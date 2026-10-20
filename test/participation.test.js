import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { nextMonthStart,isCurrentMember,membershipDTO } from '../participation.js';
import { registrationAllowed } from '../seasons.js';
import { migrateSeasons,migrateParticipation } from '../migrations.js';
import { configureAudit } from '../audit.js';

test('koniec miesiąca: luty, rok przestępny, grudzień i ścisła granica końca udziału',()=>{
  for(const [now,end] of [['2028-02-29T23:59:59','2028-03-01T00:00:00'],['2027-02-28T12:00:00','2027-03-01T00:00:00'],['2026-12-31T23:59:59','2027-01-01T00:00:00'],['2026-10-25T02:30:00','2026-11-01T00:00:00']])assert.equal(nextMonthStart(now),end);
  const member={status:'active',ends_at:'2026-10-01T00:00:00'};
  assert.equal(isCurrentMember(member,'2026-09-30T23:59:59'),true);
  assert.equal(isCurrentMember(member,'2026-10-01T00:00:00'),false);
  assert.equal(membershipDTO(member,'2026-10-01T00:00:00').status,'ended');
});
test('zapisy wymagają aktywnej grupy, otwartych zapisów i trwającego sezonu',()=>{
  const group={status:'active',registration_open:1,season_id:5},season={status:'active',start_date:'2026-09-01',end_date:'2027-06-30'};
  assert.equal(registrationAllowed(group,season,'2026-09-01'),true);
  assert.equal(registrationAllowed(group,season,'2027-06-30'),true);
  for(const day of ['2026-08-31','2027-07-01'])assert.equal(registrationAllowed(group,season,day),false);
  for(const status of ['planned','paused','ended'])assert.equal(registrationAllowed({...group,status},season,'2026-10-01'),false);
  assert.equal(registrationAllowed({...group,registration_open:0},season,'2026-10-01'),false);
  assert.equal(registrationAllowed(group,{...season,status:'archived'},'2026-10-01'),false);
  assert.equal(registrationAllowed({...group,season_id:null},null,'2026-10-01'),true);
});
function fixture() {
  const db=new DatabaseSync(':memory:');configureAudit(db);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);
    INSERT INTO schema_migrations VALUES(1,'one',''),(2,'two',''),(3,'three','');
    CREATE TABLE groups(id INTEGER PRIMARY KEY,location_id INTEGER,name TEXT,capacity INTEGER,price INTEGER,trial_price INTEGER,trials INTEGER,start_date TEXT,end_date TEXT,start_time TEXT,end_time TEXT,weekday INTEGER);
    INSERT INTO groups VALUES(1,1,'Liski',10,3500,0,1,'2026-09-01','2027-06-30','13:00','13:30',2);
    CREATE TABLE athletes(id INTEGER PRIMARY KEY);
    INSERT INTO athletes VALUES(2);
    CREATE TABLE memberships(group_id INTEGER REFERENCES groups(id),athlete_id INTEGER REFERENCES athletes(id),status TEXT,joined_at TEXT,trial_id INTEGER,PRIMARY KEY(group_id,athlete_id));
    INSERT INTO memberships VALUES(1,2,'active','2026-09-15T12:00:00',NULL);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,actor_id INTEGER,request_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,before_json TEXT,after_json TEXT,created_at TEXT);`);
  return db;
}
test('migracje sezonów i okresów zachowują grupy oraz zapis, nie zgadują sezonu; restart jest idempotentny',()=>{
  const db=fixture();try{
    migrateSeasons(db);migrateParticipation(db);migrateSeasons(db);migrateParticipation(db);
    const group=db.prepare('SELECT * FROM groups').get(),member=db.prepare('SELECT * FROM memberships').get();
    assert.equal(group.price,3500);assert.equal(group.season_id,null);assert.equal(group.registration_open,1);assert.equal(group.status,'active');
    assert.equal(member.joined_at,'2026-09-15T12:00:00');assert.equal(member.ends_at,null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM membership_periods').get().n,1);
    assert.equal(db.prepare('SELECT starts_at FROM membership_periods').get().starts_at,member.joined_at);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});
test('nieudana migracja uczestnictwa wycofuje nowe kolumny i okresy',()=>{
  const db=fixture();try{
    migrateSeasons(db);
    db.exec("CREATE TRIGGER test_fail BEFORE INSERT ON schema_migrations WHEN NEW.version=5 BEGIN SELECT RAISE(ABORT,'rollback'); END;");
    assert.throws(()=>migrateParticipation(db),/rollback/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memberships').get().n,1);
    assert.ok(!db.prepare('PRAGMA table_info(memberships)').all().some(column=>column.name==='ends_at'));
    assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='membership_periods'").get());
  }finally{db.close();}
});
