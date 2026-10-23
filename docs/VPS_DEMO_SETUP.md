# Yerli Windows kompüterində VELA DEMO

VELA saytı telefon və brauzerdən idarəetmə üçündür. Bazar məlumatı və MT5 demo əmrləri sənin Windows kompüterindəki connector-da işləyir. Kompüter söndürüləndə və ya connector dayananda yeni giriş mümkün deyil. Bunun üçün VPS lazım deyil.

## İlk dəfə qur

1. Bu kompüterdə MT5 terminalı `C:\Program Files\MetaTrader 5\terminal64.exe` yolunda, Python mühiti isə `agent/.venv` daxilində tapıldı. `MetaTrader5` və `requests` paketləri mövcuddur.
2. MT5-i aç, demo hesabına daxil ol və broker bağlantısının qurulduğunu yoxla. Parolu VELA-ya və ya söhbətə yazma.
3. Saytda **Hesablar & MT5** bölməsində hesab nömrəsini, broker serverini və `terminal64.exe` yolunu daxil et. Şəxsi `vela-connection.json` faylını endir. Faylda gizli bağlantı açarı var; paylaşma.
4. Kök qovluqdakı **VELA Başlat.cmd** faylına iki dəfə bas. İlk dəfə açılan pəncərədə JSON fayлаа сонго; VELA onu cari Windows hesabına DPAPI ilə şифрлэж `%LOCALAPPDATA%\VELAConnector\connection.dat` daxilində saxlayır. Endirdiyin JSON-u sonra Downloads-dan özün silə bilərsən.
5. Başladıcı MT5 demo hesabını və serveri tutuşdurur, heç bir broker sifarişi göndərmir. Saytda təzə heartbeat/hesab məlumatı görünəndən sonra demo sınağını başlat.
6. MT5-də **Algo Trading** və `Options → Expert Advisors → Allow algorithmic trading` aktiv olmalıdır. Bağlıdırsa, agent girişləri bloklayır.

## Gündəlik istifadə

Əvvəl MT5-i demo hesabla açıq saxla. Sonra **VELA Başlat.cmd**-ə iki dəfə bas; saytda bağlantının təzə və aktiv olduğunu yoxla. Daha sonra saytdan AUTO və ya Telegram təsdiqi rejimində demo sessiyasını başlat. Siqnal uyğun gəlməsə, bot giriş etməyə bilər.

Dayandırmaq üçün **VELA Dayandır.cmd**-ə iki dəfə bas. Bu, yeni girişləri bloklayır, agenti cari təhlükəsiz əməliyyatdan sonra bağlayır və açıq mövqelərə toxunmur. Sayt serverə stop-un çatmadığını bildirsə, internet bərpa olunanda saytdakı **Dayandır** düyməsini də bas. Açıq mövqelər qalır; kompüteri söndürməzdən əvvəl MT5-də onları özün шалгаж, idarə et.

## Bu yoxlamanın nəticəsi

MT5 terminal faylı və Python kitabxanaları bu kompüterdə байна, amma шалгах үед MT5 процесс açıq deyildi; VELA холбоосын JSON ч байхгүй байлаа. Buna görə broker login-i, sayt heartbeat-i, canlı bazar məlumatı, analiz və AUTO/Telegram iş axını bu yoxlamada təsdiqlənməyib. MT5-i açıb demo hesaba daxil ol və saytdan şəxsi JSON-u endir. Real hesab əmrləri bloklanır.

Sayt statusu Vercel-dən gəlir. Agent serverə təxminən hər 15 saniyədə məlumat verir; 45 saniyədən köhnə heartbeat aktiv bağlantı sayılmır. Başlatma sorğusu 60 saniyə ərzində təsdiqlənməzsə, sayt agent/kompüter bağlantısı olmadığını göstərməlidir.
