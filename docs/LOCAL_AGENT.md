# Yerli demo MT5 bağlantısı

MT5 Windows kompüterində açıq və demo hesaba daxil olmalıdır. Saytda **Hesaplar & MT5 → MT5-i kompüterimə bağla** seçin, hesabı, MT5 Login nömrəsini, serveri və terminal64.exe yolunu yoxlayın. Bağlantı faylını endirin; bu yalnız daxil olmuş hesab sahibinə açıqdır. Tenant istifadəçidən qəbul edilmir, sessiyadan alınır. Token serverdə yalnız hash kimi saxlanır. Yenidən endirmə əvvəlki tokeni ləğv edir. Şifrə sayta ötürülmür.

`vela-connection.json` məxfi fayldır, paylaşmayın və GitHub-a yükləməyin. Agent üçün `agent/.venv` Python mühiti və `agent/requirements.txt` paketləri quraşdırılmalıdır. Sonra kök qovluqdakı **Start-VELA.cmd** açılır. Standart fayl yeri Windows Downloads/vela-connection.json-dır. Başqa yer üçün `agent/start.ps1 -ConfigPath "C:\path\vela-connection.json"` istifadə olunur.

Agent yalnız demo hesabdan 15 saniyədə bir balans, equity, margin, açıq pozisiya və gözləyən əmrləri sayta ötürür. Login/server uyğunsuzluğu və ya real hesab olduqda dayanır. Broker sifarişi göndərən funksiya yoxdur. Kompüter, MT5, agent və internet açıq qalmalıdır. Bu mərhələ şam tarixçəsi, avtomatik analiz və ya avtomatik ticarət mühərriki deyil. Uğurlu POST cavabı və saytda real heartbeat görünmədən bağlantı tamamlanmış sayılmır.
