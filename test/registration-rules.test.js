import test from 'node:test';
import assert from 'node:assert/strict';
import {ageAt,checkAge,groupRules} from '../registration-rules.js';
test('wiek w ukończonych latach, dzień urodzin i granice grupy',()=>{
 assert.equal(ageAt('2023-10-20','2026-10-20'),3);
 assert.equal(ageAt('2023-10-21','2026-10-20'),2);
 assert.doesNotThrow(()=>checkAge({min_age:3,max_age:5},'2021-10-20','2026-10-20'));
 assert.throws(()=>checkAge({min_age:3,max_age:5},null,'2026-10-20'),/urodzenia/);
 assert.throws(()=>checkAge({min_age:3,max_age:5},'2020-10-20','2026-10-20'),/zakresie/);
 assert.equal(ageAt('2020-02-29','2025-02-28'),4);
 assert.equal(ageAt('2020-02-29','2025-03-01'),5);
});
test('stare grupy zachowują brak ograniczeń; metadane wymagają poprawnych zakresów i pytań',()=>{
 assert.deepEqual(groupRules({}),{activity_type:'',parent_description:'',min_age:null,max_age:null,questions:'[]'});
 assert.throws(()=>groupRules({min_age:6,max_age:3}),/Wiek od/);
 assert.throws(()=>groupRules({questions:[{label:'Pytanie',required:true},{label:' Pytanie ',required:false}]}),/Pytania/);
 assert.throws(()=>groupRules({min_age:'3'}),/liczbą/);
});
