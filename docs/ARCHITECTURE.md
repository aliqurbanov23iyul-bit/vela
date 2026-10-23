# Vela Forex AI — uygulanan mimari ve sınırlar

Bu depo məhdud DEMO pilotu ehtiva edir; tam istehsal məhsulu deyil. `accounts.live_enabled` üzərində `CHECK(live_enabled = false)` real hesab ticarətini bloklayır. Demo idarəetməsi `/api/demo/control` vasitəsilə istəyi saxlayır; brokerə əmr yalnız hesab sahibi saytdan açıq sınaq başlatdıqda, davamlı Windows MT5 agentində və `agent/demo_pilot.py` risk/siqnal/onay yoxlamalarından sonra göndərilir. Vercel özü MT5 prosesi və ya davamlı ticarət dövrü işlətmir.

## Süreçler ve veri akışı

Tarayıcı → Next.js API → PostgreSQL. Oturumda seçilmiş tenant üyeliği her istekte tekrar doğrulanır. Request tenant parametresi kullanıcı yetkisini belirlemez. Girişte gönderilen tenant, parola ve üyelik doğrulanmadan oturuma alınmaz.

BullMQ `entries` kuyruğu → bağımsız worker → RLS transaction → hesap satırı kilidi → kalıcı emir durumu. Kuyruk yalnızca UUID referansları taşır, sır taşımaz. Runtime rolü tenant RLS kapsamındadır. Redis'e yalnızca sunucu servisleri erişmelidir; kuyruk üreticisi henüz ürüne bağlanmamıştır. Hatalı işler `failed-entry` kuyruğuna referans olarak yazılır. Yeniden başlayan worker SUBMITTING/UNKNOWN durumunu RECONCILING yapar ve tekrar emir göndermez. Gerçek broker uzlaştırması henüz uygulanmamıştır; bu yüzden işleme dönmez.

Dedicated Windows MT5 terminali → Python connector/demo pilot → TLS/Bearer token → snapshot və market endpoint-ləri. Hər agent üçün ayrıca hesab UUID-si, token, broker login-i, server və terminal yolu vardır. Token SHA-256 özeti saxlanır; terminal hesabı dəyişərsə agent bağlanır. Tenant kimliyi agent mesajında təkbaşına səlahiyyət vermir. Verilənlər bazasında hesab və token əhatəsi birlikdə doğrulanır. Agent şəxsi PC-də işləyə bilər; telefon/PC-dən asılı olmadan 24/7 iş üçün həmin connector və MT5 terminalı Windows VPS-də quraşdırılmalıdır. VPS qurulması və brokerlə canlı sınaq bu repoda avtomatik edilməyib.

AI adaptörleri yalnızca minimize edilmiş analiz snapshot'ı alır; hesabın kimliği, bakiye veya sır gönderilmemelidir. Gemini/Groq/OpenRouter için resmi OpenAI uyumlu REST yolları kullanılır. Model adları uydurulmaz; ortamda operatör tarafından seçilir. Zod alanları, analiz/snapshot kimliği, kaynak kimlikleri ve çıktı süresi denetlenir. Tüm sağlayıcılar başarısızsa NO_TRADE döner. AI katmanı emir tablosuna yazamaz. Circuit breaker süreç içidir; dağıtık breaker, parasal bütçe ve kalıcı değerlendirme raporları eksiktir. `AI_MAX_CALLS` çağrı sınırıdır, maliyet bütçesi değildir. Tek çağrı/provider yapılır; kör retry yoktur.

`LicensedJsonFeed`, sözleşmesi bu uygulamanın normalize edilmiş şeması olan HTTPS adaptörüdür. Belirli bir ticari haber sağlayıcısına yapılmış ve doğrulanmış entegrasyon değildir. Lisanslı sağlayıcının gerçek alan eşlemesi ve freshness/polling pipeline'ı geliştirilmelidir.

## Güvenlik modeli

OWNER tenant yöneticisi, OPERATOR ve VIEWER rol değerleri vardır. Mevcut yazma uçları OWNER ister; okuma üyelik ister. Super admin bayrağı tenant RLS'yi kaldırmaz; ayrıca üyelik gerekir. Tenantlar arasında otomatik yönetici erişimi yoktur. Super admin ilk oluşturulurken TOTP zorunlu tutulur. Parola Argon2id, session token 256-bit rastgele ve veritabanında hash, çerez HttpOnly/SameSite Strict/production Secure. Origin kontrolü yazma uçlarında zorunlu. Login Redis üzerinde username hash ile atomik deneme sınırı uygular ve Redis kesintisinde giriş kapanır. IP bazlı edge sınırlaması henüz yoktur.

AES-256-GCM sır zarfı vardır; anahtar veritabanından ayrı 32-byte hex ortam sırrıdır. İlk adminin TOTP sırrı şifrelenir. Admin API'leri parola/sır döndürmez. Uygulama rolü güvenilen sunucu rolüdür; SQL injection veya sunucu ele geçirilmesine karşı RLS tek başına yeterli değildir. Raw SQL daima parametrelidir. Tenant transaction `set_config(...,true)` ile scoped ve rollback/release garantilidir. Migration sahibi yerine ayrı NOBYPASSRLS runtime rolü zorunludur.

Audit UPDATE/DELETE trigger ve runtime grant sınırıyla korunur; DBA'ya karşı değişmezlik garantisi değildir. Harici WORM/SIEM teslimi henüz yoktur. Telegram pairing, webhook secret kontrolü, update dedup ve atomik callback tüketimi uygulanmıştır; gerçek botla doğrulanmamıştır. Tam mesaj/öneri yayınlama ve tolerans yeniden onay pipeline'ı eksiktir. Ayrıntılar TELEGRAM.md dosyasındadır.

## Emir durumu

CREATED → BLOCKED (bu sürüm). Gelecek motor için RESERVED → SUBMITTING → FILLED/PARTIAL/REJECTED veya UNKNOWN → RECONCILING durumları tanımlıdır. `(account_id,proposal_id)` tekildir. UNKNOWN sonuç otomatik retry edilmez. Broker tarafında exactly-once garantisi yoktur. Hesap kilidi mevcut; atomik risk rezervasyon ve broker dispatch henüz yoktur. Saf risk modülü bu haliyle yürütme motoru sayılmaz.

## Analiz ve P&L sınırları

EMA50/200, Wilder RSI/ATR, MACD/signal ve 20 mum destek/direnç kodu mevcut. Bar sırası/boşluk/güncellik ve kapanmamış son mum engeli vardır. Çoklu zaman aralığı veri toplama, 60+ gün history pipeline, seans takvimi ve tam OHLC doğrulama eksiktir. Hafta sonu/seans boşluklarını kabul eden veri takvimi eklenmelidir.

P&L yardımcı fonksiyonu TRADE netini `profit + commission + swap + fee` olarak hesaplar, nakit hareketlerini dışlar. Broker sınıflandırması ve tam position yaşam döngüsü toplanması çağıranın sorumluluğudur. Bu fonksiyon tamamlanmış MT5 muhasebe sistemi değildir: açık kalmış pozisyona ait giriş maliyetleri, kısmi kapanış, farklı broker deal türleri, drawdown, periyot sınırları ve döviz çevrimi için ek ledger ve fixture doğrulaması gerekir. Arayüz henüz hiçbir türetilmiş kazanç rakamı sunmaz.

