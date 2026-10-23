import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoObservation} from '../src/server/demo-observation';
test('demo observation requires a completed news assessment and fresh bounded bias',()=>{
 const now=1800000000000,result={bias:'BUY',newsAssessment:{summary:'Official news assessed'},expiresAt:new Date(now+180000).toISOString()};
 assert.equal(demoObservation('EURUSD','COMPLETED',result,now)?.bias,'BUY');
 for(const status of ['RUNNING','FAILED','NO_PROVIDER'])assert.equal(demoObservation('EURUSD',status,result,now),null);
 for(const change of [{newsAssessment:null},{bias:'EXECUTE'},{expiresAt:new Date(now-1).toISOString()},{expiresAt:new Date(now+300001).toISOString()}])assert.equal(demoObservation('EURUSD','COMPLETED',{...result,...change},now),null);
});
