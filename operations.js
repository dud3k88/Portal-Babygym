import { warsawNow } from './billing.js';
import { warsawEpoch } from './admissions.js';
export const integer=(n,min=1,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Nieprawidłowa liczba.');return n;};
export const required=(s,max=200)=>{if(typeof s!=='string'||!s.trim()||s.length>max)throw Error('Uzupełnij wymagane pole.');return s.trim();};
export const transaction=(db,fn)=>{db.exec('SAVEPOINT operation');try{const result=fn();db.exec('RELEASE operation');return result;}catch(e){db.exec('ROLLBACK TO operation');db.exec('RELEASE operation');throw e;}};
export function createCalendar(db,{sessions,guardians,chargedTotals,reconcileExclusions,admissions}) {
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 const trainer=user=>db.prepare("SELECT * FROM trainers WHERE user_id=? AND status='active'").get(user.id);
 function syncAssignments(){
  db.exec(`INSERT INTO lesson_trainers(session_id,trainer_id) SELECT s.id,gt.trainer_id FROM sessions s JOIN group_trainers gt ON gt.group_id=s.group_id WHERE NOT EXISTS(SELECT 1 FROM lesson_assignment_snapshots a WHERE a.session_id=s.id);
   INSERT INTO lesson_assignment_snapshots SELECT id FROM sessions WHERE id NOT IN (SELECT session_id FROM lesson_assignment_snapshots);`);
 }
 function canRead(user,session) {
  if(user.role==='admin')return true;
  if(user.role==='trainer')return Boolean(trainer(user)&&db.prepare('SELECT 1 FROM lesson_trainers WHERE session_id=? AND trainer_id=?').get(session.id,trainer(user).id));
  return roster(session).some(a=>guardians.canAccess(a,user));
 }
 function lesson(id,user) {
  const s=sessions().find(s=>s.id===integer(id));
  if(!s||!canRead(user,s))throw Object.assign(Error('Nie znaleziono zajęć.'),{status:404});return s;
 }
 function roster(s) {
  return all(`SELECT DISTINCT a.id,a.parent_id,a.name,a.birth_date FROM athletes a JOIN membership_periods p ON p.athlete_id=a.id WHERE p.group_id=? AND p.starts_at<=? AND (p.ends_at IS NULL OR p.ends_at>?)
   AND (p.status='active' OR EXISTS(SELECT 1 FROM enrollments e WHERE e.group_id=p.group_id AND e.athlete_id=p.athlete_id AND e.trial_id=?)) ORDER BY a.name`,s.group_id,s.starts_at,s.starts_at,s.id);
 }
 function list(user,params) {
  syncAssignments();const from=params.get('from')||warsawNow().slice(0,7)+'-01',to=params.get('to')||warsawNow().slice(0,7)+'-31';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('Wybierz zakres dat.');
  return {items:sessions().filter(s=>s.starts_at.slice(0,10)>=from&&s.starts_at.slice(0,10)<=to&&canRead(user,s))
   .filter(s=>(!params.get('group_id')||s.group_id===Number(params.get('group_id')))&&(!params.get('location_id')||s.location_id===Number(params.get('location_id'))))
   .map(s=>{const group=db.prepare('SELECT name,location FROM groups WHERE id=?').get(s.group_id),teachers=all('SELECT t.id,t.name FROM lesson_trainers l JOIN trainers t ON t.id=l.trainer_id WHERE l.session_id=?',s.id),completion=db.prepare('SELECT * FROM lesson_completion WHERE session_id=?').get(s.id);return {id:s.id,group_id:s.group_id,starts_at:s.starts_at,ends_at:s.ends_at,excluded:s.excluded,cancelled:s.cancelled,group_name:group.name,location:group.location,trainers:teachers,completed:Boolean(completion?.completed),missing:roster(s).filter(a=>!db.prepare("SELECT 1 FROM attendance WHERE session_id=? AND athlete_id=? AND status<>'unmarked'").get(s.id,a.id)).length};})
   .filter(s=>!params.get('trainer_id')||s.trainers.some(t=>t.id===Number(params.get('trainer_id'))))};
 }
 function confirmedAttendance(id,user){
  const available=new Set(sessions().filter(s=>!s.excluded).map(s=>s.id));
  return all("SELECT s.id,s.starts_at,s.group_id FROM attendance a JOIN lesson_completion c ON c.session_id=a.session_id JOIN sessions s ON s.id=a.session_id WHERE a.athlete_id=? AND a.status='present' AND c.completed=1 ORDER BY s.starts_at,s.id",id).filter(s=>available.has(s.id)&&canRead(user,s));
 }
 function detail(user,id) {
  syncAssignments();const s=lesson(id,user);
  const children=roster(s).filter(a=>user.role!=='parent'||guardians.canAccess(a,user));
  return {session:{id:s.id,starts_at:s.starts_at,ends_at:s.ends_at,excluded:s.excluded},children:children.map(a=>({...a,attendance:db.prepare('SELECT status FROM attendance WHERE session_id=? AND athlete_id=?').get(s.id,a.id)?.status||'unmarked',reported_absent:Boolean(db.prepare('SELECT 1 FROM absence_reports WHERE session_id=? AND athlete_id=? AND active=1').get(s.id,a.id)),stamps:confirmedAttendance(a.id,user).length})),completion:db.prepare('SELECT * FROM lesson_completion WHERE session_id=?').get(s.id)||null};
 }
 function mark(user,b) {
  const s=lesson(b.session_id,user);
  if(user.role==='parent')throw Object.assign(Error('Obecność sprawdza trener lub administrator.'),{status:403});
  if(s.excluded||s.starts_at>warsawNow())throw Error('Obecność można sprawdzić po rozpoczęciu nieodwołanych zajęć.');
  if(!['present','absent','unmarked'].includes(b.status)||!roster(s).some(a=>a.id===b.athlete_id))throw Error('Nieprawidłowy zawodnik lub status.');
  const old=db.prepare('SELECT status FROM attendance WHERE session_id=? AND athlete_id=?').get(s.id,b.athlete_id);
  if(old&&old.status!=='unmarked'&&old.status!==b.status)required(b.reason,1000);
  db.prepare(`INSERT INTO attendance(session_id,athlete_id,status,actor_id,reason,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(session_id,athlete_id) DO UPDATE SET status=excluded.status,actor_id=excluded.actor_id,reason=excluded.reason,updated_at=excluded.updated_at`).run(s.id,b.athlete_id,b.status,user.id,b.reason||'',warsawNow());return {ok:true};
 }
 function absence(user,b) {
  const s=lesson(b.session_id,user),child=roster(s).find(a=>a.id===b.athlete_id);
  if(user.role!=='parent'||!child||!guardians.canAccess(child,user))throw Object.assign(Error('Brak dostępu do zgłoszenia.'),{status:403});
  if(s.excluded||s.starts_at<=warsawNow())throw Error('Nieobecność zgłaszasz przed rozpoczęciem zajęć.');
  if(typeof b.active!=='boolean')throw Error('Nieprawidłowy status.');
  db.prepare('INSERT INTO absence_reports(session_id,athlete_id,active,actor_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(session_id,athlete_id) DO UPDATE SET active=excluded.active,actor_id=excluded.actor_id,updated_at=excluded.updated_at').run(s.id,child.id,Number(b.active),user.id,warsawNow());return {ok:true};
 }
 function complete(user,b) {
  const s=lesson(b.session_id,user);
  if(user.role==='parent')throw Object.assign(Error('Brak uprawnień.'),{status:403});
  if(s.excluded||(s.ends_at?warsawEpoch(s.ends_at):warsawEpoch(s.starts_at)+3600000)>Date.now())throw Error('Potwierdź realizację po zakończeniu nieodwołanych zajęć.');
  if(typeof b.completed!=='boolean')throw Error('Nieprawidłowy status.');
  if(b.completed&&roster(s).some(a=>!db.prepare("SELECT 1 FROM attendance WHERE session_id=? AND athlete_id=? AND status<>'unmarked'").get(s.id,a.id)))throw Error('Najpierw uzupełnij wszystkie obecności.');
  const minutes=b.actual_minutes??(s.ends_at?Math.round((warsawEpoch(s.ends_at)-warsawEpoch(s.starts_at))/60000):60);integer(minutes,1,480);
  const old=db.prepare('SELECT * FROM lesson_completion WHERE session_id=?').get(s.id);
  if(old&&!b.completed)required(b.reason,1000);
  db.prepare('INSERT INTO lesson_completion(session_id,completed,actor_id,reason,updated_at,actual_minutes) VALUES(?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET completed=excluded.completed,actor_id=excluded.actor_id,reason=excluded.reason,updated_at=excluded.updated_at,actual_minutes=excluded.actual_minutes').run(s.id,Number(b.completed),user.id,b.reason||'',warsawNow(),minutes);return {ok:true};
 }
 function edit(user,b) {
  if(user.role!=='admin')throw Object.assign(Error('Zmiana terminu wymaga administratora.'),{status:403});
  return transaction(db,()=>{
   syncAssignments();const s=lesson(b.session_id,user),reason=required(b.reason,1000),before=chargedTotals();
   if(db.prepare('SELECT 1 FROM lesson_completion WHERE session_id=? AND completed=1').get(s.id))throw Error('Najpierw cofnij potwierdzenie realizacji z uzasadnieniem.');
   if(b.cancelled!==undefined) {
    if(typeof b.cancelled!=='boolean')throw Error('Nieprawidłowy status terminu.');
    db.prepare('UPDATE sessions SET cancelled=? WHERE id=?').run(Number(b.cancelled),s.id);
   }
   if(b.starts_at!==undefined){
    const start=required(b.starts_at),end=required(b.ends_at);warsawEpoch(start);warsawEpoch(end);
    if(start>=end||start<warsawNow()||s.starts_at<warsawNow())throw Error('Można przesuwać przyszłe zajęcia na przyszły termin.');
    if(start.slice(0,7)!==s.starts_at.slice(0,7))throw Error('Przesunięcie między miesiącami wymaga osobnego rozliczenia.');
    db.prepare('UPDATE sessions SET starts_at=?,ends_at=? WHERE id=?').run(start,end,s.id);
   }
   if(b.starts_at!==undefined&&b.trainer_ids===undefined)b.trainer_ids=all('SELECT trainer_id FROM lesson_trainers WHERE session_id=?',s.id).map(t=>t.trainer_id);
   if(b.trainer_ids!==undefined){
    if(!Array.isArray(b.trainer_ids)||b.trainer_ids.length>10)throw Error('Wybierz trenerów.');
    for(const id of b.trainer_ids)if(!db.prepare("SELECT id FROM trainers WHERE id=? AND status='active'").get(integer(id)))throw Error('Wybierz aktywnego trenera.');
    const current=db.prepare('SELECT * FROM sessions WHERE id=?').get(s.id);
    for(const id of b.trainer_ids) {
     const conflict=db.prepare('SELECT s.id FROM sessions s JOIN lesson_trainers t ON t.session_id=s.id WHERE t.trainer_id=? AND s.id<>? AND s.cancelled=0 AND s.starts_at<? AND COALESCE(s.ends_at,s.starts_at)>? LIMIT 1').get(id,s.id,current.ends_at||current.starts_at,current.starts_at);
     if(conflict&&b.confirm_conflict!==true)throw Error('Konflikt grafiku trenera. Sprawdź terminy i jawnie potwierdź wyjątek.');
    }
    db.prepare('DELETE FROM lesson_trainers WHERE session_id=?').run(s.id);
    for(const id of new Set(b.trainer_ids))db.prepare('INSERT INTO lesson_trainers VALUES(?,?)').run(s.id,id);
   }
   db.prepare('INSERT INTO lesson_changes(session_id,reason,actor_id,created_at) VALUES(?,?,?,?)').run(s.id,reason,user.id,warsawNow());
   reconcileExclusions(before,reason);admissions.sync();return {ok:true};
  });
 }
 return {list,detail,mark,absence,complete,edit,syncAssignments,roster,canRead,confirmedAttendance};
}
