import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const digest = value => createHash('sha256').update(value).digest('hex');
const safeUser = user => user ? { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } : null;
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
export function createAuth(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK(role IN ('admin','parent')), password_hash TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS invitations(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);`);
  const attempts = new Map();
  function needsSetup() { return !db.prepare("SELECT id FROM users WHERE role='admin'").get(); }
  function user(req) {
    const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('ea_session='))?.slice(11);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return safeUser(db.prepare('SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token), Date.now()));
  }
  function session(res, userId) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM auth_sessions WHERE expires_at<?').run(Date.now());
    db.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run(digest(token), userId, Date.now() + 7 * 86400000);
    res.setHeader('Set-Cookie', `ea_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
  }
  function invite(userId) {
    const parent = db.prepare("SELECT * FROM users WHERE id=? AND role='parent'").get(userId);
    if (!parent) throw Error('Nie znaleziono rodzica.');
    if (parent.password_hash) throw Error('Rodzic ma już aktywne konto.');
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM invitations WHERE user_id=?').run(userId);
    db.prepare('INSERT INTO invitations VALUES(?,?,?)').run(digest(token), userId, Date.now() + 86400000);
    return token;
  }
  async function route(req, res, path, body, send) {
    if (req.method === 'GET' && path === '/api/auth/status') return send(200, { user: user(req), needs_setup: needsSetup() });
    if (req.method !== 'POST') return send(404, { error: 'Nie znaleziono operacji.' });
    const key = req.socket.remoteAddress;
    const now = Date.now();
    if (attempts.size > 1000) for (const [ip, attempt] of attempts) if (attempt.until < now) attempts.delete(ip);
    const bucket = attempts.get(key);
    if (path !== '/api/auth/logout') {
      if (bucket && bucket.until > now && bucket.count >= 30) return send(429, { error: 'Zbyt wiele prób. Spróbuj ponownie za 15 minut.' });
      attempts.set(key, bucket && bucket.until > now ? { ...bucket, count: bucket.count + 1 } : { until: now + 900000, count: 1 });
    }
    if (path === '/api/auth/logout') {
      const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('ea_session='))?.slice(11);
      if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(token));
      res.setHeader('Set-Cookie', 'ea_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return send(200, { ok: true });
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
      return send(201, { user: safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
    }
    if (path === '/api/auth/login') {
      const email = emailAddress(body.email);
      const account = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (!await matches(body.password, account?.password_hash)) return send(401, { error: 'Nieprawidłowy email lub hasło. Dla przeniesionych danych potrzebny jest link aktywacyjny od administratora.' });
      session(res, account.id);
      return send(200, { user: safeUser(account) });
    }
    if (path === '/api/auth/activate') {
      const invitation = db.prepare('SELECT * FROM invitations WHERE token_hash=? AND expires_at>?').get(digest(String(body.token)), Date.now());
      if (!invitation) throw Error('Link aktywacyjny wygasł lub został wykorzystany.');
      const hash = await passwordHash(body.password);
      db.exec('BEGIN IMMEDIATE');
      try {
        const valid = db.prepare('SELECT * FROM invitations WHERE token_hash=? AND expires_at>?').get(digest(String(body.token)), Date.now());
        if (!valid) throw Error('Link aktywacyjny wygasł lub został wykorzystany.');
        db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash IS NULL').run(hash, valid.user_id);
        db.prepare('DELETE FROM invitations WHERE user_id=?').run(valid.user_id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      session(res, invitation.user_id);
      return send(200, { ok: true });
    }
    return send(404, { error: 'Nie znaleziono operacji.' });
  }
  return { user, route, invite, session };
}
