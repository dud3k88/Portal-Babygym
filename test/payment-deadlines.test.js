import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentTiming} from '../payment-deadlines.js';
import {groupRules} from '../registration-rules.js';
test('termin dzisiaj nie jest zaległością; liczymy dni kalendarzowe niezależnie od DST',()=>{
 assert.equal(paymentTiming({due_on:'2026-10-25',balance:3500},'2026-10-25').overdue_amount,0);
 assert.equal(paymentTiming({due_on:'2026-10-25',balance:3500},'2026-10-26').overdue_days,1);
 assert.equal(paymentTiming({due_on:'2026-03-28',balance:3500},'2026-03-30').overdue_days,2);
 assert.equal(paymentTiming({due_on:'2026-12-31',balance:1500},'2027-01-01').overdue_amount,1500);
});
test('brak historycznego terminu, opłacenie i nadpłata nie tworzą zaległości',()=>{
 assert.equal(paymentTiming({due_on:null,balance:3500},'2026-10-20').payment_status,'unknown');
 for(const balance of [0,-500]){const result=paymentTiming({due_on:'2026-09-10',balance},'2026-10-20');assert.equal(result.overdue_amount,0);assert.equal(result.overdue_days,0);}
});
test('wszystkie dodatkowe pytania pozostają opcjonalne również przy żądaniu API',()=>{
 const rules=groupRules({questions:[{label:'Grupa przedszkolna',required:true}]});
 assert.equal(JSON.parse(rules.questions)[0].required,false);
});

import {DatabaseSync} from 'node:sqlite';
import {configureAudit} from '../audit.js';
import {migratePaymentDeadlines} from '../migrations.js';
test('migracja terminów: rollback, stare opłaty bez daty, trwałe nowe terminy i restart',()=>{
 const db=new DatabaseSync(':memory:');
 configureAudit(db);let now='2026-10-05T12:00:00';db.function('academy_now',()=>now);
 db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);
 CREATE TABLE users(id INTEGER PRIMARY KEY);
 CREATE TABLE groups(id INTEGER PRIMARY KEY,questions TEXT);
 CREATE TABLE enrollments(id INTEGER PRIMARY KEY,month TEXT,created_at TEXT,amount INTEGER);
 CREATE TABLE finance_settings(id INTEGER PRIMARY KEY,due_day INTEGER);
 CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,actor_id INTEGER,request_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,before_json TEXT,after_json TEXT,created_at TEXT);
 INSERT INTO finance_settings VALUES(1,10);
 INSERT INTO groups VALUES(1,'[{"label":"Pytanie","required":true}]');
 INSERT INTO enrollments VALUES(1,'2026-09','2026-09-01T12:00:00',3500);
 CREATE TRIGGER fail_migration BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT,'rollback'); END;`);
 try{
 assert.throws(()=>migratePaymentDeadlines(db),/rollback/);
 assert.equal(db.prepare('PRAGMA table_info(enrollments)').all().some(c=>c.name==='due_on'),false);
 assert.equal(JSON.parse(db.prepare('SELECT questions FROM groups').get().questions)[0].required,true);
 db.exec('DROP TRIGGER fail_migration');migratePaymentDeadlines(db);migratePaymentDeadlines(db);
 assert.equal(db.prepare('SELECT due_on FROM enrollments WHERE id=1').get().due_on,null);
 assert.equal(JSON.parse(db.prepare('SELECT questions FROM groups').get().questions)[0].required,false);
 db.exec("INSERT INTO enrollments(id,month,created_at,amount) VALUES(2,'2026-10','2026-10-05T12:00:00',3500)");
 assert.equal(db.prepare('SELECT due_on FROM enrollments WHERE id=2').get().due_on,'2026-10-10');
 db.exec('UPDATE finance_settings SET due_day=15');now='2026-10-20T12:00:00';
 db.exec("INSERT INTO enrollments(id,month,created_at,amount) VALUES(3,'2026-10','2026-10-01T12:00:00',3500)");
 assert.equal(db.prepare('SELECT due_on FROM enrollments WHERE id=3').get().due_on,'2026-10-20');
 assert.equal(db.prepare('SELECT due_on FROM enrollments WHERE id=2').get().due_on,'2026-10-10');
 }finally{db.close();}
});
