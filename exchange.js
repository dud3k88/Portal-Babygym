import {paymentTiming} from './payment-deadlines.js';
import {integer,required,transaction} from './operations.js';
import {validDate} from './schedule.js';
import {warsawNow} from './billing.js';
export function createExchange(db,finance,business){
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 function rows(kind,query,user){
  if(user.role!=='admin')throw Object.assign(Error('Wymagane konto administratora.'),{status:403});
  if(kind==='athletes')return all('SELECT a.id,a.name,a.birth_date,u.name AS parent,u.email,u.phone FROM athletes a JOIN users u ON u.id=a.parent_id ORDER BY a.name');
  if(kind==='payments')return all('SELECT p.id,a.name AS child,p.amount,p.reference,p.paid_on FROM payments p JOIN athletes a ON a.id=p.athlete_id ORDER BY p.paid_on');
  if(kind==='charges')return all('SELECT e.id,e.due_on,a.name AS child,e.month,g.name AS group_name,g.location,e.amount+COALESCE((SELECT SUM(amount) FROM adjustments WHERE enrollment_id=e.id),0) AS amount,e.amount+COALESCE((SELECT SUM(amount) FROM adjustments WHERE enrollment_id=e.id),0)-COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE enrollment_id=e.id),0) AS balance FROM enrollments e JOIN athletes a ON a.id=e.athlete_id JOIN groups g ON g.id=e.group_id ORDER BY e.month,e.id').map(e=>paymentTiming(e));
  if(kind==='report'){const r=business.report({month:query.get('month')},user);return Object.entries(r).filter(([key,value])=>typeof value==='number'&&key!=='location_id').map(([key,value])=>({metric:key,value}));}
  if(kind==='wages'){const month=query.get('month');return all('SELECT id,name FROM trainers').flatMap(t=>business.wages(t.id,month,user).items.map(i=>({trainer:t.name,month,...i})));}
  throw Error('Nieznany eksport.');
 }
 function preview(table){if(!table.length)throw Error('Pusty plik.');return {headers:table[0],rows:table.slice(1),athletes:all('SELECT id,name FROM athletes ORDER BY name')};}
 function bank(b,user){return transaction(db,()=>{if(user.role!=='admin')throw Object.assign(Error('Brak dostępu.'),{status:403});if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>100)throw Error('Zatwierdź od 1 do 100 wpłat naraz.');let created=0,duplicates=0;for(const row of b.rows){integer(row.athlete_id);integer(row.amount,1,100000000);required(row.reference);if(!validDate(row.date)||row.date>warsawNow().slice(0,10))throw Error('Nieprawidłowa data wpływu.');const result=finance.payment(row,user);if(result.duplicate)duplicates++;else created++;}return {created,duplicates};});}
 return {rows,preview,bank};
}
