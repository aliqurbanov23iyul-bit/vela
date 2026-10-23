import { Pool, PoolClient } from 'pg';
export const pool = new Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:3000,idleTimeoutMillis:30000,query_timeout:5000});
export async function tenantTx<T>(tenant:string, fn:(db:PoolClient)=>Promise<T>):Promise<T>{
 const db=await pool.connect();
 try {await db.query('BEGIN');await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const value=await fn(db);await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
export async function audit(db:PoolClient,tenant:string,actor:string,event:string,account?:string){await db.query('INSERT INTO audit(tenant_id,actor_id,event,account_id) VALUES($1,$2,$3,$4)',[tenant,actor,event,account??null]);}
