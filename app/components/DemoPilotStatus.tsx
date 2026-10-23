'use client';
type Account={id:string;label:string;currency:string|null;heartbeat:string|null;snapshot:Record<string,unknown>|null};
export default function DemoPilotStatus({accounts}:{accounts:Account[]}){
 return <>{accounts.map(account=>{
 const state=account.snapshot?.demoPilot as {enabled:boolean;phase:string;reason:string;expiresAt:string|null;attempts:number;equityChange:number}|undefined;
 const fresh=!!account.heartbeat&&Date.now()-Date.parse(account.heartbeat)<45000;
 return <section className="panel detail" key={account.id}><div className="connection-heading"><h2>Avtomatik demo sınağı</h2><span className={'connection-state '+(fresh&&state?.enabled?'online':'')}>{fresh&&state?.enabled?'Sınaq aktivdir':'Yeni giriş bağlıdır'}</span></div><p>{account.label} · {fresh&&state?state.reason:state?'Bağlantı köhnədir. Cari sınaq vəziyyəti təsdiqlənmir.':'Başlamaq üçün kompüterdə VELA-nı aç və “Demo sınağını başlat” düyməsinə bas.'}</p>{state&&<p>Cəhdlər: {state.attempts}/3 · Hesab equity fərqi: {state.equityChange.toLocaleString('az-AZ')} {account.currency}{state.expiresAt&&<> · Yeni girişlərin son vaxtı: {new Date(state.expiresAt).toLocaleString('az-AZ')}</>}</p>}<small>Yalnız virtual pul · EUR/USD və qızıl · Eyni anda 1 mövqe · Planlanan risk 0,25% · Sessiya itkisi həddi 1%. Sınağın bitməsi açıq mövqeni bağlamır; SL/TP qüvvədə qalır. Real ticarət bağlıdır.</small></section>;
 })}</>;
}
