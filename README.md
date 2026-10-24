# VELA · Bazar xəbərləri və ssenariləri

VELA xəbər mənbələrindən gələn məlumatları qəbul etmək, təkrarları ayırmaq, hadisələri qruplaşdırmaq və yoxlanmış AI bazar baxışlarını göstərmək üçün sadə, çox istifadəçili paneldir. Bu buraxılış brokerə qoşulmur və heç bir ticarət əməliyyatı icra etmir.

## Yerli başlatma

1. `npm ci`
2. `.env.example` faylını `.env` kimi kopyala və `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `APP_ORIGIN`, `SECRET_KEY_HEX` dəyərlərini təhlükəsiz şəkildə doldur.
3. PostgreSQL-də yeni cədvəlləri tətbiq et: `npm run migrate`.
4. İlk hesabı təhlükəsiz yaratmaq üçün [quraşdırma təlimatına](docs/SETUP.md) bax.
5. `npm run dev` ilə saytı aç.

Xəbər adapteri seçilmədiyinə görə panel “Xəbər mənbəyi hələ qoşulmayıb” göstərir. Bu mərhələdə canlı xəbər, bazar əhvalı və ya siqnal yoxdur. AI açarı olsa belə, mənbə olmadan analiz çağırılmır.

## Məhsul sərhədi

- Login, sessiya, MFA, tenant RLS və təhlükəsiz ilk quraşdırma qalır.
- Telegram yalnız qısaömürlü `/start` kodu ilə hesab bağlayır və xəbər/ssenari bildirişlərini dəstəkləyir.
- Köhnə MT5, agent, demo idarəsi, broker balansı və ticarət endpointləri 410 qaytarır.
- Migration əvvəlki agent tokenlarını ləğv edir, hesabları dayandırır və yalnız növbədə qalmış CREATED/RESERVED daxili əmrləri bloklayır. Açıq broker mövqeləri, snapshots, deal tarixçəsi və məlumat bazası qeydləri saxlanılır.
- Xəbər axını: adapter → qəbul → təkrar filtri → hadisə qrupu → şema ilə yoxlanan AI təhlili → baxış → panel/Telegram.
- Adapter reyestri qəsdən boşdur. Mənbə və Vercel planı seçildikdən sonra adapter və cron intervalı qoşulmalıdır.

## Yoxlama

`npm run typecheck`, `npm test`. `npm run build` deploy migration scriptini icra etdiyinə görə yerli yoxlamada istifadə etmə; Vercel deployment mühitində migration DB credential mövcud olanda işləyir. Xarici xəbər, AI provider və Telegram bağlantısı real hesablarla yoxlanmayıb.

Ətraflı: [məhsul sərhədi və xəbər pipeline](docs/NEWS_PIPELINE.md), [giriş və ilk hesab](docs/SETUP.md), [əvvəlki Windows trading quruluşunun dayandırılması](docs/VPS_DEMO_SETUP.md).

