import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processEntry} from '../src/server/execution';
import {POST as agentDemo} from '../app/api/agent/demo/route';
import {POST as agentSnapshot} from '../app/api/agent/snapshot/route';
import {POST as demoControl} from '../app/api/demo/control/route';
import {POST as legacyApproval} from '../app/api/telegram/notify/route';
test('retired trade APIs fail closed with HTTP 410',async()=>{for(const handler of [agentDemo,agentSnapshot,demoControl,legacyApproval])assert.equal((await handler()).status,410);await assert.rejects(processEntry(),/TRADING_DISABLED/);});

