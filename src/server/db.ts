import {Pool,PoolClient,QueryResultRow} from 'pg';
const runtimePool=new Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:3000,idleTimeoutMillis:30000,query_timeout:5000});

// Transaction-scoped role selection also works with transaction-pooling hosts.
// A missing/unauthorized role fails closed; owner privileges are never a fallback.
export async function runRestrictedTransaction<T>(db:PoolClient,tenant:string|undefined,fn:(db:PoolClient)=>Promise<T>):Promise<T>{
  await db.query('BEGIN');
  try{
    await db.query('SET LOCAL ROLE forex_app');
    await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant??'']);
    const value=await fn(db);await db.query('COMMIT');return value;
  }catch(e){await db.query('ROLLBACK');throw e;}
}
async function restrictedTx<T>(tenant:string|undefined,fn:(db:PoolClient)=>Promise<T>){
  const db=await runtimePool.connect();
  try{return await runRestrictedTransaction(db,tenant,fn);}finally{db.release();}
}
export const pool={
  query<R extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[]){return restrictedTx(undefined,db=>db.query<R>(sql,values));}
};
export async function tenantTx<T>(tenant:string,fn:(db:PoolClient)=>Promise<T>):Promise<T>{return restrictedTx(tenant,fn);}
export async function audit(db:PoolClient,tenant:string,actor:string,event:string,account?:string){await db.query('INSERT INTO audit(tenant_id,actor_id,event,account_id) VALUES($1,$2,$3,$4)',[tenant,actor,event,account??null]);}
