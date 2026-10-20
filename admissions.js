import { notifyChild } from './workspace.js';
import { warsawNow, enrollmentMonth } from './billing.js';
import { isCurrentMember } from './participation.js';
export function warsawAt(epoch) {
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(epoch)).replace(' ','T');
}
export function warsawEpoch(local) {
 // Select the later occurrence of an ambiguous autumn wall time. Reject gaps.
 const nominal=Date.parse(local.slice(0,19)+'Z');
 const candidates=[nominal-3600000,nominal-7200000].filter(epoch=>warsawAt(epoch)===local.slice(0,19));
 if(!candidates.length)throw Error('Termin przypada na nieistniejącą godzinę zmiany czasu. Popraw grafik.');
 return Math.max(...candidates);
}
export function createAdmissions(db,{sessions,quote,saveEnrollment,seasonService}) {
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 const settings=()=>db.prepare('SELECT * FROM admission_settings WHERE id=1').get();
 const atomic=fn=>{db.exec('SAVEPOINT admissions');try{const result=fn();db.exec('RELEASE admissions');return result;}catch(error){db.exec('ROLLBACK TO admissions');db.exec('RELEASE admissions');throw error;}};
 const group=id=>{const value=db.prepare('SELECT * FROM groups WHERE id=?').get(Number(id));if(!value)throw Error('Nie znaleziono grupy.');return value;};
 const member=(groupId,athleteId)=>db.prepare('SELECT * FROM memberships WHERE group_id=? AND athlete_id=?').get(groupId,athleteId);
 function occupied(groupId) {return db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE group_id=? AND status IN ('active','trial') AND (ends_at IS NULL OR ends_at>?)").get(groupId,warsawNow()).n;}
 function reserved(groupId,except=null) {return db.prepare("SELECT COUNT(*) AS n FROM waiting_list WHERE group_id=? AND status='offered' AND expires_at>? AND id<>?").get(groupId,Date.now(),except??-1).n;}
 function open(g) {return seasonService.available(g)&&db.prepare("SELECT 1 FROM locations WHERE id=? AND status='active'").get(g.location_id);}
 function future(g) {return sessions().filter(s=>s.group_id===g.id&&!s.excluded&&s.starts_at>=warsawNow()&&s.starts_at.startsWith(warsawNow().slice(0,7)));}
 function startTrial(enrollmentId,legacy=false) {
  const e=db.prepare('SELECT * FROM enrollments WHERE id=?').get(enrollmentId);
  const term=db.prepare('SELECT * FROM sessions WHERE id=?').get(e.trial_id);
  const end=term.ends_at||warsawAt(warsawEpoch(term.starts_at)+3600000);
  const expiry=Math.max(warsawEpoch(end),legacy?Date.now():0)+settings().trial_hours*3600000;
  db.prepare('INSERT INTO trial_decisions(enrollment_id,ends_at,expires_at) VALUES(?,?,?)').run(e.id,end,expiry);
  const m=member(e.group_id,e.athlete_id),deadline= m.ends_at&&m.ends_at<warsawAt(expiry)?m.ends_at:warsawAt(expiry);
  db.prepare('UPDATE memberships SET ends_at=? WHERE group_id=? AND athlete_id=?').run(deadline,e.group_id,e.athlete_id);
  db.prepare('UPDATE membership_periods SET ends_at=? WHERE id=(SELECT MAX(id) FROM membership_periods WHERE group_id=? AND athlete_id=?)').run(deadline,e.group_id,e.athlete_id);
 }
 function bootstrap() {
  atomic(()=>{
   const rows=all("SELECT e.id FROM memberships m JOIN enrollments e ON e.group_id=m.group_id AND e.athlete_id=m.athlete_id AND e.trial_id=m.trial_id WHERE m.status='trial' AND (m.ends_at IS NULL OR m.ends_at>?) AND NOT EXISTS(SELECT 1 FROM trial_decisions t WHERE t.enrollment_id=e.id) ORDER BY e.id",warsawNow());
   for(const row of rows)startTrial(row.id,true);
  });
 }
 function sync() {
  atomic(()=>{
   for(const trial of all("SELECT t.*,e.group_id,e.athlete_id,s.starts_at,s.ends_at AS session_end FROM trial_decisions t JOIN enrollments e ON e.id=t.enrollment_id JOIN sessions s ON s.id=e.trial_id WHERE t.status='pending' AND t.expires_at>?",Date.now())) {
    const end=trial.session_end||warsawAt(warsawEpoch(trial.starts_at)+3600000);
    if(end!==trial.ends_at) {
     const expires=warsawEpoch(end)+(trial.expires_at-warsawEpoch(trial.ends_at));
     db.prepare('UPDATE trial_decisions SET ends_at=?,expires_at=? WHERE enrollment_id=?').run(end,expires,trial.enrollment_id);
     db.prepare("UPDATE memberships SET ends_at=? WHERE group_id=? AND athlete_id=? AND status='trial' AND withdrawal_reason=''").run(warsawAt(expires),trial.group_id,trial.athlete_id);
     db.prepare("UPDATE membership_periods SET ends_at=? WHERE id=(SELECT MAX(id) FROM membership_periods WHERE group_id=? AND athlete_id=?) AND status='trial' AND withdrawal_reason=''").run(warsawAt(expires),trial.group_id,trial.athlete_id);
    }
   }
   db.prepare("UPDATE trial_decisions SET status='expired' WHERE status='pending' AND expires_at<=?").run(Date.now());
   db.prepare("UPDATE waiting_list SET status='expired' WHERE status='offered' AND expires_at<=?").run(Date.now());
   for(const g of all("SELECT * FROM groups WHERE id IN (SELECT group_id FROM waiting_list WHERE status IN ('waiting','offered'))")) {
    if(!open(g)||!future(g).length){db.prepare("UPDATE waiting_list SET status='waiting',expires_at=NULL WHERE group_id=? AND status='offered'").run(g.id);continue;}
    let free=g.capacity-occupied(g.id)-reserved(g.id);
    for(const entry of all("SELECT w.* FROM waiting_list w JOIN users u ON u.id=w.payer_id WHERE w.group_id=? AND w.status='waiting' AND u.access_status='active' ORDER BY w.id",g.id)) {
     if(isCurrentMember(member(g.id,entry.athlete_id))) {db.prepare("UPDATE waiting_list SET status='cancelled' WHERE id=?").run(entry.id);continue;}
     if(free<=0)break;
     db.prepare("UPDATE waiting_list SET status='offered',expires_at=? WHERE id=?").run(Date.now()+settings().offer_hours*3600000,entry.id);notifyChild(db,entry.athlete_id,'offer:'+entry.id+':'+Date.now(),'Wolne miejsce w grupie '+g.name+'. Sprawdź ofertę w panelu.');free--;
    }
   }
  });
 }
 function join(body,athlete,payerId) {
  return atomic(()=>{
   const g=group(body.group_id);enrollmentMonth(body.month);if(!open(g)||!future(g).length)throw Error('Brak otwartych zapisów i zajęć w bieżącym miesiącu.');
   if(isCurrentMember(member(g.id,athlete.id)))throw Error('Dziecko już uczestniczy w tej grupie.');
   const existing=db.prepare("SELECT id FROM waiting_list WHERE group_id=? AND athlete_id=? AND status IN ('waiting','offered')").get(g.id,athlete.id);
   if(existing)return {queued:true,waiting_id:existing.id};
   const id=Number(db.prepare('INSERT INTO waiting_list(group_id,athlete_id,payer_id,created_at) VALUES(?,?,?,?)').run(g.id,athlete.id,payerId,new Date().toISOString()).lastInsertRowid);
   sync();return {queued:true,waiting_id:id};
  });
 }
 function entryFor(body,athlete) {
  const entry=db.prepare('SELECT * FROM waiting_list WHERE id=? AND athlete_id=?').get(Number(body.id),athlete.id);
  if(!entry)throw Error('Nie znaleziono zgłoszenia.');return entry;
 }
 function cancel(body,athlete) {return atomic(()=>{const entry=entryFor(body,athlete);if(!['waiting','offered'].includes(entry.status))throw Error('Zgłoszenie jest już zakończone.');db.prepare("UPDATE waiting_list SET status='cancelled' WHERE id=?").run(entry.id);sync();return {ok:true};});}
 function accept(body,athlete) {
  return atomic(()=>{
   sync();const entry=entryFor(body,athlete);
   if(entry.status==='accepted')return {id:entry.accepted_enrollment_id};
   if(entry.status!=='offered'||entry.expires_at<=Date.now())throw Error('Oferta miejsca wygasła lub nie jest jeszcze dostępna.');
   if(!db.prepare("SELECT id FROM users WHERE id=? AND access_status='active'").get(entry.payer_id))throw Error('Konto płatnika jest zablokowane.');
   const result=saveEnrollment({group_id:entry.group_id,month:body.month,offer_id:entry.id,expected_amount:body.expected_amount},athlete,entry.payer_id);
   db.prepare("UPDATE waiting_list SET status='accepted',accepted_enrollment_id=? WHERE id=?").run(result.id,entry.id);return result;
  });
 }
 function offerFor(groupId,athleteId,offerId) {return db.prepare("SELECT id FROM waiting_list WHERE id=? AND group_id=? AND athlete_id=? AND status='offered' AND expires_at>?").get(Number(offerId)||-1,groupId,athleteId,Date.now());}
 function trial(body,athlete) {
  const e=db.prepare('SELECT e.*,t.ends_at AS trial_end,t.expires_at,t.status AS decision_status,t.regular_enrollment_id FROM enrollments e JOIN trial_decisions t ON t.enrollment_id=e.id WHERE e.id=? AND e.athlete_id=?').get(Number(body.id),athlete.id);
  if(!e)throw Error('Nie znaleziono zapisu próbnego.');return e;
 }
 function conversionQuote(body,athlete) {
  const e=trial(body,athlete);enrollmentMonth(body.month);
  if(e.decision_status==='converted')throw Error('Zapis został już potwierdzony.');
  const m=member(e.group_id,athlete.id);
  if(m?.status!=='trial'||m.trial_id!==e.trial_id||m.withdrawal_reason)throw Error('Ten zapis próbny nie może być kontynuowany.');
  const ownOffer=offerFor(e.group_id,athlete.id,body.offer_id);
  if(!isCurrentMember(m)&&occupied(e.group_id)+reserved(e.group_id,ownOffer?.id)>=group(e.group_id).capacity)throw Error('Rezerwacja wygasła i nie ma wolnego miejsca. Dołącz do listy rezerwowej.');
  if(warsawNow()<e.trial_end)throw Error('Zapis stały potwierdzisz po zakończeniu zajęć próbnych.');
  const q=quote({group_id:e.group_id,month:body.month,athlete_id:athlete.id});
  return {...q,source:e};
 }
 function convert(body,athlete) {
  return atomic(()=>{
   const e=trial(body,athlete);
   if(e.decision_status==='converted')return {id:e.regular_enrollment_id};
   const q=conversionQuote(body,athlete);
   if(body.expected_amount!==q.amount)throw Error('Kwota uległa zmianie. Sprawdź aktualne podsumowanie i potwierdź ponownie.');
   const payer=db.prepare('SELECT * FROM users WHERE id=?').get(e.payer_id??athlete.parent_id);
   if(db.prepare('SELECT 1 FROM enrollments WHERE group_id=? AND athlete_id=? AND month=? AND trial_id IS NULL').get(e.group_id,athlete.id,q.month))throw Error('Istnieje już stały zapis za ten miesiąc.');
   const result=Number(db.prepare('INSERT INTO enrollments(group_id,parent,email,child,month,trial_id,amount,created_at,athlete_id,payer_id) VALUES(?,?,?,?,?,NULL,?,?,?,?)').run(e.group_id,payer.name,payer.email,athlete.name,q.month,q.amount,q.joinedAt,athlete.id,payer.id).lastInsertRowid);
   db.prepare('UPDATE membership_periods SET ends_at=CASE WHEN ends_at IS NULL OR ends_at>? THEN ? ELSE ends_at END WHERE id=(SELECT MAX(id) FROM membership_periods WHERE group_id=? AND athlete_id=?)').run(q.joinedAt,q.joinedAt,e.group_id,athlete.id);
   db.prepare("UPDATE memberships SET status='active',joined_at=?,ends_at=NULL,trial_id=NULL,withdrawal_reason='' WHERE group_id=? AND athlete_id=?").run(q.joinedAt,e.group_id,athlete.id);
   db.prepare("INSERT INTO membership_periods(group_id,athlete_id,status,starts_at) VALUES(?,?,'active',?)").run(e.group_id,athlete.id,q.joinedAt);
   for(const term of q.terms)db.prepare('INSERT INTO enrollment_sessions VALUES(?,?,?)').run(result,term.id,term.price);
   db.prepare("UPDATE trial_decisions SET status='converted',regular_enrollment_id=? WHERE enrollment_id=?").run(result,e.id);
   return {id:result,amount:q.amount};
  });
 }
 function saveSettings(body) {
  for(const field of ['trial_hours','offer_hours'])if(!Number.isInteger(body[field])||body[field]<1||body[field]>168)throw Error('Czas potwierdzenia musi wynosić od 1 do 168 godzin.');
  db.prepare('UPDATE admission_settings SET trial_hours=?,offer_hours=? WHERE id=1').run(body.trial_hours,body.offer_hours);return {ok:true};
 }
 return {settings,saveSettings,bootstrap,sync,startTrial,reserved,occupied,join,cancel,accept,offerFor,conversionQuote,convert};
}
