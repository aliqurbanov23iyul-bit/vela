import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeDemo} from '../src/core/demo-status';

const now=Date.parse('2026-10-23T18:00:00.000Z');
const iso=(age:number)=>new Date(now-age).toISOString();

test('demo status distinguishes requested state from agent acknowledgement',()=>{
 const common={accountType:'DEMO',heartbeatAt:iso(1000),startedAt:iso(2000),now};
 assert.equal(observeDemo({...common,desired:false,pilot:{enabled:false,phase:'OFF'}}).state,'STOPPED');
 assert.equal(observeDemo({...common,desired:true,pilot:{enabled:false,phase:'OFF'}}).state,'STARTING');
 const running=observeDemo({...common,desired:true,pilot:{enabled:true,phase:'WAITING',reason:'Siqnal gözlənilir.'}});
 assert.deepEqual(running,{state:'RUNNING',reason:'Siqnal gözlənilir.'});
});

test('demo status reports stale connection and a connector that failed to start',()=>{
 const common={accountType:'DEMO',desired:true,now,startedAt:iso(61000)};
 assert.equal(observeDemo({...common,heartbeatAt:iso(46000),pilot:{enabled:false,phase:'OFF'}}).state,'DEGRADED');
 const failed=observeDemo({...common,heartbeatAt:iso(1000),pilot:{enabled:false,phase:'OFF'}});
 assert.equal(failed.state,'DEGRADED');assert.match(failed.reason,/doğru hesab faylı/);
 assert.equal(observeDemo({...common,heartbeatAt:iso(1000),pilot:{enabled:false,phase:'ALGO_OFF'}}).state,'ERROR');
});
