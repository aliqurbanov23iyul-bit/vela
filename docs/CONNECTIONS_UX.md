# Sadə bağlantı axını

Əsas menyu Ümumi baxış, Bağlantılar, AI analizləri və Əməliyyatlardır. Risk və fəaliyyət qeydləri Əlavə seçimlərdə, admin müştəriləri yalnız admin menyusunda qalır. Ümumi baxışda boş performans qrafikləri çıxarılıb; hesab metrikləri, həqiqi bağlantı vəziyyətləri və güncəl broker snapshot-dan açıq mövqelər göstərilir. Hesab snapshot-ları görünən səhifədə 15 saniyədə yenilənir.

Bağlantılar səhifəsində MT5, Telegram və son AI analizi bir yerdədir. `/api/connections` yalnız autentifikasiya olunmuş tenant daxilində təhlükəsiz hesab metadatasını və statusları verir; token/hash/şifrə qaytarmır. Heartbeat 90 saniyədən köhnədirsə bağlı statusu göstərilmir. AI kartı son COMPLETED nəticəsinin mövcudluğunu bildirir, provayderin hazırda online olduğuna zəmanət deyil.

MT5 əsas formada hesab nömrəsi və server tələb edir. Hesab qeydi yoxdursa tək göndəriş axını əvvəl qeyd yaradır, sonra bağlantı faylını endirir. UUID və WATCH kimi daxili məlumatlar göstərilmir. Fayl yolu, etiket və broker UTC fərqi Əlavə seçimlərdədir. Mövcud hesabın offset-i market_latest-dən alınır və yeni faylda saxlanır. Yeni hesab üçün default 0-dır; broker fərqi ilkin bağlantıda yoxlanmalıdır. Bağlı hesab əvvəlcə sadə status görünüşü verir; yeni token yalnız istifadəçi açıq yeniləmə etdikdə yaradılır. Rotasiya heartbeat-i sıfırlayır, köhnə balans snapshot-ını silmir; yeni agent həqiqətən məlumat göndərənədək yeni bağlantı təsdiqlənmir.

Telegram-da istifadəçi Bağla seçir, sonra Telegram-da aç linkindən botun Start düyməsinə basır. getMe-dən alınan və yoxlanan bot username-i ilə t.me linki yaradılır. Start payload 22 simvolluq tenant + 22 simvolluq təsadüfi koddur: Telegram-ın 64 simvol və URL-safe simvol tələbinə uyğundur. Webhook köhnə tenant.code əmrlərini də qəbul edir; hər ikisi eyni hash/expiry/private-chat yoxlamalarına tabedir. Link alınmazsa manual komanda alternativi qalır. Admin webhook quraşdırması ayrıca details içindədir. Mövcud əlaqələr səhifəyə girmək və ya statusu oxumaqla dəyişmir.

Müştərilər üçün avtomatik ticarət aktivləşdirilməsi bu UX dəyişikliyinə daxil deyil. Autentifikasiya, tenant izolyasiyası və əməliyyat icra məhdudiyyətləri saxlanır.

## Müştəri və AI ayarları

İlk girişdə hesabı olmayan müştəri MT5 və istəyə bağlı Telegram addımlarını görür. Müştəri AI səhifəsində EURUSD/XAUUSD seçir, 15/30/60 dəqiqə intervalını xidmətin minimumu daxilində dəyişir və yeni AI analizlərinə fasilə verir. Bu seçimlər real claim axınında yoxlanır; balans və qiymət ötürülməsini dayandırmır. API açarı və model seçimi müştəridən tələb olunmur.

008 migration tenant üzrə RLS ilə ai_preferences və mərkəzi ai_service_settings əlavə edir. Mərkəzi model, provayder sırası və limitlər yalnız son 15 dəqiqədə MFA ilə təsdiqlənmiş superadmin sessiyası ilə SECURITY DEFINER funksiyasından dəyişir. API açarları yalnız mühit dəyişənlərində qalır. Müştəriyə provider/model/failure diaqnostikası qaytarılmır.

Windows paketi public/vela-windows-agent.zip daxilində yalnız altı açıq mənbə faylı saxlayır. scripts/package-agent.py ilə agent mənbəyi dəyişəndə yenidən hazırlanmalıdır. Şəxsi bağlantı faylı daxil edilmir. Bu imzalanmış quraşdırıcı deyil; Windows, MT5 demo və Python 3.12–3.14 x64 tələb edir (təlimatda 3.13 tövsiyə olunur). İlk açılış PyPI paketlərini yükləyir. Kompüter, MT5 və bağlantı pəncərəsi açıq qalmalıdır.
