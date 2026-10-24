"""VELA Windows MT5 connector and explicitly armed demo pilot."""
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
VERSION = '1.4.4'


def record_status(event, error=None):
    # Last event only, bounded and credential-free; safe for support to inspect.
    from datetime import datetime, timezone
    data = {'version': VERSION, 'event': event, 'at': datetime.now(timezone.utc).isoformat()}
    if error is not None:
        data.update(safe_diagnostic(error))
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        (ROOT / 'connection-status.json').write_text(json.dumps(data), encoding='utf-8')
        runtime={'event':'ERROR' if event in ('ERROR','CONFIG_ERROR') else event,'pid':os.getpid(),'at':data['at']}
        if error is not None:runtime['reason']=safe_diagnostic(error)['category']
        temporary=ROOT/'agent-process-status.tmp'
        temporary.write_text(json.dumps(runtime),encoding='utf-8')
        os.replace(temporary,ROOT/'agent-process-status.json')
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


def acquire_agent_mutex():
    """Keep the same single-agent lock used by main.py while this UI owns MT5."""
    if os.name != 'nt':
        return None
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel.CreateMutexW(None, False, 'Local\\VELAConnectorAgentV1')
    if not handle:
        raise OSError('AGENT_INSTANCE_CHECK_FAILED')
    if ctypes.get_last_error() == 183:
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel.CloseHandle(handle)
        return None
    return handle


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
        self.root.title('VELA · Botu idarə et · ' + VERSION)
        self.root.geometry('620x680')
        self.root.minsize(570, 640)
        self.root.configure(bg='#f3f7ff')
        if testing:
            self.root.withdraw()
        self.events = queue.Queue()
        self.status = ConnectionStatus()
        self.process = None
        self.agent_mutex = None
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
        # The connector starts only when the user presses the start button.
        self.refresh_demo()
        self.root.after(250, self.poll)

    def _build(self, ttk):
        tk = self.tk
        style = ttk.Style()
        style.theme_use('clam')
        style.configure('VELA.TCheckbutton', background='#ffffff', foreground='#536580', font=('Segoe UI', 10))
        header = tk.Frame(self.root, bg='#ffffff', padx=28, pady=20)
        header.pack(fill='x')
        tk.Label(header, text='◢  VELA', font=('Segoe UI', 25, 'bold'), fg='#1655f5', bg='#ffffff').pack(anchor='w')
        tk.Label(header, text='Botu bir düymə ilə başlat və təhlükəsiz dayandır.', font=('Segoe UI', 10), fg='#637594', bg='#ffffff').pack(anchor='w', pady=(4, 0))
        body = tk.Frame(self.root, bg='#f3f7ff', padx=24, pady=20)
        body.pack(fill='both', expand=True)
        card = tk.Frame(body, bg='#ffffff', padx=22, pady=18, highlightbackground='#e0e9fa', highlightthickness=1)
        card.pack(fill='x')
        self.status_label = tk.Label(card, textvariable=self.indicator, font=('Segoe UI', 18, 'bold'), fg='#637594', bg='#ffffff')
        self.status_label.pack(anchor='w')
        tk.Label(card, textvariable=self.account_text, font=('Segoe UI', 11), fg='#17294d', bg='#ffffff').pack(anchor='w', pady=(12, 4))
        tk.Label(card, textvariable=self.message, font=('Segoe UI', 10), fg='#637594', bg='#ffffff', wraplength=500, justify='left').pack(anchor='w', pady=6)
        tk.Label(card, textvariable=self.time_text, font=('Segoe UI', 9), fg='#637594', bg='#ffffff').pack(anchor='w', pady=(4, 0))
        actions = tk.Frame(body, bg='#f3f7ff')
        actions.pack(fill='x', pady=(16, 10))
        self.connect_button = tk.Button(actions, text='VELA-nı başlat', command=self.start, bg='#1655f5', fg='#ffffff', activebackground='#1045d3', activeforeground='#ffffff', relief='flat', font=('Segoe UI', 12, 'bold'), padx=22, pady=14, cursor='hand2')
        self.connect_button.pack(side='left', fill='x', expand=True)
        self.stop_button = tk.Button(actions, text='VELA-nı dayandır', command=self.stop, bg='#e95159', fg='#ffffff', activebackground='#d83f49', activeforeground='#ffffff', relief='flat', font=('Segoe UI', 12, 'bold'), padx=18, pady=14, cursor='hand2', state='disabled')
        self.stop_button.pack(side='left', fill='x', expand=True, padx=(10, 0))
        tk.Button(body, text='Bağlantı faylını seç və ya dəyiş  →', command=self.choose, relief='flat', bg='#f3f7ff', fg='#1655f5', font=('Segoe UI', 10), cursor='hand2', pady=8).pack(anchor='w')
        guide = tk.Frame(body, bg='#ffffff', padx=16, pady=13)
        guide.pack(fill='x', pady=(4, 12))
        tk.Label(guide, text='İlk dəfə qoşulursan?', font=('Segoe UI', 10, 'bold'), fg='#17294d', bg='#ffffff').pack(anchor='w')
        tk.Label(guide, text='1  MT5-i aç və demo hesaba daxil ol.\n2  Saytdan endirilən VELA JSON faylını seç.\n3  Başlat düyməsinə bas; bağlantı hazır olanda sayt status göstərəcək.', font=('Segoe UI', 9), fg='#536580', bg='#ffffff', justify='left', anchor='w').pack(fill='x', pady=(6, 0))
        demo_box = tk.Frame(body, bg='#ffffff', padx=16, pady=12)
        demo_box.pack(fill='x')
        tk.Label(demo_box, text='Demo əməliyyatları', bg='#ffffff', fg='#17294d', font=('Segoe UI', 10, 'bold')).pack(anchor='w')
        tk.Label(demo_box, textvariable=self.demo_text, bg='#ffffff', fg='#637594', font=('Segoe UI', 9), wraplength=500, justify='left').pack(anchor='w', pady=(5, 7))
        tk.Button(demo_box, text='Rejimi saytda seç  ↗', command=self.open_site, bg='#edf3ff', fg='#1655f5', relief='flat', font=('Segoe UI', 9, 'bold'), padx=12, pady=7, cursor='hand2').pack(anchor='w')
        footer = tk.Frame(self.root, bg='#ffffff', padx=24, pady=12)
        footer.pack(fill='x', side='bottom')
        tk.Label(footer, text='Yalnız DEMO · Real hesabda ticarət bloklanır', bg='#ffffff', fg='#637594', font=('Segoe UI', 9)).pack(side='left')
        tk.Button(footer, text='Saytı aç ↗', command=self.open_site, relief='flat', bg='#ffffff', fg='#1655f5', font=('Segoe UI', 9), cursor='hand2').pack(side='right')

    def set_account(self, config):
        self.account = config
        self.account_text.set('Demo hesab •••' + config['MT5_LOGIN'][-4:] + '  ·  ' + config['MT5_SERVER'])

    def choose(self):
        from tkinter import filedialog, messagebox
        if self.process is not None:
            messagebox.showinfo('VELA', 'Faylı dəyişmək üçün əvvəl VELA-nı dayandır.', parent=self.root)
            return
        self.root.attributes('-topmost', True)
        path = filedialog.askopenfilename(parent=self.root, title='VELA bağlantı faylını seç', initialdir=str(Path.home() / 'Downloads'), filetypes=[('VELA bağlantısı', '*.json')])
        self.root.attributes('-topmost', False)
        if not path:
            self.status.stopped('Başlatmaq üçün VELA bağlantı JSON faylını seç.')
            self.message.set(self.status.message)
            self.root.lift()
            messagebox.showinfo('Bağlantı faylı lazımdır', 'Saytdakı Bağlantılar bölməsindən VELA JSON faylını endir və bu pəncərədə seç. Fayl seçilmədən agent başlaya bilməz.', parent=self.root)
            return
        try:
            config = read_config(path)
            save_config(CONFIG_PATH, config)
            self.set_account(config)
            self.status.stopped('Bağlantı faylı hazırdır. MT5 demo hesabını aç və VELA-nı başlat.')
            self.message.set(self.status.message)
        except Exception:
            messagebox.showerror('Fayl seçilmədi', 'Saytdakı Bağlantılar bölməsindən endirdiyin etibarlı VELA JSON faylını seç. Faylın içini dəyişmə.', parent=self.root)

    def start(self):
        if self.process is not None:
            return
        if getattr(self, 'account', None):
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
        if os.name == 'nt':
            try:
                self.agent_mutex = acquire_agent_mutex()
            except Exception as error:
                record_status('ERROR', error)
                self.status.stopped('VELA Windows agent kilidini aça bilmədi. Proqramı bağlayıb yenidən aç.')
                self.message.set(self.status.message)
                return
            if self.agent_mutex is None:
                self.status.stopped('VELA agenti artıq işləyir. Əvvəl həmin proqramdan dayandır.')
                self.message.set(self.status.message)
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
        try:
            self.process.start()
        except Exception as error:
            record_status('ERROR', error)
            self.process = None
            self.stopping = False
            if self.agent_mutex:
                try:
                    ctypes.windll.kernel32.CloseHandle(self.agent_mutex)
                except Exception:
                    pass
                self.agent_mutex = None
            self.status.stopped('VELA agent iş parçası başlaya bilmədi. Proqramı bağlayıb yenidən aç; xəta qeydi diaqnostikada saxlanıb.')
            self.message.set(self.status.message)
            self.connect_button.configure(state='normal')
            self.stop_button.configure(state='disabled')

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
            if self.agent_mutex:
                try:
                    ctypes.windll.kernel32.CloseHandle(self.agent_mutex)
                except Exception:
                    pass
                self.agent_mutex = None
            self.events.put(('exit', generation, ''))

    def stop(self):
        self.stop_demo()
        if self.process is None:
            try:
                runtime = json.loads((ROOT / 'agent-process-status.json').read_text(encoding='utf-8'))
                pid = runtime.get('pid')
                if isinstance(pid, int) and pid > 0 and pid != os.getpid():
                    os.kill(pid, 0)
                    ROOT.mkdir(parents=True, exist_ok=True)
                    (ROOT / 'stop.request').write_text('stop', encoding='ascii')
            except (OSError, ValueError, TypeError):
                pass
        if getattr(self, 'account', None):
            threading.Thread(target=self.halt_remote, args=(dict(self.account),), daemon=True).start()
        if self.process is None:
            return
        self.stopping = True
        self.stop_event.set()
        self.status.stopped('Dayandırılır… Cari məlumat ötürülməsi bitənədək bir az gözlə. MT5 bağlanmır.')
        self.last_clock_ack = None
        self.connect_button.configure(state='disabled')
        self.stop_button.configure(state='disabled')

    def halt_remote(self, config):
        try:
            settings_path = ROOT / 'demo-pilot.json'
            try:
                settings = json.loads(settings_path.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                settings = {}
            from demo_bridge import DemoApprovalClient
            result = DemoApprovalClient(config).halt(settings, 'MANUAL')
            ok = result.get('ok') is True
        except Exception:
            ok = False
        self.events.put(('remote_stop', self.generation, ok))

    def poll(self):
        stop_file=ROOT/'stop.request'
        if stop_file.exists():
            try:stop_file.unlink()
            except OSError:pass
            self.quitting=True
            self.stop()
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
            elif kind == 'remote_stop':
                self.message.set('Demo sessiyası dayandırıldı. Açıq mövqelər bağlanmadı.' if value else 'Bu kompüterdə yeni girişlər dayandırıldı; sayt stop təsdiqini almadı. İnternet bərpa olunanda saytda Dayandır düyməsinə bas.')
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
                        record_status('STOPPED')
                        self.status.stopped('VELA dayandırıldı. Yenidən başlatmaq üçün Başlat düyməsinə bas.')
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
            self.demo_text.set(d['reason']+' · Cəhd: '+str(d['attempts'])+' · Equity fərqi: '+str(d['equityChange']))
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
    assert ui.connect_button.cget('text') == 'VELA-nı başlat'
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
