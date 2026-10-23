import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consumeLoginAttempt} from '../src/server/login-limit';

test('login limit allows first ten attempts and blocks eleventh',async()=>{
  for (const attempts of [1, 10, 11]) {
    const result=await consumeLoginAttempt({query:async()=>({rows:[{attempts,retry_after:120}]})},'Alice');
    assert.equal(result.allowed,attempts<=10);
    assert.equal(result.retryAfter,120);
  }
});
test('login keys are hashed and case normalized',async()=>{
  const keys:string[]=[];
  const db={query:async(_sql:string,values:string[])=>{keys.push(values[0]);return {rows:[{attempts:1,retry_after:900}]};}};
  await consumeLoginAttempt(db,'Alice');await consumeLoginAttempt(db,'ALICE');
  assert.equal(keys[0],keys[1]);assert.match(keys[0],/^[a-f0-9]{64}$/);
});
test('database outage never bypasses login limit',async()=>{
  await assert.rejects(consumeLoginAttempt({query:async()=>{throw Error('offline');}},'Alice'));
  await assert.rejects(consumeLoginAttempt({query:async()=>({rows:[]})},'Alice'));
});
