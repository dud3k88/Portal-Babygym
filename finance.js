import {notifyChild} from './workspace.js';
import { warsawNow } from './billing.js';
import { validDate } from './schedule.js';
import { integer,required,transaction } from './operations.js';
export function createFinance(db,{sessions}) {
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 function total(id){return db.prepare('SELECT amount+COALESCE((SELECT SUM(amount) FROM adjustments WHERE enrollment_id=e.id),0)-COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE enrollment_id=e.id),0) AS balance FROM enrollments e WHERE id=?').get(id)?.balance;}
 function credit(id){return db.prepare('SELECT amount-COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id=p.id),0)-COALESCE((SELECT SUM(amount) FROM refunds WHERE payment_id=p.id AND status IN (\'approved\',\'paid\')),0) AS amount FROM payments p WHERE id=?').get(id)?.amount;}
 function payment(b,user){return transaction(db,()=>{
  const athlete=db.prepare('SELECT * FROM athletes WHERE id=?').get(integer(b.athlete_id));if(!athlete)throw Error('Wybierz zawodnika.');
  const amount=integer(b.amount,1,100000000),reference=required(b.reference,200),date=required(b.date);
  if(!validDate(date)||date>warsawNow().slice(0,10))throw Error('Podaj datę otrzymania wpłaty.');
  const payer=integer(b.payer_id??athlete.parent_id);
  if(!db.prepare("SELECT id FROM users WHERE id=? AND role='parent'").get(payer))throw Error('Wybierz płatnika.');
  const old=db.prepare('SELECT * FROM payments WHERE reference=?').get(reference);
  if(old){if(old.amount!==amount||old.athlete_id!==athlete.id||old.payer_id!==payer||old.paid_on!==date)throw Error('Ten identyfikator wpłaty ma już inne dane.');return {id:old.id,duplicate:true};}
  const id=Number(db.prepare('INSERT INTO payments(athlete_id,payer_id,amount,reference,paid_on,actor_id,created_at) VALUES(?,?,?,?,?,?,?)').run(athlete.id,payer,amount,reference,date,user.id,warsawNow()).lastInsertRowid);
  if(b.allocate!==false)allocate({payment_id:id},user);
  return {id};
 });}
 function allocate(b,user){return transaction(db,()=>{
  const p=db.prepare('SELECT * FROM payments WHERE id=?').get(integer(b.payment_id));if(!p)throw Error('Nie znaleziono wpłaty.');
  let remaining=credit(p.id);const charges=all('SELECT id FROM enrollments WHERE athlete_id=? AND payer_id=? ORDER BY month,id',p.athlete_id,p.payer_id);
  for(const e of charges){const amount=Math.min(remaining,Math.max(0,total(e.id)));if(amount){db.prepare('INSERT INTO payment_allocations(payment_id,enrollment_id,amount,actor_id,created_at) VALUES(?,?,?,?,?)').run(p.id,e.id,amount,user.id,warsawNow());remaining-=amount;}}
  return {credit:remaining};
 });}
 function refund(b,user){return transaction(db,()=>{
  const p=db.prepare('SELECT * FROM payments WHERE id=?').get(integer(b.payment_id));if(!p)throw Error('Nie znaleziono wpłaty.');
  const amount=integer(b.amount,1,100000000),reason=required(b.reason,1000),reference=required(b.reference,200);
  const existing=db.prepare('SELECT * FROM refunds WHERE reference=?').get(reference);if(existing){if(existing.payment_id!==p.id||existing.amount!==amount)throw Error('Identyfikator zwrotu już wykorzystany.');return {id:existing.id};}
  if(amount>credit(p.id))throw Error('Kwota przekracza wolne środki tej wpłaty.');
  const id=Number(db.prepare("INSERT INTO refunds(payment_id,amount,reason,reference,status,actor_id,created_at) VALUES(?,?,?,?,'approved',?,?)").run(p.id,amount,reason,reference,user.id,warsawNow()).lastInsertRowid);return {id};
 });}
 function refundPaid(b,user){const r=db.prepare('SELECT * FROM refunds WHERE id=?').get(integer(b.id));if(!r)throw Error('Nie znaleziono zwrotu.');if(r.status==='paid')return {ok:true};const date=required(b.date);if(!validDate(date)||date>warsawNow().slice(0,10))throw Error('Nieprawidłowa data.');db.prepare("UPDATE refunds SET status='paid',paid_on=?,actor_id=? WHERE id=?").run(date,user.id,r.id);return {ok:true};}
 function rate(gid,date){return db.prepare('SELECT * FROM price_versions WHERE group_id=? AND starts_on<=? ORDER BY starts_on DESC,id DESC LIMIT 1').get(gid,date);}
 function price(b){const group=db.prepare('SELECT * FROM groups WHERE id=?').get(integer(b.group_id));if(!group)throw Error('Brak grupy.');if(!validDate(b.starts_on))throw Error('Podaj datę obowiązywania.');integer(b.amount,0,10000000);const vat=b.vat_bps===null?null:integer(b.vat_bps,0,10000);const id=Number(db.prepare('INSERT INTO price_versions(group_id,starts_on,amount,vat_bps) VALUES(?,?,?,?)').run(group.id,b.starts_on,b.amount,vat).lastInsertRowid);return {id};}
 function discount(b){integer(b.athlete_id);if(!db.prepare('SELECT id FROM athletes WHERE id=?').get(b.athlete_id))throw Error('Brak zawodnika.');if(!validDate(b.starts_on)||!validDate(b.ends_on)||b.starts_on>b.ends_on)throw Error('Nieprawidłowe daty.');if(!['percent','fixed'].includes(b.kind))throw Error('Wybierz rabat.');integer(b.value,0,b.kind==='percent'?10000:10000000);const reason=required(b.reason,1000);if(db.prepare('SELECT 1 FROM discounts WHERE athlete_id=? AND starts_on<=? AND ends_on>=?').get(b.athlete_id,b.ends_on,b.starts_on))throw Error('Okres rabatu pokrywa się z innym rabatem.');return {id:Number(db.prepare('INSERT INTO discounts(athlete_id,starts_on,ends_on,kind,value,reason) VALUES(?,?,?,?,?,?)').run(b.athlete_id,b.starts_on,b.ends_on,b.kind,b.value,reason).lastInsertRowid)};}
 function unitPrice(gid,athleteId,term){
  const version=rate(gid,term.starts_at.slice(0,10));let amount=version?.amount??term.price;
  const discount=db.prepare('SELECT * FROM discounts WHERE athlete_id=? AND starts_on<=? AND ends_on>=?').get(athleteId,term.starts_at.slice(0,10),term.starts_at.slice(0,10));
  if(discount)amount=discount.kind==='percent'?Math.round(amount*(10000-discount.value)/10000):Math.max(0,amount-discount.value);
  return amount;
 }
 function generate(b,user){return transaction(db,()=>{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month)||b.month>warsawNow().slice(0,7))throw Error('Wybierz bieżący lub wcześniejszy miesiąc.');
  let count=0;
  const groups=all('SELECT * FROM groups').filter(g=>(!b.group_id||g.id===b.group_id)&&(!b.location_id||g.location_id===b.location_id));
  for(const g of groups)for(const a of all("SELECT DISTINCT a.* FROM athletes a JOIN membership_periods p ON p.athlete_id=a.id WHERE p.group_id=? AND p.status='active'",g.id)){
   if(db.prepare('SELECT 1 FROM enrollments WHERE group_id=? AND athlete_id=? AND month=? AND trial_id IS NULL').get(g.id,a.id,b.month))continue;
   const terms=sessions().filter(s=>s.group_id===g.id&&s.starts_at.startsWith(b.month)&&!s.excluded&&db.prepare("SELECT 1 FROM membership_periods WHERE group_id=? AND athlete_id=? AND status='active' AND starts_at<=? AND (ends_at IS NULL OR ends_at>?)").get(g.id,a.id,s.starts_at,s.starts_at));if(!terms.length)continue;
   const payer=db.prepare('SELECT * FROM users WHERE id=?').get(a.parent_id),amount=terms.reduce((sum,t)=>sum+unitPrice(g.id,a.id,t),0);
   const id=Number(db.prepare('INSERT INTO enrollments(group_id,parent,email,child,month,amount,created_at,athlete_id,payer_id) VALUES(?,?,?,?,?,?,?,?,?)').run(g.id,payer.name,payer.email,a.name,b.month,amount,b.month+'-01T00:00:00',a.id,payer.id).lastInsertRowid);
   for(const term of terms)db.prepare('INSERT INTO enrollment_sessions VALUES(?,?,?)').run(id,term.id,unitPrice(g.id,a.id,term));
   db.prepare('INSERT INTO billing_runs(enrollment_id,actor_id,created_at) VALUES(?,?,?)').run(id,user?.id??null,warsawNow());notifyChild(db,a.id,'charge:'+id,'Nowa należność za '+b.month+'. Sprawdź rozliczenia dziecka.');count++;
  }
  for(const p of all('SELECT id FROM payments'))allocate({payment_id:p.id},user||{id:null});
  return {created:count};
 });}
 function view(user,athleteIds){
  const admin=user.role==='admin',ids=new Set(athleteIds);
  const payments=all('SELECT * FROM payments ORDER BY paid_on DESC,id DESC').filter(p=>admin||ids.has(p.athlete_id));
  const visible=new Set(payments.map(p=>p.id));
  return {deadlines:all('SELECT d.*,e.athlete_id FROM enrollment_deadlines d JOIN enrollments e ON e.id=d.enrollment_id').filter(d=>admin||ids.has(d.athlete_id)),settings:db.prepare('SELECT * FROM finance_settings WHERE id=1').get(),fee_rules:admin?all('SELECT * FROM annual_fee_rules'):[],fees:all('SELECT * FROM annual_fees').filter(f=>admin||ids.has(f.athlete_id)),payments:payments.map(p=>({...p,credit:credit(p.id)})),allocations:all('SELECT * FROM payment_allocations').filter(a=>visible.has(a.payment_id)),refunds:all('SELECT * FROM refunds').filter(r=>visible.has(r.payment_id)),prices:admin?all('SELECT * FROM price_versions ORDER BY starts_on DESC'):[],discounts:admin?all('SELECT * FROM discounts'):[]};
 }
 function rebalance(user={id:null}){return transaction(db,()=>{
  for(const e of all('SELECT id,amount+COALESCE((SELECT SUM(amount) FROM adjustments WHERE enrollment_id=e.id),0) AS due FROM enrollments e')){
   const allocations=all('SELECT payment_id,SUM(amount) AS amount FROM payment_allocations WHERE enrollment_id=? GROUP BY payment_id HAVING SUM(amount)>0 ORDER BY payment_id',e.id);
   let excess=Math.max(0,allocations.reduce((s,a)=>s+a.amount,0)-Math.max(0,e.due));
   for(const a of allocations){const amount=Math.min(excess,a.amount);if(amount){db.prepare('INSERT INTO payment_allocations(payment_id,enrollment_id,amount,reason,actor_id,created_at) VALUES(?,?,?,?,?,?)').run(a.payment_id,e.id,-amount,'Zwolnienie nadpłaty po korekcie należności',user.id,warsawNow());excess-=amount;}}
  }
 });}
 function configure(b){if(typeof b.auto_monthly!=='boolean')throw Error('Wybierz tryb naliczania.');integer(b.due_day,1,28);const account=String(b.bank_account||'').replace(/\s/g,'');if(account&&!/^(PL)?[0-9]{26}$/.test(account))throw Error('Podaj polski numer rachunku (26 cyfr).');if(account){const n=account.replace(/^PL/,'');if(BigInt(n.slice(2)+'2521'+n.slice(0,2))%97n!==1n)throw Error('Nieprawidłowa suma kontrolna numeru rachunku.');}db.prepare('UPDATE finance_settings SET auto_monthly=?,since_month=COALESCE(since_month,?),due_day=?,bank_account=? WHERE id=1').run(Number(b.auto_monthly),warsawNow().slice(0,7),b.due_day,account);return {ok:true};}
 function auto(){const cfg=db.prepare('SELECT * FROM finance_settings WHERE id=1').get();if(!cfg.auto_monthly)return;let month=cfg.since_month;for(let i=0;month<=warsawNow().slice(0,7)&&i<240;i++){if(!db.prepare('SELECT 1 FROM automatic_billing_months WHERE month=?').get(month))transaction(db,()=>{generate({month},{id:null});db.prepare('INSERT INTO automatic_billing_months VALUES(?,?)').run(month,warsawNow());});const [y,m]=month.split('-').map(Number);month=m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0');}}
 function feeRule(b){integer(b.amount,0,10000000);db.prepare('INSERT INTO annual_fee_rules VALUES(?,?) ON CONFLICT(season_id) DO UPDATE SET amount=excluded.amount').run(integer(b.season_id),b.amount);return {ok:true};}
 function fee(b,user){return transaction(db,()=>{const old=db.prepare('SELECT * FROM annual_fees WHERE athlete_id=? AND season_id=?').get(integer(b.athlete_id),integer(b.season_id));if(old)return {duplicate:true};const rule=db.prepare('SELECT * FROM annual_fee_rules WHERE season_id=?').get(b.season_id);if(!rule)throw Error('Najpierw ustaw wpisowe dla sezonu.');const e=db.prepare('SELECT e.id FROM enrollments e JOIN groups g ON g.id=e.group_id WHERE e.athlete_id=? AND g.season_id=? AND e.trial_id IS NULL ORDER BY e.id LIMIT 1').get(b.athlete_id,b.season_id);if(!e)throw Error('Brak zapisu uczestnika w tym sezonie.');const amount=b.exempt===true?0:rule.amount,reason=required(b.reason,1000);db.prepare('INSERT INTO annual_fees VALUES(?,?,?,?,?)').run(b.athlete_id,b.season_id,e.id,amount,reason);if(amount)db.prepare('INSERT INTO adjustments(enrollment_id,amount,reason,created_at) VALUES(?,?,?,?)').run(e.id,amount,'Wpisowe za sezon: '+reason,warsawNow());return {amount};});}
 function dueDate(b,user){return transaction(db,()=>{if(user.role!=='admin')throw Object.assign(Error('Wymagane konto administratora.'),{status:403});const id=integer(b.enrollment_id),reason=required(b.reason,1000);if(!validDate(b.due_on))throw Error('Podaj poprawną datę płatności.');const e=db.prepare('SELECT * FROM enrollments WHERE id=?').get(id);if(!e)throw Error('Nie znaleziono należności.');if(b.due_on<e.created_at.slice(0,10))throw Error('Termin nie może poprzedzać daty zapisu należności.');if(e.due_on===b.due_on)return {ok:true};db.prepare('INSERT INTO enrollment_deadlines(enrollment_id,old_due_on,new_due_on,reason,actor_id,created_at) VALUES(?,?,?,?,?,?)').run(id,e.due_on,b.due_on,reason,user.id,warsawNow());db.prepare('UPDATE enrollments SET due_on=? WHERE id=?').run(b.due_on,id);return {ok:true};});}
 return {dueDate,payment,allocate,refund,refundPaid,price,discount,generate,view,total,unitPrice,rebalance,configure,auto,feeRule,fee};
}
