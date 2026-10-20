import {test} from 'node:test';
import assert from 'node:assert/strict';
import {warsawAt,warsawEpoch} from '../admissions.js';
test('terminy ofert liczone w godzinach rzeczywistych, również przy zmianie czasu',()=>{
 const before=warsawEpoch('2026-03-28T13:00:00');
 assert.equal(warsawAt(before+24*3600000),'2026-03-29T14:00:00');
 assert.equal(warsawAt(warsawEpoch('2026-10-24T13:00:00')+24*3600000),'2026-10-25T12:00:00');
 assert.equal(warsawAt(warsawEpoch('2026-12-31T13:30:00')+24*3600000),'2027-01-01T13:30:00');
 assert.throws(()=>warsawEpoch('2026-03-29T02:30:00'),/nieistniejącą/);
 assert.equal(warsawEpoch('2026-10-25T02:30:00'),Date.parse('2026-10-25T01:30:00Z'));
});
import {DatabaseSync} from 'node:sqlite';
import {configureAudit} from '../audit.js';
import {migrateAdmissions} from '../migrations.js';
test('migracja kolejki jest addytywna i idempotentna; błąd cofa tabele i ustawienia',()=>{
 const db=new DatabaseSync(':memory:');configureAudit(db);
 try {
  db.exec(`PRAGMA foreign_keys=ON;
   CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);
   CREATE TABLE users(id INTEGER PRIMARY KEY);
   CREATE TABLE groups(id INTEGER PRIMARY KEY);
   CREATE TABLE athletes(id INTEGER PRIMARY KEY);
   CREATE TABLE enrollments(id INTEGER PRIMARY KEY,amount INTEGER);
   INSERT INTO enrollments VALUES(1,3500);
   CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,actor_id INTEGER,request_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,before_json TEXT,after_json TEXT,created_at TEXT);
   CREATE TRIGGER fail_migration BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT,'rollback'); END;`);
  assert.throws(()=>migrateAdmissions(db),/rollback/);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='waiting_list'").get(),undefined);
  assert.equal(db.prepare('SELECT amount FROM enrollments').get().amount,3500);
  db.exec('DROP TRIGGER fail_migration');migrateAdmissions(db);migrateAdmissions(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admission_settings').get().n,1);
  assert.equal(db.prepare('SELECT amount FROM enrollments').get().amount,3500);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
