# Teslim ve doğrulama raporu — 23 Ekim 2026

## 1. Kod olarak tamamlanan parçalar

- Next.js 16.4.2 / React 19.3.1 / TypeScript; Türkçe responsive panel, açık/koyu tema, veri yok durumları, giriş formu ve temel klavye odak döngüsü.
- PostgreSQL migration sürümleme, ayrı runtime rolü, tenant tablolarında FORCE RLS, parametreli sorgular ve oturumdan türetilen üyelik kapsamı.
- Argon2id login, zorunlu super admin TOTP, şifreli MFA sırrı, hash'li oturum, Redis login sınırlama, logout API, güvenli ilk admin CLI.
- Hesap kaydı, token scope ile MT5 snapshot kabulü, hesap sabitli read-only Python ajan ve provisioning CLI.
- Tenant stop transaction'ı; bağımsız BullMQ worker, hesap/emir kilitleri, tekil proposal/order constraint, belirsiz emir durumunda tekrar gönderim engeli.
- Saf risk hesaplaması, EMA/RSI/MACD/ATR yardımcıları, temel net P&L hesabı.
- Gemini/Groq/OpenRouter REST adaptörleri, şema/kimlik/kaynak/expiry doğrulaması, sınırlı fallback, süreç içi circuit breaker, NO_TRADE.
- Telegram kısa süreli tek kullanımlık pairing kodu, webhook secret, update dedup, yetki kontrolü, atomik tüketim; /status ve /stop kodları.
- İşletim, yedek/kurtarma, mimari, Telegram kurulumu, resmi kaynaklar ve kalan üretim kapıları belgeleri.

Bu liste tamamlanan tüm ürün gereksinimleri anlamına gelmez. Birçok modül saf fonksiyon veya sınırlı veri yolu olarak vardır; tam analiz → öneri → onay → risk rezervasyonu → broker dispatch pipeline'ı henüz yoktur. Canlı yürütme DB constraint, worker ve ajan katmanlarında kapalıdır.

## 2. Gerçek hizmete bağlanarak doğrulananlar

Npm paket kayıt servisinden bağımlılıklar indirildi; lockfile oluşturuldu. Resmi Next.js, PostgreSQL, BullMQ, MT5, Telegram, Gemini, Groq ve OpenRouter belgeleri incelendi. Bunlar broker veya AI servis entegrasyonunun çalıştığına dair kanıt değildir.

**Gerçek MT5, broker, Telegram botu, AI veya lisanslı haber sağlayıcısına bağlanarak doğrulanan iş akışı yoktur.**

## 3. Yerel veya taklit bağımlılıklarla test edilenler

| Kontrol | Sonuç | Kapsam |
|---|---|---|
| `npm test` | 24 geçti | Lot/risk sınırları, eksik/eski veri, haber engeli, izin/stop/mod sürümü saf fonksiyonları, approval eşleşmesi, P&L maliyetleri, gösterge warmup, şifreleme, OWNER kontrolü, Telegram callback boyutu, taklit AI 429 fallback |
| `npm run typecheck` | Geçti | Uygulama, worker, CLI, test TypeScript kodu |
| `npm run build` | Geçti | Production Webpack derlemesi ve Next route üretimi |
| Yerel HTTP smoke | 6 geçti | Ana sayfa 200, oturumsuz dashboard 401, originsiz login 401, stop/ajan/webhook yetkisiz 403 |
| PostgreSQL RLS entegrasyon testi | 1 atlandı | Gerçek DB erişimi verilmedi; başarılı sayılmaz |
| Tarayıcı kontrolü | Yapıldı | Panel açıldı, veri olmayan kartlar görüldü, giriş formu açıldı, koyu tema geçişi görüldü |

HTTP test komutu: PowerShell'de `$env:SMOKE_BASE_URL='http://localhost:3100'; npm run test:integration`. Bu kontrol gerçek yerel Next sunucusuna gider; DB/Redis/Telegram/broker kullanılmaz. Gerçek RLS testi için yalnızca ayrılmış test DB'sinde migration'ları uygulayın; `TEST_DATABASE_URL` runtime rolünü, `TEST_ADMIN_DATABASE_URL` test fixture oluşturabilen admin rolünü kullansın. Test iki tenant ve bir test hesabı açıp kaldırır; üretim DB'sinde çalıştırmayın.

Risk testleri eşzamanlı worker limit garantisi sağlamaz; atomik rezervasyon motoru tamamlanmamıştır. Approval saf fonksiyon testi gerçek Telegram replay testine eşdeğer değildir. Fallback testi brokerda çift emir testine eşdeğer değildir. Bu sürümün hiçbir yolu emir göndermediğinden yerel testlerde gerçek emir riski yoktur.

## 4. Erişim veya ortam eksikliği nedeniyle doğrulanamayanlar

- Docker bulunamadı; PostgreSQL/Redis çalıştırılmadı. Migration, RLS, gerçek login/session/rate limiter ve BullMQ recovery entegrasyonu çalıştırılmadı.
- Kullanılabilir Python ve MT5 terminali bulunmadı. Ajanın Python runtime kontrolü, broker snapshot'ı, sembol yetenekleri ve hesap türü eşlemesi brokerla doğrulanmadı.
- AI anahtar/model erişimi yok; gerçek sağlayıcı cevabı alınmadı. Model uygunluğu, kota ve ticari koşullar doğrulanmadı.
- Telegram bot tokenı/webhook yok; gerçek mesaj, pairing ve callback denenmedi.
- Haber/takvim anahtarı veya veri lisansı yok; ticari sağlayıcı alanları ve güncellik doğrulanmadı.

## 5. Bilinen eksikler ve canlı kullanım öncesi işler

Tam super admin müşteri yönetimi/davet/suspend arayüzü; parola sıfırlama ve hassas eylem reauth akışları; TOTP replay koruması; tüm arayüz metinlerinin çeviri kataloğuna alınması; tam çoklu timeframe history pipeline; haber freshness ve lisanslı sağlayıcı entegrasyonu; dağıtık AI bütçe/breaker; bildirim outbox; teklif mesajı ve tolerans yeniden onayı; tam risk/maruziyet rezervasyonu; canlı grant ve mod değişimi akışı; MT5 check/send/retcode/reconciliation; deal ledger/periyot/drawdown/P&L grafikleri; alarm/backup restore ve güvenlik testi eksiktir. Ayrıntılı kapılar OPERATIONS.md'dedir.

İlk Turbopack derlemesi Windows sandbox junction izni nedeniyle başarısız oldu; Webpack yapılandırmasına geçildi ve derleme geçti. İlk lot testi float yuvarlama taşmasını yakaladı; aşağı yuvarlama düzeltildikten sonra testler geçti. Hiçbir test amacıyla gerçek para veya demo hesap emri gönderilmedi. Uygulama üretime hazır olarak değerlendirilmemelidir.
