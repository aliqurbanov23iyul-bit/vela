import {test} from 'node:test';
import assert from 'node:assert/strict';
const origin=process.env.SMOKE_BASE_URL;
test('HTTP home renders product',{skip:!origin},async()=>{const r=await fetch(origin!);assert.equal(r.status,200);assert.match(await r.text(),/Vela/);});
for(const [path,method,status] of [['/api/dashboard','GET',401],['/api/login','POST',401],['/api/stop','POST',403],['/api/agent/snapshot','POST',403],['/api/telegram/webhook','POST',403]] as const){test('HTTP unauthorized request blocked '+path,{skip:!origin},async()=>{const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});assert.equal(r.status,status);});}
