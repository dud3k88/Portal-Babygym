import { warsawNow } from './billing.js';

export function nextMonthStart(now=warsawNow()) {
  const year=Number(now.slice(0,4)),month=Number(now.slice(5,7));
  return `${month===12?year+1:year}-${String(month===12?1:month+1).padStart(2,'0')}-01T00:00:00`;
}
export function isCurrentMember(member,now=warsawNow()) {
  return Boolean(member&&['active','trial'].includes(member.status)&&(!member.ends_at||member.ends_at>now));
}
export function membershipDTO(member,now=warsawNow()) {
  return {...member,status:member.status==='suspended'?'suspended':isCurrentMember(member,now)?member.status:'ended'};
}
export function createParticipation(db) {
  function change(body,athlete,cancel=false) {
    const groupId=Number(body.group_id),now=warsawNow();
    if(body.month!==now.slice(0,7))throw Error('Zmienił się miesiąc rozliczeniowy. Odśwież kartotekę i ponów operację.');
    if(!Number.isSafeInteger(groupId)||groupId<1)throw Error('Wybierz grupę.');
    db.exec('SAVEPOINT participation_change');
    try {
      const member=db.prepare('SELECT * FROM memberships WHERE group_id=? AND athlete_id=?').get(groupId,athlete.id);
      if(member?.status==='trial')throw Error('Zapis próbny wygasa zgodnie z terminem potwierdzenia. Przejście na zapis stały jest dostępne w kartotece.');
      if(!isCurrentMember(member,now))throw Error('Udział w tej grupie już się zakończył. Powrót wymaga nowego zapisu przy wolnym miejscu.');
      const period=db.prepare('SELECT * FROM membership_periods WHERE group_id=? AND athlete_id=? ORDER BY id DESC LIMIT 1').get(groupId,athlete.id);
      if(!period)throw Error('Brak okresu uczestnictwa. Skontaktuj się z administratorem.');
      let endsAt,reason;
      if(cancel){endsAt=null;reason='';}
      else {
        if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000)throw Error('Podaj powód rezygnacji (do 1000 znaków).');
        if(db.prepare(`SELECT 1 FROM enrollments e WHERE e.group_id=? AND e.athlete_id=? AND e.month>?
          AND e.amount+COALESCE((SELECT SUM(amount) FROM adjustments WHERE enrollment_id=e.id),0)>0 LIMIT 1`).get(groupId,athlete.id,now.slice(0,7)))throw Error('Istnieją przyszłe naliczenia. Administrator musi je rozliczyć przed rezygnacją.');
        endsAt=member.ends_at||nextMonthStart(now);reason=member.ends_at?member.withdrawal_reason:body.reason.trim();
      }
      db.prepare('UPDATE memberships SET ends_at=?,withdrawal_reason=? WHERE group_id=? AND athlete_id=?').run(endsAt,reason,groupId,athlete.id);
      db.prepare('UPDATE membership_periods SET ends_at=?,withdrawal_reason=? WHERE id=?').run(endsAt,reason,period.id);
      db.exec('RELEASE participation_change');
      return {ok:true,ends_at:endsAt};
    }catch(error){db.exec('ROLLBACK TO participation_change');db.exec('RELEASE participation_change');throw error;}
  }
  function recordStart(groupId,athleteId,status,startsAt) {
    db.prepare('INSERT INTO membership_periods(group_id,athlete_id,status,starts_at) VALUES(?,?,?,?)').run(groupId,athleteId,status,startsAt);
  }
  return {change,recordStart};
}
