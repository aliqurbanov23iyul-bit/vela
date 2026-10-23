// Informational AI bias for an explicitly armed local virtual-money experiment.
// This is never a server execution command or a live-trading permission.
export function demoObservation(symbol:string,status:string,result:any,now=Date.now()) {
 const expires=Date.parse(result?.expiresAt??'');
 if(status!=='COMPLETED'||!result?.newsAssessment||!['BUY','SELL','NO_TRADE'].includes(result?.bias)||!Number.isFinite(expires)||expires<=now||expires>now+300000)return null;
 return {symbol,bias:result.bias,expiresAt:result.expiresAt,newsAssessed:true};
}
