import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { configureAudit, requestContext, recordAccess } from '../audit.js';

test('równoległe żądania zachowują właściwego autora audytu, również po await', async()=>{
 const db=new DatabaseSync(':memory:');configureAudit(db);
 db.exec('CREATE TABLE audit_logs(actor_id INTEGER,request_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,created_at TEXT)');
 try {
  await Promise.all([1,2].map(id=>requestContext.run({actorId:id,requestId:'req-'+id},async()=>{
   await new Promise(resolve=>setTimeout(resolve,id===1?10:1));
   recordAccess(db,'invitation.created',100+id);
   const current=db.prepare('SELECT audit_actor_id() AS actor,audit_request_id() AS request').get();
   assert.equal(current.actor,id);assert.equal(current.request,'req-'+id);
  })));
  const rows=db.prepare('SELECT actor_id,request_id,entity_id FROM audit_logs ORDER BY actor_id').all();
  assert.deepEqual(rows.map(row=>({...row})),[{actor_id:1,request_id:'req-1',entity_id:'101'},{actor_id:2,request_id:'req-2',entity_id:'102'}]);
  assert.equal(db.prepare('SELECT audit_actor_id() AS actor').get().actor,null);
 }finally{db.close();}
});
