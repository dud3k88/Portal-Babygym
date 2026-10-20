import { randomBytes } from 'node:crypto';
import { digest } from './security.js';
import { emailAddress } from './auth.js';

export function createGuardians(db,auth) {
  function canAccess(athlete,user) {
    return user.role==='admin'||athlete.parent_id===user.id||Boolean(db.prepare('SELECT 1 FROM athlete_guardians WHERE athlete_id=? AND user_id=?').get(athlete.id,user.id));
  }
  function athleteFor(id,user) {
    const athlete=db.prepare('SELECT * FROM athletes WHERE id=?').get(Number(id));
    if(!athlete||!canAccess(athlete,user))throw Object.assign(Error('Nie znaleziono zawodnika.'),{status:404});
    return athlete;
  }
  function links() {
    return db.prepare(`SELECT id AS athlete_id,parent_id AS user_id,1 AS primary_guardian,NULL AS verified_at FROM athletes
      UNION ALL SELECT g.athlete_id,g.user_id,0,g.verified_at FROM athlete_guardians g JOIN athletes a ON a.id=g.athlete_id WHERE g.user_id<>a.parent_id`).all();
  }
  function transaction(work) {
    db.exec('SAVEPOINT guardian_action');
    try{const result=work();db.exec('RELEASE guardian_action');return result;}
    catch(error){db.exec('ROLLBACK TO guardian_action');db.exec('RELEASE guardian_action');throw error;}
  }
  function invitationFor(token,user) {
    if(user.role!=='parent')throw Error('Zaproszenie jest przeznaczone dla konta rodzica.');
    const invitation=db.prepare(`SELECT i.*,a.name AS child FROM guardian_invitations i JOIN athletes a ON a.id=i.athlete_id
      JOIN users inviter ON inviter.id=i.invited_by
      WHERE token_hash=? AND expires_at>? AND i.email=? AND inviter.access_status='active'
      AND (inviter.role='admin' OR a.parent_id=inviter.id OR EXISTS(SELECT 1 FROM athlete_guardians WHERE athlete_id=a.id AND user_id=inviter.id))`).get(digest(String(token||'')),Date.now(),user.email);
    if(!invitation)throw Error('Zaproszenie wygasło, zostało cofnięte lub dotyczy innego adresu email. Zaloguj się na zaproszone konto.');
    return invitation;
  }
  function invite(body,user) {
    const athlete=athleteFor(body.athlete_id,user),email=emailAddress(body.email);
    const recipient=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(recipient&&(recipient.role!=='parent'||recipient.access_status!=='active'))throw Error('Nie można zaprosić tego konta.');
    if(recipient&&canAccess(athlete,recipient))throw Error('Ten rodzic ma już dostęp do dziecka.');
    const token=randomBytes(32).toString('hex');
    transaction(()=>{
      db.prepare('DELETE FROM guardian_invitations WHERE athlete_id=? AND email=?').run(athlete.id,email);
      db.prepare('INSERT INTO guardian_invitations(athlete_id,email,invited_by,token_hash,expires_at) VALUES(?,?,?,?,?)').run(athlete.id,email,user.id,digest(token),Date.now()+86400000);
      auth.deliver('guardian',email,token,{athlete_id:athlete.id});
    });
    return {ok:true,message:'Zaproszenie zapisano w lokalnej skrzynce testowej. Nie wysłano emaila.'};
  }
  function accept(body,user) {
    return transaction(()=>{
      const invitation=invitationFor(body.token,user);
      db.prepare('INSERT OR IGNORE INTO athlete_guardians VALUES(?,?,?)').run(invitation.athlete_id,user.id,new Date().toISOString());
      db.prepare('DELETE FROM guardian_invitations WHERE id=?').run(invitation.id);
      return {ok:true,athlete_id:invitation.athlete_id};
    });
  }
  function revoke(body,user) {
    const athlete=athleteFor(body.athlete_id,user);
    // Any verified parent can invite. Only the primary parent/admin manages other
    // guardians' access; an additional parent may give up their own access.
    if(user.role!=='admin'&&athlete.parent_id!==user.id&&Number(body.user_id)!==user.id)throw Object.assign(Error('Tę zmianę może wykonać główny rodzic lub administrator.'),{status:403});
    if(Number(body.user_id)===athlete.parent_id)throw Error('Nie można usunąć głównego rodzica.');
    transaction(()=>{
      db.prepare('DELETE FROM athlete_guardians WHERE athlete_id=? AND user_id=?').run(athlete.id,Number(body.user_id));
      db.prepare('DELETE FROM guardian_invitations WHERE athlete_id=? AND (invited_by=? OR email=(SELECT email FROM users WHERE id=?))').run(athlete.id,Number(body.user_id),Number(body.user_id));
    });
    return {ok:true};
  }
  function cancel(body,user) {
    const athlete=athleteFor(body.athlete_id,user);
    const invitation=db.prepare('SELECT * FROM guardian_invitations WHERE id=? AND athlete_id=?').get(Number(body.id),athlete.id);
    if(!invitation)throw Error('Nie znaleziono zaproszenia.');
    if(user.role!=='admin'&&athlete.parent_id!==user.id&&invitation.invited_by!==user.id)throw Object.assign(Error('Brak uprawnień do cofnięcia zaproszenia.'),{status:403});
    db.prepare('DELETE FROM guardian_invitations WHERE id=?').run(invitation.id);
    return {ok:true};
  }
  return {canAccess,athleteFor,links,invite,accept,revoke,cancel,preview:(body,user)=>({child:invitationFor(body.token,user).child})};
}
