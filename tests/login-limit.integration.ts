import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {consumeLoginAttempt} from '../src/server/login-limit';
import {digest} from '../src/server/security';

test('PostgreSQL atomically limits concurrent attempts and resets expired window',
  {skip:!process.env.TEST_DATABASE_URL||!process.env.TEST_ADMIN_DATABASE_URL},async()=>{
    const db=new Pool({connectionString:process.env.TEST_DATABASE_URL});
    const admin=new Pool({connectionString:process.env.TEST_ADMIN_DATABASE_URL});
    const username='login-test-'+randomUUID();const key=digest(username);
    try {
      const results=await Promise.all(Array.from({length:20},()=>consumeLoginAttempt(db,username)));
      assert.equal(results.filter(r=>r.allowed).length,10);
      await admin.query("UPDATE login_attempts SET resets_at=now()-interval '1 second' WHERE key_hash=$1",[key]);
      assert.equal((await consumeLoginAttempt(db,username)).allowed,true);
    } finally {
      await admin.query('DELETE FROM login_attempts WHERE key_hash=$1',[key]);
      await db.end();await admin.end();
    }
  });
