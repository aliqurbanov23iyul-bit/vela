export type DemoObservedState='STOPPED'|'STARTING'|'RUNNING'|'DEGRADED'|'ERROR';
type PilotStatus={enabled?:boolean;phase?:string;reason?:string}|null|undefined;
export function observeDemo({desired,accountType,heartbeatAt,startedAt,pilot,now=Date.now()}:{desired:boolean;accountType:string|null;heartbeatAt:string|null;startedAt:string|null;pilot:PilotStatus;now?:number}){
 if(!desired)return {state:'STOPPED' as const,reason:'Bot dayandırılıb.'};
 const heartbeat=heartbeatAt?Date.parse(heartbeatAt):NaN;
 if(!Number.isFinite(heartbeat)||now-heartbeat>45000)return {state:'DEGRADED' as const,reason:'MT5 bağlantısından 45 saniyədən çoxdur məlumat gəlmir. Yeni giriş təsdiqlənmir.'};
 if(accountType!=='DEMO')return {state:'ERROR' as const,reason:'Hesab demo kimi təsdiqlənməyib; girişlər bloklanıb.'};
 if(pilot?.enabled===true)return {state:'RUNNING' as const,reason:pilot.reason??'Demo agent işləyir.'};
 const started=startedAt?Date.parse(startedAt):NaN;
 if(Number.isFinite(started)&&now-started>60000){
  if(pilot?.phase==='OFF')return {state:'DEGRADED' as const,reason:'Connector canlıdır, amma son MT5 statusunda demo sınağı aktiv görünmür. Saytdakı hesabı və connectorun doğru hesab faylı ilə işlədiyini yoxla.'};
  if(pilot?.phase==='ALGO_OFF'||pilot?.phase==='REAL_BLOCKED'||pilot?.phase==='ERROR')return {state:'ERROR' as const,reason:pilot.reason??'MT5 connector xətası; yeni girişlər dayandırılıb.'};
  return {state:'DEGRADED' as const,reason:pilot?.reason??'Agent son 60 saniyədə başladığını təsdiqləmədi. MT5 connectorunu yoxla.'};
 }
 return {state:'STARTING' as const,reason:'Başlatma istəyi agentə göndərilir; növbəti bağlantı yoxlanılır.'};
}
