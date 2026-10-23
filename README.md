# Vela · Forex AI SaaS

Next.js/TypeScript əsaslı SaaS paneli, PostgreSQL RLS, təhlükəsiz giriş və Windows MT5 connector-u ehtiva edir. Sayt demo sessiyasını və AUTO/Telegram rejimini idarə edir; ayrıca Windows connector-u yalnız açıq aktiv edilmiş DEMO sessiyasında sifariş icra edə bilər. **Real hesabda sifariş bloklanıb.** Telefonla idarə olunan DEMO quruluşu üçün [Windows VPS təlimatına](docs/VPS_DEMO_SETUP.md), məhdudiyyətlər üçün [arxitekturaya](docs/ARCHITECTURE.md) baxın.

## Vercel: Redis gerektirmeyen web kurulumu

Admin girişi sonrasında soldaki **Kullanıcılar** bölümünden kullanıcı adı/şifreyle müşteri hesabı açılabilir; profiller ve MT5 snapshot verileri incelenebilir. Müşteriler yalnızca kendi çalışma alanlarını görür. [Kullanıcı yönetimi ve izinler](docs/CUSTOMERS.md).

İlk admini terminal kullanmadan oluşturmak için [tek kullanımlık /setup ekranı](docs/SETUP.md) eklendi. Vercel'de geçici SETUP_TOKEN tanımlayın, redeploy edin ve sitenizde `/setup` açın. Kurulum, şema ve MFA doğrulamasını tamamladıktan sonra otomatik giriş yapar; ilk admin oluşturulunca kapanır. Sonrasında geçici SETUP_TOKEN değerini kaldırın.

Web ve giriş sistemi Redis kullanmaz. Giriş denemesi sınırı mevcut PostgreSQL bağlantısına taşınmıştır. Yeni `db/004_postgres_login_limits.sql` migration dosyasını uygulayın. Vercel'e REDIS_URL eklemeyin. Ayrıntılar: [Vercel kurulumu](docs/VERCEL.md). Mevcut BullMQ worker yalnızca ayrıca başlatılırsa Redis kullanır; bu web deploy'u için worker başlatmayın.

## Yerel kurulum

Node.js 20.9+ (burada 24.21.0 kullanıldı), PostgreSQL 18 gereklidir. Redis 8 yalnızca ayrı BullMQ worker çalıştırılacaksa gerekir. Python ajan için Windows üzerinde broker'ın desteklediği MT5 terminali, uygun 64-bit Python ve çalışan broker oturumu gerekir. Web/worker Linux VPS'de olabilir; MT5 ajanını ayrı Windows VPS'de çalıştırın. Tarayıcı kapalıyken servisler çalışabilir; internet ve broker/AI/veri erişimi gerekir. Piyasalar her zaman açık değildir.

1. `npm ci`
2. `.env.example` dosyasını `.env` olarak kopyalayın. Benzersiz parola, APP_ORIGIN ve SECRET_KEY_HEX girin. Anahtar üretimi: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Docker mevcutsa POSTGRES_PASSWORD ortam değişkenini tanımlayıp `docker compose up -d` çalıştırın. Docker bu çalışma ortamında bulunamadığı için compose doğrulanmadı.
4. MIGRATION_DATABASE_URL sahibi/migration rolünü kullansın. `npm run migrate` migration dosyalarını sıralı, transaction ve sürüm tablosuyla uygular. Migration rolü ilk runtime rolünü oluşturabilecek yetkiye sahip olmalıdır.
5. Migration 002 runtime rolünü oluşturur. `psql` içinde `\password forex_app` ile özel parola tanımlayın. DATABASE_URL yalnızca bu NOBYPASSRLS rolünü kullansın. Owner/superuser bağlantısıyla web veya worker başlatmayın.
6. BOOTSTRAP_USERNAME ve 16+ karakter BOOTSTRAP_PASSWORD ortam değişkenlerini özel oturumda tanımlayın. `npm run bootstrap`. Dönen tenant UUID'sini ve TOTP URI'sini güvenli yerde tutun; TOTP'yi authenticator'a ekleyin. Çıktıyı log sistemine göndermeyin. Değişkenleri ardından kaldırın. Sabit parola veya herkese açık admin kayıt rotası yoktur.
7. `npm run dev`; production için `npm run build` ve `npm start`. Next.js `.env` yükler. `APP_ORIGIN` tarayıcı origin'iyle birebir eşleşmelidir. Üretimde TLS zorunludur.
8. Ayrı süreçte `npm run worker`. `.env` okunur. Sunucuya Redis erişimi gerekli; üretimde Redis auth/TLS ve özel ağ kullanın.

## MT5 DEMO hesabını bağlama

OWNER oturumuyla Hesaplar & MT5 ekranında hesap kaydı açın. İşletim operatörü `npm run provision-agent -- TENANT_UUID ACCOUNT_UUID BROKER_LOGIN SERVER` ile token üretsin. `.env` içindeki migration bağlantısı yalnızca bu CLI için kullanılır. Token çıktısını yalnızca ajan secret deposuna aktarın.

MT5 terminalini Windows kompüterində və ya VPS-də açıb demo hesaba daxil ol. Saytdakı **Hesablar & MT5** axınında terminalin tam `terminal64.exe` yolunu verərək məxfi connector JSON-u endir. Bu layihədəki connector 1.4.0 installer-i Python mühiti və demo pilotu ilə gəlir. Connector-u qoşduqdan sonra təzə heartbeat və `demoProtocol: 2` görünməlidir. Saytın başlatma API-si istəyi saxlayır; sifariş yalnız davamlı Windows MT5 connector-unda siqnal, AI/xəbər, hesab, risk, qiymət və icazələr təsdiqlənəndə göndərilir. Şəxsi kompüter söndürüləndə işləməsi üçün MT5 və connector Windows VPS-də açıq qalmalıdır. Addımlar: [Windows VPS təlimatı](docs/VPS_DEMO_SETUP.md).

## Kontroller

`npm test`, `npm run typecheck`, `npm run build`. Testler emir göndermez. Gerçek PostgreSQL tenant izolasyonu için `npm run test:integration` (aşağıdaki rapor önkoşulları). Broker/Telegram/AI erişimi olmadan bu entegrasyonların doğrulandığı iddia edilmez.

## Güncel resmi başvuru kaynakları

- [Next.js kurulum](https://nextjs.org/docs/app/getting-started/installation)
- [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [BullMQ worker](https://docs.bullmq.io/guide/workers)
- [MT5 Python entegrasyonu](https://www.mql5.com/en/docs/python_metatrader5) ve [order_send](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py)
- [Gemini uyumluluk API](https://ai.google.dev/gemini-api/docs/openai), [Groq](https://console.groq.com/docs/openai), [OpenRouter](https://openrouter.ai/docs/api-reference/overview)
- [Telegram Bot API](https://core.telegram.org/bots/api)

Model adları hesap erişimine göre operatörce seçilir; bu çalışma gerçek model erişimini veya lisans koşullarını onaylamaz. Ticari satış öncesi hedef ülke, yatırım danışmanlığı/otomatik işlem/portföy hizmeti kapsamı, broker sözleşmesi, veri yeniden dağıtım lisansı ve kişisel veri aktarımı uzmanlarca incelenmelidir. Mevzuata uygunluk veya kâr garantisi verilmez.

