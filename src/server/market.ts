import {z} from 'zod';
import {indicators} from '../core/analytics';
const bar=z.object({time:z.number().int().positive(),open:z.number().finite().positive(),high:z.number().finite().positive(),low:z.number().finite().positive(),close:z.number().finite().positive()}).strict().refine(b=>b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.high>=b.low,'Invalid OHLC');
export const marketInput=z.object({accountId:z.string().uuid(),tenantId:z.string().uuid(),login:z.string(),server:z.string(),symbol:z.enum(['EURUSD','XAUUSD']),brokerSymbol:z.string().min(1).max(64),brokerTimeOffsetMinutes:z.number().int().min(-840).max(840).multipleOf(15).default(0),observedAt:z.string().datetime(),quoteAt:z.string().datetime(),bid:z.number().finite().positive(),ask:z.number().finite().positive(),point:z.number().finite().positive(),m5:z.array(bar).min(220).max(300),h1:z.array(bar).min(220).max(300)}).strict().refine(x=>x.ask>=x.bid,'Invalid quote');
export type MarketInput=z.infer<typeof marketInput>;
function weekendSlot(time:number){const d=new Date(time),day=d.getUTCDay(),hour=d.getUTCHours();return day===6||day===0||day===5&&hour>=20||day===1&&hour<2;}
export function closedIndicators(bars:z.infer<typeof bar>[],now:number,interval:number,observationGap?:(time:number)=>boolean){
 for(let i=0;i<bars.length;i++){
  const b=bars[i];bar.parse(b);if(b.time%interval!==0)throw Error('BAR_ALIGNMENT');
  if(i){const delta=b.time-bars[i-1].time;if(delta<interval||delta%interval!==0||delta>72*3600000)throw Error('BAR_ORDER');
   for(let missing=bars[i-1].time+interval;missing<b.time;missing+=interval)if(!weekendSlot(missing)&&!observationGap?.(missing))throw Error('MISSING_BARS');}
 }
 const last=bars.at(-1)!;if(last.time+interval>now||now-last.time>interval*3)throw Error('STALE_OR_OPEN_BARS');
 // Skip only validated weekend session gaps for the calculation; never fill prices.
 const normalized=bars.map((b,i)=>({...b,time:last.time-(bars.length-1-i)*interval}));return indicators(normalized,now,interval);
}
export function summarizeMarket(input:MarketInput,now=Date.now()){
 const issues:string[]=[];const observed=Date.parse(input.observedAt),quote=Date.parse(input.quoteAt);
 if(Math.abs(now-observed)>60000)throw Error('STALE_UPLOAD');
 if(quote>now+10000||now-quote>60000)issues.push('STALE_QUOTE');
 const frames:Record<string,ReturnType<typeof indicators>>={};
 // This narrow window was observed in the connected demo broker's gold bars.
 // It permits observation calculations only; a verified session calendar remains mandatory for execution.
 const demoGold=input.symbol==='XAUUSD'&&input.server==='MetaQuotes-Demo'&&input.brokerTimeOffsetMinutes===180;
 const observationGap=demoGold?(time:number)=>{const h=new Date(time).getUTCHours();return h>=20&&h<22;}:undefined;
 for(const [name,bars,interval] of [['M5',input.m5,300000],['H1',input.h1,3600000]] as const){try{frames[name]=closedIndicators(bars,now,interval,observationGap);}catch{issues.push(name+'_INVALID_OR_STALE');}}
 const spreadPoints=(input.ask-input.bid)/input.point;
 return {bid:input.bid,ask:input.ask,spreadPoints,brokerTimeOffsetMinutes:input.brokerTimeOffsetMinutes,sessionCalendar:demoGold?'OBSERVED_DEMO_GOLD_GAPS_20_22_UTC':'WEEKEND_WINDOW_ONLY',quoteAt:input.quoteAt,observedAt:input.observedAt,lastM5:new Date(input.m5.at(-1)!.time).toISOString(),lastH1:new Date(input.h1.at(-1)!.time).toISOString(),frames,dataIssues:issues,executionAllowed:false,executionBlocks:['NEWS_MISSING','BROKER_SESSION_CALENDAR_UNVERIFIED','ACCOUNT_RISK_NOT_CONFIGURED','EXECUTION_DISABLED'],action:'NO_TRADE' as const};
}
export function aiLimits(){const interval=Number(process.env.AI_ANALYSIS_INTERVAL_MINUTES??30),daily=Number(process.env.AI_MAX_ANALYSES_PER_DAY??96);return {intervalMinutes:Number.isFinite(interval)?Math.max(15,Math.min(1440,interval)):30,daily:Number.isFinite(daily)?Math.max(0,Math.min(288,Math.floor(daily))):96};}
