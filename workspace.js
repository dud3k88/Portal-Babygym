import { integer,required,transaction } from './operations.js';
import { warsawNow } from './billing.js';
export function notify(db,userId,key,title){db.prepare('INSERT OR IGNORE INTO notifications(user_id,event_key,title,created_at) VALUES(?,?,?,?)').run(userId,key,title,warsawNow());}
export function notifyChild(db,athleteId,key,title){for(const row of db.prepare('SELECT parent_id AS id FROM athletes WHERE id=? UNION SELECT user_id AS id FROM athlete_guardians WHERE athlete_id=?').all(athleteId,athleteId))notify(db,row.id,key,title);}
export function createWorkspace(db,guardians){
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 const admin=u=>{if(u.role!=='admin')throw Object.assign(Error('Wymagane konto administratora.'),{status:403});};
 const child=(id,u)=>{const a=db.prepare('SELECT * FROM athletes WHERE id=?').get(integer(id));if(!a||!guardians.canAccess(a,u))throw Object.assign(Error('Nie znaleziono zawodnika.'),{status:404});return a;};
 function policies(){return all('SELECT * FROM policy_documents p WHERE published=1 AND id=(SELECT MAX(id) FROM policy_documents WHERE kind=p.kind AND published=1) ORDER BY kind');}
 function savePolicy(b,u){admin(u);if(!['terms','privacy','som','photos','marketing'].includes(b.kind)||typeof b.published!=='boolean')throw Error('Nieprawidłowy dokument.');return {id:Number(db.prepare('INSERT INTO policy_documents(kind,version,title,body,published,created_at) VALUES(?,?,?,?,?,?)').run(b.kind,required(b.version,100),required(b.title),required(b.body,30000),Number(b.published),warsawNow()).lastInsertRowid)};}
 function consent(b,u){return transaction(db,()=>{
  child(b.athlete_id,u);const d=db.prepare('SELECT * FROM policy_documents WHERE id=? AND published=1').get(integer(b.document_id));if(!d||typeof b.accepted!=='boolean')throw Error('Wybierz opublikowany dokument.');
  if(!b.accepted&&!['photos','marketing'].includes(d.kind))throw Error('Wycofać można dobrowolną zgodę na zdjęcia lub marketing.');
  const old=db.prepare('SELECT * FROM policy_acceptances WHERE athlete_id=? AND user_id=? AND document_id=? ORDER BY id DESC LIMIT 1').get(b.athlete_id,u.id,d.id);if(old?.accepted===Number(b.accepted))return {id:old.id};
  return {id:Number(db.prepare('INSERT INTO policy_acceptances(document_id,athlete_id,user_id,accepted,method,created_at) VALUES(?,?,?,?,?,?)').run(d.id,b.athlete_id,u.id,Number(b.accepted),'panel',warsawNow()).lastInsertRowid)};
 });}
 function requirePolicies(athleteId,userId,accepted){
  const ids=Array.isArray(accepted)?accepted:[];
  for(const d of policies())if(['terms','privacy','som'].includes(d.kind)&&!ids.includes(d.id)&&!db.prepare('SELECT 1 FROM policy_acceptances WHERE athlete_id=? AND user_id=? AND document_id=? AND accepted=1').get(athleteId,userId,d.id))throw Error('Potwierdź aktualne dokumenty: '+d.title);
 }
 function recordPublic(athleteId,userId,accepted){for(const id of Array.isArray(accepted)?accepted:[]){const d=policies().find(p=>p.id===id);if(!d)throw Error('Nieprawidłowa wersja dokumentu.');db.prepare('INSERT INTO policy_acceptances(document_id,athlete_id,user_id,accepted,method,created_at) VALUES(?,?,?,1,?,?)').run(id,athleteId,userId,'public-registration',warsawNow());}}
 function conversations(u){return all('SELECT c.*,u.name AS owner_name,u.role AS owner_role FROM conversations c JOIN users u ON u.id=c.owner_id WHERE ?=1 OR c.owner_id=? ORDER BY c.id DESC',Number(u.role==='admin'),u.id);}
 function conversation(id,u){const c=db.prepare('SELECT * FROM conversations WHERE id=?').get(integer(id));if(!c||(u.role!=='admin'&&c.owner_id!==u.id))throw Object.assign(Error('Nie znaleziono rozmowy.'),{status:404});return c;}
 function thread(id,u){const c=conversation(id,u);return {conversation:c,messages:all('SELECT m.id,m.body,m.created_at,u.name AS sender_name FROM conversation_messages m JOIN users u ON u.id=m.sender_id WHERE conversation_id=? ORDER BY m.id',c.id)};}
 function message(b,u){return transaction(db,()=>{
  let c;
  if(b.id)c=conversation(b.id,u);else {
   const owner=u.role==='admin'?integer(b.owner_id):u.id;
   if(!db.prepare('SELECT id FROM users WHERE id=?').get(owner))throw Error('Nie znaleziono odbiorcy.');
   c={id:Number(db.prepare('INSERT INTO conversations(owner_id,subject,category,created_at) VALUES(?,?,?,?)').run(owner,required(b.subject),required(b.category||'Organizacja'),warsawNow()).lastInsertRowid),owner_id:owner};
  }
  const id=Number(db.prepare('INSERT INTO conversation_messages(conversation_id,sender_id,body,created_at) VALUES(?,?,?,?)').run(c.id,u.id,required(b.body,10000),warsawNow()).lastInsertRowid);
  db.prepare("UPDATE conversations SET status=? WHERE id=?").run(u.role==='admin'?'waiting':'new',c.id);
  const recipients=u.role==='admin'?[c.owner_id]:all("SELECT id FROM users WHERE role='admin' AND access_status='active'").map(a=>a.id);
  for(const recipient of recipients)notify(db,recipient,'message:'+id,'Nowa wiadomość w rozmowie #'+c.id);
  return {id:c.id};
 });}
 function status(b,u){admin(u);conversation(b.id,u);if(!['new','progress','waiting','closed'].includes(b.status))throw Error('Nieprawidłowy status.');db.prepare('UPDATE conversations SET status=? WHERE id=?').run(b.status,b.id);return {ok:true};}
 function locationIds(u){if(u.role==='admin')return all('SELECT id FROM locations').map(l=>l.id);if(u.role!=='trainer')return [];return all('SELECT DISTINCT g.location_id AS id FROM groups g JOIN group_trainers gt ON gt.group_id=g.id JOIN trainers t ON t.id=gt.trainer_id WHERE t.user_id=? AND t.status=\'active\'',u.id).map(l=>l.id);}
 function equipment(u){if(u.role==='parent')throw Object.assign(Error('Brak dostępu.'),{status:403});const ids=locationIds(u);const stock=all('SELECT s.*,e.name,e.category,e.description,l.name AS location_name FROM equipment_stock s JOIN equipment e ON e.id=s.equipment_id JOIN locations l ON l.id=s.location_id').filter(s=>ids.includes(s.location_id));return {catalog:u.role==='admin'?all('SELECT * FROM equipment'):[],stock,issues:all('SELECT * FROM equipment_issues').filter(i=>ids.includes(i.location_id)),movements:u.role==='admin'?all('SELECT * FROM equipment_movements ORDER BY id DESC'):[],locations:all('SELECT id,name FROM locations').filter(l=>ids.includes(l.id))};}
 function equipmentSave(b,u){admin(u);return {id:Number(db.prepare('INSERT INTO equipment(name,category,description) VALUES(?,?,?)').run(required(b.name),required(b.category),String(b.description||'').slice(0,2000)).lastInsertRowid)};}
 function move(b,u){admin(u);return transaction(db,()=>{
  if(b.inventory!==undefined&&typeof b.inventory!=='boolean')throw Error('Nieprawidłowy tryb inwentaryzacji.');
  const id=integer(b.equipment_id),quantity=integer(b.quantity,0,100000),reason=required(b.reason,1000),status=required(b.status);
  if(!['good','damaged','replace','retired'].includes(status))throw Error('Wybierz stan sprzętu.');
  const target=integer(b.to_location);if(!db.prepare('SELECT id FROM locations WHERE id=?').get(target)||!db.prepare('SELECT id FROM equipment WHERE id=?').get(id))throw Error('Wybierz sprzęt i lokalizację.');
  if(b.from_location){integer(b.from_location);if(b.from_location===target)throw Error('Wybierz inną lokalizację.');const stock=db.prepare('SELECT quantity FROM equipment_stock WHERE equipment_id=? AND location_id=? AND status=?').get(id,b.from_location,status)?.quantity||0;if(quantity>stock)throw Error('Brak wystarczającej ilości sprzętu.');db.prepare('UPDATE equipment_stock SET quantity=quantity-? WHERE equipment_id=? AND location_id=? AND status=?').run(quantity,id,b.from_location,status);}
  let delta=quantity;if(b.inventory){if(b.from_location)throw Error('Inwentaryzacja dotyczy jednej placówki.');delta=quantity-(db.prepare('SELECT quantity FROM equipment_stock WHERE equipment_id=? AND location_id=? AND status=?').get(id,target,status)?.quantity||0);}
  db.prepare('INSERT INTO equipment_stock VALUES(?,?,?,?) ON CONFLICT(equipment_id,location_id,status) DO UPDATE SET quantity=quantity+?').run(id,target,status,quantity,delta);
  const movement=Number(db.prepare('INSERT INTO equipment_movements(equipment_id,from_location,to_location,status,quantity,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,b.from_location||null,target,status,delta,reason,u.id,warsawNow()).lastInsertRowid);return {id:movement};
 });}
 function issue(b,u){if(!locationIds(u).includes(integer(b.location_id)))throw Object.assign(Error('Brak dostępu do placówki.'),{status:403});if(b.id){admin(u);if(!['open','resolved'].includes(b.status))throw Error('Wybierz status.');db.prepare('UPDATE equipment_issues SET status=? WHERE id=? AND location_id=?').run(b.status,integer(b.id),b.location_id);return {ok:true};}return {id:Number(db.prepare('INSERT INTO equipment_issues(equipment_id,location_id,body,actor_id,created_at) VALUES(?,?,?,?,?)').run(b.equipment_id||null,b.location_id,required(b.body,2000),u.id,warsawNow()).lastInsertRowid)};}
 function state(u){const ids=all('SELECT * FROM athletes').filter(a=>guardians.canAccess(a,u)).map(a=>a.id);return {conversations:conversations(u),notifications:all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC',u.id),documents:policies(),acceptances:all('SELECT * FROM policy_acceptances').filter(a=>ids.includes(a.athlete_id)),equipment:u.role==='parent'?null:equipment(u)};}
 function read(b,u){db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').run(warsawNow(),integer(b.id),u.id);return {ok:true};}
 return {state,policies,savePolicy,consent,requirePolicies,recordPublic,thread,message,status,equipment,equipmentSave,move,issue,read};
}
