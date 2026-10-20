import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,readdirSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateTrainerAccess } from '../migrations.js';
import { configureAudit } from '../audit.js';
function fixture() {
 const folder=mkdtempSync(join(tmpdir(),'ea-migration2-')),path=join(folder,'db.sqlite'),db=new DatabaseSync(path);configureAudit(db);
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
 INSERT INTO schema_migrations VALUES(1,'foundations','2026-10-20');
 CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT NOT NULL DEFAULT '',role TEXT NOT NULL CHECK(role IN ('admin','parent')),password_hash TEXT,created_at TEXT NOT NULL,access_status TEXT NOT NULL DEFAULT 'active' CHECK(access_status IN ('active','blocked')));
 CREATE TABLE trainers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '');
 CREATE TABLE athletes(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES users(id));
 CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires_at INTEGER);
 CREATE TABLE invitations(token_hash TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires_at INTEGER);
 CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,actor_id INTEGER,request_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,before_json TEXT,after_json TEXT,created_at TEXT);
 CREATE INDEX custom_user_name ON users(name);
 CREATE TRIGGER custom_user_audit AFTER UPDATE ON users BEGIN INSERT INTO audit_logs(action,entity_type,entity_id) VALUES('update','users',NEW.id); END;
 INSERT INTO users VALUES(17,'Rodzic','parent@example.org','123456789','parent','unchanged-salted-hash','2026-10-20','active');
 INSERT INTO users VALUES(29,'Administrator','admin@example.org','','admin','admin-hash','2026-10-20','active');
 INSERT INTO athletes VALUES(6,17);INSERT INTO auth_sessions VALUES('hashed-token',17,9999999999999);
 INSERT INTO invitations VALUES('hashed-invitation',17,9999999999999);`);
 return {db,path,folder,close(){db.close();rmSync(folder,{recursive:true,force:true});}};
}
test('migracja trzech ról zachowuje konta, powiązania, indeksy i triggery; snapshot i restart',()=>{
 const f=fixture();try {
  const before=JSON.stringify(f.db.prepare('SELECT * FROM users ORDER BY id').all());
  migrateTrainerAccess(f.db,f.path);migrateTrainerAccess(f.db,f.path);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM users ORDER BY id').all()),before);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  assert.equal(f.db.prepare('SELECT user_id FROM auth_sessions').get().user_id,17);
  assert.equal(f.db.prepare('SELECT user_id FROM invitations').get().user_id,17);
  const files=readdirSync(f.folder).filter(name=>name.includes('before-v2'));assert.equal(files.length,1);
  const snapshot=new DatabaseSync(join(f.folder,files[0]),{readOnly:true});
  assert.equal(JSON.stringify(snapshot.prepare('SELECT * FROM users ORDER BY id').all()),before);
  assert.equal(snapshot.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,1);snapshot.close();
  assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE name='custom_user_name'").get());
  f.db.prepare("UPDATE users SET phone='987654321' WHERE id=17").run();
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n,1);
  f.db.prepare("INSERT INTO users(name,email,role,created_at) VALUES('Trener','trainer@example.org','trainer','2026-10-20')").run();
  assert.throws(()=>f.db.prepare("INSERT INTO users(name,email,role,created_at) VALUES('Other','other@example.org','coordinator','2026-10-20')").run(),/CHECK/);
 }finally{f.close();}
});
test('błąd po przebudowie users wycofuje schemat i dane, przywraca FK',()=>{
 const f=fixture();try {
  f.db.exec("ALTER TABLE trainers ADD COLUMN status TEXT DEFAULT 'active'");
  const schema=f.db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql;
  assert.throws(()=>migrateTrainerAccess(f.db,f.path),/duplicate column/);
  assert.equal(f.db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql,schema);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,2);
  assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,1);
 }finally{f.close();}
});
test('nieznane kolumny kont zatrzymują migrację bez utraty danych',()=>{
 const f=fixture();try {
  f.db.exec('ALTER TABLE users ADD COLUMN unexpected TEXT');
  assert.throws(()=>migrateTrainerAccess(f.db,f.path),/Nietypowy schemat/);
  assert.equal(readdirSync(f.folder).filter(name=>name.includes('before-v2')).length,0);
 }finally{f.close();}
});
