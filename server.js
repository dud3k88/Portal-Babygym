import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { calculateCharge, warsawNow } from './billing.js';
import { generateSchedule, validDate, isExcluded } from './schedule.js';
mkdirSync('data', { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || 'data/evolution.sqlite');
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
function sessionsWithStatus() {
 const groups=all('SELECT * FROM groups'), exclusions=all('SELECT * FROM exclusions');
 return all('SELECT * FROM sessions ORDER BY starts_at').map(s=>({...s,excluded:isExcluded(s,groups.find(g=>g.id===s.group_id),exclusions)}));
}
// Backfill the original charged terms once for existing enrollments.
for(const e of all('SELECT * FROM enrollments WHERE id NOT IN (SELECT enrollment_id FROM enrollment_sessions)')) {
 const terms=all('SELECT * FROM sessions WHERE group_id=? AND substr(starts_at,1,7)=? AND starts_at>=?',e.group_id,e.month,e.created_at).filter(s=>!e.trial_id||s.id===e.trial_id);
 for(const term of terms) db.prepare('INSERT OR IGNORE INTO enrollment_sessions VALUES(?,?,?)').run(e.id,term.id,e.trial_id?e.amount:term.price);
}
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
function quote(b) {
 const g = group(b.group_id);
 if (!/^\d{4}-\d{2}$/.test(b.month)) throw Error('Wybierz miesiąc.');
 const sessions = sessionsWithStatus().filter(s=>s.group_id===g.id&&s.starts_at.startsWith(b.month)&&!s.excluded);
 const trial = b.trial_id ? Number(b.trial_id) : null;
 if (trial && !g.trials) throw Error('Próby nie są dostępne w tej grupie.');
 const joinedAt=warsawNow();
 const result = calculateCharge(sessions, joinedAt, trial, g.trial_price);
 if (!result.count) throw Error('Brak przyszłych zajęć w wybranym miesiącu.');
 return { ...result, group:g, trial, joinedAt };
}
const server = http.createServer(async (req,res) => {
 const url = new URL(req.url, 'http://localhost');
 const send = (status, data) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
 try {
  if (req.method === 'GET' && url.pathname === '/api/state') return send(200, {groups:all('SELECT * FROM groups'), sessions:sessionsWithStatus(), exclusions:all('SELECT * FROM exclusions ORDER BY start_date'), enrollments:all(`SELECT e.*, g.name AS group_name, g.location, e.amount + COALESCE((SELECT SUM(a.amount) FROM adjustments a WHERE a.enrollment_id=e.id),0) AS balance FROM enrollments e JOIN groups g ON g.id=e.group_id ORDER BY e.id DESC`), adjustments:all('SELECT * FROM adjustments ORDER BY id DESC'), now:warsawNow()});
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
   let raw=''; for await (const chunk of req) {raw+=chunk; if(raw.length>50000) throw Error('Zbyt duże żądanie.');}
   const b=JSON.parse(raw);
   if(url.pathname==='/api/groups') {
    const location=text(b.location,'lokalizacja'), name=text(b.name,'grupa');
    const price=integer(b.price,0,10000000), capacity=integer(b.capacity,1,500), trialPrice=integer(b.trial_price,0,10000000);
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
     const id=Number(db.prepare('INSERT INTO groups(location,name,capacity,price,trial_price,trials) VALUES(?,?,?,?,?,?)').run(location,name,capacity,price,trialPrice,b.trials?1:0).lastInsertRowid);
     db.prepare('UPDATE groups SET start_date=?,end_date=?,start_time=?,end_time=?,weekday=? WHERE id=?').run(b.start_date||null,b.end_date||null,b.start_time||null,b.end_time||null,b.weekday??null,id);
     for(const term of terms) db.prepare('INSERT INTO sessions(group_id,starts_at,ends_at,price) VALUES(?,?,?,?)').run(id,term.starts_at,term.ends_at,price);
     db.exec('COMMIT'); return send(201,{id,count:terms.length});
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
     const base={start_date:b.start_date,end_date:b.end_date,scope:b.scope,reason:text(b.reason,'powód'),location:null,group_id:null};
     const targets=b.scope==='all'?[null]:(b.targets??[b.scope==='location'?b.location:b.group_id]);
     if(!Array.isArray(targets)||!targets.length||targets.length>500) throw Error('Wybierz lokalizacje lub grupy.');
     entries=[...new Set(targets)].map(target=>{
      const item={...base};
      if(b.scope==='location') {
       item.location=text(target,'lokalizacja');
       if(!db.prepare('SELECT id FROM groups WHERE location=?').get(item.location)) throw Error('Nie znaleziono lokalizacji.');
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
     else for(const item of entries) db.prepare('INSERT INTO exclusions(start_date,end_date,scope,location,group_id,reason) VALUES(?,?,?,?,?,?)').run(item.start_date,item.end_date,item.scope,item.location,item.group_id,item.reason);
     reconcileExclusions(before,(url.pathname.endsWith('/remove')?'Usunięcie wykluczenia: ':'Wykluczenie: ')+entry.reason);
     db.exec('COMMIT');return send(200,{ok:true});
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
   if(url.pathname==='/api/quote') { const q=quote(b); return send(200,{amount:q.amount,count:q.count}); }
   if(url.pathname==='/api/enrollments') {
    const parent=text(b.parent,'rodzic'), child=text(b.child,'dziecko'), email=text(b.email,'email');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Podaj poprawny email.');
    db.exec('BEGIN IMMEDIATE');
    try {
     const q=quote(b);
     const count=db.prepare('SELECT COUNT(*) AS n FROM enrollments WHERE group_id=? AND month=?').get(q.group.id,b.month).n;
     if(count>=q.group.capacity) throw Error('Brak wolnych miejsc.');
     if(db.prepare('SELECT id FROM enrollments WHERE group_id=? AND month=? AND email=? AND child=?').get(q.group.id,b.month,email,child)) throw Error('Dziecko jest już zapisane w tym miesiącu.');
     const id=Number(db.prepare('INSERT INTO enrollments(group_id,parent,email,child,month,trial_id,amount,created_at) VALUES(?,?,?,?,?,?,?,?)').run(q.group.id,parent,email,child,b.month,q.trial,q.amount,q.joinedAt).lastInsertRowid);
     for(const term of sessionsWithStatus().filter(s=>s.group_id===q.group.id&&s.starts_at.startsWith(b.month)&&s.starts_at>=q.joinedAt&&(!q.trial||s.id===q.trial))) db.prepare('INSERT INTO enrollment_sessions VALUES(?,?,?)').run(id,term.id,q.trial?q.amount:term.price);
     db.exec('COMMIT');return send(201,{id,amount:q.amount});
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
   if(url.pathname==='/api/adjustments') {
    const id=integer(b.enrollment_id,1,Number.MAX_SAFE_INTEGER), amount=integer(b.amount,-10000000,10000000), reason=text(b.reason,'powód korekty');
    if(!db.prepare('SELECT id FROM enrollments WHERE id=?').get(id)) throw Error('Brak zapisu.');
    db.prepare('INSERT INTO adjustments(enrollment_id,amount,reason,created_at) VALUES(?,?,?,?)').run(id,amount,reason,warsawNow());return send(201,{ok:true});
   }
   return send(404,{error:'Nie znaleziono operacji.'});
  }
  if(req.method==='GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
   const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
   res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8'});return res.end(readFileSync(new URL('./public/'+name,import.meta.url)));
  }
  send(404,{error:'Nie znaleziono strony.'});
 } catch(e) {send(400,{error:e.message});}
});
server.listen(Number(process.env.PORT||3000), process.env.HOST||'127.0.0.1',()=>console.log('Evolution Academy: serwer uruchomiony'));
