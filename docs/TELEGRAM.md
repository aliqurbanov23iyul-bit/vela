# Telegram bağlantısı və qərarlar

Vercel Production dəyişənləri: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (təsadüfi, yalnız A–Z/a–z/0–9/_/-, maksimum 256 simvol) və `APP_ORIGIN=https://velatradingbot.vercel.app`.

Admin daxil olub Telegram bölməsində **Bot bağlantısını qur** seçir. Bu, Telegram `setWebhook` çağırışında `/api/telegram/webhook` HTTPS ünvanını və gizli header kodunu qeydiyyata alır. Bot tokenı brauzerə verilmir. Bunu hər müştəri üçün təkrarlamaq lazım deyil; bot bütün tenantlar üçün ortaqdır.

İstifadəçi **Bağlantı kodu yarat** seçir, 5 dəqiqəlik `/start tenant.code` əmrini botun xüsusi söhbətinə göndərir. Bot ✅ təsdiq, username və vəziyyət düyməsi göndərir. Sayt həm Telegram bölməsində, həm ümumi baxışda verilənlər bazasındakı təsdiqlənmiş bağlantını göstərir və görünən səhifədə hər 5 saniyədə yoxlayır. Status botun bloklanmadığına və ya brokerin online olduğuna zəmanət deyil.

Telegram bölməsində mövcud, vaxtı bitməmiş proposal-lar **Telegram-a göndər** ilə göndərilir. API yalnız mövcud tenant proposal-ını qəbul edir; istifadəçi mesajdan qiymət və ya həcm dəyişdirə bilməz. İstifadəçiyə məxsus approval yaradılır; mesajda hesab, simvol, istiqamət, giriş/SL/TP/həcm, UTC son vaxtı və ✅/❌ düymələri var. Qərar atomik bir dəfə qəbul edilir. Köhnə/başqa tenant/başqa user callback-ləri rədd edilir. Qərardan sonra söhbətə nəticə göndərilir, köhnə düymələr silinir, sayt son qərarları yeniləyir.

Webhook cavabı audit ilə eyni transaction-da saxlanır. Telegram-a çatdırılma alınmazsa HTTP 503 ilə retry istənir; təkrar update qərarı yenidən tətbiq etmir. Çatdırılma ilə audit işarələnməsi arasında şəbəkə xətası eyni mesajı təkrar göstərə bilər (Telegram sendMessage idempotency açarı təqdim etmir), amma qərarı və ya əmri təkrar icra etmir. Təklifin manual göndərilməsi də uğursuz şəbəkə nəticəsində eyni approval düymələri ilə təkrarlana bilər.

Bu dəyişiklik AI proposal generatorunu və avtomatik proposal bildiriş worker-ini yaratmır. Hazırkı tətbiqdə canlı order icrası bağlıdır: təsdiq yalnız qərarı saxlayır. Bot mesajları broker əməliyyatının icrasını iddia etmir. Həqiqi bot tokenı/webhook hesabı olmadan end-to-end çatdırılma təsdiqlənməyib.

Bot API mənbəyi: https://core.telegram.org/bots/api
