export function validDate(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
 const date=new Date(value+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function generateSchedule({start_date,end_date,start_time,end_time,weekday}) {
 if(!validDate(start_date)||!validDate(end_date)||end_date<start_date) throw Error('Podaj poprawny zakres dat.');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end_time)||end_time<=start_time) throw Error('Godzina zakończenia musi być późniejsza niż rozpoczęcia.');
 if(!Number.isInteger(weekday)||weekday<0||weekday>6) throw Error('Wybierz dzień tygodnia.');
 const start=new Date(start_date+'T00:00:00Z'),end=new Date(end_date+'T00:00:00Z');
 if((end-start)/86400000>3*366) throw Error('Grafik może obejmować maksymalnie trzy lata.');
 const sessions=[];
 for(let day=start;day<=end;day.setUTCDate(day.getUTCDate()+1)) if(day.getUTCDay()===weekday) {
  const date=day.toISOString().slice(0,10);sessions.push({starts_at:date+'T'+start_time+':00',ends_at:date+'T'+end_time+':00'});
 }
 if(!sessions.length) throw Error('Wybrany dzień tygodnia nie występuje w tym zakresie.');
 return sessions;
}
export function isExcluded(session,group,exclusions) {
 const date=session.starts_at.slice(0,10);
 return exclusions.some(e=>date>=e.start_date&&date<=e.end_date&&(e.scope==='all'||e.scope==='location'&&e.location===group.location||e.scope==='group'&&e.group_id===group.id));
}
