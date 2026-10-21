import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
export function createPasskeys(db,{user,accountFor,tokenHash,session,atomic,onEvent}){
 const forbidden=()=>Object.assign(Error('Zaloguj się ponownie, aby zarządzać kluczami.'),{status:403});
 function context(req){
  const value=process.env.WEBAUTHN_ORIGIN||req.headers.origin;
  let origin;try{origin=new URL(value);}catch{throw Error('Otwórz aplikację przez localhost lub skonfiguruj jej adres HTTPS.');}
  const local=['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
  if(!process.env.WEBAUTHN_ORIGIN&&!local)throw Error('Ustaw WEBAUTHN_ORIGIN na publiczny adres HTTPS aplikacji.');
  if(origin.protocol!=='https:'&&!(local&&origin.protocol==='http:'))throw Error('Klucz dostępu wymaga HTTPS lub localhost.');
  if(req.headers.origin!==origin.origin)throw Error('Adres strony nie pasuje do konfiguracji kluczy dostępu.');
  return {origin:origin.origin,rpID:origin.hostname};
 }
 function account(req,verified){const a=verified?user(req):accountFor(req);if(a?.role!=='admin')throw forbidden();return a;}
 function saveChallenge(req,a,kind,challenge,ctx){db.prepare('DELETE FROM passkey_challenges WHERE expires_at<=?').run(Date.now());db.prepare('INSERT OR REPLACE INTO passkey_challenges VALUES(?,?,?,?,?,?,?)').run(tokenHash(req),a.id,kind,challenge,ctx.origin,ctx.rpID,Date.now()+300000);}
 function takeChallenge(req,a,kind){const hash=tokenHash(req),c=db.prepare('SELECT * FROM passkey_challenges WHERE token_hash=? AND user_id=? AND kind=? AND expires_at>?').get(hash,a.id,kind,Date.now());if(!c)throw Error('Potwierdzenie wygasło. Rozpocznij ponownie.');db.prepare('DELETE FROM passkey_challenges WHERE token_hash=?').run(hash);const ctx=context(req);if(ctx.origin!==c.origin||ctx.rpID!==c.rp_id)throw Error('Nieprawidłowy adres potwierdzenia.');return c;}
 function active(req,a,verified){if(account(req,verified).id!==a.id)throw forbidden();}
 async function route(req,res,path,body,send){
  const suffix=path.slice('/api/auth/passkeys'.length);
  if(req.method==='GET'&&suffix===''){const a=account(req,true);return send(200,{items:db.prepare('SELECT id,label,created_at,last_used_at FROM passkeys WHERE user_id=? ORDER BY created_at').all(a.id)});}
  if(req.method!=='POST')return send(404,{error:'Nieznana operacja.'});
  const registration=suffix.startsWith('/register'),a=account(req,registration||suffix==='/remove');
  if(suffix==='/remove'){const result=db.prepare('DELETE FROM passkeys WHERE id=? AND user_id=?').run(String(body.id),a.id);if(!result.changes)throw Error('Nie znaleziono klucza.');onEvent('passkey.removed',a.id);return send(200,{ok:true});}
  if(suffix==='/register/options'){
   const ctx=context(req),existing=db.prepare('SELECT id,transports FROM passkeys WHERE user_id=?').all(a.id);
   if(existing.length>=10)throw Error('Możesz dodać maksymalnie 10 kluczy.');
   const options=await generateRegistrationOptions({rpName:'Evolution Academy',rpID:ctx.rpID,userID:Buffer.from('evolution-admin-'+a.id),userName:a.email,userDisplayName:a.name,attestationType:'none',supportedAlgorithmIDs:[-7,-257],authenticatorSelection:{residentKey:'preferred',userVerification:'required'},preferredAuthenticatorType:'remoteDevice',excludeCredentials:existing.map(k=>({id:k.id,transports:JSON.parse(k.transports)}))});
   active(req,a,true);saveChallenge(req,a,'register',options.challenge,ctx);return send(200,options);
  }
  if(suffix==='/register/verify'){
   const c=takeChallenge(req,a,'register'),label=typeof body.label==='string'?body.label.trim():'';if(!label||label.length>100)throw Error('Podaj nazwę urządzenia do 100 znaków.');
   const result=await verifyRegistrationResponse({response:body.response,expectedChallenge:c.challenge,expectedOrigin:c.origin,expectedRPID:c.rp_id,requireUserVerification:true});
   active(req,a,true);if(!result.verified||!result.registrationInfo)throw Error('Nie udało się potwierdzić klucza.');
   const credential=result.registrationInfo.credential;
   atomic(()=>{db.prepare('INSERT INTO passkeys(id,user_id,public_key,counter,transports,label,created_at) VALUES(?,?,?,?,?,?,?)').run(credential.id,a.id,Buffer.from(credential.publicKey),credential.counter,JSON.stringify(credential.transports||[]),label,new Date().toISOString());onEvent('passkey.registered',a.id);});return send(201,{ok:true});
  }
  if(suffix==='/authenticate/options'){
   if(user(req))throw Error('Konto jest już zalogowane.');const ctx=context(req),keys=db.prepare('SELECT id,transports FROM passkeys WHERE user_id=?').all(a.id);if(!keys.length)throw Error('Nie dodano klucza. Użyj Authenticatora.');
   const options=await generateAuthenticationOptions({rpID:ctx.rpID,userVerification:'required',allowCredentials:keys.map(k=>({id:k.id,transports:JSON.parse(k.transports)}))});active(req,a,false);saveChallenge(req,a,'authenticate',options.challenge,ctx);return send(200,options);
  }
  if(suffix==='/authenticate/verify'){
   const c=takeChallenge(req,a,'authenticate'),key=db.prepare('SELECT * FROM passkeys WHERE id=? AND user_id=?').get(String(body.response?.id),a.id);if(!key)throw Error('Ten klucz nie należy do konta.');
   const result=await verifyAuthenticationResponse({response:body.response,expectedChallenge:c.challenge,expectedOrigin:c.origin,expectedRPID:c.rp_id,credential:{id:key.id,publicKey:new Uint8Array(key.public_key),counter:key.counter,transports:JSON.parse(key.transports)},requireUserVerification:true});
   active(req,a,false);if(!result.verified)throw Error('Nie udało się potwierdzić logowania.');
   atomic(()=>{const updated=db.prepare('UPDATE passkeys SET counter=?,last_used_at=? WHERE id=? AND user_id=? AND counter=?').run(result.authenticationInfo.newCounter,new Date().toISOString(),key.id,a.id,key.counter);if(!updated.changes)throw Error('Klucz zmienił się. Spróbuj ponownie.');db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash(req));session(res,a.id,true);onEvent('passkey.verified',a.id);});return send(200,{ok:true});
  }
  return send(404,{error:'Nieznana operacja klucza.'});
 }
 return {route};
}
