'use client';

import Icon from './Icon';

type Props={onLogin:()=>void;telegramUrl:string|null;telegramReady:boolean};

export default function PublicLanding({onLogin,telegramUrl,telegramReady}:Props){
 return <div className="public-site">
  <header className="public-header">
   <a href="/" className="public-brand" aria-label="VELA ana səhifə"><img src="/vela-logo.png" alt="VELA" width="1942" height="809"/></a>
   <nav aria-label="Səhifə bölmələri"><a href="#nece-isleyir">Necə işləyir?</a><a href="#tehlukesizlik">Təhlükəsizlik</a></nav>
   <button className="public-login" onClick={onLogin}>Daxil ol <Icon name="arrow" size={16}/></button>
  </header>

  <main>
   <section className="public-hero">
    <div className="public-copy">
     <span className="public-eyebrow"><i/> FOREX AI <b>·</b> DEMO PLATFORMASI</span>
     <h1>Bazarı anla.<br/><em>Hesabını rahat idarə et.</em></h1>
     <p>EUR/USD və qızıl bazarını izlə, AI xülasələrini bir yerdə gör, hesab yeniliklərini Telegram-dan al.</p>
     <div className="public-actions"><button className="public-primary" onClick={onLogin}>Hesabıma daxil ol <Icon name="arrow" size={17}/></button>{telegramUrl?<a className="public-secondary" href={telegramUrl} target="_blank" rel="noopener noreferrer"><Icon name="telegram" size={17}/> Telegram botunu aç ↗</a>:<span className="public-secondary is-pending"><Icon name="telegram" size={17}/>{telegramReady?'Telegram bot bağlantısı hazır deyil':'Telegram linki yoxlanır…'}</span>}</div>
     <small className="public-hint">Sənə verilmiş istifadəçi adı və şifrə ilə başla. Əlavə AI açarları quraşdırmaq lazım deyil.</small>
    </div>
    <div className="public-visual" aria-label="VELA demo platformasının nümunə görünüşü">
     <div className="visual-glow"/>
     <div className="visual-card">
      <div className="visual-top"><span className="visual-mark">◢</span><div><strong>VELA bazar icmalı</strong><small>Nümunə panel görünüşü</small></div><span className="live-tag"><i/> DEMO</span></div>
      <div className="visual-chart"><div className="chart-gridline line-one"/><div className="chart-gridline line-two"/><svg viewBox="0 0 520 180" role="presentation" aria-hidden="true"><defs><linearGradient id="vela-line-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4f8eff" stopOpacity=".3"/><stop offset="1" stopColor="#4f8eff" stopOpacity="0"/></linearGradient></defs><path className="chart-area" d="M0 142 C35 133 37 117 70 124 S112 151 145 111 S190 87 216 105 S250 131 281 86 S318 76 344 91 S378 111 406 58 S445 76 468 39 S494 60 520 22 V180 H0Z"/><path className="chart-line" d="M0 142 C35 133 37 117 70 124 S112 151 145 111 S190 87 216 105 S250 131 281 86 S318 76 344 91 S378 111 406 58 S445 76 468 39 S494 60 520 22"/></svg><div className="chart-labels"><span>EUR / USD</span><span>XAU / USD</span></div></div>
      <div className="visual-bottom"><span><i/> MT5 hesabı</span><span><i/> AI təhlili</span><span><i/> Telegram</span></div>
     </div>
     <div className="visual-orbit orbit-a"/><div className="visual-orbit orbit-b"/>
    </div>
   </section>

   <section className="public-steps" id="nece-isleyir">
    <div className="steps-intro"><span className="public-eyebrow">SADƏ BAŞLANĞIC</span><h2>Bir baxışda hər şey.</h2><p>Qarışıq menyular yox. Lazım olan addımlar aydın yerdədir.</p></div>
    <div className="steps-grid">
     <article><span className="step-number">01</span><div className="step-icon"><Icon name="accounts" size={21}/></div><h3>Hesabını bağla</h3><p>Demo MT5 hesabını VELA proqramı ilə təhlükəsiz qoş.</p></article>
     <article><span className="step-number">02</span><div className="step-icon"><Icon name="sparkles" size={21}/></div><h3>Analizi izlə</h3><p>EUR/USD və qızıl üzrə bazar məlumatını, xəbərləri və AI xülasəsini gör.</p></article>
     <article><span className="step-number">03</span><div className="step-icon"><Icon name="telegram" size={21}/></div><h3>Telegram-dan xəbər al</h3><p>Botu açıb Start düyməsinə bas. Bağlantı sayt və Telegram-da görünəcək.</p></article>
    </div>
   </section>

   <section className="public-safety" id="tehlukesizlik"><span className="safety-icon"><Icon name="shield" size={21}/></span><div><strong>Demo rejimi ilə başla</strong><p>Bu platforma real ticarət qazancına zəmanət vermir. Real hesabda əməliyyat bağlıdır; demo nəticələri də qazanc vədi deyil.</p></div><span className="safety-label">YALNIZ DEMO</span></section>
  </main>
  <footer className="public-footer"><span>© VELA · Forex AI</span>{telegramUrl?<a href={telegramUrl} target="_blank" rel="noopener noreferrer">Telegram botu <Icon name="arrow" size={14}/></a>:<span>{telegramReady?'Telegram botu konfiqurasiya edilməyib':'Telegram bağlantısı yoxlanır'}</span>}</footer>
 </div>;
}
