'use client';
import {useState} from 'react';
import Icon, {type IconName} from './Icon';
type Account={id:string;label:string;currency:string|null;heartbeat:string|null;snapshot:Record<string,unknown>|null};
const cards:[string,string,IconName,string][]=[['Balans','balance','wallet','metric-blue'],['Equity','equity','chart','metric-cyan'],['Marja','margin','layers','metric-violet'],['Sərbəst marja','freeMargin','coins','metric-sky']];
export default function AccountMetrics({accounts}:{accounts:Account[]}){
 const [selected,setSelected]=useState('');const account=accounts.find(a=>a.id===selected)??accounts[0];const fresh=!!account?.heartbeat&&Date.now()-Date.parse(account.heartbeat)<45000;const snap=fresh?account.snapshot:null;
 return <>{account&&<label className="account-select"><span className="account-select-title">Hesab</span><select aria-label="Göstərilən hesab" value={account.id} onChange={e=>setSelected(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.label} · {a.currency??'—'}</option>)}</select><span className={'account-live '+(fresh?'is-live':'')}>{fresh?'MT5 canlıdır':'MT5 gözlənilir'}</span></label>}<div className="metrics">{cards.map(([label,key,icon,tone],i)=><section className={'metric '+tone} key={key} style={{animationDelay:`${i*70}ms`}}><div>{label}<span className="metric-icon"><Icon name={icon} size={19}/></span></div><strong>{snap&&typeof snap[key]==='number'?new Intl.NumberFormat('az-AZ',{maximumFractionDigits:2}).format(snap[key] as number):'—'}<small>{account?.currency??''}</small></strong></section>)}</div></>;
}
