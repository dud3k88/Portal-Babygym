import { emailAddress } from './auth.js';
import { warsawNow } from './billing.js';
const id=value=>{if(!Number.isSafeInteger(value)||value<1)throw Error('Nieprawidłowe konto.');return value;};
const text=(value,label,required=false)=>{if(typeof value!=='string'||value.length>200||(required&&!value.trim()))throw Error('Podaj poprawne '+label+'.');return value.trim();};
export function createUserService(db,auth) {
 const get=value=>{const user=db.prepare('SELECT * FROM users WHERE id=?').get(id(value));if(!user)throw Error('Nie znaleziono użytkownika.');return user;};
 const atomic=fn=>{db.exec('SAVEPOINT user_change');try{const result=fn();db.exec('RELEASE user_change');return result;}catch(error){db.exec('ROLLBACK TO user_change');db.exec('RELEASE user_change');throw error;}};
 function list(params) {
  const role=params.get('role')||'',status=params.get('status')||'',activation=params.get('activation')||'',search=params.get('search')||'';
  const page=Number(params.get('page')||1);
  if(!Number.isSafeInteger(page)||page<1||page>1000000||search.length>200||!['','admin','parent','trainer'].includes(role)||!['','active','blocked'].includes(status)||!['','pending','ready'].includes(activation))throw Error('Nieprawidłowe filtry użytkowników.');
  const where=[],args=[];
  if(role){where.push('u.role=?');args.push(role);}
  if(status){where.push('u.access_status=?');args.push(status);}
  if(activation)where.push(activation==='pending'?'u.password_hash IS NULL':'u.password_hash IS NOT NULL');
  if(search.trim()){where.push("(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')");const value='%'+search.trim().replace(/[\\%_]/g,'\\$&')+'%';args.push(value,value,value);}
  const sql=where.length?' WHERE '+where.join(' AND '):'';
  const total=db.prepare('SELECT COUNT(*) AS n FROM users u'+sql).get(...args).n;
  const items=db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.role,u.access_status,u.created_at,u.password_hash IS NOT NULL AS activated,
   EXISTS(SELECT 1 FROM admin_mfa m WHERE m.user_id=u.id) AS mfa_enrolled,
   (SELECT t.id FROM trainers t WHERE t.user_id=u.id) AS trainer_id FROM users u${sql} ORDER BY u.name COLLATE NOCASE,u.id LIMIT 50 OFFSET ?`).all(...args,(page-1)*50);
  return {items,total,page,pages:Math.max(1,Math.ceil(total/50))};
 }
 function create(body) {
  const name=text(body.name,'imię i nazwisko',true),phone=text(body.phone??'','numer telefonu'),email=emailAddress(body.email);
  if(!['admin','parent','trainer'].includes(body.role))throw Error('Wybierz rolę użytkownika.');
  return atomic(()=>{
   if(db.prepare('SELECT id FROM users WHERE email=?').get(email))throw Error('Konto z tym adresem już istnieje. Znajdź je na liście użytkowników.');
   if(body.role==='trainer'&&db.prepare('SELECT id FROM trainers WHERE lower(email)=?').get(email))throw Error('Istnieje profil trenera z tym adresem. Utwórz jego konto w dziale Trenerzy.');
   const userId=Number(db.prepare('INSERT INTO users(name,email,phone,role,created_at) VALUES(?,?,?,?,?)').run(name,email,phone,body.role,warsawNow()).lastInsertRowid);
   if(body.role==='trainer')db.prepare('INSERT INTO trainers(name,email,phone,user_id) VALUES(?,?,?,?)').run(name,email,phone,userId);
   return {id:userId,token:auth.invite(userId,body.role)};
  });
 }
 function update(body) {
  return atomic(()=>{
   const user=get(body.id),name=text(body.name,'imię i nazwisko',true),phone=text(body.phone??'','numer telefonu');
   if((body.role!==undefined&&body.role!==user.role)||(body.email!==undefined&&body.email!==user.email))throw Error('Rola i adres logowania istniejącego konta pozostają bez zmian.');
   db.prepare('UPDATE users SET name=?,phone=? WHERE id=?').run(name,phone,user.id);
   if(user.role==='trainer')db.prepare('UPDATE trainers SET name=?,phone=? WHERE user_id=?').run(name,phone,user.id);
   return {ok:true};
  });
 }
 function access(body,actor) {
  if(!['active','blocked'].includes(body.access_status))throw Error('Nieprawidłowy status dostępu.');
  return atomic(()=>{
   const user=get(body.id);
   if(body.access_status==='blocked'&&user.role==='admin') {
    if(user.id===actor.id)throw Error('Nie możesz zablokować własnego konta administratora.');
    if(!db.prepare("SELECT 1 FROM users u JOIN admin_mfa m ON m.user_id=u.id WHERE u.role='admin' AND u.access_status='active' AND u.password_hash IS NOT NULL AND u.id<>? LIMIT 1").get(user.id))throw Error('Musi pozostać co najmniej jeden aktywowany administrator z MFA.');
   }
   if(body.access_status==='active'&&user.role==='trainer'&&!db.prepare("SELECT id FROM trainers WHERE user_id=? AND status='active'").get(user.id))throw Error('Najpierw aktywuj profil w dziale Trenerzy.');
   db.prepare('UPDATE users SET access_status=? WHERE id=?').run(body.access_status,user.id);
   if(body.access_status==='blocked')auth.invalidate(user.id);
   return {ok:true};
  });
 }
 function invite(body) {const user=get(body.id);return {token:auth.invite(user.id,user.role)};}
 return {list,create,update,access,invite};
}
