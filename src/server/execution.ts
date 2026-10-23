import {tenantTx} from './db';
export async function processEntry(tenantId:string,orderId:string){return tenantTx(tenantId,async db=>{
 const result=await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[orderId]);const order=result.rows[0];if(!order)throw Error('ORDER_NOT_FOUND');
 await db.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[order.account_id]);
 // This release never dispatches broker commands. Recovery never retries ambiguous submissions.
 if(['SUBMITTING','UNKNOWN','RECONCILING'].includes(order.state)){await db.query("UPDATE orders SET state='RECONCILING' WHERE id=$1",[orderId]);return 'RECONCILING';}
 if(['FILLED','PARTIAL','REJECTED','BLOCKED'].includes(order.state))return order.state;
 await db.query("UPDATE orders SET state='BLOCKED' WHERE id=$1",[orderId]);await db.query("INSERT INTO audit(tenant_id,account_id,event,data) VALUES($1,$2,'EXECUTION_BLOCKED',$3)",[tenantId,order.account_id,JSON.stringify({reason:'LIVE_EXECUTION_NOT_RELEASED',orderId})]);return 'BLOCKED';
 });}
