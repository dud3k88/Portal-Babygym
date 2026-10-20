import {integer,required,transaction} from './operations.js';
import {warsawNow} from './billing.js';
import {isCurrentMember} from './participation.js';
import {notifyChild} from './workspace.js';
export function createMembershipOperations(db,{chargedTotals,reconcileExclusions,saveEnrollment,admissions,finance,sessions,seasonService,participation}){
 function run(b,user){if(user.role!=='admin')throw Object.assign(Error('Wymagane konto administratora.'),{status:403});return transaction(db,()=>{
  if(!['transfer','suspend','resume'].includes(b.action))throw Error('Wybierz przeniesienie lub zawieszenie.');
  if(!Array.isArray(b.athlete_ids)||!b.athlete_ids.length||b.athlete_ids.length>200)throw Error('Wybierz od 1 do 200 zawodników.');
  const source=integer(b.group_id),target=b.action==='transfer'?integer(b.target_group_id):null,reason=required(b.reason,1000),now=warsawNow();
  if(target===source)throw Error('Wybierz inną grupę.');const ids=[...new Set(b.athlete_ids)].map(id=>integer(id));
  if(b.action==='resume'){
   const group=db.prepare('SELECT * FROM groups WHERE id=?').get(source);if(!group||!seasonService.available(group))throw Error('Grupa musi mieć otwarte zapisy.');
   const active=db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE group_id=? AND status IN ('active','trial') AND (ends_at IS NULL OR ends_at>?)").get(source,now).n;if(active+ids.length+admissions.reserved(source)>group.capacity)throw Error('Brak wolnych miejsc do wznowienia.');
   for(const id of ids){const member=db.prepare('SELECT * FROM memberships WHERE group_id=? AND athlete_id=?').get(source,id);if(member?.status!=='suspended')throw Error('Wybierz wyłącznie zawieszonych zawodników.');const a=db.prepare('SELECT * FROM athletes WHERE id=?').get(id);const charge=db.prepare('SELECT * FROM enrollments WHERE group_id=? AND athlete_id=? AND month=? AND trial_id IS NULL').get(source,id,now.slice(0,7));
    if(!charge)saveEnrollment({group_id:source},a);else {const before=chargedTotals();db.prepare("UPDATE memberships SET status='active',joined_at=?,ends_at=NULL,withdrawal_reason='' WHERE group_id=? AND athlete_id=?").run(now,source,id);participation.recordStart(source,id,'active',now);for(const term of sessions().filter(s=>s.group_id===source&&s.starts_at.startsWith(now.slice(0,7))&&s.starts_at>=now&&!s.cancelled))db.prepare('INSERT OR IGNORE INTO enrollment_sessions VALUES(?,?,?)').run(charge.id,term.id,finance.unitPrice(source,id,term));reconcileExclusions(before,'Wznowienie udziału: '+reason);}
    notifyChild(db,id,'resume:'+source+':'+id+':'+now,'Wznowiono udział dziecka w zajęciach.');
   }finance.rebalance(user);return {changed:ids.length,effective_at:now};
  }
  for(const id of ids){const member=db.prepare('SELECT * FROM memberships WHERE group_id=? AND athlete_id=?').get(source,id);if(!isCurrentMember(member)||member.status!=='active')throw Error('Operacja wymaga aktywnego zapisu stałego każdego wybranego zawodnika.');}
  const before=chargedTotals();for(const id of ids){db.prepare('UPDATE membership_periods SET ends_at=?,withdrawal_reason=? WHERE group_id=? AND athlete_id=? AND (ends_at IS NULL OR ends_at>?)').run(now,reason,source,id,now);db.prepare('UPDATE memberships SET ends_at=?,withdrawal_reason=?,status=? WHERE group_id=? AND athlete_id=?').run(now,reason,b.action==='suspend'?'suspended':'ended',source,id);}
  reconcileExclusions(before,(b.action==='suspend'?'Zawieszenie udziału: ':'Przeniesienie: ')+reason);
  for(const id of ids){if(target){const a=db.prepare('SELECT * FROM athletes WHERE id=?').get(id);saveEnrollment({group_id:target},a);}notifyChild(db,id,'membership:'+source+':'+id+':'+now,b.action==='suspend'?'Zawieszono udział dziecka w grupie.':'Zmieniono grupę dziecka. Sprawdź terminy i rozliczenie.');}
  finance.rebalance(user);admissions.sync();return {changed:ids.length,effective_at:now};
 });}
 return {run};
}
