import {integer,required,transaction} from './operations.js';
import {warsawNow} from './billing.js';
import {emailAddress} from './auth.js';
import {validDate} from './schedule.js';
export function nextAthleteId(db){return db.prepare('SELECT MAX(id)+1 AS id FROM (SELECT COALESCE(MAX(id),0) AS id FROM athletes UNION ALL SELECT COALESCE(MAX(source_id),0) AS id FROM athlete_merges)').get().id;}
export function createDirectoryOperations(db){
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 const admin=u=>{if(u.role!=='admin')throw Object.assign(Error('Wymagane konto administratora.'),{status:403});};
 const normalized=s=>s.trim().toLocaleLowerCase('pl');
 function checkRows(rows){if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('Import obsługuje od 1 do 100 wierszy naraz.');return rows.map((row,index)=>{try{const name=required(row.name),birth_date=required(row.birth_date);if(!validDate(birth_date)||birth_date>warsawNow().slice(0,10))throw Error('Nieprawidłowa data urodzenia.');const email=emailAddress(row.parent_email),parent_name=required(row.parent_name),phone=String(row.parent_phone||'').trim();if(phone.length>200)throw Error('Za długi telefon.');const parent=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(parent&&parent.role!=='parent')throw Error('Email należy do konta innej roli.');const existing=parent&&all('SELECT * FROM athletes WHERE parent_id=?',parent.id).find(a=>normalized(a.name)===normalized(name)&&a.birth_date===birth_date);return {index,name,birth_date,parent_email:email,parent_name,parent_phone:phone,existing_id:existing?.id||null};}catch(e){return {index,error:e.message};}});}
 function importAthletes(b,u){admin(u);return transaction(db,()=>{const rows=checkRows(b.rows);if(rows.some(r=>r.error))throw Error(rows.filter(r=>r.error).map(r=>'Wiersz '+(r.index+1)+': '+r.error).join('; '));let created=0,skipped=0;for(const r of rows){let parent=db.prepare('SELECT id FROM users WHERE email=?').get(r.parent_email);if(!parent)parent={id:Number(db.prepare("INSERT INTO users(name,email,phone,role,created_at) VALUES(?,?,?,'parent',?)").run(r.parent_name,r.parent_email,r.parent_phone,warsawNow()).lastInsertRowid)};const existing=all('SELECT * FROM athletes WHERE parent_id=?',parent.id).find(a=>normalized(a.name)===normalized(r.name)&&a.birth_date===r.birth_date);if(existing){skipped++;continue;}db.prepare('INSERT INTO athletes(id,parent_id,name,birth_date,created_at) VALUES(?,?,?,?,?)').run(nextAthleteId(db),parent.id,r.name,r.birth_date,warsawNow());created++;}return {created,skipped};});}
 function duplicates(u){admin(u);const list=all('SELECT id,parent_id,name,birth_date FROM athletes ORDER BY id'),pairs=[];for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i],b=list[j];if(a.parent_id===b.parent_id&&normalized(a.name)===normalized(b.name)&&a.birth_date===b.birth_date)pairs.push({target:a,source:b});}return {pairs:pairs.slice(0,100)};}
 function merge(b,u){admin(u);if(b.confirmed!==true)throw Error('Potwierdź połączenie kartotek.');const source=integer(b.source_id),target=integer(b.target_id),reason=required(b.reason,1000);if(source===target)throw Error('Wybierz dwie różne kartoteki.');return transaction(db,()=>{
  const a=db.prepare('SELECT * FROM athletes WHERE id=?').get(source),t=db.prepare('SELECT * FROM athletes WHERE id=?').get(target);if(!a||!t)throw Error('Nie znaleziono kartotek.');
  if(a.parent_id!==t.parent_id||a.birth_date!==t.birth_date||normalized(a.name)!==normalized(t.name))throw Error('Połącz kartoteki dopiero po uzgodnieniu nazwiska, daty urodzenia i głównego rodzica.');
  const guardians=id=>all('SELECT user_id FROM athlete_guardians WHERE athlete_id=? ORDER BY user_id',id).map(g=>g.user_id).join(',');if(guardians(source)!==guardians(target))throw Error('Kartoteki mają różne dostępy opiekunów. Najpierw uzgodnij uprawnienia.');
  if(db.prepare('SELECT 1 FROM memberships a JOIN memberships b ON b.group_id=a.group_id WHERE a.athlete_id=? AND b.athlete_id=?').get(source,target))throw Error('Obie kartoteki mają historię tej samej grupy. Wymagają indywidualnego uzgodnienia zapisów i rozliczeń.');
  db.exec('PRAGMA defer_foreign_keys=ON');try{
   // These identical access links are redundant; all other history is moved intact.
   db.prepare('DELETE FROM athlete_guardians WHERE athlete_id=?').run(source);
   for(const {name:table} of all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")){
    for(const fk of all('PRAGMA foreign_key_list("'+table+'")').filter(f=>f.table==='athletes'&&f.to==='id'))db.prepare('UPDATE "'+table+'" SET "'+fk.from+'"=? WHERE "'+fk.from+'"=?').run(target,source);
   }
   db.prepare('UPDATE membership_periods SET athlete_id=? WHERE athlete_id=?').run(target,source);
   if(a.notes&&!t.notes)db.prepare('UPDATE athletes SET notes=? WHERE id=?').run(a.notes,target);
   db.prepare('INSERT INTO athlete_merges VALUES(?,?,?,?,?,?)').run(source,target,JSON.stringify(a),reason,u.id,warsawNow());
   db.prepare('DELETE FROM athletes WHERE id=?').run(source);
   if(all('PRAGMA foreign_key_check').length)throw Error('Konflikt powiązań. Nie połączono kartotek.');return {id:target};
  }catch(e){if(e.code?.startsWith('SQLITE_CONSTRAINT'))throw Error('Konflikt historii. Nie połączono kartotek; dane pozostają bez zmian.');throw e;}finally{db.exec('PRAGMA defer_foreign_keys=OFF');}
 });}
 return {checkRows,importAthletes,duplicates,merge};
}
