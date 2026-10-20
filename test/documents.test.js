import test from 'node:test';
import assert from 'node:assert/strict';
import {csv,parseCSV,workbook,parseWorkbook,pdf} from '../documents.js';
test('CSV zachowuje polskie znaki, średniki i nowe linie; neutralizuje formuły',()=>{
 const bytes=csv([{key:'name',label:'Nazwa'},{key:'value',label:'Wartość'}],[{name:'Żółw; "test"\nDruga linia',value:'=1+1'}]);
 assert.deepEqual(parseCSV(bytes),[['Nazwa','Wartość'],['Żółw; "test"\nDruga linia',"'=1+1"]]);
 assert.throws(()=>parseCSV(Buffer.from('"niedomknięte')),/cudzysłów/);
});
test('XLSX jest odczytywalnym arkuszem z oryginalnymi wartościami',async()=>{
 const bytes=await workbook('Zawodnicy',[{key:'name',label:'Imię'},{key:'value',label:'Kwota'}],[{name:'Łucja',value:12345}]);
 assert.deepEqual(await parseWorkbook(bytes,'xlsx'),[['Imię','Kwota'],['Łucja','12345']]);
 await assert.rejects(parseWorkbook(Buffer.alloc(5*1024*1024+1),'xlsx'),/5 MB/);
});
test('PDF karty obejmuje kolejną stronę po 35 obecnościach',async()=>{
 const output=await pdf('Żółw — Łucja',[],{stamps:Array.from({length:36},()=>({starts_at:'2099-09-01T13:00:00'}))});
 assert.equal(output.subarray(0,5).toString(),'%PDF-');
 assert.match(output.toString('latin1'),/\/Count 2\b/);
});
