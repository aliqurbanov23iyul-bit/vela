VELA Connector · Windows x64

Download the latest VELA-Setup.exe from https://github.com/aliqurbanov23iyul-bit/vela/releases/latest. Open it and choose “Quraşdır və aç”. The installer runs only for your Windows user and adds a desktop shortcut. Python is included; no CMD or separate Python installation is needed.

Open MetaTrader 5 and sign into your DEMO account. In VELA, select your private connection JSON downloaded from the website, then choose “VELA-nı başlat”. Opening the program does not start the connector; you start it only when you press the button. The green status requires a successful, recent server acknowledgment.

Choose “VELA-nı dayandır” to block new entries, stop the local connector, and request a stop for the website demo session. Open MT5 positions are not closed. Closing the window keeps VELA in the system tray; right-click its icon and choose “Çıxış” after stopping. MT5 itself is not terminated.

The website's “Sürətli TEST” mode requires connector version 1.4.4 or later. It uses closed one-minute candles, sends each proposed demo entry to Telegram for approval, and requests an automatic close after 60 seconds. If the market data is stale, the quote is unavailable, or the session is stopped, it will not open a new entry. Existing demo risk and one-position safeguards remain enabled.

Your imported credential is stored with Windows current-user DPAPI encryption. Never share the original JSON, which remains in Downloads until you remove it yourself. No personal config or keys are included in this installer.

This build is unsigned. Windows may display an unknown-publisher warning; there is no certificate or SmartScreen reputation yet. SHA256SUMS.txt identifies the exact release build. Keep the computer, MT5 and VELA running while you want the connector online.
