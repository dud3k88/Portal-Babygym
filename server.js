import http from 'node:http';
import { migrateFoundations } from './migrations.js';
import { configureAudit, withRequestContext, requestContext, recordAccess } from './audit.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { calculateCharge, warsawNow, enrollmentMonth } from './billing.js';
import { generateSchedule, validDate, isExcluded } from './schedule.js';
import { createAuth, emailAddress, passwordHash } from './auth.js';
mkdirSync('data', { recursive: true });
const logoPath = process.env.LOGO_PATH || 'data/logo';
const db = new DatabaseSync(process.env.DB_PATH || 'data/evolution.sqlite');
configureAudit(db);
const legacyBackfillDone = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() && db.prepare('SELECT version FROM schema_migrations WHERE version=1').get());
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, location TEXT NOT NULL, name TEXT NOT NULL, capacity INTEGER NOT NULL, price INTEGER NOT NULL, trial_price INTEGER NOT NULL, trials INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, group_id INTEGER REFERENCES groups(id), starts_at TEXT NOT NULL, price INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS enrollments(id INTEGER PRIMARY KEY, group_id INTEGER REFERENCES groups(id), parent TEXT NOT NULL, email TEXT NOT NULL, child TEXT NOT NULL, month TEXT NOT NULL, trial_id INTEGER REFERENCES sessions(id), amount INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS adjustments(id INTEGER PRIMARY KEY, enrollment_id INTEGER REFERENCES enrollments(id), amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);`);
const all = (sql, ...args) => db.prepare(sql).all(...args);
// Additive migration: preserve databases created by the first prototype.
for(const [table,column,type] of [['groups','start_date','TEXT'],['groups','end_date','TEXT'],['groups','start_time','TEXT'],['groups','end_time','TEXT'],['groups','weekday','INTEGER'],['sessions','ends_at','TEXT']]) {
 if(!all(`PRAGMA table_info(${table})`).some(c=>c.name===column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS exclusions(id INTEGER PRIMARY KEY, start_date TEXT NOT NULL, end_date TEXT NOT NULL, scope TEXT NOT NULL, location TEXT, group_id INTEGER REFERENCES groups(id), reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS enrollment_sessions(enrollment_id INTEGER REFERENCES enrollments(id), session_id INTEGER REFERENCES sessions(id), price INTEGER NOT NULL, PRIMARY KEY(enrollment_id,session_id));`);
db.exec(`CREATE TABLE IF NOT EXISTS trainers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS group_trainers(group_id INTEGER NOT NULL REFERENCES groups(id), trainer_id INTEGER NOT NULL REFERENCES trainers(id), PRIMARY KEY(group_id,trainer_id));`);
// Registered locations use stable IDs; names stay available for older records and views.
db.exec(`CREATE TABLE IF NOT EXISTS locations(id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE);`);
for(const table of ['groups','exclusions']) {
 if(!all(`PRAGMA table_info(${table})`).some(c=>c.name==='location_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN location_id INTEGER REFERENCES locations(id)`);
}
const cleanLocationName=value=>value.normalize('NFKC').trim().replace(/\s+/gu,' ');
const locationKey=value=>cleanLocationName(value).toLocaleLowerCase('pl-PL');
db.exec('BEGIN IMMEDIATE');
try {
 for(const table of ['groups','exclusions']) {
  for(const row of all(`SELECT id,location FROM ${table} WHERE location_id IS NULL AND location IS NOT NULL${table==='exclusions'?" AND scope='location'":''} ORDER BY id`)) {
   const name=cleanLocationName(row.location);
   db.prepare('INSERT OR IGNORE INTO locations(name,name_key) VALUES(?,?)').run(name,locationKey(name));
   const entry=db.prepare('SELECT * FROM locations WHERE name_key=?').get(locationKey(name));
   db.prepare(`UPDATE ${table} SET location_id=?,location=? WHERE id=?`).run(entry.id,entry.name,row.id);
  }
 }
 db.exec('COMMIT');
} catch(error){db.exec('ROLLBACK');throw error;}
if(!all('PRAGMA table_info(sessions)').some(c=>c.name==='location_id')) db.exec('ALTER TABLE sessions ADD COLUMN location_id INTEGER REFERENCES locations(id)');
db.exec('UPDATE sessions SET location_id=(SELECT location_id FROM groups WHERE groups.id=sessions.group_id) WHERE location_id IS NULL');
const auth=createAuth(db, (action,id)=>recordAccess(db,action,id));
db.exec(`CREATE TABLE IF NOT EXISTS athletes(id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, birth_date TEXT, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(group_id INTEGER NOT NULL REFERENCES groups(id), athlete_id INTEGER NOT NULL REFERENCES athletes(id), status TEXT NOT NULL DEFAULT 'active', joined_at TEXT NOT NULL, trial_id INTEGER REFERENCES sessions(id), PRIMARY KEY(group_id,athlete_id));`);
if(!all('PRAGMA table_info(enrollments)').some(c=>c.name==='athlete_id')) db.exec('ALTER TABLE enrollments ADD COLUMN athlete_id INTEGER REFERENCES athletes(id)');
if(!all('PRAGMA table_info(sessions)').some(c=>c.name==='cancelled')) db.exec('ALTER TABLE sessions ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0');
// Convert legacy records once; never resurrect future withdrawals on restart.
if (!legacyBackfillDone) {
db.exec('BEGIN IMMEDIATE');
try {
 for(const e of all('SELECT * FROM enrollments WHERE athlete_id IS NULL ORDER BY id')) {
  const email=e.email.trim().toLowerCase();
  let parent=db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if(!parent) parent={id:Number(db.prepare("INSERT INTO users(name,email,role,created_at) VALUES(?,?,'parent',?)").run(e.parent,email,e.created_at).lastInsertRowid)};
  let athlete=db.prepare('SELECT id FROM athletes WHERE parent_id=? AND name=?').get(parent.id,e.child);
  if(!athlete) athlete={id:Number(db.prepare('INSERT INTO athletes(parent_id,name,created_at) VALUES(?,?,?)').run(parent.id,e.child,e.created_at).lastInsertRowid)};
  db.prepare('UPDATE enrollments SET athlete_id=? WHERE id=?').run(athlete.id,e.id);
 }
 for(const e of all('SELECT * FROM enrollments ORDER BY id')) {
  db.prepare('INSERT OR IGNORE INTO memberships(group_id,athlete_id,status,joined_at,trial_id) VALUES(?,?,?,?,?)').run(e.group_id,e.athlete_id,e.trial_id?'trial':'active',e.created_at,e.trial_id);
  if(!e.trial_id) db.prepare("UPDATE memberships SET status='active',trial_id=NULL WHERE group_id=? AND athlete_id=?").run(e.group_id,e.athlete_id);
 }
 db.exec('COMMIT');
} catch(error){db.exec('ROLLBACK');throw error;}
}
function sessionsWithStatus() {
 const groups=all('SELECT * FROM groups'), exclusions=all('SELECT * FROM exclusions');
 return all('SELECT * FROM sessions ORDER BY starts_at').map(s=>({...s,excluded:Boolean(s.cancelled)||isExcluded(s,groups.find(g=>g.id===s.group_id),exclusions)}));
}
// Backfill the original charged terms once for existing enrollments.
if (!legacyBackfillDone) for(const e of all('SELECT * FROM enrollments WHERE id NOT IN (SELECT enrollment_id FROM enrollment_sessions)')) {
 const terms=all('SELECT * FROM sessions WHERE group_id=? AND substr(starts_at,1,7)=? AND starts_at>=?',e.group_id,e.month,e.created_at).filter(s=>!e.trial_id||s.id===e.trial_id);
 for(const term of terms) db.prepare('INSERT OR IGNORE INTO enrollment_sessions VALUES(?,?,?)').run(e.id,term.id,e.trial_id?e.amount:term.price);
}
migrateFoundations(db);
function chargedTotals() {
 const active=new Set(sessionsWithStatus().filter(s=>!s.excluded).map(s=>s.id));
 const totals=new Map();
 for(const item of all('SELECT * FROM enrollment_sessions')) totals.set(item.enrollment_id,(totals.get(item.enrollment_id)||0)+(active.has(item.session_id)?item.price:0));
 return totals;
}
function reconcileExclusions(before,reason) {
 for(const [id,amount] of chargedTotals()) {
  const difference=amount-(before.get(id)||0);
  if(difference) db.prepare('INSERT INTO adjustments(enrollment_id,amount,reason,created_at) VALUES(?,?,?,?)').run(id,difference,'Automatycznie: '+reason,warsawNow());
 }
}

const text = (v, label) => { if (typeof v !== 'string' || !v.trim() || v.length > 200) throw Error(`Uzupełnij pole: ${label}`); return v.trim(); };
const integer = (v, min, max) => { if (!Number.isSafeInteger(v) || v < min || v > max) throw Error('Nieprawidłowa kwota lub liczba miejsc.'); return v; };
function group(id) { const g = db.prepare('SELECT * FROM groups WHERE id=?').get(Number(id)); if (!g) throw Error('Nie znaleziono grupy.'); return g; }
function locationById(id) {
 const value=Number(id);
 if(!Number.isSafeInteger(value)||value<1) throw Error('Wybierz lokalizację z listy.');
 const entry=db.prepare('SELECT * FROM locations WHERE id=?').get(value);
 if(!entry) throw Error('Nie znaleziono lokalizacji. Dodaj ją najpierw w dziale „Lokalizacje”.');
 return entry;
}
function trainerIds(value=[]) {
 if(!Array.isArray(value)||value.length>100) throw Error('Wybierz trenerów z listy.');
 return [...new Set(value)].map(id=>{
  integer(id,1,Number.MAX_SAFE_INTEGER);
  if(!db.prepare('SELECT id FROM trainers WHERE id=?').get(id)) throw Error('Nie znaleziono trenera.');
  return id;
 });
}
function assignTrainers(groupId,ids) {
 db.prepare('DELETE FROM group_trainers WHERE group_id=?').run(groupId);
 for(const id of ids) db.prepare('INSERT INTO group_trainers VALUES(?,?)').run(groupId,id);
}
function quote(b) {
 const g = group(b.group_id);
 if (locationById(g.location_id).status !== 'active') throw Error('Zapisy w tej placówce są zamknięte.');
 const joinedAt=warsawNow();
 const month=enrollmentMonth(b.month,joinedAt);
 const sessions = sessionsWithStatus().filter(s=>s.group_id===g.id&&s.starts_at.startsWith(month)&&!s.excluded);
 const trial = b.trial_id ? Number(b.trial_id) : null;
 if (trial && !g.trials) throw Error('Próby nie są dostępne w tej grupie.');
 const result = calculateCharge(sessions, joinedAt, trial, g.trial_price);
 if (!result.count) throw Error('Brak przyszłych zajęć w wybranym miesiącu.');
 return { ...result, group:g, trial, joinedAt, month };
}
function athleteById(id,user) {
 const athlete=db.prepare('SELECT * FROM athletes WHERE id=?').get(Number(id));
 if(!athlete||(user.role!=='admin'&&athlete.parent_id!==user.id)) throw Object.assign(Error('Nie znaleziono zawodnika.'),{status:404});
 return athlete;
}
function stateFor(user) {
 const admin=user.role==='admin';
 const athletes=admin?all('SELECT * FROM athletes ORDER BY name'):all('SELECT id,parent_id,name,birth_date,created_at FROM athletes WHERE parent_id=? ORDER BY name',user.id);
 const ids=new Set(athletes.map(a=>a.id));
 const enrollments=all(`SELECT e.*, a.name AS child, u.name AS parent, u.email, g.name AS group_name, g.location, e.amount + COALESCE((SELECT SUM(a.amount) FROM adjustments a WHERE a.enrollment_id=e.id),0) AS balance FROM enrollments e JOIN groups g ON g.id=e.group_id JOIN athletes a ON a.id=e.athlete_id JOIN users u ON u.id=a.parent_id ORDER BY e.id DESC`).filter(e=>admin||ids.has(e.athlete_id));
 const enrollmentIds=new Set(enrollments.map(e=>e.id));
 const ownGroupIds=new Set(all('SELECT * FROM memberships').filter(m=>ids.has(m.athlete_id)).map(m=>m.group_id));
 const availableLocations=new Set(all("SELECT id FROM locations WHERE status='active'").map(l=>l.id));
 const visibleGroups=all(`SELECT g.*,(SELECT COUNT(*) FROM memberships m WHERE m.group_id=g.id AND m.status IN ('active','trial')) AS member_count FROM groups g`).filter(g=>admin||availableLocations.has(g.location_id)||ownGroupIds.has(g.id));
 const visibleIds=new Set(visibleGroups.map(g=>g.id));
 const trainerLinks=all('SELECT * FROM group_trainers').filter(gt=>admin||visibleIds.has(gt.group_id));
 const trainerIds=new Set(trainerLinks.map(gt=>gt.trainer_id));
 const visibleLocations=new Set(visibleGroups.map(g=>g.location_id));
 return {user,athletes,parents:admin?all("SELECT id,name,email,phone,access_status,password_hash IS NOT NULL AS active FROM users WHERE role='parent' ORDER BY name"):[user],memberships:all('SELECT * FROM memberships').filter(m=>admin||ids.has(m.athlete_id)),locations:admin?all('SELECT * FROM locations ORDER BY name'):all('SELECT id,name,status FROM locations ORDER BY name').filter(l=>availableLocations.has(l.id)||visibleLocations.has(l.id)),trainers:admin?all('SELECT * FROM trainers ORDER BY name'):all('SELECT id,name FROM trainers ORDER BY name').filter(t=>trainerIds.has(t.id)),group_trainers:trainerLinks,logo:existsSync(logoPath)?'/logo?v='+Date.now():null,groups:visibleGroups,sessions:sessionsWithStatus().filter(s=>admin||ownGroupIds.has(s.group_id)||(visibleIds.has(s.group_id)&&s.starts_at>=warsawNow())),exclusions:admin?all('SELECT * FROM exclusions ORDER BY start_date'):[],enrollments,adjustments:all('SELECT * FROM adjustments ORDER BY id DESC').filter(a=>admin||enrollmentIds.has(a.enrollment_id)),now:warsawNow()};
}
async function readJSON(req) {
 if(!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(Error('Wymagany format JSON.'),{status:415});
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>50000) throw Error('Zbyt duże żądanie.');}
 return JSON.parse(raw);
}
function saveEnrollment(b,athlete) {
 const parent=db.prepare('SELECT * FROM users WHERE id=?').get(athlete.parent_id);
     const q=quote(b);
     const member=db.prepare('SELECT * FROM memberships WHERE group_id=? AND athlete_id=?').get(q.group.id,athlete.id);
     const count=db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE group_id=? AND status IN ('active','trial')").get(q.group.id).n;
     if(!member&&count>=q.group.capacity) throw Error('Brak wolnych miejsc.');
     if(db.prepare('SELECT id FROM enrollments WHERE group_id=? AND month=? AND athlete_id=?').get(q.group.id,q.month,athlete.id)) throw Error('Zawodnik jest już zapisany w tej grupie w wybranym miesiącu.');
     const id=Number(db.prepare('INSERT INTO enrollments(group_id,parent,email,child,month,trial_id,amount,created_at,athlete_id) VALUES(?,?,?,?,?,?,?,?,?)').run(q.group.id,parent.name,parent.email,athlete.name,q.month,q.trial,q.amount,q.joinedAt,athlete.id).lastInsertRowid);
     db.prepare('INSERT OR IGNORE INTO memberships(group_id,athlete_id,status,joined_at,trial_id) VALUES(?,?,?,?,?)').run(q.group.id,athlete.id,q.trial?'trial':'active',q.joinedAt,q.trial);
     if(!q.trial) db.prepare("UPDATE memberships SET status='active',trial_id=NULL WHERE group_id=? AND athlete_id=?").run(q.group.id,athlete.id);
     for(const term of sessionsWithStatus().filter(s=>s.group_id===q.group.id&&s.starts_at.startsWith(q.month)&&s.starts_at>=q.joinedAt&&!s.cancelled&&(!q.trial||s.id===q.trial))) db.prepare('INSERT INTO enrollment_sessions VALUES(?,?,?)').run(id,term.id,q.trial?q.amount:term.price);

 return {id,amount:q.amount};
}

const signupAttempts=new Map();
const server = http.createServer(withRequestContext(async (req,res) => {
 const url = new URL(req.url, 'http://localhost');
 const send = (status, data) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
 try {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`) return send(403,{error:'Niedozwolone źródło żądania.'});
  requestContext.getStore().actorId = auth.user(req)?.id ?? null;
  if(url.pathname.startsWith('/api/auth/')) return await auth.route(req,res,url.pathname,req.method==='POST'?await readJSON(req):null,send);
  if(req.method==='GET'&&url.pathname==='/api/public/catalog') {
   const now=warsawNow();
   const activeLocations = all("SELECT id,name FROM locations WHERE status='active' ORDER BY name");
   const activeGroups = new Set(all("SELECT g.id FROM groups g JOIN locations l ON l.id=g.location_id WHERE l.status='active'").map(g=>g.id));
   return send(200,{logo:existsSync(logoPath)?'/logo':null,locations:activeLocations,groups:all(`SELECT id,location_id,name,capacity,price,trial_price,trials,weekday,start_time,end_time,(SELECT COUNT(*) FROM memberships m WHERE m.group_id=groups.id AND m.status IN ('active','trial')) AS member_count FROM groups`).filter(g=>activeGroups.has(g.id)),trainers:all('SELECT id,name FROM trainers WHERE id IN (SELECT gt.trainer_id FROM group_trainers gt JOIN groups g ON g.id=gt.group_id JOIN locations l ON l.id=g.location_id WHERE l.status=?) ORDER BY name','active'),group_trainers:all('SELECT * FROM group_trainers').filter(gt=>activeGroups.has(gt.group_id)),sessions:sessionsWithStatus().filter(s=>activeGroups.has(s.group_id)&&!s.cancelled&&s.starts_at>=now).map(s=>({id:s.id,group_id:s.group_id,starts_at:s.starts_at,ends_at:s.ends_at,excluded:s.excluded})),now});
  }
  if(req.method==='POST'&&url.pathname==='/api/public/quote') {
   const q=quote(await readJSON(req));return send(200,{amount:q.amount,count:q.count});
  }
  if(req.method==='POST'&&url.pathname==='/api/public/enroll') {
   const key=req.socket.remoteAddress,now=Date.now(),attempt=signupAttempts.get(key);
   if(signupAttempts.size>1000)for(const [ip,value] of signupAttempts)if(value.until<now)signupAttempts.delete(ip);
   if(attempt&&attempt.until>now&&attempt.count>=15)return send(429,{error:'Zbyt wiele prób. Spróbuj ponownie za 15 minut.'});
   signupAttempts.set(key,attempt&&attempt.until>now?{...attempt,count:attempt.count+1}:{until:now+900000,count:1});
   if(!db.prepare("SELECT id FROM users WHERE role='admin'").get())throw Error('Zapisy nie zostały jeszcze uruchomione.');
   const b=await readJSON(req);
   const childName=text(b.child_first_name,'imię dziecka')+' '+text(b.child_last_name,'nazwisko dziecka');
   const parentName=text(b.parent_first_name,'imię rodzica')+' '+text(b.parent_last_name,'nazwisko rodzica');
   if(childName.length>200||parentName.length>200)throw Error('Imię i nazwisko mogą mieć łącznie maksymalnie 200 znaków.');
   const email=emailAddress(b.email),phone=text(b.phone,'numer telefonu');
   if(!/^[+0-9\s().-]+$/.test(phone)||phone.replace(/\D/g,'').length<9||phone.replace(/\D/g,'').length>15)throw Error('Podaj poprawny numer telefonu (9–15 cyfr).');
   const birthDate=b.birth_date||null;
   if(birthDate&&(!validDate(birthDate)||birthDate>warsawNow().slice(0,10)))throw Error('Podaj poprawną datę urodzenia dziecka.');
   if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return send(409,{error:'Konto z tym adresem email już istnieje. Zaloguj się w panelu rodzica, aby zapisać dziecko. Nie twórz drugiego konta.'});
   quote(b);
   const hash=await passwordHash(b.password);
   db.exec('BEGIN IMMEDIATE');
   let parentId,result;
   try {
    if(db.prepare('SELECT id FROM users WHERE email=?').get(email))throw Error('Konto z tym adresem już istnieje. Zaloguj się w panelu rodzica.');
    parentId=Number(db.prepare("INSERT INTO users(name,email,phone,role,password_hash,created_at) VALUES(?,?,?,'parent',?,?)").run(parentName,email,phone,hash,warsawNow()).lastInsertRowid);
    const id=Number(db.prepare('INSERT INTO athletes(parent_id,name,birth_date,created_at) VALUES(?,?,?,?)').run(parentId,childName,birthDate,warsawNow()).lastInsertRowid);
    result=saveEnrollment(b,{id,parent_id:parentId,name:childName});
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   auth.session(res,parentId);
   return send(201,result);
  }
  const user=auth.user(req);
  if(url.pathname.startsWith('/api/')) {
   if(!user) return send(401,{error:'Zaloguj się, aby kontynuować.'});
   if (!['admin','parent'].includes(user.role)) return send(403,{error:'Brak dostępu dla tej roli.'});
   const parentPaths=['/api/state','/api/athletes','/api/athletes/update','/api/quote','/api/enrollments'];
   if(user.role!=='admin'&&!parentPaths.includes(url.pathname)) return send(403,{error:'Ta operacja wymaga konta administratora.'});
  }
  if(req.method==='GET'&&url.pathname==='/api/audit') {
   const before=url.searchParams.get('before');
   const limit=50;
   if(before!==null&&(!/^\d+$/.test(before)||!Number.isSafeInteger(Number(before))||Number(before)<1)) throw Error('Nieprawidłowy kursor.');
   const rows=all('SELECT a.*,u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.id<? ORDER BY a.id DESC LIMIT ?',before===null?Number.MAX_SAFE_INTEGER:Number(before),limit+1);
   const more=rows.length>limit; const items=rows.slice(0,limit);
   return send(200,{items,next_cursor:more?items.at(-1).id:null});
  }
  if (req.method === 'GET' && url.pathname === '/api/state') return send(200,stateFor(user));
  if(req.method==='GET'&&url.pathname==='/logo') {
   if(!existsSync(logoPath)) return send(404,{error:'Nie dodano logo.'});
   const logo=readFileSync(logoPath);
   res.writeHead(200,{'Content-Type':logo[0]===137?'image/png':logo[0]===255?'image/jpeg':'image/webp','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});return res.end(logo);
  }
  if(req.method==='POST'&&url.pathname==='/api/logo') {
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>5*1024*1024) throw Error('Logo może mieć maksymalnie 5 MB.');chunks.push(chunk);}
   const bytes=Buffer.concat(chunks);
   const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
   const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
   const webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
   if(!png&&!jpeg&&!webp) throw Error('Wybierz plik PNG, JPG lub WebP.');
   writeFileSync(logoPath,bytes);return send(201,{ok:true});
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
   const b=await readJSON(req);
   if(url.pathname==='/api/parents') {
    const name=text(b.name,'imię i nazwisko rodzica'),email=emailAddress(b.email),phone=b.phone?text(b.phone,'telefon'):'';
    if(db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw Error('Rodzic z tym adresem email już istnieje. Wybierz go z listy.');
    const id=Number(db.prepare("INSERT INTO users(name,email,phone,role,created_at) VALUES(?,?,?,'parent',?)").run(name,email,phone,warsawNow()).lastInsertRowid);
    return send(201,{id});
   }
   if(url.pathname==='/api/parents/access') {
    const id=integer(b.parent_id,1,Number.MAX_SAFE_INTEGER);
    if(!['active','blocked'].includes(b.access_status)) throw Error('Nieprawidłowy status konta.');
    if(!db.prepare("SELECT id FROM users WHERE id=? AND role='parent'").get(id)) throw Error('Nie znaleziono rodzica.');
    db.exec('BEGIN IMMEDIATE');
    try {
     db.prepare('UPDATE users SET access_status=? WHERE id=?').run(b.access_status,id);
     if(b.access_status==='blocked') {
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id);
      db.prepare('DELETE FROM invitations WHERE user_id=?').run(id);
     }
     db.exec('COMMIT');return send(200,{ok:true});
    }catch(error){db.exec('ROLLBACK');throw error;}
   }
   if(url.pathname==='/api/parents/invite') return send(200,{token:auth.invite(integer(b.parent_id,1,Number.MAX_SAFE_INTEGER))});
   if(url.pathname==='/api/athletes'||url.pathname==='/api/athletes/update') {
    const existing=url.pathname.endsWith('/update')?athleteById(b.id,user):null;
    const name=text(b.name,'imię i nazwisko zawodnika'),parentId=user.role==='admin'?integer(b.parent_id,1,Number.MAX_SAFE_INTEGER):user.id;
    if(!db.prepare("SELECT id FROM users WHERE id=? AND role='parent'").get(parentId)) throw Error('Wybierz rodzica z listy. Każdy zawodnik musi mieć rodzica.');
    const birthDate=b.birth_date||null;
    if(birthDate&&(!validDate(birthDate)||birthDate>warsawNow().slice(0,10))) throw Error('Podaj poprawną datę urodzenia.');
    const notes=user.role==='admin'?String(b.notes||''):(existing?.notes||'');
    if(notes.length>2000) throw Error('Notatka może mieć maksymalnie 2000 znaków.');
    if(existing) {db.prepare('UPDATE athletes SET parent_id=?,name=?,birth_date=?,notes=? WHERE id=?').run(parentId,name,birthDate,notes,existing.id);return send(200,{id:existing.id});}
    const id=Number(db.prepare('INSERT INTO athletes(parent_id,name,birth_date,notes,created_at) VALUES(?,?,?,?,?)').run(parentId,name,birthDate,notes,warsawNow()).lastInsertRowid);
    return send(201,{id});
   }
   if(url.pathname==='/api/locations' || url.pathname==='/api/locations/update') {
    const name=cleanLocationName(text(b.name,'nazwa lokalizacji')),key=locationKey(name);
    const existing=url.pathname.endsWith('/update')?locationById(b.id):null;
    const duplicate=db.prepare('SELECT id FROM locations WHERE name_key=?').get(key);
    if(duplicate&&duplicate.id!==existing?.id) throw Error('Taka lokalizacja już istnieje. Wybierz ją z listy.');
    const values={name,name_key:key};
    for(const field of ['address','city','phone','email','contact_name','notes']) {
     const value=b[field]===undefined?(existing?.[field]||''):b[field];
     if(typeof value!=='string'||value.length>(field==='notes'?2000:200)) throw Error('Nieprawidłowe dane placówki: '+field);
     values[field]=value.trim();
    }
    if(values.email) values.email=emailAddress(values.email);
    if(values.phone&&(!/^[+0-9\s().-]+$/.test(values.phone)||values.phone.replace(/\D/g,'').length<7||values.phone.replace(/\D/g,'').length>15)) throw Error('Podaj poprawny telefon placówki.');
    values.status=b.status??existing?.status??'active';
    if(!['active','paused','archived'].includes(values.status)) throw Error('Nieprawidłowy status placówki.');
    db.exec('BEGIN IMMEDIATE');
    try {
     let id=existing?.id;
     if(existing) db.prepare('UPDATE locations SET '+Object.keys(values).map(k=>k+'=?').join(',')+' WHERE id=?').run(...Object.values(values),id);
     else id=Number(db.prepare('INSERT INTO locations('+Object.keys(values).join(',')+') VALUES('+Object.keys(values).map(()=>'?').join(',')+')').run(...Object.values(values)).lastInsertRowid);
     if(existing) {
      db.prepare('UPDATE groups SET location=? WHERE location_id=?').run(name,id);
      db.prepare("UPDATE exclusions SET location=? WHERE scope='location' AND location_id=?").run(name,id);
     }
     db.exec('COMMIT');return send(existing?200:201,{id});
    }catch(error){db.exec('ROLLBACK');throw error;}
   }
   if(url.pathname==='/api/trainers') {
    const name=text(b.name,'imię i nazwisko trenera');
    const email=b.email?text(b.email,'email'):'';
    const phone=b.phone?text(b.phone,'telefon'):'';
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Podaj poprawny email trenera.');
    const id=Number(db.prepare('INSERT INTO trainers(name,email,phone) VALUES(?,?,?)').run(name,email,phone).lastInsertRowid);
    return send(201,{id});
   }
   if(url.pathname==='/api/groups/trainers') {
    const g=group(b.group_id),ids=trainerIds(b.trainer_ids);
    db.exec('BEGIN IMMEDIATE');
    try{assignTrainers(g.id,ids);db.exec('COMMIT');return send(200,{ok:true});}
    catch(e){db.exec('ROLLBACK');throw e;}
   }
   if(url.pathname==='/api/groups'||url.pathname==='/api/groups/update') {
    const existing=url.pathname.endsWith('/update')?group(b.id):null;
    const location=locationById(b.location_id), name=text(b.name,'grupa');
    if(existing&&existing.location_id!==location.id) throw Error('Nie można przenieść całej grupy do innej placówki.');
    if(!existing&&location.status!=='active') throw Error('Nową grupę można utworzyć tylko w aktywnej placówce.');
    const price=integer(b.price,0,10000000), capacity=integer(b.capacity,1,500), trialPrice=integer(b.trial_price,0,10000000);
    const assigned=trainerIds(b.trainer_ids);
    let terms;
    if(b.start_date!==undefined) terms=generateSchedule(b);
    else {
     if(!Array.isArray(b.dates)||!b.dates.length||b.dates.length>100) throw Error('Podaj grafik zajęć.');
     terms=[...new Set(b.dates)].map(date=>{
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(date)||!validDate(date.slice(0,10))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(date.slice(11))) throw Error('Nieprawidłowy termin.');
      return {starts_at:date+':00',ends_at:null};
     });
    }
    db.exec('BEGIN');
    try {
     const before=chargedTotals(),now=warsawNow();
     const count=existing?db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE group_id=? AND status IN ('active','trial')").get(existing.id).n:0;
     if(capacity<count) throw Error(`Limit nie może być mniejszy od liczby zapisanych zawodników (${count}).`);
     const id=existing?.id||Number(db.prepare('INSERT INTO groups(location,location_id,name,capacity,price,trial_price,trials) VALUES(?,?,?,?,?,?,?)').run(location.name,location.id,name,capacity,price,trialPrice,b.trials?1:0).lastInsertRowid);
     db.prepare('UPDATE groups SET location=?,location_id=?,name=?,capacity=?,price=?,trial_price=?,trials=?,start_date=?,end_date=?,start_time=?,end_time=?,weekday=? WHERE id=?').run(location.name,location.id,name,capacity,price,trialPrice,b.trials?1:0,b.start_date||null,b.end_date||null,b.start_time||null,b.end_time||null,b.weekday??null,id);
     assignTrainers(id,assigned);
     if(!existing) for(const term of terms) db.prepare('INSERT INTO sessions(group_id,starts_at,ends_at,price,location_id) VALUES(?,?,?,?,?)').run(id,term.starts_at,term.ends_at,price,location.id);
     else {
      // Keep IDs and original agreed prices in enrollment_sessions; never delete history.
      const future=all('SELECT * FROM sessions WHERE group_id=? AND starts_at>=? AND cancelled=0',id,now);
      const used=new Set();
      for(const term of terms.filter(t=>t.starts_at>=now)) {
       const sameDay=future.find(old=>!used.has(old.id)&&old.starts_at.slice(0,10)===term.starts_at.slice(0,10));
       if(sameDay) {
        used.add(sameDay.id);
        db.prepare('UPDATE sessions SET starts_at=?,ends_at=?,price=?,location_id=? WHERE id=?').run(term.starts_at,term.ends_at,price,location.id,sameDay.id);
       } else {
        const sessionId=Number(db.prepare('INSERT INTO sessions(group_id,starts_at,ends_at,price,location_id) VALUES(?,?,?,?,?)').run(id,term.starts_at,term.ends_at,price,location.id).lastInsertRowid);
        for(const e of all('SELECT * FROM enrollments WHERE group_id=? AND trial_id IS NULL AND month=? AND created_at<=?',id,term.starts_at.slice(0,7),term.starts_at)) {
         const agreed=db.prepare('SELECT price FROM enrollment_sessions WHERE enrollment_id=? LIMIT 1').get(e.id)?.price??price;
         db.prepare('INSERT INTO enrollment_sessions VALUES(?,?,?)').run(e.id,sessionId,agreed);
        }
       }
      }
      for(const old of future) if(!used.has(old.id)) db.prepare('UPDATE sessions SET cancelled=1 WHERE id=?').run(old.id);
      reconcileExclusions(before,'Zmiana grafiku grupy: '+name);
     }
     db.exec('COMMIT'); return send(existing?200:201,{id,count:terms.length});
    } catch(e) {db.exec('ROLLBACK');throw e;}
   }
   if(url.pathname==='/api/exclusions' || url.pathname==='/api/exclusions/remove') {
    let entry, entries;
    if(url.pathname.endsWith('/remove')) {
     entry=db.prepare('SELECT * FROM exclusions WHERE id=?').get(integer(b.id,1,Number.MAX_SAFE_INTEGER));
     if(!entry) throw Error('Nie znaleziono wykluczenia.');
    } else {
     if(!validDate(b.start_date)||!validDate(b.end_date)||b.end_date<b.start_date) throw Error('Podaj poprawny zakres wykluczenia.');
     if(!['all','location','group'].includes(b.scope)) throw Error('Wybierz zakres wykluczenia.');
     const base={start_date:b.start_date,end_date:b.end_date,scope:b.scope,reason:text(b.reason,'powód'),location:null,location_id:null,group_id:null};
     const targets=b.scope==='all'?[null]:(b.targets??[b.scope==='location'?b.location_id:b.group_id]);
     if(!Array.isArray(targets)||!targets.length||targets.length>500) throw Error('Wybierz lokalizacje lub grupy.');
     entries=[...new Set(targets)].map(target=>{
      const item={...base};
      if(b.scope==='location') {
       const location=locationById(target);
       item.location=location.name;item.location_id=location.id;
      }
      if(b.scope==='group') item.group_id=group(target).id;
      return item;
     });
     entry=entries[0];
    }
    db.exec('BEGIN IMMEDIATE');
    try {
     const before=chargedTotals();
     if(url.pathname.endsWith('/remove')) db.prepare('DELETE FROM exclusions WHERE id=?').run(entry.id);
     else for(const item of entries) db.prepare('INSERT INTO exclusions(start_date,end_date,scope,location,location_id,group_id,reason) VALUES(?,?,?,?,?,?,?)').run(item.start_date,item.end_date,item.scope,item.location,item.location_id,item.group_id,item.reason);
     reconcileExclusions(before,(url.pathname.endsWith('/remove')?'Usunięcie wykluczenia: ':'Wykluczenie: ')+entry.reason);
     db.exec('COMMIT');return send(200,{ok:true});
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
   if(url.pathname==='/api/quote') { const q=quote(b); return send(200,{amount:q.amount,count:q.count}); }
   if(url.pathname==='/api/enrollments') {
    const athlete=athleteById(b.athlete_id,user);
    db.exec('BEGIN IMMEDIATE');
    try {
     const result=saveEnrollment(b,athlete);
     db.exec('COMMIT');return send(201,result);
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
   if(url.pathname==='/api/adjustments') {
    const id=integer(b.enrollment_id,1,Number.MAX_SAFE_INTEGER), amount=integer(b.amount,-10000000,10000000), reason=text(b.reason,'powód korekty');
    if(!db.prepare('SELECT id FROM enrollments WHERE id=?').get(id)) throw Error('Brak zapisu.');
    db.prepare('INSERT INTO adjustments(enrollment_id,amount,reason,created_at) VALUES(?,?,?,?)').run(id,amount,reason,warsawNow());return send(201,{ok:true});
   }
   return send(404,{error:'Nie znaleziono operacji.'});
  }
  if(req.method==='GET' && ['/', '/zapisy', '/zapisy/', '/public-registration.js', '/public-registration.css', '/app.js', '/style.css', '/brand.css', '/fonts/baloo-bhai-2.ttf', '/fonts/open-sans.ttf'].includes(url.pathname)) {
   const name=url.pathname==='/'?'index.html':url.pathname==='/zapisy'||url.pathname==='/zapisy/'?'public-registration.html':url.pathname.slice(1);
   res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.ttf')?'font/ttf':'text/html; charset=utf-8'});return res.end(readFileSync(new URL('./public/'+name,import.meta.url)));
  }
  send(404,{error:'Nie znaleziono strony.'});
 } catch(e) {send(e.status||400,{error:e.message});}
}));
server.listen(Number(process.env.PORT||3000), process.env.HOST||'127.0.0.1',()=>console.log('Evolution Academy: serwer uruchomiony'));
