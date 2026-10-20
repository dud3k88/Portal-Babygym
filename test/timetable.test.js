import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutLessons} from '../public/timetable.js';
const lesson=(id,start,end)=>({id,starts_at:'2026-10-20T'+start,ends_at:end?'2026-10-20T'+end:null});
test('nakładające się zajęcia mają osobne kolumny; stykające się terminy nie kolidują',()=>{
 const result=layoutLessons([lesson(1,'09:00','10:00'),lesson(2,'09:30','10:30'),lesson(3,'10:00','11:00'),lesson(4,'11:00','12:00')]);
 assert.deepEqual(result.map(e=>[e.lane,e.lanes]),[[0,2],[1,2],[0,2],[0,1]]);
 for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++){const a=result[i],b=result[j];if(a.start<b.end&&b.start<a.end)assert.notEqual(a.lane,b.lane);}
});
test('czas bez końca nie znika; zakres obejmuje granicę północy',()=>{
 assert.equal(layoutLessons([lesson(1,'13:00',null)])[0].end,810);
 assert.equal(layoutLessons([{id:1,starts_at:'2026-10-20T23:30',ends_at:'2026-10-21T00:30'}])[0].end,1440);
});
