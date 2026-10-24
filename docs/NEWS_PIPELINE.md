# Xəbər pipeline və əməliyyat sərhədi

## Hazırkı vəziyyət

Xəbər mənbələrinin adapter reyestri boşdur. Heç bir sayta scraping sorğusu edilmir, pullu xidmət qoşulmayıb və panel canlı məlumat iddia etmir. Bazaya mənbə əlavə ediləndə onun `adapter_key` dəyəri əvvəlcədən kodda qeydə alınmış adapterlə uyğun gəlməlidir. Mənbə config-də token/parol saxlanmamalıdır; gələcək məxfi credential-lar Vercel environment secret-lərində qalmalıdır.

## Məlumat axını

1. Mənbə adapteri `NewsRecord` obyektləri və cursor qaytarır; hər çağırış timeout ilə məhdudlaşır.
2. Poll target DB lock ilə seçilir; source intervalına hörmət edilir. Xəta olduqda polling intervalı backoff ilə artırılır, son xəta kodu və uğurlu yoxlama vaxtı qeyd olunur.
3. Başlıq normallaşdırılıb tarix günü ilə birləşdirilir; eyni mənbədə `externalId` və məzmun SHA-256 təkrarı filtrləyir. Dəyişən xəbər yeni `news_analysis_jobs` işi yaradır.
4. Hadisə və mənbə yazıları tenant RLS daxilində saxlanılır. AI işi `FOR UPDATE SKIP LOCKED` ilə yalnız bir dəfə claim olunur; həddən artıq cəhdlər və UTC günlük AI büdcəsi məhdudlaşdırılır.
5. AI-yə yalnız tarixli xəbər başlığı, excerpt və mənbə ID-ləri verilir. Mətn etibarsız məlumatdır. Cavab sərt Zod sxemindən, whitelist simvoldan, icazəli mənbə ID-lərindən və 24 saatlıq etibarlılıqdan keçməsə dərc edilmir.
6. Yeni ssenari əvvəlkini silmir: əvvəlki baxış `UPDATED`, yenisi `CURRENT` olur. Baxışda fakt, izah, ssenari, zidd fakt, risk, etibarsızlaşma şərti, xəbər vaxtı və ssenari vaxtı görünür.
7. Telegram bildirişi yalnız bağlı hesab, açıq istifadəçi seçimi, seçilmiş bazar və susdurma vaxtı yoxlanandan sonra göndərilir. Hər ssenari versiyası bir dəfə yazılır; eyni istifadəçiyə saatda ən çox 4 uğurlu bildiriş gedir. Əməliyyat düymələri yoxdur.

## Fon işi və Vercel

`/api/cron/news` qorunur və `Authorization: Bearer $CRON_SECRET` tələb edir. Adapter reyestri boş olduğuna görə indi mənbə sorğusu və analiz işləmir. `vercel.json` cron cədvəli qəsdən əlavə edilməyib: əvvəl mənbə, onun tələb etdiyi interval, Vercel layihə planının cron imkanları və AI xərc həddi seçilməlidir. Bu qərarlardan sonra cron cədvəli seçilmiş provayder limitinə uyğunlaşdırıla bilər; brauzer sekməsi fon işi daşımır.

Vercel environment-larında: `CRON_SECRET`, `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SECRET_KEY_HEX`, `APP_ORIGIN`; sonra seçilən model provayderinin server açarı/modeli; Telegram üçün `TELEGRAM_BOT_TOKEN` və `TELEGRAM_WEBHOOK_SECRET`. Tokenlar yalnız server secrets-də saxlanmalıdır. `AI_MAX_ANALYSES_PER_DAY` default 24-dür. Modelin xərc tarifləri provider/model seçimindən asılıdır.

## Trading decommission

Migration `015_news_workspace.sql` mövcud hesabları dayandırır, agent tokenlarını boşaldır, permission version artırır, demo control-u söndürür, yalnız icra edilməmiş CREATED/RESERVED daxili sifarişləri bloklayır və açıq approval-ları rədd edilmiş kimi işarələyir. Broker tərəfdə açıq pozisiyalara, order tarixçəsinə, snapshot/deal qeydlərinə toxunmur. Köhnə agent snapshot/market/demo, demo control, account, analysis və digər ticarət API-ləri HTTP 410 qaytarır. Telegram callback düymələri cavablandırılır, lakin heç bir qərar yazmır və əməliyyat başlatmır. Worker fail-closed şəkildə çıxır.

Əvvəlki VELA Windows proqramı açıqdırsa, onu sistem tray menyusundan çıxartmaq olar; MT5-i bağlamaq və ya broker mövqelərini dəyişmək lazım deyil. Köhnə agent serverə yeni məlumat yaza bilməyəcək.

