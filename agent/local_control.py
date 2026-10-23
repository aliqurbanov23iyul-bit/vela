"""Two-click Windows launcher/controller for a user's local MT5 demo connector."""
import argparse
import ctypes
import json
import os
import subprocess
import sys
import time
from pathlib import Path

AGENT_DIR=Path(__file__).resolve().parent
WORKSPACE=AGENT_DIR.parent
LOCAL=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'VELAConnector'
CONFIG=LOCAL/'connection.dat'
STOP_FILE=LOCAL/'stop.request'
STATUS=LOCAL/'agent-process-status.json'
PYTHON=AGENT_DIR/'.venv'/'Scripts'/'python.exe'
PYTHONW=AGENT_DIR/'.venv'/'Scripts'/'pythonw.exe'

def tell(message,title='VELA'):
    if os.name=='nt':ctypes.windll.user32.MessageBoxW(None,message,title,0x40)
    else:print(message)

def fail(message):
    tell(message,'VELA · yoxlama');return 1

def select_config():
    try:
        import tkinter as tk
        from tkinter import filedialog
        root=tk.Tk();root.withdraw();root.attributes('-topmost',True)
        selected=filedialog.askopenfilename(parent=root,title='VELA bağlantı JSON faylını seç',initialdir=str(Path.home()/'Downloads'),filetypes=[('VELA connection','vela-connection*.json'),('JSON','*.json')])
        root.destroy()
        return selected
    except Exception:return ''

def get_config():
    from connector_core import read_config,save_config,load_config
    LOCAL.mkdir(parents=True,exist_ok=True)
    if CONFIG.is_file():
        try:return load_config(CONFIG)
        except Exception:
            return None
    selected=select_config()
    if not selected:return None
    config=read_config(selected)
    save_config(CONFIG,config)
    return config

def status():
    try:return json.loads(STATUS.read_text(encoding='utf-8'))
    except (OSError,ValueError):return {}

def is_running(data=None):
    data=data or status();pid=data.get('pid')
    if not isinstance(pid,int) or pid<=0:return False
    try:os.kill(pid,0);return True
    except (OSError,ProcessLookupError):return False

def verify_terminal(config):
    path=Path(config['MT5_TERMINAL_PATH'])
    if not path.is_file():return 'MT5 terminal yolu tapılmadı. Saytdakı bağlantı faylını bu kompüterdəki terminal64.exe yolu ilə yenidən endir.'
    try:
        import MetaTrader5 as mt5
        if not mt5.initialize(path=str(path)):return 'MT5-i aç, demo hesabına daxil ol və terminalın brokerə qoşulduğunu yoxla.'
        try:
            account=mt5.account_info();terminal=mt5.terminal_info()
            if account is None or terminal is None or not terminal.connected:return 'MT5 brokerə qoşulmayıb. MT5-də demo hesabına daxil ol.'
            if str(account.login)!=config['MT5_LOGIN'] or account.server!=config['MT5_SERVER']:
                return 'MT5-dəki hesab/server sayt bağlantı faylı ilə uyğun deyil. Düzgün demo hesabını seç.'
            if account.trade_mode!=mt5.ACCOUNT_TRADE_MODE_DEMO:return 'Bu bağlantı yalnız DEMO hesabı dəstəkləyir. Real hesabda agent başlamayacaq.'
        finally:mt5.shutdown()
    except Exception:return 'MT5 bağlantısı yoxlanmadı. MT5-i açıb demo hesabına daxil ol, sonra yenidən yoxla.'
    return None

def start():
    if not PYTHON.is_file() or not PYTHONW.is_file():return fail('Python mühiti tapılmadı. Layihə qovluğunda asılılıqları quraşdırmaq lazımdır.')
    if is_running():return fail('VELA agenti artıq işləyir. Təkrar başlatma etmədim.')
    try:config=get_config()
    except Exception:return fail('Bağlantı faylı oxunmadı. Saytdan yenisini endir və VELA Başlat faylını yenidən aç.')
    if not config:return fail('İlk dəfədir qoşulursansa, saytdan şəxsi VELA JSON faylını endir və açılan pəncərədə seç.')
    problem=verify_terminal(config)
    if problem:return fail(problem)
    LOCAL.mkdir(parents=True,exist_ok=True)
    try:STOP_FILE.unlink(missing_ok=True)
    except OSError:pass
    flags=getattr(subprocess,'DETACHED_PROCESS',0x00000008)|getattr(subprocess,'CREATE_NO_WINDOW',0x08000000)
    try:
        subprocess.Popen([str(PYTHONW),str(AGENT_DIR/'main.py'),'--config',str(CONFIG),'--encrypted-config','--control-dir',str(LOCAL)],cwd=str(WORKSPACE),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags,close_fds=True)
    except OSError:return fail('VELA agenti açıla bilmədi. agent/.venv qovluğunu yoxla.')
    deadline=time.time()+12
    while time.time()<deadline:
        data=status()
        if data.get('event')=='ERROR' and not is_running(data):return fail('Agent başlamadı. Vəziyyət: '+str(data.get('reason','UNKNOWN'))+'. MT5 və demo hesabını yoxla.')
        if data.get('event')=='CONNECTED' and is_running(data):
            return fail('VELA agenti işləyir və sayta məlumat göndərdiyini təsdiqlədi. İndi saytda DEMO sınağını başlat. Bu yoxlama broker əmri göndərmədi.')
        time.sleep(.25)
    data=status()
    if is_running(data):return fail('VELA agenti başladıldı. Saytda bağlantının 45 saniyə içində yenilənməsini yoxla; DEMO sınağını yalnız “Bağlıdır” görünəndə başlat.')
    return fail('Agent işə düşdüyünü təsdiqləmədi. MT5-i açıq saxla və VELA-Dayandır ilə təmizlədikdən sonra yenidən cəhd et.')

def stop():
    LOCAL.mkdir(parents=True,exist_ok=True)
    try:
        from demo_pilot import disarm
        settings_path=LOCAL/'demo-pilot.json'
        try:settings=json.loads(settings_path.read_text(encoding='utf-8'))
        except (OSError,ValueError):settings={}
        disarm(LOCAL)
        STOP_FILE.write_text('stop',encoding='ascii')
        remote_ok=False
        try:
            from connector_core import load_config
            from demo_bridge import DemoApprovalClient
            config=load_config(CONFIG)
            result=DemoApprovalClient(config).halt(settings,'MANUAL')
            remote_ok=result.get('ok') is True
        except Exception:remote_ok=False
        deadline=time.time()+25
        while time.time()<deadline:
            data=status()
            if not is_running(data) or data.get('event')=='STOPPED':break
            time.sleep(.25)
        data=status()
        if is_running(data):return fail('Yeni girişlər bloklandı; agent təhlükəsiz dayandırma sorğusunu aldı və cari HTTPS/MT5 sorğusunun bitməsini gözləyir. Pəncərəni zorla bağlama.')
        if remote_ok:return fail('VELA dayandırıldı. Saytın heartbeat-i 45 saniyə ərzində köhnələcək; açıq mövqelərə toxunulmadı.')
        return fail('Bu kompüterdə yeni girişlər bloklandı və agent dayandırıldı. Sayt serverinə stop təsdiqi çatmadı; internet bərpa olunanda saytda “Dayandır” düyməsini də bas. Açıq mövqelər bağlanmadı.')
    except Exception:return fail('Təhlükəsiz dayandırma tamamlanmadı. Saytda “Dayandır” düyməsini bas və MT5-i açıq saxla.')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=('start','stop'));args=parser.parse_args()
    return start() if args.action=='start' else stop()

if __name__=='__main__':raise SystemExit(main())
