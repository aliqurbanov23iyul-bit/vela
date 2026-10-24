# Əvvəlki VELA Windows/MT5 quruluşu dayandırılıb

Bu təlimat tarixi qeyd kimi saxlanılır. Cari VELA artıq MT5-ə qoşulmur və demo və ya real əməliyyat açmır. Vercel-ə köhnə VELA agentini quraşdırmaq, `VELA Başlat/Dayandır` fayllarını işlətmək, `MT5_*` sirrlərini əlavə etmək və Redis worker başlatmaq lazım deyil.

Yeni migration əvvəlki agent tokenlarını ləğv edir, serverdə broker hesablarını dayandırır və ticarət endpointlərini HTTP 410 ilə bağlayır. Açıq MT5 mövqelərini bu migration bağlamır və onlara toxunmur. Köhnə VELA proqramı hazırda açıqdırsa, onu sistem tray menyusundan **Çıxış** seçərək bağla. MT5 terminalını və açıq broker mövqelərini dəyişmək tələb olunmur. Köhnə installer yeni məhsul üçün istifadə edilməməlidir.

Ətraflı məlumat: [NEWS_PIPELINE.md](NEWS_PIPELINE.md) sənədindəki “Trading decommission” bölməsi.

