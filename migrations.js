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

export function migrateAccountSecurity(db) {
  if(db.prepare('SELECT version FROM schema_migrations WHERE version=3').get())return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE admin_mfa(user_id INTEGER PRIMARY KEY REFERENCES users(id),secret TEXT NOT NULL,last_step INTEGER NOT NULL);
      CREATE TABLE mfa_recovery(user_id INTEGER NOT NULL REFERENCES users(id),code_hash TEXT PRIMARY KEY);
      CREATE TABLE mfa_pending(token_hash TEXT PRIMARY KEY REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,secret TEXT NOT NULL);
      CREATE TABLE mfa_verified(token_hash TEXT PRIMARY KEY REFERENCES auth_sessions(token_hash) ON DELETE CASCADE);
      CREATE TABLE mfa_attempts(user_id INTEGER PRIMARY KEY REFERENCES users(id),count INTEGER NOT NULL,until_at INTEGER NOT NULL);
      CREATE TABLE password_resets(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),email TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE INDEX password_resets_user ON password_resets(user_id);
      CREATE TABLE athlete_guardians(athlete_id INTEGER NOT NULL REFERENCES athletes(id),user_id INTEGER NOT NULL REFERENCES users(id),verified_at TEXT NOT NULL,PRIMARY KEY(athlete_id,user_id));
      CREATE TABLE guardian_invitations(id INTEGER PRIMARY KEY,athlete_id INTEGER NOT NULL REFERENCES athletes(id),email TEXT NOT NULL,invited_by INTEGER NOT NULL REFERENCES users(id),token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX guardian_invitation_recipient ON guardian_invitations(athlete_id,email);
      ALTER TABLE enrollments ADD COLUMN payer_id INTEGER REFERENCES users(id);
      UPDATE enrollments SET payer_id=(SELECT id FROM users WHERE lower(email)=lower(enrollments.email) AND role='parent')
        WHERE (SELECT COUNT(*) FROM users WHERE lower(email)=lower(enrollments.email) AND role='parent')=1;
      DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE role='admin');
    `);
    // Legacy parent_id is preserved as the primary relationship; only additionally
    // verified guardians live in the new table. Historical payer snapshots stay intact.
    replaceAuditTriggers(db,'athlete_guardians',['athlete_id','user_id','verified_at'],['athlete_id','user_id']);
    replaceAuditTriggers(db,'guardian_invitations',['id','athlete_id','email','invited_by','expires_at']);
    replaceAuditTriggers(db,'enrollments',['id','group_id','athlete_id','payer_id','month','trial_id','amount']);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migracja 3 narusza powiązania.');
    db.prepare('INSERT INTO schema_migrations VALUES(3,?,?)').run('Admin MFA, password recovery and verified guardians',new Date().toISOString());
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function migrateSeasons(db) {
  if(db.prepare('SELECT version FROM schema_migrations WHERE version=4').get())return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE seasons(
      id INTEGER PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,
      start_date TEXT NOT NULL,end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
      CHECK(start_date<=end_date));
      ALTER TABLE groups ADD COLUMN season_id INTEGER REFERENCES seasons(id);
      ALTER TABLE groups ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('planned','active','paused','ended'));
      ALTER TABLE groups ADD COLUMN registration_open INTEGER NOT NULL DEFAULT 1 CHECK(registration_open IN (0,1));
      CREATE INDEX groups_season ON groups(season_id);`);
    replaceAuditTriggers(db,'seasons',['id','name','start_date','end_date','status']);
    replaceAuditTriggers(db,'groups',['id','location_id','name','capacity','price','trial_price','trials','start_date','end_date','start_time','end_time','weekday','season_id','status','registration_open']);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migracja sezonów narusza powiązania.');
    db.prepare('INSERT INTO schema_migrations VALUES(4,?,?)').run('Seasons, group lifecycle and registration controls',new Date().toISOString());
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function migrateParticipation(db) {
  if(db.prepare('SELECT version FROM schema_migrations WHERE version=5').get())return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`ALTER TABLE memberships ADD COLUMN ends_at TEXT;
      ALTER TABLE memberships ADD COLUMN withdrawal_reason TEXT NOT NULL DEFAULT '';
      CREATE TABLE membership_periods(
        id INTEGER PRIMARY KEY,group_id INTEGER NOT NULL,athlete_id INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','trial')),
        starts_at TEXT NOT NULL,ends_at TEXT,withdrawal_reason TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(group_id,athlete_id) REFERENCES memberships(group_id,athlete_id),
        CHECK(ends_at IS NULL OR ends_at>starts_at));
      INSERT INTO membership_periods(group_id,athlete_id,status,starts_at)
        SELECT group_id,athlete_id,status,joined_at FROM memberships;
      CREATE INDEX periods_member ON membership_periods(group_id,athlete_id,starts_at);
      CREATE UNIQUE INDEX periods_open ON membership_periods(group_id,athlete_id) WHERE ends_at IS NULL;`);
    replaceAuditTriggers(db,'memberships',['group_id','athlete_id','status','joined_at','trial_id','ends_at','withdrawal_reason'],['group_id','athlete_id']);
    replaceAuditTriggers(db,'membership_periods',['id','group_id','athlete_id','status','starts_at','ends_at','withdrawal_reason']);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migracja uczestnictwa narusza powiązania.');
    db.prepare('INSERT INTO schema_migrations VALUES(5,?,?)').run('Participation periods and month-end withdrawals',new Date().toISOString());
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function migrateAdmissions(db) {
 if(db.prepare('SELECT version FROM schema_migrations WHERE version=6').get())return;
 db.exec('BEGIN IMMEDIATE');
 try {
  db.exec(`CREATE TABLE admission_settings(id INTEGER PRIMARY KEY CHECK(id=1),trial_hours INTEGER NOT NULL CHECK(trial_hours BETWEEN 1 AND 168),offer_hours INTEGER NOT NULL CHECK(offer_hours BETWEEN 1 AND 168));
   INSERT INTO admission_settings VALUES(1,24,24);
   CREATE TABLE trial_decisions(
   enrollment_id INTEGER PRIMARY KEY REFERENCES enrollments(id),
   ends_at TEXT NOT NULL,expires_at INTEGER NOT NULL,
   status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','converted','expired')),
   regular_enrollment_id INTEGER UNIQUE REFERENCES enrollments(id));
   CREATE TABLE waiting_list(
    id INTEGER PRIMARY KEY,group_id INTEGER NOT NULL REFERENCES groups(id),
    athlete_id INTEGER NOT NULL REFERENCES athletes(id),payer_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','offered','accepted','cancelled','expired')),
    created_at TEXT NOT NULL,expires_at INTEGER,accepted_enrollment_id INTEGER REFERENCES enrollments(id));
   CREATE UNIQUE INDEX waiting_one_open ON waiting_list(group_id,athlete_id) WHERE status IN ('waiting','offered');
   CREATE INDEX waiting_fifo ON waiting_list(group_id,status,id);`);
  replaceAuditTriggers(db,'admission_settings',['id','trial_hours','offer_hours']);
  replaceAuditTriggers(db,'trial_decisions',['enrollment_id','ends_at','expires_at','status','regular_enrollment_id'],['enrollment_id']);
  replaceAuditTriggers(db,'waiting_list',['id','group_id','athlete_id','payer_id','status','created_at','expires_at','accepted_enrollment_id']);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migracja zapisów narusza powiązania.');
  db.prepare('INSERT INTO schema_migrations VALUES(6,?,?)').run('Trial continuation and FIFO waiting list',new Date().toISOString());
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}

export function migrateOperations(db) {
 if(db.prepare('SELECT version FROM schema_migrations WHERE version=7').get())return;
 db.exec('BEGIN IMMEDIATE');try {
  db.exec(`CREATE TABLE lesson_assignment_snapshots(session_id INTEGER PRIMARY KEY REFERENCES sessions(id));
   CREATE TABLE lesson_trainers(session_id INTEGER REFERENCES sessions(id),trainer_id INTEGER REFERENCES trainers(id),PRIMARY KEY(session_id,trainer_id));
   CREATE TABLE attendance(session_id INTEGER REFERENCES sessions(id),athlete_id INTEGER REFERENCES athletes(id),status TEXT NOT NULL CHECK(status IN ('present','absent','unmarked')),actor_id INTEGER REFERENCES users(id),reason TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(session_id,athlete_id));
   CREATE TABLE absence_reports(session_id INTEGER REFERENCES sessions(id),athlete_id INTEGER REFERENCES athletes(id),active INTEGER NOT NULL CHECK(active IN (0,1)),actor_id INTEGER REFERENCES users(id),updated_at TEXT NOT NULL,PRIMARY KEY(session_id,athlete_id));
   CREATE TABLE lesson_completion(session_id INTEGER PRIMARY KEY REFERENCES sessions(id),completed INTEGER NOT NULL CHECK(completed IN (0,1)),actor_id INTEGER REFERENCES users(id),reason TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
   CREATE TABLE lesson_changes(id INTEGER PRIMARY KEY,session_id INTEGER REFERENCES sessions(id),reason TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);`);
  for(const [table,columns,keys] of [
   ['lesson_trainers',['session_id','trainer_id'],['session_id','trainer_id']],
   ['attendance',['session_id','athlete_id','status','actor_id','reason','updated_at'],['session_id','athlete_id']],
   ['absence_reports',['session_id','athlete_id','active','actor_id','updated_at'],['session_id','athlete_id']],
   ['lesson_completion',['session_id','completed','actor_id','reason','updated_at'],['session_id']],
   ['lesson_changes',['id','session_id','reason','actor_id','created_at'],['id']]
  ])replaceAuditTriggers(db,table,columns,keys);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migracja narusza powiązania danych.');
 db.prepare('INSERT INTO schema_migrations VALUES(7,?,?)').run('Calendar, lesson assignments and attendance',new Date().toISOString());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function migrateFinance(db){
 if(db.prepare('SELECT version FROM schema_migrations WHERE version=8').get())return;
 db.exec('BEGIN IMMEDIATE');try{
 db.exec(`CREATE TABLE payments(id INTEGER PRIMARY KEY,athlete_id INTEGER NOT NULL REFERENCES athletes(id),payer_id INTEGER NOT NULL REFERENCES users(id),amount INTEGER NOT NULL CHECK(amount>0),reference TEXT NOT NULL UNIQUE,paid_on TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE payment_allocations(id INTEGER PRIMARY KEY,payment_id INTEGER NOT NULL REFERENCES payments(id),enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),amount INTEGER NOT NULL CHECK(amount<>0),reason TEXT NOT NULL DEFAULT '',actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE refunds(id INTEGER PRIMARY KEY,payment_id INTEGER NOT NULL REFERENCES payments(id),amount INTEGER NOT NULL CHECK(amount>0),reason TEXT NOT NULL,reference TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('approved','paid')),paid_on TEXT,actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE price_versions(id INTEGER PRIMARY KEY,group_id INTEGER REFERENCES groups(id),starts_on TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>=0),vat_bps INTEGER CHECK(vat_bps BETWEEN 0 AND 10000),UNIQUE(group_id,starts_on));
 CREATE TABLE discounts(id INTEGER PRIMARY KEY,athlete_id INTEGER REFERENCES athletes(id),starts_on TEXT NOT NULL,ends_on TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')),value INTEGER NOT NULL CHECK(value>=0),reason TEXT NOT NULL);
 CREATE TABLE automatic_billing_months(month TEXT PRIMARY KEY,created_at TEXT NOT NULL);
 CREATE TABLE finance_settings(id INTEGER PRIMARY KEY CHECK(id=1),auto_monthly INTEGER NOT NULL DEFAULT 0,since_month TEXT,due_day INTEGER NOT NULL DEFAULT 10,bank_account TEXT NOT NULL DEFAULT '');
 INSERT INTO finance_settings(id) VALUES(1);
 CREATE TABLE annual_fee_rules(season_id INTEGER PRIMARY KEY REFERENCES seasons(id),amount INTEGER NOT NULL CHECK(amount>=0));
 CREATE TABLE annual_fees(athlete_id INTEGER REFERENCES athletes(id),season_id INTEGER REFERENCES seasons(id),enrollment_id INTEGER REFERENCES enrollments(id),amount INTEGER NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(athlete_id,season_id));
 CREATE TABLE billing_runs(enrollment_id INTEGER PRIMARY KEY REFERENCES enrollments(id),actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE INDEX allocations_charge ON payment_allocations(enrollment_id);
 CREATE INDEX allocations_payment ON payment_allocations(payment_id);`);
 for(const table of ['payments','payment_allocations','refunds','price_versions','discounts','billing_runs','finance_settings','automatic_billing_months','annual_fee_rules','annual_fees']){const cols=db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name);replaceAuditTriggers(db,table,cols,table==='billing_runs'?['enrollment_id']:table==='automatic_billing_months'?['month']:table==='annual_fee_rules'?['season_id']:table==='annual_fees'?['athlete_id','season_id']:['id']);}
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migracja narusza powiązania danych.');
 db.prepare('INSERT INTO schema_migrations VALUES(8,?,?)').run('Payments, allocations, refunds and dated prices',new Date().toISOString());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function migrateWorkspace(db){
 if(db.prepare('SELECT version FROM schema_migrations WHERE version=9').get())return;
 db.exec('BEGIN IMMEDIATE');try{
 db.exec(`CREATE TABLE conversations(id INTEGER PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),subject TEXT NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','progress','waiting','closed')),created_at TEXT NOT NULL);
 CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY,conversation_id INTEGER REFERENCES conversations(id),sender_id INTEGER REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE notifications(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),event_key TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT,UNIQUE(user_id,event_key));
 CREATE TABLE policy_documents(id INTEGER PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('terms','privacy','som','photos','marketing')),version TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,published INTEGER NOT NULL CHECK(published IN (0,1)),created_at TEXT NOT NULL,UNIQUE(kind,version));
 CREATE TABLE policy_acceptances(id INTEGER PRIMARY KEY,document_id INTEGER REFERENCES policy_documents(id),athlete_id INTEGER REFERENCES athletes(id),user_id INTEGER REFERENCES users(id),accepted INTEGER NOT NULL CHECK(accepted IN (0,1)),method TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE equipment(id INTEGER PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL DEFAULT '');
 CREATE TABLE equipment_stock(equipment_id INTEGER REFERENCES equipment(id),location_id INTEGER REFERENCES locations(id),status TEXT NOT NULL CHECK(status IN ('good','damaged','replace','retired')),quantity INTEGER NOT NULL CHECK(quantity>=0),PRIMARY KEY(equipment_id,location_id,status));
 CREATE TABLE equipment_movements(id INTEGER PRIMARY KEY,equipment_id INTEGER REFERENCES equipment(id),from_location INTEGER REFERENCES locations(id),to_location INTEGER REFERENCES locations(id),status TEXT NOT NULL,quantity INTEGER NOT NULL,reason TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE equipment_issues(id INTEGER PRIMARY KEY,equipment_id INTEGER REFERENCES equipment(id),location_id INTEGER REFERENCES locations(id),body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);`);
 for(const table of ['conversations','conversation_messages','notifications','policy_documents','policy_acceptances','equipment','equipment_stock','equipment_movements','equipment_issues']){const cols=db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name);replaceAuditTriggers(db,table,cols,table==='equipment_stock'?['equipment_id','location_id','status']:['id']);}
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migracja narusza powiązania danych.');
 db.prepare('INSERT INTO schema_migrations VALUES(9,?,?)').run('Conversations, policies, notifications and equipment',new Date().toISOString());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function migrateMethodology(db){
 if(db.prepare('SELECT version FROM schema_migrations WHERE version=10').get())return;
 db.exec('BEGIN IMMEDIATE');try{
 db.exec(`CREATE TABLE programs(id INTEGER PRIMARY KEY,name TEXT NOT NULL,min_age INTEGER NOT NULL,max_age INTEGER NOT NULL,description TEXT NOT NULL);
 CREATE TABLE program_skills(id INTEGER PRIMARY KEY,program_id INTEGER REFERENCES programs(id),name TEXT NOT NULL,criteria TEXT NOT NULL,stage TEXT NOT NULL);
 CREATE TABLE group_programs(group_id INTEGER PRIMARY KEY REFERENCES groups(id),program_id INTEGER REFERENCES programs(id));
 CREATE TABLE lesson_plans(id INTEGER PRIMARY KEY,owner_id INTEGER REFERENCES users(id),program_id INTEGER REFERENCES programs(id),title TEXT NOT NULL,warmup TEXT NOT NULL,main_part TEXT NOT NULL,games TEXT NOT NULL,ending TEXT NOT NULL,equipment TEXT NOT NULL,minutes INTEGER NOT NULL,private INTEGER NOT NULL CHECK(private IN (0,1)));
 CREATE TABLE learning_assets(id INTEGER PRIMARY KEY,owner_id INTEGER REFERENCES users(id),group_id INTEGER REFERENCES groups(id),program_id INTEGER REFERENCES programs(id),title TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '',audience TEXT NOT NULL CHECK(audience IN ('private','trainers','parents')),mime TEXT NOT NULL,bytes INTEGER NOT NULL,content BLOB NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE skill_assessments(id INTEGER PRIMARY KEY,athlete_id INTEGER REFERENCES athletes(id),skill_id INTEGER REFERENCES program_skills(id),status TEXT NOT NULL CHECK(status IN ('new','learning','mastered')),comment TEXT NOT NULL,published INTEGER NOT NULL CHECK(published IN (0,1)),actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE adventure_cards(athlete_id INTEGER PRIMARY KEY REFERENCES athletes(id),hero TEXT NOT NULL CHECK(hero IN ('fox','giraffe','hare','turtle','seal','monkey')),created_at TEXT NOT NULL);`);
 for(const table of ['programs','program_skills','group_programs','lesson_plans','learning_assets','skill_assessments','adventure_cards']){const cols=db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name).filter(c=>c!=='content');replaceAuditTriggers(db,table,cols,table==='group_programs'?['group_id']:table==='adventure_cards'?['athlete_id']:['id']);}
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migracja narusza powiązania danych.');
 db.prepare('INSERT INTO schema_migrations VALUES(10,?,?)').run('Methodology, private library and progress history',new Date().toISOString());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function migrateBusiness(db){
 if(db.prepare('SELECT version FROM schema_migrations WHERE version=11').get())return;
 db.exec('BEGIN IMMEDIATE');try{
 db.exec(`ALTER TABLE lesson_completion ADD COLUMN actual_minutes INTEGER;
 CREATE TABLE trainer_contracts(trainer_id INTEGER PRIMARY KEY REFERENCES trainers(id),kind TEXT NOT NULL,starts_on TEXT NOT NULL,ends_on TEXT,presentation TEXT NOT NULL);
 CREATE TABLE trainer_availability(id INTEGER PRIMARY KEY,trainer_id INTEGER REFERENCES trainers(id),starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,weekday INTEGER,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reason TEXT NOT NULL,actor_id INTEGER REFERENCES users(id));
 CREATE TABLE wage_rates(id INTEGER PRIMARY KEY,trainer_id INTEGER REFERENCES trainers(id),location_id INTEGER REFERENCES locations(id),starts_on TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>=0),unit_minutes INTEGER NOT NULL CHECK(unit_minutes IN (30,60)));
 CREATE TABLE wage_adjustments(id INTEGER PRIMARY KEY,trainer_id INTEGER REFERENCES trainers(id),month TEXT NOT NULL,location_id INTEGER REFERENCES locations(id),amount INTEGER NOT NULL,reason TEXT NOT NULL,actor_id INTEGER REFERENCES users(id));
 CREATE TABLE wage_settlements(id INTEGER PRIMARY KEY,trainer_id INTEGER REFERENCES trainers(id),month TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('approved','paid')),amount INTEGER NOT NULL,items_json TEXT NOT NULL,paid_on TEXT,actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(trainer_id,month));
 CREATE TABLE cost_categories(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE);
 CREATE TABLE business_costs(id INTEGER PRIMARY KEY,category_id INTEGER REFERENCES cost_categories(id),location_id INTEGER REFERENCES locations(id),amount INTEGER NOT NULL CHECK(amount>=0),date TEXT NOT NULL,label TEXT NOT NULL,recurrence TEXT NOT NULL DEFAULT 'none',ends_on TEXT,kind TEXT NOT NULL CHECK(kind IN ('operating','vat','income_tax','social')),actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE TABLE rent_rules(id INTEGER PRIMARY KEY,location_id INTEGER REFERENCES locations(id),starts_on TEXT NOT NULL,amount_per_hour INTEGER NOT NULL CHECK(amount_per_hour>=0),minimum_minutes INTEGER NOT NULL CHECK(minimum_minutes>=0),cleaning INTEGER NOT NULL CHECK(cleaning>=0),fixed_monthly INTEGER NOT NULL CHECK(fixed_monthly>=0));
 CREATE TABLE report_snapshots(id INTEGER PRIMARY KEY,month TEXT NOT NULL,revision INTEGER NOT NULL,payload_json TEXT NOT NULL,reason TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(month,revision));`);
 for(const table of ['trainer_contracts','trainer_availability','wage_rates','wage_adjustments','wage_settlements','cost_categories','business_costs','rent_rules','report_snapshots']){const cols=db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name);replaceAuditTriggers(db,table,cols,table==='trainer_contracts'?['trainer_id']:['id']);}
 replaceAuditTriggers(db,'lesson_completion',['session_id','completed','actor_id','reason','updated_at','actual_minutes'],['session_id']);
 db.exec("CREATE TRIGGER report_snapshot_no_update BEFORE UPDATE ON report_snapshots BEGIN SELECT RAISE(ABORT,'Snapshot raportu jest niezmienny.'); END; CREATE TRIGGER report_snapshot_no_delete BEFORE DELETE ON report_snapshots BEGIN SELECT RAISE(ABORT,'Snapshot raportu jest niezmienny.'); END;");
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migracja narusza powiązania danych.');
 db.prepare('INSERT INTO schema_migrations VALUES(11,?,?)').run('Trainer settlements, availability and business reporting',new Date().toISOString());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function migrateDirectoryOperations(db){
 if(db.prepare('SELECT version FROM schema_migrations WHERE version=12').get())return;
 db.exec('BEGIN IMMEDIATE');try{
  db.exec(`CREATE TABLE athlete_merges(source_id INTEGER PRIMARY KEY,target_id INTEGER NOT NULL REFERENCES athletes(id),source_json TEXT NOT NULL,reason TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);`);
  replaceAuditTriggers(db,'athlete_merges',['source_id','target_id','source_json','reason','actor_id','created_at'],['source_id']);
  db.prepare('INSERT INTO schema_migrations VALUES(12,?,?)').run('Controlled athlete record merges',new Date().toISOString());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function migrateRegistrationRules(db){
 if(db.prepare('SELECT version FROM schema_migrations WHERE version=13').get())return;
 db.exec('BEGIN IMMEDIATE');try{
 db.exec(`ALTER TABLE groups ADD COLUMN activity_type TEXT NOT NULL DEFAULT '';
 ALTER TABLE groups ADD COLUMN parent_description TEXT NOT NULL DEFAULT '';
 ALTER TABLE groups ADD COLUMN min_age INTEGER CHECK(min_age BETWEEN 0 AND 18);
 ALTER TABLE groups ADD COLUMN max_age INTEGER CHECK(max_age BETWEEN 0 AND 18);
 ALTER TABLE groups ADD COLUMN questions TEXT NOT NULL DEFAULT '[]';
 CREATE TABLE registration_answers(group_id INTEGER REFERENCES groups(id),athlete_id INTEGER REFERENCES athletes(id),definition_json TEXT NOT NULL,values_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(group_id,athlete_id));`);
 replaceAuditTriggers(db,'groups',db.prepare('PRAGMA table_info(groups)').all().map(c=>c.name));
 replaceAuditTriggers(db,'registration_answers',['group_id','athlete_id','definition_json','values_json','updated_at'],['group_id','athlete_id']);
 db.prepare('INSERT INTO schema_migrations VALUES(13,?,?)').run('Group age rules and registration questions',new Date().toISOString());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function migratePaymentDeadlines(db){
 if(db.prepare('SELECT version FROM schema_migrations WHERE version=14').get())return;
 db.exec('BEGIN IMMEDIATE');try{
 db.exec(`ALTER TABLE enrollments ADD COLUMN due_on TEXT;
 CREATE TABLE enrollment_deadlines(id INTEGER PRIMARY KEY,enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),old_due_on TEXT,new_due_on TEXT NOT NULL,reason TEXT NOT NULL,actor_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE INDEX enrollment_due_on ON enrollments(due_on);
 CREATE TRIGGER enrollment_default_deadline AFTER INSERT ON enrollments WHEN NEW.due_on IS NULL BEGIN
 UPDATE enrollments SET due_on=MAX(substr(academy_now(),1,10),substr(NEW.created_at,1,10),NEW.month||'-'||printf('%02d',(SELECT due_day FROM finance_settings WHERE id=1))) WHERE id=NEW.id;
 END;`);
 replaceAuditTriggers(db,'enrollments',db.prepare('PRAGMA table_info(enrollments)').all().map(c=>c.name));
 replaceAuditTriggers(db,'enrollment_deadlines',['id','enrollment_id','old_due_on','new_due_on','reason','actor_id','created_at']);
 // Existing question definitions become optional; preserve historical answer snapshots.
 for(const g of db.prepare('SELECT id,questions FROM groups').all())db.prepare('UPDATE groups SET questions=? WHERE id=?').run(JSON.stringify(JSON.parse(g.questions).map(q=>({...q,required:false}))),g.id);
 db.prepare('INSERT INTO schema_migrations VALUES(14,?,?)').run('Payment deadlines and optional registration questions',new Date().toISOString());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function migratePasskeys(db){
 if(db.prepare('SELECT version FROM schema_migrations WHERE version=15').get())return;
 db.exec('BEGIN IMMEDIATE');try{
 db.exec(`CREATE TABLE passkeys(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),public_key BLOB NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL,label TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT);
 CREATE TABLE passkey_challenges(token_hash TEXT PRIMARY KEY REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,challenge TEXT NOT NULL,origin TEXT NOT NULL,rp_id TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
 replaceAuditTriggers(db,'passkeys',['id','user_id','label','created_at','last_used_at']);
 db.prepare('INSERT INTO schema_migrations VALUES(15,?,?)').run('Administrator passkeys as second factor',new Date().toISOString());db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
