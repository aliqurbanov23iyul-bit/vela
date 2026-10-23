"""VELA Windows desktop entry point with one cooperative read-only MT5 thread."""
import argparse
import ctypes
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from connector_core import (ORIGIN, CONFIG_KEYS, read_config, validate_config, save_config,
                            load_config, ConnectionStatus, ERROR_MESSAGES, classify_error, safe_diagnostic)

ROOT = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'VELAConnector'
CONFIG_PATH = ROOT / 'connection.dat'
INSTALLED = ROOT / 'VELA.exe'
FROZEN = bool(getattr(sys, 'frozen', False))
NO_WINDOW = 0x08000000
VERSION = '1.3.0'


def record_status(event, error=None):
    # Last event only, bounded and credential-free; safe for support to inspect.
    from datetime import datetime, timezone
    data = {'version': VERSION, 'event': event, 'at': datetime.now(timezone.utc).isoformat()}
    if error is not None:
        data.update(safe_diagnostic(error))
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        (ROOT / 'connection-status.json').write_text(json.dumps(data), encoding='utf-8')
    except OSError:
        pass


def startup_enabled():
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
            value, _ = winreg.QueryValueEx(key, 'VELAConnector')
            return value == '"' + str(INSTALLED) + '" --background'
    except OSError:
        return False


def set_startup(enabled):
    import winreg
    if enabled and (not FROZEN or Path(sys.executable).resolve() != INSTALLED.resolve()):
        raise ValueError('INSTALL_FIRST')
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
        if enabled:
            winreg.SetValueEx(key, 'VELAConnector', 0, winreg.REG_SZ, '"' + str(INSTALLED) + '" --background')
        else:
            try:
                winreg.DeleteValue(key, 'VELAConnector')
            except FileNotFoundError:
                pass


class InstallError(Exception):
    def __init__(self, stage, error):
        self.stage = stage
        self.code = getattr(error, 'winerror', None) or getattr(error, 'errno', None) or 0
        super().__init__(stage)


def create_shortcut(executable, destination=None):
    # Native Windows COM, including redirected OneDrive desktop locations.
    # No PowerShell, shell commands, or dynamically generated scripts.
    import pythoncom
    from win32com.shell import shell, shellcon
    if destination is None:
        destination = Path(shell.SHGetFolderPath(0, shellcon.CSIDL_DESKTOPDIRECTORY, None, 0)) / 'VELA.lnk'
    # WScript.Shell.Save can convert non-ASCII desktop paths to the system ANSI
    # codepage. IShellLinkW + IPersistFile keep Azerbaijani/Turkish paths intact.
    shortcut = pythoncom.CoCreateInstance(shell.CLSID_ShellLink, None,
                                         pythoncom.CLSCTX_INPROC_SERVER, shell.IID_IShellLink)
    shortcut.SetPath(str(executable))
    shortcut.SetWorkingDirectory(str(Path(executable).parent))
    shortcut.SetIconLocation(str(executable), 0)
    shortcut.QueryInterface(pythoncom.IID_IPersistFile).Save(str(destination), 0)
    if not Path(destination).is_file():
        raise OSError('SHORTCUT_NOT_CREATED')


def install():
    """Per-user installation only. No elevation, startup permission, or connection import."""
    if not FROZEN:
        raise ValueError('BUILD_REQUIRED')
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        if Path(sys.executable).resolve() != INSTALLED.resolve():
            shutil.copy2(sys.executable, INSTALLED)
    except OSError as error:
        raise InstallError('COPY', error) from error
    shortcut_ok = True
    try:
        create_shortcut(INSTALLED)
    except Exception:
        shortcut_ok = False  # optional shortcut must not prevent opening the app
    env = dict(os.environ)
    env['PYINSTALLER_RESET_ENVIRONMENT'] = '1'
    try:
        subprocess.Popen([str(INSTALLED)], env=env, creationflags=NO_WINDOW, close_fds=True)
    except OSError as error:
        raise InstallError('OPEN', error) from error
    return shortcut_ok


def acquire_instance():
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel.CreateMutexW(None, False, 'Local\\VELAConnectorDesktopV1')
    if not handle:
        raise OSError('INSTANCE_CHECK_FAILED')
    if ctypes.get_last_error() == 183:
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel.CloseHandle(handle)
        return None
    return handle  # keep the kernel handle alive until process exit


class Desktop:
    def __init__(self, background=False, testing=False):
        import tkinter as tk
        from tkinter import ttk
        self.tk = tk
        self.root = tk.Tk()
        self.root.title('VELA · Hesab bağlantısı · ' + VERSION)
        self.root.geometry('660x810')
        self.root.minsize(580, 760)
        self.root.configure(bg='#f3f7ff')
        if testing:
            self.root.withdraw()
        self.events = queue.Queue()
        self.status = ConnectionStatus()
        self.process = None
        self.stop_event = threading.Event()
        self.stopping = False
        self.generation = 0
        self.tray = None
        self.account = None
        self.quitting = False
        self.last_clock_ack = None
        self.message = tk.StringVar(value=self.status.message)
        self.indicator = tk.StringVar(value='●  Bağlanmayıb')
        self.account_text = tk.StringVar(value='Hələ hesab seçilməyib')
        self.time_text = tk.StringVar(value='Son məlumat: —')
        self.startup = tk.BooleanVar(value=False if testing else startup_enabled())
        self.demo_text = tk.StringVar(value='Botu saytda Ümumi baxışdan başlat.')
        self._build(ttk)
        self.root.protocol('WM_DELETE_WINDOW', self.hide)
        if testing:
            return
        self._start_tray()
        try:
            config = load_config(CONFIG_PATH)
            self.set_account(config)
        except FileNotFoundError:
            pass
        except Exception:
            self.message.set(ERROR_MESSAGES['CONFIG'])
        if background and self.tray:
            self.root.withdraw()
        # Opening VELA reconnects its existing imported account. Windows login
        # autostart remains a separate, explicit opt-in setting.
        if self.account:
            self.root.after(500, self.start)
        self.refresh_demo()
        self.root.after(250, self.poll)

    def _build(self, ttk):
        tk = self.tk
        style = ttk.Style()
        style.theme_use('clam')
        style.configure('VELA.TCheckbutton', background='#ffffff', foreground='#536580', font=('Segoe UI', 10))
        header = tk.Frame(self.root, bg='#ffffff', padx=30, pady=22)
        header.pack(fill='x')
        tk.Label(header, text='◢  VELA', font=('Segoe UI', 25, 'bold'), fg='#1655f5', bg='#ffffff').pack(anchor='w')
        tk.Label(header, text='Hesabınla sayt arasında sadə bağlantı.', font=('Segoe UI', 10), fg='#637594', bg='#ffffff').pack(anchor='w', pady=(4, 0))
        body = tk.Frame(self.root, bg='#f3f7ff', padx=28, pady=22)
        body.pack(fill='both', expand=True)
        card = tk.Frame(body, bg='#ffffff', padx=24, pady=20, highlightbackground='#e0e9fa', highlightthickness=1)
        card.pack(fill='x')
        self.status_label = tk.Label(card, textvariable=self.indicator, font=('Segoe UI', 17, 'bold'), fg='#637594', bg='#ffffff')
        self.status_label.pack(anchor='w')
        tk.Label(card, textvariable=self.account_text, font=('Segoe UI', 11), fg='#17294d', bg='#ffffff').pack(anchor='w', pady=(14, 5))
        tk.Label(card, textvariable=self.message, font=('Segoe UI', 10), fg='#637594', bg='#ffffff', wraplength=490, justify='left').pack(anchor='w', pady=7)
        tk.Label(card, textvariable=self.time_text, font=('Segoe UI', 9), fg='#637594', bg='#ffffff').pack(anchor='w', pady=(5, 0))
        actions = tk.Frame(card, bg='#ffffff')
        actions.pack(fill='x', pady=(18, 2))
        self.connect_button = tk.Button(actions, text='Hesabı bağla', command=self.start, bg='#1655f5', fg='#ffffff', activebackground='#1045d3', activeforeground='#ffffff', relief='flat', font=('Segoe UI', 11, 'bold'), padx=20, pady=11, cursor='hand2')
        self.connect_button.pack(side='left')
        self.stop_button = tk.Button(actions, text='Dayandır', command=self.stop, bg='#edf3ff', fg='#1655f5', relief='flat', font=('Segoe UI', 10), padx=16, pady=12, state='disabled')
        self.stop_button.pack(side='left', padx=10)
        tk.Button(body, text='Bağlantı faylını seç və ya dəyiş  →', command=self.choose, relief='flat', bg='#f3f7ff', fg='#1655f5', font=('Segoe UI', 10), cursor='hand2', pady=14).pack(anchor='w')
        tk.Label(body, text='1  MT5-i aç və demo hesabına daxil ol.\n2  Saytdan endirdiyin JSON faylını seç.\n3  “Hesabı bağla” düyməsinə bas.', font=('Segoe UI', 10), fg='#536580', bg='#f3f7ff', justify='left', anchor='w').pack(fill='x', pady=(0, 16))
        options = tk.Frame(body, bg='#ffffff', padx=14, pady=12)
        options.pack(fill='x')
        self.startup_check = ttk.Checkbutton(options, text='Windows açılanda avtomatik bağlan', variable=self.startup, command=self.change_startup, style='VELA.TCheckbutton')
        self.startup_check.pack(anchor='w')
        demo_box=tk.Frame(body,bg='#ffffff',padx=14,pady=12)
        demo_box.pack(fill='x',pady=(12,0))
        tk.Label(demo_box,text='Demo bot · Saytdan idarə olunur',bg='#ffffff',fg='#17294d',font=('Segoe UI',11,'bold')).pack(anchor='w')
        tk.Label(demo_box,textvariable=self.demo_text,bg='#ffffff',fg='#637594',font=('Segoe UI',9),wraplength=510,justify='left').pack(anchor='w',pady=7)
        demo_buttons=tk.Frame(demo_box,bg='#ffffff');demo_buttons.pack(anchor='w')
        tk.Button(demo_buttons,text='Saytdan idarə et',command=self.start_demo,bg='#1655f5',fg='#ffffff',relief='flat',padx=12,pady=7).pack(side='left')
        tk.Button(demo_buttons,text='Yeni girişləri dayandır',command=self.stop_demo,bg='#edf3ff',fg='#1655f5',relief='flat',padx=12,pady=7).pack(side='left',padx=7)
        if not FROZEN or Path(sys.executable).resolve() != INSTALLED.resolve():
            self.startup_check.configure(state='disabled')
        tk.Label(body, text='Pəncərəni bağlasan, VELA saatın yanında işləyir.\nTam çıxmaq üçün VELA ikonuna sağ klik → Çıxış.', font=('Segoe UI', 9), fg='#637594', bg='#f3f7ff', justify='left').pack(anchor='w', pady=14)
        footer = tk.Frame(self.root, bg='#ffffff', padx=28, pady=14)
        footer.pack(fill='x', side='bottom')
        tk.Label(footer, text='Yalnız DEMO · Real hesabda ticarət bloklanır', bg='#ffffff', fg='#637594', font=('Segoe UI', 9)).pack(side='left')
        tk.Button(footer, text='Saytı aç ↗', command=lambda: self.open_site(), relief='flat', bg='#ffffff', fg='#1655f5', font=('Segoe UI', 10), cursor='hand2').pack(side='right')

    def set_account(self, config):
        self.account = config
        self.account_text.set('Demo hesab •••' + config['MT5_LOGIN'][-4:] + '  ·  ' + config['MT5_SERVER'])

    def choose(self):
        from tkinter import filedialog, messagebox
        if self.process is not None:
            messagebox.showinfo('VELA', 'Faylı dəyişmək üçün əvvəl Dayandır düyməsinə bas.', parent=self.root)
            return
        path = filedialog.askopenfilename(parent=self.root, title='VELA bağlantı faylını seç', initialdir=str(Path.home() / 'Downloads'), filetypes=[('VELA bağlantısı', '*.json')])
        if not path:
            return
        try:
            config = read_config(path)
            save_config(CONFIG_PATH, config)
            self.set_account(config)
            self.status.stopped('Fayl hazırdır. MT5-i aç və Hesabı bağla düyməsinə bas.')
            self.message.set(self.status.message)
        except Exception:
            messagebox.showerror('Fayl seçilmədi', 'Saytdakı Bağlantılar bölməsindən endirdiyin etibarlı VELA JSON faylını seç. Faylın içini dəyişmə.', parent=self.root)

    def start(self):
        if self.process is not None:
            return
        if self.account:
            try:
                self.set_account(load_config(CONFIG_PATH))
            except Exception as error:
                record_status('CONFIG_ERROR', error)
                self.status.stopped(ERROR_MESSAGES['CONFIG'])
                return
        if not self.account:
            self.choose()
            if not self.account:
                return
        # One worker owns all MT5 reads. Stop cooperatively; never terminate MT5.
        self.generation += 1
        gen = self.generation
        self.status.started()
        self.last_clock_ack = None
        self.stop_event = threading.Event()
        self.stopping = False
        record_status('CONNECTING')
        self.process = threading.Thread(target=self.read_worker, args=(dict(self.account), gen, self.stop_event), daemon=False)
        self.connect_button.configure(state='disabled')
        self.stop_button.configure(state='normal')
        self.process.start()

    def read_worker(self, config, generation, stop_event):
        try:
            config = validate_config(config)
            for key in CONFIG_KEYS + ('MT5_BROKER_UTC_OFFSET_MINUTES',):
                os.environ[key] = config[key]
            from main import run
            from demo_pilot import DemoPilot
            import MetaTrader5 as mt5
            from demo_bridge import DemoApprovalClient
            pilot=DemoPilot(ROOT,config,mt5,approval_client=DemoApprovalClient(config))
            def acknowledged():
                record_status('CONNECTED')
                self.events.put(('ack', generation, ''))
            run(stop_event=stop_event, on_snapshot=acknowledged,demo_pilot=pilot)
        except Exception as error:
            record_status('ERROR', error)
            self.events.put(('error', generation, classify_error(error)))
        finally:
            self.events.put(('exit', generation, ''))

    def stop(self):
        self.stop_demo()
        if self.process is None:
            return
        self.stopping = True
        self.stop_event.set()
        self.status.stopped('Dayandırılır… Cari məlumat ötürülməsi bitənədək bir az gözlə. MT5 bağlanmır.')
        self.last_clock_ack = None
        self.connect_button.configure(state='disabled')
        self.stop_button.configure(state='disabled')

    def poll(self):
        while True:
            try:
                kind, generation, value = self.events.get_nowait()
            except queue.Empty:
                break
            if kind == 'show':
                self.show()
            elif kind == 'quit':
                self.quit()
                break
            elif generation == self.generation:
                if kind == 'ack':
                    if not self.stopping:
                        self.status.acknowledge()
                        self.last_clock_ack = time.strftime('%H:%M:%S')
                elif kind == 'error':
                    if not self.stopping:
                        self.status.stopped(ERROR_MESSAGES.get(value, ERROR_MESSAGES['UNKNOWN']))
                elif kind == 'exit':
                    self.process = None
                    if self.stopping:
                        self.status.stopped('Bağlantı dayandırılıb. Yenidən başlamaq üçün Hesabı bağla düyməsinə bas.')
                    elif self.status.running:
                        self.status.stopped(ERROR_MESSAGES['UNKNOWN'])
                    self.stopping = False
                    self.connect_button.configure(state='normal')
                    self.stop_button.configure(state='disabled')
        if self.quitting and self.process is None:
            if self.tray:
                self.tray.stop()
            self.root.destroy()
            return
        online = self.status.connected()
        self.indicator.set('●  Bağlıdır' if online else '●  Yoxlanır…' if self.status.running else '●  Bağlanmayıb')
        self.status_label.configure(fg='#16845c' if online else '#637594')
        self.message.set('Hesab məlumatların sayta göndərilir. MT5 və kompüter açıq qalmalıdır.' if online else self.status.message if not self.status.last_ack else 'Məlumat gecikir. Bağlantı hələ təsdiqlənmir; interneti və MT5-i yoxla.')
        self.time_text.set('Son təsdiqlənmiş məlumat: ' + (self.last_clock_ack or '—'))
        if self.tray:
            self.tray.title = 'VELA · ' + ('Bağlıdır' if online else 'Bağlanmayıb')
        self.refresh_demo()
        self.root.after(250, self.poll)

    def start_demo(self):
        self.open_site()

    def stop_demo(self):
        from demo_pilot import disarm
        disarm(ROOT)

    def refresh_demo(self):
        try:
            d=json.loads((ROOT/'demo-pilot-status.json').read_text(encoding='utf-8'))
            self.demo_text.set(d['reason']+' · Cəhd: '+str(d['attempts'])+'/3 · Equity fərqi: '+str(d['equityChange']))
        except (OSError,ValueError,KeyError):pass

    def _start_tray(self):
        try:
            import pystray
            from PIL import Image, ImageDraw
            image = Image.new('RGBA', (64, 64), '#1655f5')
            ImageDraw.Draw(image).polygon([(12, 15), (26, 15), (34, 35), (43, 15), (55, 15), (34, 52), (27, 52)], fill='#ffffff')
            self.tray = pystray.Icon('VELA', image, 'VELA · Bağlanmayıb', menu=pystray.Menu(
                pystray.MenuItem('VELA-nı aç', lambda: self.events.put(('show', 0, '')), default=True),
                pystray.MenuItem('Çıxış', lambda: self.events.put(('quit', 0, '')))))
            threading.Thread(target=self._run_tray, daemon=True).start()
        except Exception:
            self.tray = None

    def _run_tray(self):
        try:
            self.tray.run()
        except Exception:
            self.tray = None
            self.events.put(('show', 0, ''))

    def hide(self):
        if self.tray and self.tray.visible:
            self.root.withdraw()
        else:
            self.root.iconify()  # never hide an unreachable app when the tray failed

    def show(self):
        self.root.deiconify()
        self.root.lift()

    def change_startup(self):
        from tkinter import messagebox
        try:
            set_startup(self.startup.get())
        except Exception:
            self.startup.set(startup_enabled())
            messagebox.showerror('VELA', 'Avtomatik başlama seçimi saxlanmadı. Əvvəl VELA-nı quraşdır.', parent=self.root)

    def open_site(self):
        import webbrowser
        webbrowser.open(ORIGIN)

    def quit(self):
        self.stop()
        self.quitting = True
        self.show()


def setup_window():
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk()
    root.title('VELA quraşdırılması')
    root.geometry('510x330')
    root.resizable(False, False)
    root.configure(bg='#ffffff')
    tk.Label(root, text='VELA', font=('Segoe UI', 32, 'bold'), fg='#1655f5', bg='#ffffff').pack(pady=(28, 12))
    tk.Label(root, text='Python və CMD olmadan hesab bağlantısı.\nYalnız bu Windows istifadəçisi üçün quraşdırılır.\nMasaüstünə VELA ikonu əlavə olunacaq.', font=('Segoe UI', 11), fg='#637594', bg='#ffffff', justify='center').pack(pady=10)
    def proceed():
        try:
            shortcut_ok = install()
            if not shortcut_ok:
                messagebox.showinfo('VELA quraşdırıldı', 'VELA açılır. Masaüstü ikonu yaradıla bilmədi. Sonrakı dəfə Windows + R düymələri ilə %LOCALAPPDATA%\\VELAConnector\\VELA.exe ünvanını aç.', parent=root)
            root.destroy()
        except InstallError as error:
            if error.stage == 'COPY':
                message = 'Proqram faylı kopyalanmadı. Açıq VELA varsa saatın yanındakı ikonundan Çıxış et və yenidən sına.'
            elif error.code in (577, 1260, 4551):
                message = 'Fayl kopyalandı, amma Windows təhlükəsizlik siyasəti proqramın açılmasını blokladı. Qorumanı söndürmə; proqramın imzalanması və ya administrator tərəfindən təsdiqi lazımdır.'
            else:
                message = 'Fayl kopyalandı, amma VELA açıla bilmədi. Bu xəta kodunu dəstəyə göndər.'
            messagebox.showerror('VELA', message + '\n\nAddım: ' + error.stage + ' · Kod: ' + str(error.code), parent=root)
        except Exception:
            messagebox.showerror('VELA', 'Gözlənilməyən quraşdırma xətası. Kod: SETUP_UNKNOWN.', parent=root)
    tk.Button(root, text='Quraşdır və aç', command=proceed, bg='#1655f5', fg='#ffffff', font=('Segoe UI', 11, 'bold'), relief='flat', padx=28, pady=12).pack(pady=12)
    tk.Label(root, text='MT5 və kompüter açıq qalmalıdır · Yalnız demo', font=('Segoe UI', 9), fg='#637594', bg='#ffffff').pack()
    root.mainloop()


def self_test(output):
    """No MT5 initialize, network, config import, startup changes, or user data access."""
    import tkinter
    import pystray
    import MetaTrader5
    import requests
    import ssl
    from PIL import Image
    from connector_core import protect
    probe = b'VELA_BUILD_PROBE'
    assert protect(protect(probe), decrypt=True) == probe
    assert tkinter.Tcl().eval('info patchlevel')
    tls = ssl.create_default_context(cafile=requests.certs.where())
    assert tls.check_hostname and tls.verify_mode == ssl.CERT_REQUIRED
    ui = Desktop(testing=True)
    ui.root.update_idletasks()
    assert ui.connect_button.cget('text') == 'Hesabı bağla'
    assert ui.process is None and not ui.status.connected()
    ui.root.destroy()
    # Exercise native shortcut creation only in a temporary build-test folder.
    # Never write the real desktop, installed executable, or user configuration.
    import tempfile
    with tempfile.TemporaryDirectory(dir=Path(output).resolve().parent) as scratch:
        create_shortcut(sys.executable, Path(scratch) / 'VELA-test.lnk')
    Path(output).write_text(json.dumps({'ok': True, 'frozen': FROZEN, 'execution': 'disabled'}), encoding='utf-8')


def entry():
    parser = argparse.ArgumentParser()
    parser.add_argument('--background', action='store_true')
    parser.add_argument('--self-test')
    args = parser.parse_args()
    if args.self_test:
        self_test(args.self_test)
        return 0
    if FROZEN and Path(sys.executable).stem.lower() == 'vela-setup':
        setup_window()
        return 0
    instance_handle = acquire_instance()
    if instance_handle is None:
        ctypes.windll.user32.MessageBoxW(None, 'VELA artıq işləyir. Saatın yanındakı VELA ikonunu aç.', 'VELA', 64)
        return 0
    app = Desktop(background=args.background)
    app.root.mainloop()
    return 0


if __name__ == '__main__':
    raise SystemExit(entry())
