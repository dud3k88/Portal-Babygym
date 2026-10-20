import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

export const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes) {
  let bits=0,value=0,result='';
  for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;result+=alphabet[(value>>>bits)&31];}}
  if(bits)result+=alphabet[(value<<(5-bits))&31];
  return result;
}
export function totp(secret,step=Math.floor(Date.now()/30000)) {
  let bits=0,value=0;const bytes=[];
  for(const char of secret){const n=alphabet.indexOf(char);if(n<0)throw Error('Nieprawidłowy klucz MFA.');value=(value<<5)|n;bits+=5;if(bits>=8){bits-=8;bytes.push((value>>>bits)&255);}}
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
  const hash=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),offset=hash[19]&15;
  return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
export function matchingStep(secret,code,lastStep=-1) {
  if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
  const now=Math.floor(Date.now()/30000);
  for(const step of [now,now-1,now+1])if(step>lastStep&&timingSafeEqual(Buffer.from(totp(secret,step)),Buffer.from(code)))return step;
  return null;
}
export function createSecurity(db) {
  let key;
  const keyPath=resolve(process.env.MFA_KEY_PATH||(process.env.DB_PATH||'data/evolution.sqlite')+'.mfa-key');
  function encryptionKey() {
    if(key)return key;
    if(process.env.MFA_ENCRYPTION_KEY) {
      if(!/^[a-f0-9]{64}$/i.test(process.env.MFA_ENCRYPTION_KEY))throw Error('MFA_ENCRYPTION_KEY musi zawierać 64 znaki hex.');
      return key=Buffer.from(process.env.MFA_ENCRYPTION_KEY,'hex');
    }
    if(!existsSync(keyPath)) {
      if(db.prepare('SELECT 1 FROM admin_mfa LIMIT 1').get()||db.prepare('SELECT 1 FROM mfa_pending LIMIT 1').get())throw Error('Brak klucza szyfrowania MFA. Odtwórz właściwy klucz z kopii.');
      writeFileSync(keyPath,randomBytes(32),{flag:'wx',mode:0o600});
    }
    if(statSync(keyPath).mode&0o077)throw Error('Klucz MFA wymaga uprawnień 0600.');
    key=readFileSync(keyPath);if(key.length!==32)throw Error('Nieprawidłowy klucz szyfrowania MFA.');
    return key;
  }
  const encrypt=value=>{
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
    return Buffer.concat([iv,cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');
  };
  const decrypt=value=>{
    const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',encryptionKey(),bytes.subarray(0,12));
    cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString('utf8');
  };
  function checkAttempt(userId) {
    const entry=db.prepare('SELECT * FROM mfa_attempts WHERE user_id=?').get(userId),now=Date.now();
    if(entry&&entry.until_at>now&&entry.count>=5)throw Object.assign(Error('Zbyt wiele prób MFA. Spróbuj za 15 minut.'),{status:429});
    db.prepare('INSERT INTO mfa_attempts VALUES(?,1,?) ON CONFLICT(user_id) DO UPDATE SET count=CASE WHEN until_at>? THEN count+1 ELSE 1 END,until_at=CASE WHEN until_at>? THEN until_at ELSE excluded.until_at END').run(userId,now+900000,now,now);
  }
  function clearAttempts(userId){db.prepare('DELETE FROM mfa_attempts WHERE user_id=?').run(userId);}
  function deliver(kind,email,token,extra={}) {
    if(!process.env.SECURITY_OUTBOX_DIR)throw Object.assign(Error('Dostarczanie linków nie jest skonfigurowane. Skontaktuj się z administratorem.'),{status:503});
    const directory=resolve(process.env.SECURITY_OUTBOX_DIR);mkdirSync(directory,{recursive:true,mode:0o700});
    if(statSync(directory).mode&0o077)throw Error('Skrzynka testowa wymaga uprawnień 0700.');
    const hash=kind==='reset'?'reset':'guardian';
    const file=join(directory,randomBytes(16).toString('hex')+'.json');
    // Explicit local sandbox, never a public HTTP inbox or a real email send.
    writeFileSync(file,JSON.stringify({mode:'sandbox',kind,to:email,path:`/#${hash}/${token}`,created_at:new Date().toISOString(),...extra},null,2),{flag:'wx',mode:0o600});
  }
  function validateKey() {
    const stored=db.prepare('SELECT secret FROM admin_mfa UNION ALL SELECT secret FROM mfa_pending LIMIT 1').get();
    if(stored)try{decrypt(stored.secret);}catch{throw Error('Nie można odczytać MFA. Odtwórz właściwy MFA_KEY_PATH / MFA_ENCRYPTION_KEY z kopii.');}
  }
  return {encrypt,decrypt,checkAttempt,clearAttempts,deliver,validateKey};
}
