import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { base32,totp } from '../security.js';
import { migrateAccountSecurity } from '../migrations.js';
import { configureAudit } from '../audit.js';

test('TOTP SHA1: oficjalne wektory RFC 6238, kod sześciocyfrowy i Base32',()=>{
  const secret=base32(Buffer.from('12345678901234567890'));
  assert.equal(secret,'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  for(const [time,expected] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']])assert.equal(totp(secret,Math.floor(time/30)),expected);
});
function fixture() {
  const db=new DatabaseSync(':memory:');configureAudit(db);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);
    INSERT INTO schema_migrations VALUES(1,'first',''),(2,'second','');
    CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,role TEXT);
    INSERT INTO users VALUES(1,'admin@example.org','admin'),(2,'first@example.org','parent'),(3,'new@example.org','parent');
    CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires_at INTEGER);
    INSERT INTO auth_sessions VALUES('admin-session',1,9999999999999),('parent-session',2,9999999999999);
    CREATE TABLE athletes(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES users(id));
    INSERT INTO athletes VALUES(4,3);
    CREATE TABLE enrollments(id INTEGER PRIMARY KEY,group_id INTEGER,athlete_id INTEGER REFERENCES athletes(id),month TEXT,trial_id INTEGER,amount INTEGER,email TEXT,parent TEXT);
    INSERT INTO enrollments VALUES(5,1,4,'2026-10',NULL,7000,'first@example.org','Historyczny płatnik');
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,actor_id INTEGER,request_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,before_json TEXT,after_json TEXT,created_at TEXT);`);
  return db;
}
test('migracja 3 zachowuje kartoteki i historycznego płatnika, wymaga ponownego logowania admina',()=>{
  const db=fixture();try{
    migrateAccountSecurity(db);migrateAccountSecurity(db);
    assert.equal(db.prepare('SELECT payer_id FROM enrollments').get().payer_id,2);
    assert.equal(db.prepare('SELECT parent_id FROM athletes').get().parent_id,3);
    assert.equal(db.prepare('SELECT amount FROM enrollments').get().amount,7000);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,1);
    assert.equal(db.prepare('SELECT user_id FROM auth_sessions').get().user_id,2);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    db.prepare('INSERT INTO guardian_invitations VALUES(1,4,?,3,?,?)').run('other@example.org','SECRET-TOKEN',9999999999999);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM audit_logs').all()).includes('SECRET-TOKEN'));
    db.prepare('INSERT INTO athlete_guardians VALUES(4,2,?)').run('2026-10-20');
    assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE entity_type='athlete_guardians'").get());
  }finally{db.close();}
});
test('błąd migracji 3 wycofuje kolumny, nowe tabele i wylogowanie admina',()=>{
  const db=fixture();try{
    db.exec("CREATE TRIGGER reject_migration BEFORE INSERT ON schema_migrations WHEN NEW.version=3 BEGIN SELECT RAISE(ABORT,'test rollback');END;");
    assert.throws(()=>migrateAccountSecurity(db),/test rollback/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,2);
    assert.ok(!db.prepare('PRAGMA table_info(enrollments)').all().some(field=>field.name==='payer_id'));
    assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='admin_mfa'").get());
  }finally{db.close();}
});
