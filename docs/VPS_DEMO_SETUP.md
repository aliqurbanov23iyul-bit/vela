# Yerli Windows kompüterində VELA DEMO

VELA saytı telefon və brauzerdən idarəetmə üçündür. Bazar məlumatı və MT5 demo əmrləri sənin Windows kompüterindəki connector-da işləyir. Kompüter söndürüləndə və ya connector dayananda yeni giriş mümkün deyil. Bunun üçün VPS lazım deyil.

## İlk dəfə qur

1. [VELA-Setup.exe proqramını](https://github.com/aliqurbanov23iyul-bit/vela/releases/latest) endir, aç və **Quraşdır və aç** düyməsinə bas. Python layihə qovluğundan ayrıca quraşdırılmalı deyil.
2. MT5-i aç, demo hesabına daxil ol və broker bağlantısının qurulduğunu yoxla. Parolu VELA-ya və ya söhbətə yazma.
3. Saytda **Hesablar & MT5** bölməsində hesab nömrəsini, broker serverini və `terminal64.exe` yolunu daxil et. Şəxsi `vela-connection.json` faylını endir. Faylda gizli bağlantı açarı var; paylaşma.
4. Masaüstündəki VELA ikonunu aç. **Bağlantı faylını seç və ya dəyiş** düyməsi ilə JSON faylını seç. VELA onu cari Windows hesabına məxsus DPAPI ilə şifrələyib saxlayır; endirdiyin JSON-u sonra Downloads-dan özün silə bilərsən.
5. MT5 demo hesabı açıqkən **VELA-nı başlat** düyməsinə bas. Başladıcı hesabı və serveri yoxlayır, broker əmri göndərmir. Saytda təzə heartbeat və hesab məlumatı görünənədək demo sessiyası başlatma.
6. MT5-də **Algo Trading** və `Options → Expert Advisors → Allow algorithmic trading` aktiv olmalıdır. Bağlıdırsa, agent girişləri bloklayır.

## Gündəlik istifadə

MT5-i demo hesabla açıq saxla və VELA proqramını aç. Connector-u yalnız istifadə etmək istədiyin saatlarda **VELA-nı başlat** düyməsi ilə işə sal. Saytda təzə bağlantı görünəndə demo rejimini seç. Əməliyyat başlamazdan əvvəl hesab, simvol, lot və maksimum riski nəzərdən keçir; Telegram təsdiq rejimi əməliyyat təklifini ayrıca göstərir.

Bitirəndə **VELA-nı dayandır** düyməsinə bas. Bu, yeni girişləri bloklayır, lokal agenti təhlükəsiz dayandırır və internet varsa saytdakı demo sessiyasına da stop göndərir. Açıq mövqelər bağlanmır; kompüteri söndürməzdən əvvəl MT5-də onları ayrıca yoxla. Sonra proqramı saatın yanındakı VELA ikonundan **Çıxış** ilə bağlaya bilərsən.

## Bu kompüterdə yoxlanmış vəziyyət

MT5 terminal faylı və Python kitabxanaları mövcuddur. Yoxlama zamanı MT5 açıq deyildi və VELA bağlantı JSON-u tapılmadı. Buna görə broker login-i, sayt heartbeat-i, canlı bazar məlumatı və analiz hələ təsdiqlənməyib. MT5-i açıb demo hesaba daxil ol və saytdan şəxsi JSON-u endir. Real hesab əmrləri bloklanır.

Sayt statusu Vercel-dən gəlir. Agent serverə təxminən hər 15 saniyədə məlumat verir; 45 saniyədən köhnə heartbeat aktiv bağlantı sayılmır. Başlatma sorğusu 60 saniyə ərzində təsdiqlənməzsə, sayt agent/kompüter bağlantısında problem olduğunu göstərməlidir.
