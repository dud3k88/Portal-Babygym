import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { calculateCharge, warsawNow } from './billing.js';
mkdirSync('data', { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || 'data/evolution.sqlite');
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, location TEXT NOT NULL, name TEXT NOT NULL, capacity INTEGER NOT NULL, price INTEGER NOT NULL, trial_price INTEGER NOT NULL, trials INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, group_id INTEGER REFERENCES groups(id), starts_at TEXT NOT NULL, price INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS enrollments(id INTEGER PRIMARY KEY, group_id INTEGER REFERENCES groups(id), parent TEXT NOT NULL, email TEXT NOT NULL, child TEXT NOT NULL, month TEXT NOT NULL, trial_id INTEGER REFERENCES sessions(id), amount INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS adjustments(id INTEGER PRIMARY KEY, enrollment_id INTEGER REFERENCES enrollments(id), amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);`);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const text = (v, label) => { if (typeof v !== 'string' || !v.trim() || v.length > 200) throw Error(`Uzupełnij pole: ${label}`); return v.trim(); };
const integer = (v, min, max) => { if (!Number.isSafeInteger(v) || v < min || v > max) throw Error('Nieprawidłowa kwota lub liczba miejsc.'); return v; };
function group(id) { const g = db.prepare('SELECT * FROM groups WHERE id=?').get(Number(id)); if (!g) throw Error('Nie znaleziono grupy.'); return g; }
function quote(b) {
 const g = group(b.group_id);
 if (!/^\d{4}-\d{2}$/.test(b.month)) throw Error('Wybierz miesiąc.');
 const sessions = all('SELECT * FROM sessions WHERE group_id=? AND substr(starts_at,1,7)=? ORDER BY starts_at', g.id, b.month);
 const trial = b.trial_id ? Number(b.trial_id) : null;
 if (trial && !g.trials) throw Error('Próby nie są dostępne w tej grupie.');
 const result = calculateCharge(sessions, warsawNow(), trial, g.trial_price);
 if (!result.count) throw Error('Brak przyszłych zajęć w wybranym miesiącu.');
 return { ...result, group:g, trial };
}
const server = http.createServer(async (req,res) => {
 const url = new URL(req.url, 'http://localhost');
 const send = (status, data) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
 try {
  if (req.method === 'GET' && url.pathname === '/api/state') return send(200, {groups:all('SELECT * FROM groups'), sessions:all('SELECT * FROM sessions ORDER BY starts_at'), enrollments:all(`SELECT e.*, g.name AS group_name, g.location, e.amount + COALESCE((SELECT SUM(a.amount) FROM adjustments a WHERE a.enrollment_id=e.id),0) AS balance FROM enrollments e JOIN groups g ON g.id=e.group_id ORDER BY e.id DESC`), adjustments:all('SELECT * FROM adjustments ORDER BY id DESC'), now:warsawNow()});
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
   let raw=''; for await (const chunk of req) {raw+=chunk; if(raw.length>50000) throw Error('Zbyt duże żądanie.');}
   const b=JSON.parse(raw);
   if(url.pathname==='/api/groups') {
    const location=text(b.location,'lokalizacja'), name=text(b.name,'grupa');
    const price=integer(b.price,0,10000000), capacity=integer(b.capacity,1,500), trialPrice=integer(b.trial_price,0,10000000);
    if(!Array.isArray(b.dates)||!b.dates.length||b.dates.length>100) throw Error('Podaj terminy zajęć.');
    const dates=[...new Set(b.dates)];
    for(const date of dates) if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))) throw Error('Nieprawidłowy termin.');
    db.exec('BEGIN');
    try {
     const id=Number(db.prepare('INSERT INTO groups(location,name,capacity,price,trial_price,trials) VALUES(?,?,?,?,?,?)').run(location,name,capacity,price,trialPrice,b.trials?1:0).lastInsertRowid);
     for(const date of dates) db.prepare('INSERT INTO sessions(group_id,starts_at,price) VALUES(?,?,?)').run(id,date+':00',price);
     db.exec('COMMIT'); return send(201,{id});
    } catch(e) {db.exec('ROLLBACK');throw e;}
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
     const id=Number(db.prepare('INSERT INTO enrollments(group_id,parent,email,child,month,trial_id,amount,created_at) VALUES(?,?,?,?,?,?,?,?)').run(q.group.id,parent,email,child,b.month,q.trial,q.amount,warsawNow()).lastInsertRowid);
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
