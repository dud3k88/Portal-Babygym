import {createPasskeys} from './passkeys.js';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createSecurity, base32, matchingStep } from './security.js';
const scrypt = promisify(scryptCallback);
const digest = value => createHash('sha256').update(value).digest('hex');
const safeUser = user => user ? { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, access_status: user.access_status } : null;
export function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw Error('Podaj poprawny adres email.');
  return value.trim().toLowerCase();
}
function required(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error('Uzupełnij pole: ' + label);
  return value.trim();
}
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) throw Error('Hasło musi mieć od 10 do 200 znaków.');
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
async function matches(password, stored) {
  const [salt, hash] = (stored || 'invalid:' + '0'.repeat(128)).split(':');
  const actual = await scrypt(typeof password === 'string' ? password.slice(0, 200) : '', salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex')) && Boolean(stored);
}
// Bootstrap the original schema; migration 2 expands the stored CHECK to three roles.
export function createAuth(db, onEvent = () => {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK(role IN ('admin','parent')), password_hash TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS invitations(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);`);
  const attempts = new Map();
  const security=createSecurity(db);
  const tokenHash=req=>{
    const token=(req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith('ea_session='))?.slice(11);
    return token&&/^[a-f0-9]{64}$/.test(token)?digest(token):null;
  };
  function needsSetup() { return !db.prepare("SELECT id FROM users WHERE role='admin'").get(); }
  function accountFor(req) {
    const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('ea_session='))?.slice(11);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const account=db.prepare("SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.access_status='active'").get(digest(token), Date.now());
    if(account?.role==='trainer'&&!db.prepare("SELECT id FROM trainers WHERE user_id=? AND status='active'").get(account.id))return null;
    return safeUser(account);
  }
  function user(req) {
    const account=accountFor(req);
    if(account?.role==='admin'&&!db.prepare('SELECT 1 FROM mfa_verified WHERE token_hash=?').get(tokenHash(req)))return null;
    return account;
  }
  function status(req) {
    const account=accountFor(req),current=user(req);
    return {user:current,needs_setup:needsSetup(),mfa_required:account?.role==='admin'&&!current,
      passkey_available:account?.role==='admin'?Boolean(db.prepare('SELECT 1 FROM passkeys WHERE user_id=?').get(account.id)):false,
      mfa_enrolled:account?.role==='admin'?Boolean(db.prepare('SELECT 1 FROM admin_mfa WHERE user_id=?').get(account.id)):false};
  }
  function atomic(work) {
    db.exec('SAVEPOINT auth_action');
    try { const result=work();db.exec('RELEASE auth_action');return result; }
    catch(error) { db.exec('ROLLBACK TO auth_action');db.exec('RELEASE auth_action');throw error; }
  }
  function session(res, userId, verified=false) {
    if (!db.prepare("SELECT id FROM users WHERE id=? AND access_status='active'").get(userId)) throw Error('Konto nie ma aktywnego dostępu.');
    const account=db.prepare('SELECT role FROM users WHERE id=?').get(userId);
    if(account.role==='trainer'&&!db.prepare("SELECT id FROM trainers WHERE user_id=? AND status='active'").get(userId))throw Object.assign(Error('Brak aktywnego profilu trenera.'),{status:403});
    const token = randomBytes(32).toString('hex');
    atomic(()=>{
      db.prepare('DELETE FROM auth_sessions WHERE expires_at<?').run(Date.now());
      db.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run(digest(token), userId, Date.now() + (account.role==='admin'&&!verified?600000:7*86400000));
      if(account.role==='admin'&&verified)db.prepare('INSERT INTO mfa_verified VALUES(?)').run(digest(token));
      onEvent('session.started',userId);
    });
    res.setHeader('Set-Cookie', `ea_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
  }
  function invite(userId, expectedRole='parent') {
    const parent = db.prepare("SELECT * FROM users WHERE id=? AND role=?").get(userId,expectedRole);
    if (!parent) throw Error('Nie znaleziono konta do aktywacji.');
    if (parent.access_status !== 'active') throw Error('Najpierw odblokuj dostęp do konta.');
    if (parent.password_hash) throw Error('Konto jest już aktywowane.');
    const token = randomBytes(32).toString('hex');
    atomic(()=>{
      db.prepare('DELETE FROM invitations WHERE user_id=?').run(userId);
      db.prepare('INSERT INTO invitations VALUES(?,?,?)').run(digest(token), userId, Date.now() + 86400000);
      onEvent('invitation.created',userId);
    });
    return token;
  }
  const passkeys=createPasskeys(db,{user,accountFor,tokenHash,session,atomic,onEvent});
  async function route(req, res, path, body, send) {
    if(req.method==='GET'&&path==='/api/auth/passkeys')return passkeys.route(req,res,path,body,send);
    if (req.method === 'GET' && path === '/api/auth/status') return send(200,status(req));
    if (req.method !== 'POST') return send(404, { error: 'Nie znaleziono operacji.' });
    const key = req.socket.remoteAddress;
    const now = Date.now();
    if (attempts.size > 1000) for (const [ip, attempt] of attempts) if (attempt.until < now) attempts.delete(ip);
    const bucket = attempts.get(key);
    if (path !== '/api/auth/logout') {
      if (bucket && bucket.until > now && bucket.count >= 30) return send(429, { error: 'Zbyt wiele prób. Spróbuj ponownie za 15 minut.' });
      attempts.set(key, bucket && bucket.until > now ? { ...bucket, count: bucket.count + 1 } : { until: now + 900000, count: 1 });
    }
    if(path.startsWith('/api/auth/passkeys/'))return passkeys.route(req,res,path,body,send);
    if (path === '/api/auth/logout') {
      const current=user(req);
      const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('ea_session='))?.slice(11);
      atomic(()=>{
        if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(token));
        if(current) onEvent('session.ended',current.id);
      });
      res.setHeader('Set-Cookie', 'ea_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return send(200, { ok: true });
    }
    if(path==='/api/auth/mfa/setup'||path==='/api/auth/mfa/verify') {
      const account=accountFor(req),hash=tokenHash(req);
      if(account?.role!=='admin'||user(req))return send(403,{error:'Najpierw zaloguj się hasłem administratora.'});
      const stored=db.prepare('SELECT * FROM admin_mfa WHERE user_id=?').get(account.id);
      if(path.endsWith('/setup')) {
        if(stored)throw Error('MFA jest już skonfigurowane.');
        let pending=db.prepare('SELECT secret FROM mfa_pending WHERE token_hash=?').get(hash);
        if(!pending){const secret=security.encrypt(base32(randomBytes(20)));db.prepare('INSERT INTO mfa_pending VALUES(?,?)').run(hash,secret);pending={secret};}
        return send(200,{secret:security.decrypt(pending.secret),email:account.email});
      }
      security.checkAttempt(account.id);
      const pending=stored||db.prepare('SELECT secret FROM mfa_pending WHERE token_hash=?').get(hash);
      if(!pending)throw Error('Najpierw dodaj konto do aplikacji uwierzytelniającej.');
      const step=matchingStep(security.decrypt(pending.secret),String(body.code||'').trim(),stored?.last_step??-1);
      const recovery=stored&&db.prepare('SELECT 1 FROM mfa_recovery WHERE user_id=? AND code_hash=?').get(account.id,digest(String(body.code||'').trim().toLowerCase()));
      if(step===null&&!recovery)throw Error('Nieprawidłowy lub już użyty kod. Poczekaj na kolejny kod w aplikacji.');
      if(body.replace_device) {
        if(!recovery)throw Error('Do konfiguracji nowego telefonu użyj niewykorzystanego kodu zapasowego.');
        atomic(()=>{
          db.prepare('DELETE FROM admin_mfa WHERE user_id=?').run(account.id);
          db.prepare('DELETE FROM mfa_recovery WHERE user_id=?').run(account.id);
          db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(account.id);
          security.clearAttempts(account.id);
          onEvent('mfa.device_replaced',account.id);
          session(res,account.id);
        });
        return send(200,{reenroll:true});
      }
      let codes;
      atomic(()=>{
        if(!stored) {
          db.prepare('INSERT INTO admin_mfa VALUES(?,?,?)').run(account.id,pending.secret,step);
          codes=Array.from({length:10},()=>randomBytes(8).toString('hex'));
          for(const code of codes)db.prepare('INSERT INTO mfa_recovery VALUES(?,?)').run(account.id,digest(code));
          // Invalidate other pending enrollment sessions, including pre-upgrade ones.
          db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(account.id);
          onEvent('mfa.enrolled',account.id);
        }else{
          if(recovery)db.prepare('DELETE FROM mfa_recovery WHERE user_id=? AND code_hash=?').run(account.id,digest(String(body.code).trim().toLowerCase()));
          else db.prepare('UPDATE admin_mfa SET last_step=? WHERE user_id=?').run(step,account.id);
          db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash);
          onEvent(recovery?'mfa.recovery_used':'mfa.verified',account.id);
        }
        security.clearAttempts(account.id);
        session(res,account.id,true);
      });
      return send(200,{ok:true,recovery_codes:codes});
    }
    if(path==='/api/auth/forgot') {
      if(!process.env.SECURITY_OUTBOX_DIR)return send(503,{error:'Odzyskiwanie hasła wymaga skonfigurowania dostarczania linków. Skontaktuj się z administratorem.'});
      const email=emailAddress(body.email),account=db.prepare("SELECT * FROM users WHERE email=? AND access_status='active' AND password_hash IS NOT NULL").get(email);
      if(account) {
        const token=randomBytes(32).toString('hex');
        atomic(()=>{
          db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires_at<=?').run(account.id,Date.now());
          db.prepare('INSERT INTO password_resets VALUES(?,?,?,?)').run(digest(token),account.id,email,Date.now()+1800000);
          security.deliver('reset',email,token);
          onEvent('password.reset_requested',account.id);
        });
      }
      return send(200,{ok:true,message:'Jeśli konto jest aktywne, link trafił do lokalnej skrzynki testowej. W tej wersji nie wysyłamy emaili.'});
    }
    if(path==='/api/auth/reset') {
      const token=digest(String(body.token||''));
      const valid=()=>db.prepare("SELECT r.* FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires_at>? AND u.email=r.email AND u.access_status='active'").get(token,Date.now());
      if(!valid())throw Error('Link wygasł lub został wykorzystany.');
      const hash=await passwordHash(body.password);
      atomic(()=>{
        const reset=valid();if(!reset)throw Error('Link wygasł lub został wykorzystany.');
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,reset.user_id);
        invalidate(reset.user_id);
        onEvent('password.reset_completed',reset.user_id);
      });
      return send(200,{ok:true});
    }
    if (path === '/api/auth/setup' || path === '/api/auth/register') {
      const setup = path.endsWith('/setup');
      if (setup && !needsSetup()) return send(403, { error: 'Konto administratora jest już utworzone.' });
      if (!setup && needsSetup()) return send(403, { error: 'Najpierw skonfiguruj konto administratora na komputerze obsługującym aplikację.' });
      const email = emailAddress(body.email), name = required(body.name, 'imię i nazwisko'), phone = body.phone ? required(body.phone, 'telefon') : '';
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw Error('Konto z tym adresem już istnieje. Zaloguj się lub poproś administratora o aktywację.');
      const hash = await passwordHash(body.password);
      // The one-time setup is checked again after asynchronous password hashing.
      if (setup && !needsSetup()) return send(403, { error: 'Konto administratora jest już utworzone.' });
      const id = Number(db.prepare('INSERT INTO users(name,email,phone,role,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(name, email, phone, setup ? 'admin' : 'parent', hash, new Date().toISOString()).lastInsertRowid);
      session(res, id);
      return send(201, { user: setup?null:safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)),mfa_required:setup });
    }
    if (path === '/api/auth/login') {
      const email = emailAddress(body.email);
      const account = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (!await matches(body.password, account?.password_hash)) return send(401, { error: 'Nieprawidłowy email lub hasło. Dla przeniesionych danych potrzebny jest link aktywacyjny od administratora.' });
      const current=db.prepare('SELECT * FROM users WHERE id=?').get(account.id);
      if(!current||current.email!==email||current.password_hash!==account.password_hash)return send(401,{error:'Dane logowania zmieniły się. Zaloguj się ponownie.'});
      if(current.access_status!=='active') return send(403,{error:'Dostęp do konta został zablokowany. Skontaktuj się z administratorem.'});
      session(res, account.id);
      return send(200, { user: current.role==='admin'?null:safeUser(current),mfa_required:current.role==='admin' });
    }
    if (path === '/api/auth/activate') {
      const invitation = db.prepare('SELECT * FROM invitations WHERE token_hash=? AND expires_at>?').get(digest(String(body.token)), Date.now());
      if (!invitation) throw Error('Link aktywacyjny wygasł lub został wykorzystany.');
      const hash = await passwordHash(body.password);
      db.exec('BEGIN IMMEDIATE');
      try {
        const valid = db.prepare('SELECT * FROM invitations WHERE token_hash=? AND expires_at>?').get(digest(String(body.token)), Date.now());
        if (!valid || db.prepare('SELECT access_status FROM users WHERE id=?').get(valid.user_id)?.access_status!=='active') throw Error('Link aktywacyjny wygasł lub został wykorzystany.');
        db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash IS NULL').run(hash, valid.user_id);
        db.prepare('DELETE FROM invitations WHERE user_id=?').run(valid.user_id);
        onEvent('account.activated',valid.user_id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      session(res, invitation.user_id);
      return send(200, { ok: true });
    }
    return send(404, { error: 'Nie znaleziono operacji.' });
  }
  function invalidate(userId) {
    for(const table of ['auth_sessions','invitations','password_resets'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(userId);
    db.prepare('DELETE FROM guardian_invitations WHERE invited_by=? OR email=(SELECT email FROM users WHERE id=?)').run(userId,userId);
  }
  return { user, route, invite, session, invalidate, deliver:security.deliver, validateSecurity:security.validateKey };
}
