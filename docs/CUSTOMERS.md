# Admin və müştəri hesabları

İlk admin yalnız bir dəfə `/setup` ilə yaradılır. Sonra giriş ekranında **Admin girişi** seçilir; istifadəçi adı, şifrə və authenticator kodu ilə daxil olunur. Müştərilər **Kullanıcı girişi** seçib yalnız adminin verdiyi istifadəçi adı və şifrə ilə daxil olur. Tenant UUID avtomatik serverdə seçilir; müştəriyə UUID vermək lazım deyil.

## Admin paneli

- Admin sessiyasında solda **Kullanıcılar** görünür. Müştərilərdə bu bölmə görünmür və API də onlara qapalıdır.
- **Yeni kullanıcı ekle**: ad soyad (istəyə bağlı), istifadəçi adı və ən azı 16 simvolluq şifrə. Müştəri ayrı tenant/OWNER üzvlüyü ilə yaradılır; super admin deyil. Admin yalnız yaratdığı və ayrıca grant verilmiş tenantları görür.
- Şifrə serverdə Argon2id ilə hash olunur; siyahı və profildə göstərilmir. Admin özü seçdiyi şifrəni müştəriyə təhlükəsiz kanalla verir. Şifrə reset və açıq qeydiyyat bu axına daxil deyil.
- Siyahıda ad/username, girişin aktiv/askıda olması və MT5 hesab sayı göstərilir. Axtarış və 20 sətirlik səhifələmə var.
- Profil real broker snapshot-dan bakiye, equity, margin, free margin, açıq pozisiyalar və gözləyən əmrləri göstərir. Currency ayrı saxlanılır; fərqli valyutalar toplanmır. Köhnə snapshot açıq işarələnir; əlaqəsiz hesab uğurla bağlı kimi təqdim edilmir.
- Kapanmış deal tarixçəsi və hesablanmış P&L ledger-i hələ brokerdən eşitlenmir. Profil bunu bildirir; həmin rəqəmlər uydurulmur. MT5 agenti və broker həqiqətən bağlanmadan istifadəçinin əməliyyatları görünməyəcək.
- **Erişimi durdur** ayrıca təsdiq tələb edir, istifadəçini/tenantı askıya alır, sessiyaları ləğv edir və CREATED/RESERVED girişləri bloklayır. Açıq pozisiyaları bağlamır. Erişimi yenidən açmaq stop bayraqlarını və canlı icazəni avtomatik açmır.
- Hesab yaratma və erişim dəyişmə üçün adminin son 15 dəqiqədə doğrulanmış girişi lazımdır. Vaxt keçibsə çıxış edib yenidən admin girişi edilir. Oxuma üçün aktiv admin sessiyası yetərlidir.

## İcazə modeli

Migration 006 `admin_tenant_grants` qovluğu və dar SECURITY DEFINER funksiyaları yaradır. Runtime roluna istifadəçi/səlahiyyət cədvəllərini birbaşa dəyişmək icazəsi verilmir. Funksiyalar sabit search_path istifadə edir; çağırışda təqdim edilən orijinal sessiya tokenini DB-də SHA-256 ilə hash edib, müddət/disabled/super_admin/MFA vəziyyətini yoxlayır. Veritabanından sızmış session hash funksiyalara giriş üçün kifayət etmir.

Müştəri ID-si təkbaşına yetki vermir. Profil və status əməliyyatları həm admin kimliyini, həm tenant grantını yoxlayır. Başqa super adminə bütün müştərilər avtomatik açılmır. Admin baxışları müştərinin tenant audit-inə yazılır. Broker parolası, agent token hash, MFA sirri və password hash profil cavabına çıxarılmır; snapshot-dakı mövqelər/əmrlər yalnız icazəli sahələrdən qurulur. Yeni müştəri yaratmaq canlı əməliyyat icazəsi vermir.

## Deploy və migration

`npm run build` əvvəl `scripts/deploy-migrate.ts` işlədir. Yalnız `VERCEL=1` və `VERCEL_ENV=production` olduqda artıq qurulmuş bazaya pending migration-lar transaction-da tətbiq olunur. Boş baza `/setup` üçün saxlanılır; preview/local build bazanı dəyişmir. Bağlantı seçimi: MIGRATION_DATABASE_URL → DATABASE_URL_UNPOOLED → DATABASE_URL. Migration sahibi CREATE/ALTER/FUNCTION icazələrinə malik olmalıdır. Hazır sxema olub ledger yoxdursa deploy durur; mövcud data silinmir. Məhdud runtime bağlantısı istifadə edən operator ayrıca migration bağlantısını deployment mühitində saxlamalıdır. Schema dəyişikliklərini build-də etmək komandanın release prosedurunda nəzərə alınmalıdır.

## Yoxlamalar

Daxili PostgreSQL/PGlite testləri: admin/user/anonymous yetkiləri, yeni müştərinin ayrı tenantı, duplicate username rollback, başqa adminin grant olmadan erişə bilməməsi, session hash ilə impersonation-a qarşı yoxlama, profil sırlarının redaksiyası, 15 dəqiqə reauth sərhədi, askıya alma/session revoke/queued order bloklanması, açıq pozisiyaların qorunması və audit. Bunlar real broker inteqrasiyası deyil. Əsl müştəri yaratmaq və MT5 məlumatı ilə yoxlama istifadəçinin canlı girişi/agent bağlantısını tələb edir.
