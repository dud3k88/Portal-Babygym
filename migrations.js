import { openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
// New migrations extend the existing schema. Legacy bootstrap remains in server.js.
export function migrateFoundations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  if (db.prepare('SELECT version FROM schema_migrations WHERE version=1').get()) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const add = (table, name, type) => {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    };
    for (const field of ['address','city','phone','email','contact_name','notes']) add('locations',field,"TEXT NOT NULL DEFAULT ''");
    add('locations','status',"TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived'))");
    add('users','access_status',"TEXT NOT NULL DEFAULT 'active' CHECK(access_status IN ('active','blocked'))");
    db.exec(`CREATE TABLE audit_logs(
      id INTEGER PRIMARY KEY, actor_id INTEGER, request_id TEXT,
      action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX audit_logs_entity ON audit_logs(entity_type,entity_id,id);
    CREATE INDEX memberships_athlete ON memberships(athlete_id);
    CREATE INDEX enrollments_athlete_month ON enrollments(athlete_id,month);
    CREATE INDEX sessions_group_start ON sessions(group_id,starts_at);
    CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'Dziennik zmian jest tylko do dopisywania.'); END;
    CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'Dziennik zmian jest tylko do dopisywania.'); END;`);
    // Explicit field allowlists: no passwords, session tokens or invitation tokens.
    const entities = {
      users: ['id','name','email','phone','role','access_status'],
      locations: ['id','name','address','city','phone','email','contact_name','notes','status'],
      athletes: ['id','parent_id','name','birth_date','notes'],
      groups: ['id','location_id','name','capacity','price','trial_price','trials','start_date','end_date','start_time','end_time','weekday'],
      sessions: ['id','group_id','location_id','starts_at','ends_at','price','cancelled'],
      memberships: ['group_id','athlete_id','status','joined_at','trial_id'],
      enrollments: ['id','group_id','athlete_id','month','trial_id','amount'],
      enrollment_sessions: ['enrollment_id','session_id','price'],
      adjustments: ['id','enrollment_id','amount','reason'],
      exclusions: ['id','start_date','end_date','scope','location_id','group_id','reason'],
      trainers: ['id','name','email','phone'],
      group_trainers: ['group_id','trainer_id']
    };
    for (const [table, fields] of Object.entries(entities)) {
      const snapshot = row => `json_object(${fields.map(f=>`'${f}',${row}.${f}`).join(',')})`;
      const keyFields = fields.includes('id') ? ['id'] : fields.filter(f=>f.endsWith('_id') && f!=='trial_id');
      const key = row => keyFields.map(f=>`CAST(${row}.${f} AS TEXT)`).join(" || ':' || ");
      for (const action of ['INSERT','UPDATE','DELETE']) {
        const row = action==='DELETE'?'OLD':'NEW';
        const when = action==='UPDATE' ? `WHEN ${fields.map(f=>`OLD.${f} IS NOT NEW.${f}`).join(' OR ')}` : '';
        db.exec(`CREATE TRIGGER audit_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} ${when} BEGIN
          INSERT INTO audit_logs(actor_id,request_id,action,entity_type,entity_id,before_json,after_json,created_at)
          VALUES(audit_actor_id(),audit_request_id(),'${action.toLowerCase()}','${table}',${key(row)},${action==='INSERT'?'NULL':snapshot('OLD')},${action==='DELETE'?'NULL':snapshot('NEW')},audit_timestamp());
        END;`);
      }
    }
    db.prepare('INSERT INTO schema_migrations VALUES(1,?,?)').run('Foundations: locations, access status, audit',new Date().toISOString());
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}

function replaceAuditTriggers(db,table,fields,keyFields=['id']) {
  const snapshot=row=>`json_object(${fields.map(field=>`'${field}',${row}.${field}`).join(',')})`;
  for(const action of ['INSERT','UPDATE','DELETE']) {
    const row=action==='DELETE'?'OLD':'NEW';
    const key=keyFields.map(field=>`CAST(${row}.${field} AS TEXT)`).join(" || ':' || ");
    const when=action==='UPDATE'?`WHEN ${fields.map(field=>`OLD.${field} IS NOT NEW.${field}`).join(' OR ')}`:'';
    db.exec(`DROP TRIGGER IF EXISTS audit_${table}_${action.toLowerCase()};
      CREATE TRIGGER audit_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} ${when} BEGIN
       INSERT INTO audit_logs(actor_id,request_id,action,entity_type,entity_id,before_json,after_json,created_at)
       VALUES(audit_actor_id(),audit_request_id(),'${action.toLowerCase()}','${table}',${key},${action==='INSERT'?'NULL':snapshot('OLD')},${action==='DELETE'?'NULL':snapshot('NEW')},audit_timestamp());
      END;`);
  }
}

export function migrateTrainerAccess(db,databasePath) {
  if(db.prepare('SELECT version FROM schema_migrations WHERE version=2').get())return;
  const expected=['id','name','email','phone','role','password_hash','created_at','access_status'];
  const fields=db.prepare('PRAGMA table_info(users)').all().map(field=>field.name);
  if(JSON.stringify(fields.slice().sort())!==JSON.stringify(expected.slice().sort())) throw Error('Nietypowy schemat kont. Migracja 2 wymaga przeglądu przed uruchomieniem.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Napraw powiązania bazy przed migracją 2.');
  const snapshotPath=resolve(databasePath)+'.before-v2-'+randomUUID()+'.sqlite';
  // VACUUM INTO accepts an empty file; create it privately before any data is written.
  closeSync(openSync(snapshotPath,'wx',0o600));
  db.prepare('VACUUM INTO ?').run(snapshotPath);
  const accounts=db.prepare('SELECT * FROM users ORDER BY id').all();
  const objects=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='users' AND type IN ('trigger','index') AND sql IS NOT NULL").all();
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(`CREATE TABLE users_v2(
      id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('admin','trainer','parent')),password_hash TEXT,created_at TEXT NOT NULL,
      access_status TEXT NOT NULL DEFAULT 'active' CHECK(access_status IN ('active','blocked'))
    );
    INSERT INTO users_v2 SELECT id,name,email,phone,role,password_hash,created_at,access_status FROM users;
    DROP TABLE users;
    ALTER TABLE users_v2 RENAME TO users;`);
    for(const object of objects)db.exec(object.sql);
    if(JSON.stringify(accounts)!==JSON.stringify(db.prepare('SELECT * FROM users ORDER BY id').all()))throw Error('Migracja zmieniła dane kont. Wycofano.');
    db.exec(`ALTER TABLE trainers ADD COLUMN user_id INTEGER REFERENCES users(id);
      ALTER TABLE trainers ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','archived'));
      CREATE UNIQUE INDEX trainers_user ON trainers(user_id) WHERE user_id IS NOT NULL;
      CREATE TABLE trainer_notes(trainer_id INTEGER NOT NULL REFERENCES trainers(id),athlete_id INTEGER NOT NULL REFERENCES athletes(id),body TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(trainer_id,athlete_id));`);
    replaceAuditTriggers(db,'trainers',['id','name','email','phone','user_id','status']);
    replaceAuditTriggers(db,'trainer_notes',['trainer_id','athlete_id','body','updated_at'],['trainer_id','athlete_id']);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migracja narusza powiązania. Wycofano.');
    db.prepare('INSERT INTO schema_migrations VALUES(2,?,?)').run('Trainer role, accounts and private notes',new Date().toISOString());
    db.exec('COMMIT');
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  finally{db.exec('PRAGMA foreign_keys=ON');}
}
