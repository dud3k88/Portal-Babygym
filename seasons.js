import { validDate } from './schedule.js';
import { warsawNow } from './billing.js';

export function registrationAllowed(group,season,today=warsawNow().slice(0,10)) {
  return group.status==='active'&&Boolean(group.registration_open)&&
    (!group.season_id||(season?.status==='active'&&season.start_date<=today&&season.end_date>=today));
}
export function createSeasonService(db) {
  function get(id) {
    if(!Number.isSafeInteger(id)||id<1)throw Error('Wybierz sezon z listy.');
    const season=db.prepare('SELECT * FROM seasons WHERE id=?').get(id);
    if(!season)throw Error('Nie znaleziono sezonu.');
    return season;
  }
  function save(body) {
    const existing=body.id?get(body.id):null;
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100)throw Error('Podaj nazwę sezonu (do 100 znaków).');
    const name=body.name.normalize('NFKC').trim().replace(/\s+/g,' '),key=name.toLocaleLowerCase('pl');
    if(!validDate(body.start_date)||!validDate(body.end_date)||body.start_date>body.end_date)throw Error('Podaj poprawne daty sezonu.');
    const status=body.status??existing?.status??'active';
    if(!['active','archived'].includes(status))throw Error('Nieprawidłowy status sezonu.');
    db.exec('SAVEPOINT season_change');
    try {
      const duplicate=db.prepare('SELECT id FROM seasons WHERE name_key=?').get(key);
      if(duplicate&&duplicate.id!==existing?.id)throw Error('Sezon o tej nazwie już istnieje.');
      if(existing) {
        const outside=db.prepare(`SELECT g.id FROM groups g WHERE g.season_id=? AND
          ((g.start_date IS NOT NULL AND g.start_date<?) OR (g.end_date IS NOT NULL AND g.end_date>?) OR
           EXISTS(SELECT 1 FROM sessions s WHERE s.group_id=g.id AND (substr(s.starts_at,1,10)<? OR substr(s.starts_at,1,10)>?))) LIMIT 1`)
          .get(existing.id,body.start_date,body.end_date,body.start_date,body.end_date);
        if(outside)throw Error('Daty sezonu muszą obejmować grafik i historyczne terminy jego grup.');
        db.prepare('UPDATE seasons SET name=?,name_key=?,start_date=?,end_date=?,status=? WHERE id=?').run(name,key,body.start_date,body.end_date,status,existing.id);
      }
      const id=existing?.id??Number(db.prepare('INSERT INTO seasons(name,name_key,start_date,end_date,status) VALUES(?,?,?,?,?)').run(name,key,body.start_date,body.end_date,status).lastInsertRowid);
      db.exec('RELEASE season_change');return {id};
    }catch(error){db.exec('ROLLBACK TO season_change');db.exec('RELEASE season_change');throw error;}
  }
  function groupSettings(body,existing,terms) {
    const status=body.status??existing?.status??'active';
    if(!['planned','active','paused','ended'].includes(status))throw Error('Nieprawidłowy status grupy.');
    const open=body.registration_open??existing?.registration_open??1;
    if(![true,false,0,1].includes(open))throw Error('Nieprawidłowe ustawienie zapisów.');
    const seasonId=body.season_id===undefined?(existing?.season_id??null):body.season_id;
    const season=seasonId===null?null:get(seasonId);
    if(existing?.season_id&&existing.season_id!==seasonId)throw Error('Grupa z przypisanym sezonem zachowuje go w historii. Dla kolejnego sezonu utwórz nową grupę.');
    if(season) {
      const days=[...terms.map(term=>term.starts_at.slice(0,10)),body.start_date,body.end_date].filter(Boolean);
      if(existing)days.push(...db.prepare('SELECT substr(starts_at,1,10) AS day FROM sessions WHERE group_id=?').all(existing.id).map(term=>term.day));
      if(days.some(day=>day<season.start_date||day>season.end_date))throw Error('Grafik i wszystkie historyczne terminy grupy muszą mieścić się w sezonie.');
      if(!existing&&season.status!=='active')throw Error('Nie można tworzyć grup w archiwalnym sezonie.');
    }
    return {status,registration_open:Number(open),season_id:seasonId};
  }
  function available(group) {
    return registrationAllowed(group,group.season_id?get(group.season_id):null);
  }
  return {get,save,groupSettings,available};
}
