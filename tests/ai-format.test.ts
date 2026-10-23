import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAnalysisResponse} from '../src/server/ai';
const now=Date.UTC(2026,9,23,12);
const snapshot={analysis_id:'a',snapshot_id:'s',symbol:'XAUUSD',source_ids:['MT5:XAUUSD:bar'],indicators:{}};
const value={analysis_id:'a',snapshot_id:'s',symbol:'XAUUSD',timeframe_summary:'M5/H1',action:'NO_TRADE',rationale:'Observation',risk_factors:['Missing news'],invalidation_conditions:[],source_ids:snapshot.source_ids,expires_at:new Date(now+60000).toISOString()};
test('AI parser accepts JSON and a whole JSON fence while preserving metadata checks',()=>{assert.equal(parseAnalysisResponse(JSON.stringify(value),snapshot,now).action,'NO_TRADE');assert.equal(parseAnalysisResponse('```json\n'+JSON.stringify(value)+'\n```',snapshot,now).symbol,'XAUUSD');});
test('AI parser rejects fabricated identity, sources, expiry and malformed schema',()=>{for(const [change,code] of [[{symbol:'EURUSD'},'INVALID_CORRELATION'],[{analysis_id:'wrong'},'INVALID_CORRELATION'],[{source_ids:['invented']},'INVALID_SOURCE'],[{expires_at:new Date(now-1).toISOString()},'INVALID_EXPIRY'],[{expires_at:new Date(now+600000).toISOString()},'INVALID_EXPIRY'],[{rationale:{text:'wrong'}},'INVALID_SCHEMA'],[{extra:'unknown'},'INVALID_SCHEMA']] as const){assert.throws(()=>parseAnalysisResponse(JSON.stringify({...value,...change}),snapshot,now),new RegExp(code));}assert.throws(()=>parseAnalysisResponse('text '+JSON.stringify(value),snapshot,now),/INVALID_JSON/);});
