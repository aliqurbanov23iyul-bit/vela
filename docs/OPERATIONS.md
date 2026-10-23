# İşletim ve kalan üretim kapıları

## Acil durdurma

OWNER: Risk & yetkiler → Yeni işlemleri durdur. İşlem transaction içinde tüm tenant hesaplarını durdurur, yetki sürümünü artırır ve CREATED/RESERVED emirleri BLOCKED yapar. Açık pozisyon kapatmaz. Yetkili oturum/DB yoksa başarı gösterilmez. Global `system_state.stopped=true` varsayılanı vardır; bu sürüm yürütmeyi zaten koşulsuz engeller. Global/hesap stop yönetim API'leri henüz yoktur. Gerçek açık pozisyon kapatma gerekiyorsa broker terminalinde bağımsız yetkili operatör kullanmalıdır; uygulama kapatma başarı mesajı üretmez.

## Yedek ve kurtarma

PostgreSQL için günlük şifreli `pg_dump -Fc` ve WAL/PITR stratejisi, Redis için AOF ve disk snapshot'ı planlayın. Yedekleri ayrı erişim sınırındaki depoda saklayın. Şifre anahtarını DB yedeğinden ayrı güvenli depoda yedekleyin. Aylık izolasyon ortamına restore tatbikatı ve veri/tenant kontrolleri yapın. Başlangıç hedefleri RPO 15 dakika, RTO 4 saat olarak işletmeci tarafından gözden geçirilmeli; bu hedeflerin ölçümü yapılmadı.

Restore sonrası web/worker kapalıyken tenant/account stop bayraklarını true, live_enabled false yapın; session'ları iptal edin, agent tokenları döndürün. UNKNOWN/SUBMITTING emirleri RECONCILING tutun; broker history ile yetkili operatör uzlaştırmadan devam etmeyin. Bu sürümde gerçek uzlaştırma olmadığı için canlı yürütmeye dönülemez. Redis kaybında PostgreSQL emir kayıtlarını kaynak kabul edin; otomatik gönderim yeniden oluşturmayın.

## Anahtar yenileme

Agent token `provision-agent` ile döndürüldüğünde önceki token geçersizleşir. TOTP/AES anahtarı için servisleri durdurup güvenli işletim script'iyle eski anahtarla çözme/yeni anahtarla şifreleme gerekir; sürümlü anahtar halkası ve otomatik rotasyon henüz yoktur. Eski anahtarı veri dönüşümü doğrulanmadan silmeyin. Broker parolasını sadece ayrı terminal/Windows secret deposunda tutun. AI ve Telegram anahtarlarını loglara veya tarayıcıya yazmayın.

## İzleme ve servis yönetimi

Web/worker için systemd veya platform process supervisor; Windows ajan için servis yöneticisi kullanın. Restart backoff ve başarısızlık alarmı ayarlayın. Redis AOF disk doluluğu, DB erişimi, worker stalled/failed-entry sayısı, eski agent heartbeat (>45s), eski piyasa/haber snapshot'ı, login failure oranı ve bekleyen uzlaştırmalar alarm gerektirir. Prometheus endpoint ve otomatik alarm entegrasyonu henüz uygulanmadı. Deploy öncesi TLS, secret redaction ve log erişimlerini doğrulayın.

Audit için önerilen başlangıç saklama süresi 365 gün; hukuki gereksinim ve veri minimizasyonuyla onaylanmalı. Trigger kayıtları uygulama değişikliklerinden korur; DBA müdahalesine karşı WORM dış aktarımı gerekir. Retention silme yalnızca yetkili ayrı bakım rolüyle, yasal saklama kontrolü ve ayrı audit kanıtıyla yapılmalıdır. Otomatik retention ve unutulma akışı henüz yoktur.

## Canlı aktivasyondan önce zorunlu kalanlar

- Tam tenant daveti, suspend, rol/grant, kullanıcı yeniden doğrulama, parola reset ve TOTP replay önleme akışları; session revoke-on-disable/role-change testleri.
- Gerçek PostgreSQL/Redis üzerinde IDOR, RLS, kuyruk izolasyonu ve eşzamanlı risk rezervasyonu testleri.
- Lisanslı ekonomik takvim/haber, çoklu timeframe 60+ gün history, sembol özellikleri, hesap para biriminde order_calc_profit/margin ve tüm risk kuralları.
- Telegram pairing/webhook/callback kodunun gerçek bot ve PostgreSQL ile doğrulanması; tam öneri mesajı, notification outbox ve tolerans değişiminde yeni onay.
- Ayrı live grant tablosu, account owner onayı, reauth, immutable risk profile sürümü ve dispatch anında grant/stop tekrar kontrolü.
- MT5 order_check/retcode/partial/requote, kalıcı dispatch journal ve broker reconciliation; demo broker ile fault injection. Gerçek para ile test yapmayın.
- Broker deal ledger, kısmi kapanış/komisyon/swap/ücretler, nakit hareketi ayrımı, currency/timezone/periyot ve drawdown fixture'ları.
- AI değerlendirme corpus'u, provider schema uyumu, parasal bütçe, dağıtık circuit breaker; tüm-provider-fail senaryosu.
- Backtest spread/komisyon/slippage ve örneklem dışı değerlendirme. Geçmiş performans gelecek kazancı garantilemez.
- Erişilebilirlik/odak tuzağı/klavye testi, çeviri sözlüğüne tüm metinlerin taşınması, güvenlik incelemesi, backup restore tatbikatı ve ticari/lisans incelemesi.

Kısıtları kaldıran bir deploy canlı işlem yetkisi yerine geçmez. Bu listedeki akışlar ve açık kullanıcı izni olmadan DB check kısıtını kaldırmayın.

