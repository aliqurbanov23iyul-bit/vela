'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Icon from './Icon';
import './customers.css';

type Customer={id:string;username:string;displayName:string;disabled:boolean;createdAt:string;accountCount:number};
type Position={ticket?:number;symbol?:string;type?:number;volume?:number;price_open?:number;price_current?:number;sl?:number;tp?:number;profit?:number;swap?:number};
type Pending={ticket?:number;symbol?:string;type?:number;volume_current?:number;price_open?:number;sl?:number;tp?:number};
type BrokerAccount={id:string;label:string;mode:string;stopped:boolean;currency:string|null;accountType:string|null;brokerLogin:string|null;server:string|null;heartbeat:string|null;reconciledAt:string|null;balance:number|null;equity:number|null;margin:number|null;freeMargin:number|null;positions:Position[];orders:Pending[]};
type Profile=Omit<Customer,'accountCount'>&{accounts:BrokerAccount[]};
const label=(v:unknown)=>typeof v==='string'?v:'—';
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('tr-TR',{maximumFractionDigits:5}).format(v):'—';
const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('tr-TR',{maximumFractionDigits:2}).format(v):'—';
const time=(v:string|null)=>v?new Date(v).toLocaleString('tr-TR',{timeZone:'UTC'})+' UTC':'Henüz eşitlenmedi';

async function request<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,{cache:'no-store',...init});const data=await response.json();if(!response.ok)throw Error(data.error??'İstek tamamlanamadı.');return data;}

function NewCustomer({onClose,onCreated}:{onClose:()=>void;onCreated:(id:string)=>void}){
  const dialog=useRef<HTMLDialogElement>(null);const [busy,setBusy]=useState(false),[error,setError]=useState(''),[showPassword,setShowPassword]=useState(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);try{
    const result=await request<{id:string}>('/api/admin/customers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:form.get('displayName'),username:form.get('username'),password:form.get('password')})});
    onCreated(result.id);
  }catch(e){setError(e instanceof Error?e.message:'Kullanıcı oluşturulamadı.');}finally{setBusy(false);}}
  return <dialog ref={dialog} className="admin-dialog" onCancel={onClose} onClose={onClose} aria-labelledby="new-customer-title"><button type="button" className="close" aria-label="Pencereyi kapat" onClick={onClose}>×</button><span className="empty-icon"><Icon name="admin" size={25}/></span><div className="eyebrow">MÜŞTERİ HESABI</div><h2 id="new-customer-title">Yeni kullanıcı ekle</h2><p>Kullanıcı adı ve şifreyi müşterinize verin. Kendisine ait ayrı bir çalışma alanı oluşturulur.</p><form onSubmit={submit}>
    <label>Ad soyad <small>(isteğe bağlı)</small><input name="displayName" maxLength={100} autoComplete="name" placeholder="Müşterinin adı" autoFocus/></label>
    <label>Kullanıcı adı<input name="username" required minLength={3} maxLength={64} pattern="[a-zA-Z0-9_.\-]+" autoComplete="off" placeholder="Örn. musteri01"/></label>
    <label>Şifre<input name="password" required type={showPassword?'text':'password'} minLength={16} maxLength={256} autoComplete="new-password" placeholder="En az 16 karakter"/></label>
    <label className="password-toggle"><input type="checkbox" checked={showPassword} onChange={e=>setShowPassword(e.target.checked)}/> Şifreyi göster</label>
    <p className="customer-help">Şifreyi güvenli bir kanaldan paylaşın. Kaydettikten sonra tekrar görüntülenmez. Müşteri hesabı oluşturmak canlı işlem yetkisi vermez.</p>
    {error&&<div className="error" role="alert">{error}</div>}<button className="primary" disabled={busy}>{busy?'Oluşturuluyor…':'Kullanıcıyı oluştur'}<Icon name="arrow" size={16}/></button>
  </form></dialog>;
}

function AccountProfile({accounts}:{accounts:BrokerAccount[]}){
  const [selected,setSelected]=useState('');const account=accounts.find(a=>a.id===selected)??accounts[0];
  if(!account)return <div className="customer-no-data"><Icon name="accounts" size={30}/><h3>MT5 hesabı henüz bağlanmadı</h3><p>Müşteri hesabına giriş yapıp MT5 bağlantısını kurduğunda gerçek hesap verileri burada görünür.</p></div>;
  const fresh=!!account.heartbeat&&Date.now()-Date.parse(account.heartbeat)<45000;
  return <><div className="customer-account-heading"><h3>MT5 hesapları</h3><select aria-label="Müşterinin broker hesabı" value={account.id} onChange={e=>setSelected(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.label}{a.currency?' · '+a.currency:''}</option>)}</select></div>
    <div className="customer-broker-meta"><span>{account.brokerLogin??'Hesap numarası bekleniyor'} · {account.server??'Sunucu bekleniyor'}</span><span className={`customer-status ${fresh?'active':'idle'}`}>{fresh?'Güncel snapshot':'Güncel veri bekleniyor'}</span></div>
    <div className="customer-values">{[['Bakiye',account.balance],['Equity',account.equity],['Margin',account.margin],['Serbest margin',account.freeMargin]].map(([label,value])=><div key={String(label)}><small>{label}</small><strong>{money(value)} <span>{account.currency??''}</span></strong></div>)}</div>
    <p className="customer-sync">Son eşitleme: {time(account.heartbeat)} · {account.accountType??'Hesap türü bekleniyor'} · {account.mode==='WATCH'?'İzleme':account.mode} · Canlı emir kapalı</p>
    {!fresh&&<p className="customer-stale">Gösterilen değerler son alınan snapshot'a aittir; güncel bağlantı başarısı anlamına gelmez.</p>}
    <div className="customer-table-heading"><h3>Açık pozisyonlar</h3><span>{account.heartbeat?account.positions.length+' kayıt':'Veri bekleniyor'}</span></div>
    {account.positions.length?<div className="customer-table-scroll"><table className="customer-trades"><thead><tr><th>Sembol</th><th>Yön</th><th>Lot</th><th>Giriş</th><th>SL / TP</th><th>Açık P&amp;L</th></tr></thead><tbody>{account.positions.map((p,i)=><tr key={p.ticket??i}><td>{label(p.symbol)}<small>#{number(p.ticket)}</small></td><td>{p.type===0?'Alış':p.type===1?'Satış':'—'}</td><td>{number(p.volume)}</td><td>{number(p.price_open)}</td><td>{number(p.sl)} / {number(p.tp)}</td><td>{money(p.profit)} {account.currency??''}<small>Swap: {money(p.swap)}</small></td></tr>)}</tbody></table></div>:<p className="customer-empty-row">{account.heartbeat?'Son snapshot içinde açık pozisyon bulunmuyor.':'Pozisyon bilgisi henüz alınmadı.'}</p>}
    <div className="customer-table-heading"><h3>Bekleyen emirler</h3><span>{account.heartbeat?account.orders.length+' kayıt':'Veri bekleniyor'}</span></div>
    {account.orders.length?<div className="customer-table-scroll"><table className="customer-trades"><thead><tr><th>Sembol</th><th>Emir türü</th><th>Lot</th><th>Fiyat</th><th>SL / TP</th></tr></thead><tbody>{account.orders.map((o,i)=><tr key={o.ticket??i}><td>{label(o.symbol)}<small>#{number(o.ticket)}</small></td><td>{({2:'Buy limit',3:'Sell limit',4:'Buy stop',5:'Sell stop',6:'Buy stop limit',7:'Sell stop limit'} as Record<number,string>)[o.type??-1]??'—'}</td><td>{number(o.volume_current)}</td><td>{number(o.price_open)}</td><td>{number(o.sl)} / {number(o.tp)}</td></tr>)}</tbody></table></div>:<p className="customer-empty-row">{account.heartbeat?'Son snapshot içinde bekleyen emir bulunmuyor.':'Emir bilgisi henüz alınmadı.'}</p>}
    <p className="customer-history-note"><Icon name="history" size={16}/> Kapanmış işlem geçmişi ve gerçekleşmiş P&amp;L henüz broker geçmişinden eşitlenmiyor.</p>
  </>;
}

export default function CustomersPanel(){
  const [customers,setCustomers]=useState<Customer[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[search,setSearch]=useState(''),[creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(null),[profile,setProfile]=useState<Profile|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[changing,setChanging]=useState(false),[confirmAccess,setConfirmAccess]=useState(false);
  const load=useCallback(async(signal?:AbortSignal)=>{setLoading(true);setError('');try{const data=await request<{customers:Customer[];total:number}>(`/api/admin/customers?q=${encodeURIComponent(search)}&page=${page}`,{signal});setCustomers(data.customers);setTotal(data.total);}catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Liste alınamadı.');}finally{if(!signal?.aborted)setLoading(false);}},[search,page]);
  useEffect(()=>{const controller=new AbortController();const timer=setTimeout(()=>load(controller.signal),180);return()=>{clearTimeout(timer);controller.abort();};},[load]);
  useEffect(()=>{setProfile(null);setConfirmAccess(false);if(!selected)return;const controller=new AbortController();request<Profile>('/api/admin/customers/'+selected,{signal:controller.signal}).then(setProfile).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[selected]);
  async function created(id:string){setCreating(false);setNotice('Kullanıcı oluşturuldu. Müşteriniz verdiğiniz kullanıcı adı ve şifreyle giriş yapabilir.');await load();setSelected(id);}
  async function toggleAccess(){if(!profile)return;setChanging(true);setError('');try{await request('/api/admin/customers/'+profile.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:profile.disabled})});const updated=await request<Profile>('/api/admin/customers/'+profile.id);setProfile(updated);setConfirmAccess(false);await load();}catch(e){setError(e instanceof Error?e.message:'Erişim değiştirilemedi.');}finally{setChanging(false);}}
  return <div className="customers-panel"><div className="customers-toolbar"><div><div className="eyebrow">ADMİN PANELİ</div><h2>Müşterileriniz</h2><p>Hesap oluşturun, profilleri ve gerçek işlem verilerini takip edin.</p></div><button className="primary" onClick={()=>setCreating(true)}><Icon name="admin" size={17}/>Yeni kullanıcı ekle</button></div>
    {notice&&<div className="customer-success" role="status">{notice}<button aria-label="Bildirimi kapat" onClick={()=>setNotice('')}>×</button></div>}{error&&<div className="error" role="alert">{error}</div>}
    <div className="customers-layout"><section className="panel customer-list"><div className="customer-list-top"><label>Kullanıcı ara<input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="Ad veya kullanıcı adı" maxLength={100}/></label><span>{total} kullanıcı</span></div>
      {loading?<div className="customer-empty-row" role="status">Kullanıcılar yükleniyor…</div>:customers.length?customers.map(c=><button className={`customer-row ${selected===c.id?'chosen':''}`} key={c.id} onClick={()=>{setSelected(c.id);setError('');}}><span className="customer-avatar">{(c.displayName||c.username).slice(0,2).toUpperCase()}</span><span className="customer-row-info"><strong>{c.displayName||c.username}</strong><small>@{c.username} · {c.accountCount} MT5 hesabı</small></span><span className={`customer-status ${c.disabled?'idle':'active'}`}>{c.disabled?'Askıda':'Aktif'}</span><Icon name="arrow" size={15}/></button>):<div className="customer-no-data"><Icon name="admin" size={28}/><h3>{search?'Kullanıcı bulunamadı':'Henüz müşteri eklenmedi'}</h3><p>{search?'Farklı bir adla aramayı deneyin.':'İlk müşterinize kullanıcı adı ve şifre vererek başlayın.'}</p></div>}
      {total>20&&<div className="customer-pagination"><button disabled={page===0||loading} onClick={()=>setPage(page-1)}>← Önceki</button><span>{page+1} / {Math.ceil(total/20)}</span><button disabled={(page+1)*20>=total||loading} onClick={()=>setPage(page+1)}>Sonraki →</button></div>}
    </section><section className="panel customer-profile" aria-live="polite">{!selected?<div className="customer-no-data"><Icon name="overview" size={32}/><h3>Bir kullanıcı seçin</h3><p>Profil, hesap değerleri ve açık işlemler burada gösterilir.</p></div>:!profile?<div className="customer-empty-row">{error?'Profil görüntülenemedi.':'Profil yükleniyor…'}</div>:<><div className="customer-profile-top"><span className="customer-avatar large">{(profile.displayName||profile.username).slice(0,2).toUpperCase()}</span><div><h2>{profile.displayName||profile.username}</h2><p>@{profile.username}</p><small>Kayıt: {time(profile.createdAt)}</small></div><span className={`customer-status ${profile.disabled?'idle':'active'}`}>{profile.disabled?'Askıda':'Aktif'}</span></div>
      <div className="customer-profile-actions"><span>Müşteri hesabı · Ayrı çalışma alanı</span><button className="secondary" onClick={()=>setConfirmAccess(!confirmAccess)}>{profile.disabled?'Erişimi aç':'Erişimi durdur'}</button></div>
      {confirmAccess&&<div className="customer-access-confirm"><p>{profile.disabled?'Müşterinin uygulamaya girişini yeniden açmak istiyor musunuz?':'Müşterinin oturumları kapatılacak ve yeni işlemleri durdurulacak. Açık pozisyonlar kapatılmaz.'}</p><button className={profile.disabled?'primary':'danger'} disabled={changing} onClick={toggleAccess}>{changing?'Kaydediliyor…':profile.disabled?'Evet, erişimi aç':'Evet, erişimi durdur'}</button><button className="secondary" disabled={changing} onClick={()=>setConfirmAccess(false)}>Vazgeç</button></div>}
      <AccountProfile accounts={profile.accounts}/>
    </>}</section></div>{creating&&<NewCustomer onClose={()=>setCreating(false)} onCreated={created}/>}</div>;
}

