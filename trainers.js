import { emailAddress } from './auth.js';
import { warsawNow } from './billing.js';
const denied=()=>Object.assign(Error('Nie znaleziono zawodnika w Twoich grupach.'),{status:404});
const id=value=>{if(!Number.isSafeInteger(value)||value<1)throw Error('Nieprawidłowy identyfikator.');return value;};
export function createTrainerService(db,auth) {
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 const profile=user=>{
  const trainer=db.prepare("SELECT * FROM trainers WHERE user_id=? AND status='active'").get(user.id);
  if(!trainer)throw Object.assign(Error('Brak aktywnego profilu trenera.'),{status:403});
  return trainer;
 };
 function state(user,sessions,logo) {
  const trainer=profile(user);
  const groups=all('SELECT g.id,g.name,g.location_id,g.location,g.start_date,g.end_date,g.weekday,g.start_time,g.end_time,g.capacity FROM groups g JOIN group_trainers gt ON gt.group_id=g.id WHERE gt.trainer_id=?',trainer.id);
  const groupIds=new Set(groups.map(group=>group.id));
  const memberships=all("SELECT m.* FROM memberships m JOIN group_trainers gt ON gt.group_id=m.group_id WHERE gt.trainer_id=? AND m.status IN ('active','trial')",trainer.id);
  const athletes=all("SELECT DISTINCT a.id,a.name,a.birth_date,a.parent_id FROM athletes a JOIN memberships m ON m.athlete_id=a.id JOIN group_trainers gt ON gt.group_id=m.group_id WHERE gt.trainer_id=? AND m.status IN ('active','trial') ORDER BY a.name",trainer.id);
  const athleteIds=new Set(athletes.map(athlete=>athlete.id));
  const links=all('SELECT id AS athlete_id,parent_id AS user_id FROM athletes UNION SELECT athlete_id,user_id FROM athlete_guardians').filter(link=>athleteIds.has(link.athlete_id));
  const parentIds=new Set(links.map(link=>link.user_id));
  const parents=all("SELECT id,name,email,phone FROM users WHERE role='parent'").filter(parent=>parentIds.has(parent.id));
  return {user,trainer,groups:groups.map(group=>({...group,member_count:memberships.filter(member=>member.group_id===group.id).length})),memberships,athletes,parents,guardian_links:links,
   locations:all('SELECT DISTINCT l.id,l.name,l.address,l.city FROM locations l JOIN groups g ON g.location_id=l.id JOIN group_trainers gt ON gt.group_id=g.id WHERE gt.trainer_id=? ORDER BY l.name',trainer.id),
   sessions:sessions.filter(session=>groupIds.has(session.group_id)).map(({id,group_id,starts_at,ends_at,cancelled,excluded})=>({id,group_id,starts_at,ends_at,cancelled,excluded})),
   trainer_notes:all('SELECT athlete_id,body,updated_at FROM trainer_notes WHERE trainer_id=?',trainer.id).filter(note=>athleteIds.has(note.athlete_id)),logo,now:warsawNow()};
 }
 function saveNote(user,body) {
  const trainer=profile(user),athleteId=id(body.athlete_id);
  if(!db.prepare("SELECT 1 FROM memberships m JOIN group_trainers gt ON gt.group_id=m.group_id WHERE gt.trainer_id=? AND m.athlete_id=? AND m.status IN ('active','trial')").get(trainer.id,athleteId))throw denied();
  if(typeof body.body!=='string'||body.body.length>2000)throw Error('Notatka może mieć maksymalnie 2000 znaków.');
  db.prepare('INSERT INTO trainer_notes(trainer_id,athlete_id,body,updated_at) VALUES(?,?,?,?) ON CONFLICT(trainer_id,athlete_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at').run(trainer.id,athleteId,body.body.trim(),new Date().toISOString());
  return {ok:true};
 }
 function account(body) {
  const trainer=db.prepare('SELECT * FROM trainers WHERE id=?').get(id(body.trainer_id));
  if(!trainer)throw Error('Nie znaleziono trenera.');
  if(trainer.status!=='active')throw Error('Najpierw ustaw aktywny status trenera.');
  const email=emailAddress(trainer.email);
  db.exec('BEGIN IMMEDIATE');
  try {
   let userId=trainer.user_id;
   if(!userId) {
    if(db.prepare('SELECT id FROM users WHERE email=?').get(email))throw Error('Ten email jest już przypisany do konta. Podaj trenerowi odrębny adres; istniejące konto nie zostanie przejęte.');
    userId=Number(db.prepare("INSERT INTO users(name,email,phone,role,created_at) VALUES(?,?,?,'trainer',?)").run(trainer.name,email,trainer.phone,new Date().toISOString()).lastInsertRowid);
    db.prepare('UPDATE trainers SET user_id=? WHERE id=?').run(userId,trainer.id);
   }
   const token=auth.invite(userId,'trainer');
   db.exec('COMMIT');return {token};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function update(body) {
  const trainer=db.prepare('SELECT * FROM trainers WHERE id=?').get(id(body.id));
  if(!trainer)throw Error('Nie znaleziono trenera.');
  const values={};
  for(const field of ['name','email','phone']) {
   const value=body[field]??trainer[field];
   if(typeof value!=='string'||value.length>200)throw Error('Nieprawidłowe dane trenera.');
   values[field]=value.trim();
  }
  if(!values.name)throw Error('Podaj imię i nazwisko trenera.');
  if(values.email||trainer.user_id)values.email=emailAddress(values.email);
  const status=body.status??trainer.status;
  if(!['active','inactive','archived'].includes(status))throw Error('Nieprawidłowy status trenera.');
  db.exec('BEGIN IMMEDIATE');
  try {
   if(trainer.user_id) {
    if(db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(values.email,trainer.user_id))throw Error('Ten email należy do innego konta.');
    db.prepare('UPDATE users SET name=?,email=?,phone=?,access_status=? WHERE id=?').run(values.name,values.email,values.phone,status==='active'?'active':'blocked',trainer.user_id);
    if(status!=='active'||values.email!==trainer.email) {
     auth.invalidate(trainer.user_id);
    }
   }
   db.prepare('UPDATE trainers SET name=?,email=?,phone=?,status=? WHERE id=?').run(values.name,values.email,values.phone,status,trainer.id);
   db.exec('COMMIT');return {id:trainer.id};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {state,saveNote,account,update};
}
