import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import type {PoolClient} from 'pg';

/** Caller owns the transaction; migrations and their ledger commit together. */
export async function applyMigrations(db:PoolClient) {
  await db.query('SELECT pg_advisory_xact_lock(908215)');
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory=path.join(process.cwd(),'db');
  for(const name of (await readdir(directory)).filter(n=>/^\d+_[\w]+\.sql$/.test(n)).sort()) {
    if((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])).rowCount)continue;
    await db.query(await readFile(path.join(directory,name),'utf8'));
    await db.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
  }
}
