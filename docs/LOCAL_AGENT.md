# Yerli demo MT5 bağlantısı

MT5 Windows kompüterində açıq və demo hesaba daxil olmalıdır. Saytda **Hesablar & MT5 → MT5-i kompüterimə bağla** seçin, hesabı, MT5 login nömrəsini, serveri və `terminal64.exe` yolunu yoxlayın. Bağlantı faylını endirin; bu yalnız daxil olmuş hesab sahibinə açıqdır. Tenant istifadəçidən qəbul edilmir, sessiyadan alınır. Token serverdə hash kimi saxlanır. Yenidən endirmə əvvəlki tokeni ləğv edir. MT5 parolu sayta ötürülmür.

`vela-connection.json` məxfi fayldır; paylaşmayın və GitHub-a yükləməyin. Python mühiti və paketləri `agent/.venv` daxilindədir. Kök qovluqdakı **VELA Başlat.cmd**-ə iki dəfə basın. İlk dəfə açılan fayl seçmə pəncərəsində saytdan endirilmiş JSON-u seçin. Sonrakı istifadələrdə bağlantı cari Windows istifadəçisinə DPAPI ilə şifrələnmiş yerli nüsxədən oxunur.

Agent demo hesab məlumatlarını və bazar müşahidələrini sayta ötürür. Saytın aktiv etdiyi AUTO/TELEGRAM demo sessiyası agentə qayıdır; `agent/demo_pilot.py` yalnız təzə siqnal, xəbər qiymətləndirməsi, MT5 icazəsi və deterministik risk yoxlamaları keçdikdə demo əmri göndərə bilər. Login/server uyğunsuzluğu və real hesab bloklanır. Agent yalnız yerli Windows kompüterində işləyir. **VELA Dayandır.cmd** yeni əmrləri bloklayıb agenti təhlükəsiz bağlayır; açıq mövqeləri bağlamır. Uğurlu POST cavabı və saytda təzə heartbeat görünmədən bağlantı hazır sayılmır.
