import {Pool} from 'pg';
import {applyMigrations} from '../src/server/migrations';
const db=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const c=await db.connect();
try{await c.query('BEGIN');await applyMigrations(c);await c.query('COMMIT');console.log('Migrations applied');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await db.end();}
