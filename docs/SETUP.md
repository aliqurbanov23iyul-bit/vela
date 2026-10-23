# İlk admini brauzerdən yaratmaq

Bu yol yalnız ilk quraşdırma üçündür. İstifadəçi bu yüksək səlahiyyətli, birdəfəlik ekranın schema hazırlamasına və ilk super admin yaratmasına açıq razılıq verib. Canlı əməliyyatlar dəyişmir və bağlı qalır.

## Vercel-də bir dəfə

1. `APP_ORIGIN=https://velatradingbot.vercel.app` (sonunda `/` olmasın).
2. `SECRET_KEY_HEX` 64 hex simvoldan ibarət təsadüfi açar olmalıdır. Əvvəl qurulubsa dəyişmə: mövcud MFA sirləri bu açarla şifrələnir.
3. `SETUP_TOKEN` əlavə et: 32–128 simvolluq təsadüfi gizli kod. `/setup` səhifəsində “Hələ kod yaratmamışam” hissəsi 64 hex simvolluq kod yarada və kopyalaya bilir. Kodu yalnız Vercel-in Production mühitinə əlavə et, sonra Redeploy et. Preview mühitinə production kodu və production DB vermə.
4. `/setup` aç, eyni kodu yaz və Davam et düyməsinə bas.
5. İstifadəçi adı (3–64 hərf/rəqəm/alt xətt/nöqtə/tire), 16+ simvolluq şifrə seç. Google Authenticator və ya Microsoft Authenticator ilə QR-ni skan et və cari 6 rəqəmli kodu yaz. QR üçün xarici servis istifadə edilmir.
6. Hesab yarananda avtomatik giriş edilir. Sonrakı girişlər üçün istifadəçi adı, şifrə və cari telefon kodu kifayətdir; tenant UUID lazım deyil. Köhnə və ya çoxlu təşkilatlı hesablar üçün əlavə təşkilat sahəsi saxlanılıb.
7. `SETUP_TOKEN` və quraşdırma üçün ayrıca əlavə edilmiş `MIGRATION_DATABASE_URL` dəyişkənini sil və Redeploy et. `SECRET_KEY_HEX`-i silmə və dəyişmə. Authenticator girişini təhlükəsiz yedəklə; bu versiyada MFA recovery kodları yoxdur.

## Veritabanı icazələri

Quraşdırma serverdə `MIGRATION_DATABASE_URL`, sonra `DATABASE_URL_UNPOOLED`, sonra `DATABASE_URL` seçir. Bu əlaqə cədvəl və `forex_app` rolunu yarada bilməlidir. Avtomatik platforma bağlantısında bu icazə yoxdursa, migration owner bağlantısını müvəqqəti `MIGRATION_DATABASE_URL` kimi ver. Sırları çata, GitHub-a və screenshot-a daxil etmə.

Migration 002 yeni bazalarda cari database adını istifadə edir; `forex` adlı bazanı fərz etmir. Migration 005 owner bağlantısına `forex_app` rolunu seçmək üçün üzvlük verir. Normal web sorğuları hər transaction daxilində `SET LOCAL ROLE forex_app` icra edir: owner bağlantısı avtomatik verilsə belə tenant sorğuları məhdud rol/RLS ilə işləyir. Bu, transaction pooling ilə də uyğundur. Rol yoxdursa və ya icazə verilmirsə owner kimi davam edilmir. İstehsalda ayrıca məhdud runtime bağlantısı və ayrıca quraşdırma owner bağlantısı üstün tutulur; serverdə owner credential saxlamaq server kompromisi zamanı daha geniş risk yaradır.

Migrations 001–005 və ledger eyni transaction-da tətbiq olunur. Mövcud cədvəllər migration tarixçəsi olmadan əl ilə yaradılıbsa avtomatik üzərinə yazılmır və silinmir; əvvəl tarixçə yoxlanmalıdır. İlk admin artıq varsa prepare heç bir migration və challenge yaratmır.

## Təhlükəsizlik

- Setup token standart olaraq yoxdur və API bağlıdır. Token olmadan DB-yə də müraciət edilmir.
- Origin yoxlanır, kod URL-də və loglarda istifadə edilmir. Cavablar `no-store` olur.
- Enrollment challenge təsadüfi UUID, şifrəli TOTP sirri, setup key hash, 10 dəqiqə expiry və maksimum 5 yanlış cəhdlə saxlanılır. Challenge cədvəli runtime roluna açılmır.
- Yanlış MFA kodunun cəhd sayğacı commit olunur; qeydiyyat yarımçıq qalmır.
- Web və CLI eyni PostgreSQL transaction advisory kilidini paylaşır. Admin mövcudluğu kiliddən sonra yenidən yoxlanır.
- Parola Argon2id ilə hash olunur. Sessiya tokeninin yalnız hash-i DB-yə yazılır. TOTP sayğacı təkrar istifadəni atomik bloklayır.
- Admin, tenant, OWNER üzvlüyü, session və audit birlikdə transaction-da yaranır; xətada hamısı geri qaytarılır.
- Təkrar setup ikinci admin yaratmır və mövcud admini reset etmir. Şifrə/TOTP reset üçün bu yolu istifadə etmə.

## Bu dəyişiklikdə yoxlamalar

40 avtomatik test keçdi, o cümlədən PGlite daxili PostgreSQL mühərrikində schema, rollback, MFA səhv/expiry/limit, birinci hesab, ikinci quraşdırmanın bağlanması, runtime rolunun qadağaları və tenant RLS. Bu, istifadəçinin uzaq veritabanı və pooled connection şərtlərinin təsdiqi deyil. Real Vercel admin hesabı istifadəçi tərəfindən yaradılmalıdır. Tam canlı giriş/MFA yoxlaması bu addımdan sonra aparılır.
