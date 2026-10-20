import {validDate} from './schedule.js';
import {warsawNow} from './billing.js';
export function ageAt(birth,today){if(!validDate(birth)||birth>today)throw Error('Podaj poprawną datę urodzenia dziecka.');return Number(today.slice(0,4))-Number(birth.slice(0,4))-(today.slice(5)<birth.slice(5)?1:0);}
export function checkAge(group,birth,today=warsawNow().slice(0,10)){
 if(group.min_age===null&&group.max_age===null)return;
 const age=ageAt(birth,today);
 if((group.min_age!==null&&age<group.min_age)||(group.max_age!==null&&age>group.max_age))throw Error('Wiek dziecka nie mieści się w zakresie tej grupy. Wiek liczymy w ukończonych latach w dniu zapisu.');
}
export function groupRules(body,old={}){
 const value=key=>body[key]===undefined?old[key]:body[key];
 const age=key=>{const v=value(key)??null;if(v===null)return null;if(!Number.isInteger(v)||v<0||v>18)throw Error('Wiek grupy musi być liczbą od 0 do 18 lat.');return v;};
 const min=age('min_age'),max=age('max_age');if(min!==null&&max!==null&&min>max)throw Error('Wiek od nie może przekraczać wieku do.');
 const strings={};for(const [key,limit] of [['activity_type',100],['parent_description',2000]]){const v=value(key)??'';if(typeof v!=='string'||v.length>limit)throw Error('Za długi lub nieprawidłowy opis zajęć.');strings[key]=v.trim();}
 const questions=body.questions===undefined?JSON.parse(old.questions||'[]'):body.questions;
 if(!Array.isArray(questions)||questions.length>10)throw Error('Możesz dodać maksymalnie 10 pytań.');
 const seen=new Set();for(const q of questions){if(!q||typeof q.label!=='string'||!q.label.trim()||q.label.length>150||typeof q.required!=='boolean'||seen.has(q.label.trim()))throw Error('Pytania muszą mieć różne, niepuste nazwy do 150 znaków.');seen.add(q.label.trim());}
 return {...strings,min_age:min,max_age:max,questions:JSON.stringify(questions.map(q=>({label:q.label.trim(),required:false})))};
}
export function saveRegistrationAnswers(db,group,athlete,provided){
 const questions=JSON.parse(group.questions),previous=db.prepare('SELECT values_json FROM registration_answers WHERE group_id=? AND athlete_id=?').get(group.id,athlete.id);
 if(provided===undefined&&previous)return;
 const source=provided===undefined?JSON.parse(previous?.values_json||'{}'):provided;
 if(!source||typeof source!=='object'||Array.isArray(source))throw Error('Nieprawidłowe odpowiedzi formularza.');
 const result={};for(const q of questions){const value=Object.hasOwn(source,q.label)?source[q.label]:'';if(typeof value!=='string'||value.length>500)throw Error('Odpowiedź może mieć do 500 znaków: '+q.label);Object.defineProperty(result,q.label,{value:value.trim(),enumerable:true});}
 if(questions.length)db.prepare('INSERT INTO registration_answers(group_id,athlete_id,definition_json,values_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(group_id,athlete_id) DO UPDATE SET definition_json=excluded.definition_json,values_json=excluded.values_json,updated_at=excluded.updated_at').run(group.id,athlete.id,group.questions,JSON.stringify(result),warsawNow());
}
