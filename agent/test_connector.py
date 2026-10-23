import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from connector_core import (validate_config, read_config, save_config, load_config,
                            ConnectionStatus, classify_error, protect)


def example():
    return dict(APP_ORIGIN='https://velatradingbot.vercel.app', MT5_LOGIN='123456',
                MT5_SERVER='MetaQuotes-Demo', MT5_TERMINAL_PATH=r'C:\Program Files\MetaTrader 5\terminal64.exe',
                MT5_ACCOUNT_ID='00000000-0000-4000-8000-000000000001',
                MT5_TENANT_ID='00000000-0000-4000-8000-000000000002',
                MT5_AGENT_TOKEN='test_' + 'a'*43, MT5_BROKER_UTC_OFFSET_MINUTES='180')


class ConnectorTests(unittest.TestCase):
    def test_installer_shortcut_failure_does_not_block_launch(self):
        import desktop
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / '.desktop-build') as tmp:
            with patch.object(desktop, 'FROZEN', True), patch.object(desktop, 'ROOT', Path(tmp)), \
                 patch.object(desktop, 'INSTALLED', Path(tmp) / 'VELA.exe'), \
                 patch.object(desktop.shutil, 'copy2'), \
                 patch.object(desktop, 'create_shortcut', side_effect=OSError('shortcut unavailable')), \
                 patch.object(desktop.subprocess, 'Popen') as launch:
                self.assertFalse(desktop.install())
                launch.assert_called_once()
                self.assertEqual(launch.call_args.kwargs['env']['PYINSTALLER_RESET_ENVIRONMENT'], '1')

    def test_installer_identifies_copy_and_windows_launch_failure(self):
        import desktop
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / '.desktop-build') as tmp:
            with patch.object(desktop, 'FROZEN', True), patch.object(desktop, 'ROOT', Path(tmp)), \
                 patch.object(desktop, 'INSTALLED', Path(tmp) / 'VELA.exe'), \
                 patch.object(desktop.shutil, 'copy2', side_effect=PermissionError(13, 'private path')):
                with self.assertRaises(desktop.InstallError) as caught:
                    desktop.install()
                self.assertEqual(caught.exception.stage, 'COPY')
                self.assertNotIn('private path', str(caught.exception))
            blocked = OSError('Windows signing policy')
            blocked.winerror = 577
            with patch.object(desktop, 'FROZEN', True), patch.object(desktop, 'ROOT', Path(tmp)), \
                 patch.object(desktop, 'INSTALLED', Path(tmp) / 'VELA.exe'), \
                 patch.object(desktop.shutil, 'copy2'), patch.object(desktop, 'create_shortcut'), \
                 patch.object(desktop.subprocess, 'Popen', side_effect=blocked):
                with self.assertRaises(desktop.InstallError) as caught:
                    desktop.install()
                self.assertEqual((caught.exception.stage, caught.exception.code), ('OPEN', 577))

    def test_native_shortcut_can_be_created_without_powershell(self):
        import desktop
        import sys
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / '.desktop-build') as tmp:
            target = Path(tmp) / 'VELA-test.lnk'
            desktop.create_shortcut(sys.executable, target)
            self.assertTrue(target.is_file())

    def test_desktop_entry_import_has_no_ui_or_connection_side_effects(self):
        import desktop
        self.assertFalse(desktop.FROZEN)

    def test_stop_ignores_buffered_ack_and_waits_for_worker_exit(self):
        import desktop
        import queue
        from unittest.mock import Mock
        app = desktop.Desktop.__new__(desktop.Desktop)
        app.root = Mock()
        app.events = queue.Queue()
        app.status = ConnectionStatus()
        app.status.started()
        app.status.stopped('Stopping')
        app.process = object()
        app.stopping = True
        app.quitting = False
        app.generation = 2
        app.tray = None
        app.last_clock_ack = None
        for key in ('connect_button', 'stop_button', 'indicator', 'status_label', 'message', 'time_text'):
            setattr(app, key, Mock())
        app.events.put(('ack', 2, ''))
        app.events.put(('exit', 1, ''))  # an old worker cannot affect the current one
        app.poll()
        self.assertFalse(app.status.connected())
        self.assertIsNotNone(app.process)
        app.events.put(('exit', 2, ''))
        app.poll()
        self.assertIsNone(app.process)
        self.assertFalse(app.stopping)

    def test_tray_exit_event_completes_quit_instead_of_losing_poll_loop(self):
        import desktop
        import queue
        from unittest.mock import Mock
        app = desktop.Desktop.__new__(desktop.Desktop)
        app.root = Mock()
        app.events = queue.Queue()
        app.process = None
        app.quitting = False
        app.tray = Mock()
        app.events.put(('quit', 0, ''))
        app.poll()
        app.root.destroy.assert_called_once()
        app.tray.stop.assert_called_once()
        self.assertTrue(app.quitting)

    def test_origin_and_credentials_validated_before_import(self):
        for change in [dict(APP_ORIGIN='https://example.com'), dict(MT5_LOGIN='1&bad'),
                       dict(MT5_TENANT_ID='invalid'), dict(MT5_AGENT_TOKEN='short'),
                       dict(MT5_BROKER_UTC_OFFSET_MINUTES='181')]:
            with self.assertRaises(ValueError):
                validate_config(dict(example(), **change))
        self.assertNotIn('unexpected', validate_config(dict(example(), unexpected='ignored')))

    def test_oversized_file_rejected(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / '.desktop-build') as tmp:
            path = Path(tmp) / 'config.json'
            path.write_text(' ' * 32769)
            with self.assertRaises(ValueError):
                read_config(path)

    def test_current_user_encrypted_storage_roundtrip(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / '.desktop-build') as tmp:
            path = Path(tmp) / 'connection.dat'
            save_config(path, example())
            self.assertNotIn(example()['MT5_AGENT_TOKEN'].encode(), path.read_bytes())
            self.assertEqual(load_config(path), example())
            self.assertFalse(path.with_suffix('.tmp').exists())

    def test_corrupt_encrypted_storage_fails(self):
        with self.assertRaises(OSError):
            protect(b'not encrypted', decrypt=True)

    def test_connected_requires_recent_acknowledgment_and_running_worker(self):
        status = ConnectionStatus()
        status.started()
        self.assertFalse(status.connected(100))
        status.acknowledge(100)
        self.assertTrue(status.connected(144))
        self.assertFalse(status.connected(145))
        status.stopped('Stopped')
        self.assertFalse(status.connected(101))

    def test_error_classification_does_not_return_exception_text(self):
        secret = 'private_token_do_not_show'
        self.assertEqual(classify_error(RuntimeError(secret)), 'UNKNOWN')
        self.assertEqual(classify_error(RuntimeError('Terminal disconnected ' + secret)), 'TERMINAL')
        self.assertEqual(classify_error(RuntimeError('Account identity mismatch')), 'IDENTITY')
        import requests
        response = requests.Response()
        response.status_code = 403
        self.assertEqual(classify_error(requests.HTTPError(secret, response=response)), 'AUTH')

    def test_agent_cooperatively_stops_without_trading_or_terminating_terminal(self):
        import threading
        import main
        event = threading.Event()
        calls = []
        class Account:
            login=123456; server='MetaQuotes-Demo'; trade_mode=0; currency='USD'
            balance=1000; equity=1000; margin=0; margin_free=1000
        class Terminal:
            connected=True
        class Response:
            def raise_for_status(self): pass
        env = {k: v for k, v in example().items()}
        def ack():
            calls.append('ack')
            event.set()
        with patch.dict('os.environ', env), patch.object(main.mt5, 'initialize', return_value=True), \
             patch.object(main.mt5, 'account_info', return_value=Account()), \
             patch.object(main.mt5, 'terminal_info', return_value=Terminal()), \
             patch.object(main.mt5, 'positions_get', return_value=[]), \
             patch.object(main.mt5, 'orders_get', return_value=[]), \
             patch.object(main.mt5, 'shutdown') as shutdown, \
             patch.object(main.mt5, 'order_send') as order, \
             patch.object(main, 'collect_market', side_effect=RuntimeError('test')), \
             patch.object(main.requests, 'post', return_value=Response()) as post:
            main.run(stop_event=event, on_snapshot=ack)
            self.assertEqual(calls, ['ack'])
            self.assertEqual(post.call_count, 1)
            shutdown.assert_called_once()
            order.assert_not_called()


if __name__ == '__main__':
    unittest.main()
