VELA - Windows demo connection

1. Install MetaTrader 5 and sign in to your DEMO account.
2. Install Python 3.13 (64-bit) from python.org if it is not installed.
3. In VELA > Connections, download your personal connection file.
4. Extract this ZIP to a folder. Open Start-VELA.cmd.

The first launch installs MetaTrader5 and requests from PyPI into a local .venv.
An internet connection is required. Your MT5 password is never requested.
The newest vela-connection*.json in Downloads (or this folder) is selected.
Never share that private connection file.

Keep this window, MT5 and your computer running. To stop the connector, close
the window. This version reads DEMO account data and sends market observations;
it does not send trading orders. It is not a signed standalone Windows installer.

If setup fails, check Python 3.13 64-bit, your internet connection, and MT5 login.
The ZIP contains public source files only, not passwords or API keys.
