import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
export const requestContext = new AsyncLocalStorage();
export function configureAudit(db) {
  db.function('audit_timestamp',()=>new Date().toISOString());
  db.function('audit_actor_id',()=>requestContext.getStore()?.actorId ?? null);
  db.function('audit_request_id',()=>requestContext.getStore()?.requestId ?? null);
}
export function withRequestContext(handler) {
  return (req,res)=>requestContext.run({actorId:null,requestId:randomUUID()},()=>handler(req,res));
}
export function recordAccess(db, action, userId) {
  db.prepare('INSERT INTO audit_logs(actor_id,request_id,action,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?)')
    .run(action==='session.started'?userId:(requestContext.getStore()?.actorId??userId),requestContext.getStore()?.requestId??null,action,'access',String(userId),new Date().toISOString());
}
