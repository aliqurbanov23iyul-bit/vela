"""Shared desktop connector logic. No orders, UI, or network side effects on import."""
import ctypes
import json
import os
import re
import time
from pathlib import Path
from uuid import UUID

ORIGIN = 'https://velatradingbot.vercel.app'
CONFIG_KEYS = ('MT5_TERMINAL_PATH', 'MT5_LOGIN', 'MT5_SERVER', 'APP_ORIGIN',
               'MT5_ACCOUNT_ID', 'MT5_TENANT_ID', 'MT5_AGENT_TOKEN')


def validate_config(config):
    if not isinstance(config, dict):
        raise ValueError('INVALID_CONFIG')
    if any(not isinstance(config.get(k), str) or not config[k] or len(config[k]) > 4096 for k in CONFIG_KEYS):
        raise ValueError('INVALID_CONFIG')
    if config['APP_ORIGIN'] != ORIGIN or not re.fullmatch(r'[0-9]{1,20}', config['MT5_LOGIN']):
        raise ValueError('INVALID_CONFIG')
    if len(config['MT5_SERVER']) > 100 or not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', config['MT5_AGENT_TOKEN']):
        raise ValueError('INVALID_CONFIG')
    for key in ('MT5_ACCOUNT_ID', 'MT5_TENANT_ID'):
        UUID(config[key])
    offset = str(config.get('MT5_BROKER_UTC_OFFSET_MINUTES', '0'))
    if not re.fullmatch(r'-?[0-9]{1,4}', offset) or abs(int(offset)) > 840 or int(offset) % 15:
        raise ValueError('INVALID_OFFSET')
    clean = {k: config[k] for k in CONFIG_KEYS}
    clean['MT5_BROKER_UTC_OFFSET_MINUTES'] = offset
    return clean


def read_config(path):
    path = Path(path)
    if path.stat().st_size > 32768:
        raise ValueError('INVALID_CONFIG')
    return validate_config(json.loads(path.read_text(encoding='utf-8-sig')))


class Blob(ctypes.Structure):
    _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def protect(data, decrypt=False):
    """Windows DPAPI: current Windows user only; never persist the bearer in clear text."""
    buf = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    output = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    # CRYPTPROTECT_UI_FORBIDDEN: no password prompts or machine-wide decryption.
    if decrypt:
        ok = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output))
    else:
        ok = crypt.CryptProtectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output))
    if not ok:
        raise OSError('WINDOWS_PRIVATE_STORAGE_FAILED')
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        kernel.LocalFree(output.data)


def save_config(path, config):
    clean = validate_config(config)
    encrypted = protect(json.dumps(clean).encode('utf-8'))
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_bytes(encrypted)
    os.replace(temp, path)
    return clean


def load_config(path):
    path = Path(path)
    if path.stat().st_size > 65536:
        raise ValueError('INVALID_CONFIG')
    return validate_config(json.loads(protect(path.read_bytes(), decrypt=True)))


class ConnectionStatus:
    """Connected means a recent acknowledged server upload, never merely a running process."""
    def __init__(self):
        self.last_ack = 0
        self.running = False
        self.message = 'Hesabını bağlamaq üçün bağlantı faylını seç.'

    def started(self):
        self.running = True
        self.last_ack = 0
        self.message = 'MT5 və sayt bağlantısı yoxlanır…'

    def acknowledge(self, now=None):
        self.last_ack = time.monotonic() if now is None else now

    def stopped(self, message):
        self.running = False
        self.last_ack = 0
        self.message = message

    def connected(self, now=None):
        return self.running and bool(self.last_ack) and (time.monotonic() if now is None else now) - self.last_ack < 45


ERROR_MESSAGES = {
    'TERMINAL': 'MT5 açıq deyil və ya brokerə bağlı deyil. MT5-i açıb demo hesabına daxil ol.',
    'IDENTITY': 'MT5-də seçilən hesab və ya server uyğun deyil. Düzgün demo hesabına keç.',
    'DEMO': 'Bu versiya yalnız demo hesabı dəstəkləyir. MT5-də demo hesabına keç.',
    'AUTH': 'Bağlantı faylı artıq qəbul edilmir. Saytdan yenisini endirib seç.',
    'NETWORK': 'Sayta məlumat göndərilmədi. İnterneti yoxla və yenidən bağlan.',
    'CERTIFICATE': 'Windows bu bağlantının sertifikatını təsdiqləyə bilmədi. Xəta kodu: CERTIFICATE.',
    'SSL': 'Şifrəli sayt bağlantısı qurulmadı. Xəta kodu: SSL.',
    'TIMEOUT': 'Sayt vaxtında cavab vermədi. Yenidən bağlan. Xəta kodu: TIMEOUT.',
    'PROXY': 'Windows proxy bağlantısı işləmədi. Xəta kodu: PROXY.',
    'SERVER': 'Saytda müvəqqəti xəta var. Bir az sonra yenidən bağlan. Xəta kodu: SERVER.',
    'CONFIG': 'Bağlantı faylı oxunmadı. Saytdan endirdiyin JSON faylını yenidən seç.',
    'UNKNOWN': 'Bağlantı dayandı. MT5 və interneti yoxlayıb yenidən bağlan.',
}


def classify_error(error):
    # Never send raw errors, URLs, tokens, terminal paths or account data into UI/logs.
    text = str(error)
    if 'identity mismatch' in text:
        return 'IDENTITY'
    if 'only supports demo' in text:
        return 'DEMO'
    if 'Terminal' in text or 'Broker snapshot' in text:
        return 'TERMINAL'
    response = getattr(error, 'response', None)
    if response is not None and response.status_code in (401, 403):
        return 'AUTH'
    if response is not None and response.status_code >= 500:
        return 'SERVER'
    import requests
    if isinstance(error, requests.exceptions.SSLError):
        return 'CERTIFICATE' if 'CERTIFICATE_VERIFY_FAILED' in text else 'SSL'
    if isinstance(error, requests.exceptions.Timeout):
        return 'TIMEOUT'
    if isinstance(error, requests.exceptions.ProxyError):
        return 'PROXY'
    return 'NETWORK' if error.__class__.__module__.startswith('requests') else 'UNKNOWN'


def safe_diagnostic(error):
    """Only fixed categories, numeric codes and class names; never exception text."""
    response = getattr(error, 'response', None)
    causes = []
    pending = [error]
    seen = set()
    while pending and len(causes) < 8:
        item = pending.pop(0)
        if not isinstance(item, BaseException) or id(item) in seen:
            continue
        seen.add(id(item))
        codes = [int(n) for n in re.findall(r'(?:WinError|Errno)\s+(-?\d+)', str(item))][:3]
        import traceback
        frames = [{'file': Path(f.filename).name, 'function': f.name, 'line': f.lineno}
                  for f in traceback.extract_tb(item.__traceback__)[-6:]]
        filename = getattr(item, 'filename', None)
        causes.append({'type': type(item).__name__, 'codes': codes, 'frames': frames,
                       'missingFile': Path(filename).name if isinstance(filename, str) else None})
        pending.extend([getattr(item, '__cause__', None), getattr(item, '__context__', None), getattr(item, 'reason', None)])
        pending.extend(a for a in item.args if isinstance(a, BaseException))
    return {'category': classify_error(error), 'type': type(error).__name__, 'causes': causes,
            'httpStatus': response.status_code if response is not None else None,
            'winerror': getattr(error, 'winerror', None), 'errno': getattr(error, 'errno', None)}
