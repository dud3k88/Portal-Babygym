import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateSchedule,validDate,isExcluded} from '../schedule.js';
const base={start_date:'2026-09-01',end_date:'2026-10-31',start_time:'13:00',end_time:'13:30',weekday:3};
test('wszystkie środy we wrześniu i październiku, daty i godziny graniczne',()=>{
 const terms=generateSchedule(base);
 assert.equal(terms.length,9);
 assert.equal(terms.filter(s=>s.starts_at.startsWith('2026-09')).length,5);
 assert.equal(terms.filter(s=>s.starts_at.startsWith('2026-10')).length,4);
 assert.equal(terms[0].starts_at,'2026-09-02T13:00:00');
 assert.equal(terms.at(-1).ends_at,'2026-10-28T13:30:00');
 assert.equal(generateSchedule({...base,start_date:'2026-09-02',end_date:'2026-09-02'}).length,1);
});
test('walidacja dat, godzin, dnia tygodnia i pustego zakresu',()=>{
 for(const change of [{start_date:'2026-02-30'},{end_date:'2026-08-31'},{start_time:'25:00'},{end_time:'12:30'},{weekday:7},{end_date:'2030-10-31'},{start_date:'2026-09-03',end_date:'2026-09-03'}]) assert.throws(()=>generateSchedule({...base,...change}));
 assert.equal(validDate('2024-02-29'),true);assert.equal(validDate('2026-02-29'),false);
});
test('lokalny czas nie przesuwa się po zmianie czasu',()=>{
 const terms=generateSchedule({...base,start_date:'2026-10-24',end_date:'2026-11-02',weekday:0});
 assert.deepEqual(terms.map(s=>s.starts_at),['2026-10-25T13:00:00','2026-11-01T13:00:00']);
});
test('globalne, lokalne i grupowe wykluczenia wraz z granicami zakresu',()=>{
 const session={starts_at:'2026-09-02T13:00:00'},group={id:1,location:'A'};
 const range={start_date:'2026-09-02',end_date:'2026-09-02'};
 for(const extra of [{scope:'all'},{scope:'location',location:'A'},{scope:'group',group_id:1}]) assert.equal(isExcluded(session,group,[{...range,...extra}]),true);
 for(const extra of [{scope:'location',location:'B'},{scope:'group',group_id:2},{scope:'all',start_date:'2026-09-03'}]) assert.equal(isExcluded(session,group,[{...range,...extra}]),false);
});
test('wykluczenia lokalizacji są powiązane po ID mimo zmiany nazwy',()=>{
 const session={starts_at:'2026-09-02T13:00:00'};
 const exclusion={scope:'location',location_id:7,location:'Stara nazwa',start_date:'2026-09-02',end_date:'2026-09-02'};
 assert.equal(isExcluded(session,{id:1,location_id:7,location:'Nowa nazwa'},[exclusion]),true);
 assert.equal(isExcluded(session,{id:2,location_id:8,location:'Stara nazwa'},[exclusion]),false);
});
test('historyczny termin zachowuje lokalizację po przeniesieniu grupy',()=>{
 const session={starts_at:'2026-09-02T13:00:00',location_id:7};
 const group={id:1,location_id:8,location:'Nowa lokalizacja'};
 const originalExclusion={scope:'location',location_id:7,start_date:'2026-09-02',end_date:'2026-09-02'};
 assert.equal(isExcluded(session,group,[originalExclusion]),true);
 assert.equal(isExcluded(session,group,[{...originalExclusion,location_id:8}]),false);
});
