import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {configureAudit} from '../audit.js';
import {migratePasskeys} from '../migrations.js';
test('migracja kluczy jest atomowa i powtarzalna; wylogowanie usuwa wyzwania',()=>{
 const db=new DatabaseSync(':memory:');configureAudit(db);
 try{db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);CREATE TABLE users(id INTEGER PRIMARY KEY);CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER);CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,actor_id INTEGER,request_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,before_json TEXT,after_json TEXT,created_at TEXT);INSERT INTO users VALUES(1);INSERT INTO auth_sessions VALUES('session',1);CREATE TRIGGER fail_migration BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT,'rollback');END;`);
 assert.throws(()=>migratePasskeys(db),/rollback/);assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='passkeys'").get(),undefined);
 db.exec('DROP TRIGGER fail_migration');migratePasskeys(db);migratePasskeys(db);
 db.prepare('INSERT INTO passkeys VALUES(?,?,?,?,?,?,?,?)').run('credential',1,Buffer.from('public-key'),0,'[]','Telefon','2026-10-21',null);
 const audit=db.prepare("SELECT after_json FROM audit_logs WHERE entity_type='passkeys'").get();assert.equal(JSON.parse(audit.after_json).label,'Telefon');assert.equal('public_key' in JSON.parse(audit.after_json),false);
 db.exec("INSERT INTO passkey_challenges VALUES('session',1,'authenticate','challenge','http://localhost','localhost',9999999999999);DELETE FROM auth_sessions WHERE token_hash='session'");
 assert.equal(db.prepare('SELECT COUNT(*) n FROM passkey_challenges').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM passkeys').get().n,1);
 }finally{db.close();}
});
