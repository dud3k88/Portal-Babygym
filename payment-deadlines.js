import {warsawNow} from './billing.js';
export function paymentTiming(charge,today=warsawNow().slice(0,10)) {
 const overdue=charge.balance>0&&charge.due_on&&charge.due_on<today;
 const days=overdue?Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(charge.due_on+'T00:00:00Z'))/86400000):0;
 return {...charge,payment_status:charge.balance<0?'credit':charge.balance===0?'settled':!charge.due_on?'unknown':overdue?'overdue':'pending',overdue_days:days,overdue_amount:overdue?charge.balance:0};
}
