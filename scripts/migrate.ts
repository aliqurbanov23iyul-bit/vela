import {Pool} from 'pg';
import {readFile,readdir} from 'node:fs/promises';
const db=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const c=await db.connect();
try{await c.query('SELECT pg_advisory_lock(908215)');await c.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');for(const name of (await readdir('db')).filter(n=>n.endsWith('.sql')).sort()){if((await c.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])).rowCount)continue;await c.query('BEGIN');try{await c.query(await readFile('db/'+name,'utf8'));await c.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);await c.query('COMMIT');console.log('Applied',name);}catch(e){await c.query('ROLLBACK');throw e;}}}finally{await c.query('SELECT pg_advisory_unlock(908215)');c.release();await db.end();}
