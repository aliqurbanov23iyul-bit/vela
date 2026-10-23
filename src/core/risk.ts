export type RiskInput={equity:number;entry:number;stop:number;take:number;side:'BUY'|'SELL';tickSize:number;tickValue:number;minLot:number;maxLot:number;lotStep:number;maxMoney:number;maxPercent:number;reserved:number;openRisk:number;maxTotal:number;positions:number;maxPositions:number;spread:number;maxSpread:number;marginLevel:number;minMargin:number;dailyLoss:number;maxDailyLoss:number;drawdown:number;maxDrawdown:number;fresh:boolean;newsAvailable:boolean;newsBlocked:boolean;sessionOpen:boolean;cooldown:boolean;minRR:number};
export function assessRisk(x:RiskInput):{allowed:boolean;reasons:string[];lots:number;risk:number}{
 const reasons:string[]=[];const numbers=Object.values(x).filter(v=>typeof v==='number') as number[];
 if(numbers.some(v=>!Number.isFinite(v))) reasons.push('INVALID_NUMBER');
 if(!x.fresh)reasons.push('STALE_DATA');if(!x.newsAvailable)reasons.push('NEWS_MISSING');if(x.newsBlocked)reasons.push('NEWS_BLACKOUT');if(!x.sessionOpen)reasons.push('SESSION_CLOSED');if(x.cooldown)reasons.push('COOLDOWN');
 if(x.equity<=0||x.tickSize<=0||x.tickValue<=0||x.lotStep<=0||x.minLot<=0||x.maxMoney<=0||x.maxPercent<=0)reasons.push('INVALID_SPEC');
 const distance=Math.abs(x.entry-x.stop);if(x.stop<=0||distance===0||(x.side==='BUY'?x.stop>=x.entry||x.take<=x.entry:x.stop<=x.entry||x.take>=x.entry))reasons.push('INVALID_STOPS');
 if(Math.abs(x.take-x.entry)/distance<x.minRR)reasons.push('REWARD_RATIO');
 if(x.spread>x.maxSpread)reasons.push('SPREAD');if(x.marginLevel<x.minMargin)reasons.push('MARGIN');if(x.dailyLoss>=x.maxDailyLoss)reasons.push('DAILY_LOSS');if(x.drawdown>=x.maxDrawdown)reasons.push('DRAWDOWN');if(x.positions>=x.maxPositions)reasons.push('POSITIONS');
 const perLot=distance/x.tickSize*x.tickValue,budget=Math.min(x.maxMoney,x.equity*x.maxPercent/100,x.maxTotal-x.openRisk-x.reserved);
 let lots=Math.floor(Math.min(budget/perLot,x.maxLot)/x.lotStep)*x.lotStep;
 if(lots*perLot>budget)lots=Math.max(0,lots-x.lotStep);
 const risk=lots*perLot;
 if(!Number.isFinite(lots)||lots<x.minLot||risk<=0||risk>budget+1e-8)reasons.push('VOLUME');
 return {allowed:reasons.length===0,reasons,lots:reasons.length?0:Number(lots.toFixed(8)),risk:reasons.length?0:risk};
}
export function executionGate(x:{mode:string;live:boolean;globalStop:boolean;tenantStop:boolean;accountStop:boolean;reconciled:boolean;expires:number;permissionVersion:number;currentVersion:number;approved:boolean},now=Date.now()){
 return !x.globalStop&&!x.tenantStop&&!x.accountStop&&x.reconciled&&x.live&&x.mode!=='WATCH'&&x.expires>now&&x.permissionVersion===x.currentVersion&&(x.mode==='AUTO'||x.mode==='TELEGRAM'&&x.approved);
}
