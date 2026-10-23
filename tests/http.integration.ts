import {test} from 'node:test';
import assert from 'node:assert/strict';
const origin=process.env.SMOKE_BASE_URL;
test('HTTP home renders product',{skip:!origin},async()=>{const r=await fetch(origin!);assert.equal(r.status,200);assert.match(await r.text(),/Vela/);});
test('HTTP setup page renders without exposing configuration secrets',{skip:!origin},async()=>{const r=await fetch(origin+'/setup');assert.equal(r.status,200);assert.match(await r.text(),/SETUP_TOKEN/);});
for(const [path,method,status] of [['/api/dashboard','GET',401],['/api/login','POST',401],['/api/stop','POST',403],['/api/agent/snapshot','POST',403],['/api/telegram/webhook','POST',403],['/api/setup','POST',403],['/api/admin/customers','GET',401],['/api/admin/customers/00000000-0000-4000-8000-000000000001','GET',401],['/api/admin/customers','POST',403]] as const){test('HTTP unauthorized request blocked '+path+' '+method,{skip:!origin},async()=>{const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});assert.equal(r.status,status);});}
