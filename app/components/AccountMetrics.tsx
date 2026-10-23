'use client';
import {useState} from 'react';
import Icon, {type IconName} from './Icon';
type Account={id:string;label:string;currency:string|null;heartbeat:string|null;snapshot:Record<string,unknown>|null};
export default function AccountMetrics({accounts}:{accounts:Account[]}){const [selected,setSelected]=useState('');const account=accounts.find(a=>a.id===selected)??accounts[0];const fresh=account?.heartbeat&&Date.now()-Date.parse(account.heartbeat)<45000;const snap=fresh?account.snapshot:null;
return <>{accounts.length>0&&<label className="account-select">Hesab <select aria-label="Göstərilən hesab" value={account?.id??''} onChange={e=>setSelected(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.label} · {a.currency??'—'}</option>)}</select><small>Son yenilənmə: {account.heartbeat?new Date(account.heartbeat).toLocaleString('tr-TR',{timeZone:'UTC'})+' UTC':'—'}</small></label>}<div className="metrics">{[['Balans','balance'],['Equity','equity'],['İstifadə olunan marja','margin'],['Sərbəst marja','freeMargin']].map(([label,key],i)=><section className="metric" key={key}><div>{label}<span className="metric-icon"><Icon name={(['wallet','chart','layers','coins'] as IconName[])[i]} size={19}/></span></div><strong>{snap&&typeof snap[key]==='number'?new Intl.NumberFormat('tr-TR',{maximumFractionDigits:2}).format(snap[key] as number):'—'}<small>{account?.currency??'Valyuta gözlənilir'}</small></strong><p>{fresh?'MT5-dən alındı':account?.heartbeat?'Məlumat köhnədir; bağlantını yoxla':'MT5 məlumatı gözlənilir'}</p></section>)}</div></>;
}

