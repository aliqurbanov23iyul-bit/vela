import {Pool} from 'pg';
import {applyMigrations} from '../src/server/migrations';

// Only production deployments upgrade an initialized schema. Empty databases
// remain gated by the one-time /setup flow. Preview builds never modify prod.
if(process.env.VERCEL==='1'&&process.env.VERCEL_ENV==='production'){
  const url=process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
  if(!url)throw Error('Production database connection is required');
  const pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:10000});
  const c=await pool.connect();
  try{
    const exists=await c.query("SELECT to_regclass('public.users') AS users,to_regclass('public.schema_migrations') AS ledger");
    if(exists.rows[0].users){
      if(!exists.rows[0].ledger)throw Error('Existing schema has no migration ledger; review it before deployment');
      await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='10s'");
      try{await applyMigrations(c);await c.query('COMMIT');console.log('Production schema updated');}
      catch(e){await c.query('ROLLBACK');throw e;}
    }else console.log('Empty database: first-admin setup will initialize the schema');
  }finally{c.release();await pool.end();}
}else console.log('Production migrations skipped for local/preview build');
