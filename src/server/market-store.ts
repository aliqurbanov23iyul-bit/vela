import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {digest,equal} from './security';
import {type MarketInput,summarizeMarket,aiLimits} from './market';
export async function claimMarket(db:PoolClient,b:MarketInput,raw:string,summary:ReturnType<typeof summarizeMarket>,limits=aiLimits()){
 const a=(await db.query('SELECT a.agent_token_hash,a.broker_login,a.server,a.account_type,u.disabled,t.suspended FROM accounts a JOIN users u ON u.id=a.owner_id JOIN tenants t ON t.id=a.tenant_id WHERE a.id=$1 FOR UPDATE OF a',[b.accountId])).rows[0];
 if(!a||!a.agent_token_hash||!equal(digest(raw),a.agent_token_hash)||a.broker_login!==b.login||a.server!==b.server||a.account_type!=='DEMO'||a.disabled||a.suspended)throw Error('AUTH');
 const saved=await db.query('INSERT INTO market_latest(tenant_id,account_id,symbol,broker_symbol,quote_at,observed_at,summary) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(account_id,symbol) DO UPDATE SET broker_symbol=excluded.broker_symbol,quote_at=excluded.quote_at,observed_at=excluded.observed_at,summary=excluded.summary,received_at=now() WHERE excluded.quote_at>=market_latest.quote_at RETURNING account_id',[b.tenantId,b.accountId,b.symbol,b.brokerSymbol,b.quoteAt,b.observedAt,JSON.stringify(summary)]);
 if(!saved.rowCount)return {id:null,reason:'OLDER_SNAPSHOT'};
 if(summary.dataIssues.length)return {id:null,reason:'DATA_BLOCKED'};
 const last=await db.query("SELECT 1 FROM market_analysis_runs WHERE account_id=$1 AND symbol=$2 AND created_at>now()-($3*interval '1 minute') LIMIT 1",[b.accountId,b.symbol,limits.intervalMinutes]);if(last.rowCount)return {id:null,reason:'COOLDOWN'};
 const count=await db.query("SELECT count(*)::int AS n FROM market_analysis_runs WHERE account_id=$1 AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')",[b.accountId]);if(count.rows[0].n>=limits.daily)return {id:null,reason:'DAILY_AI_LIMIT'};
 const id=randomUUID();const r=await db.query("INSERT INTO market_analysis_runs(id,tenant_id,account_id,symbol,bar_at,status) VALUES($1,$2,$3,$4,$5,'RUNNING') ON CONFLICT(account_id,symbol,bar_at) DO NOTHING RETURNING id",[id,b.tenantId,b.accountId,b.symbol,summary.lastM5]);return {id:r.rowCount?id:null,reason:r.rowCount?'STARTED':'SAME_BAR'};
}
