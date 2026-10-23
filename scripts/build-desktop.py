"""Build a self-contained Windows x64 installer; never include user connection files."""
import hashlib
import argparse
import os
import subprocess
import sys
import ssl
from pathlib import Path
from uuid import uuid4

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', default='desktop-dist')
options = parser.parse_args()
output = (root / options.output).resolve()
if not output.is_relative_to(root):
    raise ValueError('Build output must stay inside the workspace')
work = root / '.desktop-build' / uuid4().hex
output.mkdir(parents=True, exist_ok=True)
work.mkdir(parents=True, exist_ok=True)
from PIL import Image, ImageDraw
image = Image.new('RGBA', (256, 256), '#1655f5')
ImageDraw.Draw(image).polygon([(42, 54), (99, 54), (131, 144), (172, 54), (222, 54), (137, 210), (108, 210)], fill='#ffffff')
icon = work / 'vela.ico'
image.save(icon, sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
extra_data = []
# Some managed Python distributions ship SSL verification policy data beside
# ssl.py. Preserve that policy in the frozen root, where ssl.__file__ resolves.
# Never remove the runtime's certificate checks or switch requests to verify=False.
ssl_policy = Path(ssl.__file__).parent / 'codex-rejected-cas.pem'
if ssl_policy.is_file():
    extra_data = ['--add-data', str(ssl_policy) + os.pathsep + '.']
subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--onefile', '--windowed',
                '--name', 'VELA-Setup', '--icon', str(icon), '--distpath', str(output),
                '--workpath', str(work / 'work'), '--specpath', str(work),
                '--paths', str(root / 'agent'), '--hidden-import', 'pystray._win32',
                *extra_data, str(root / 'agent' / 'desktop.py')], cwd=root, check=True)
exe = output / 'VELA-Setup.exe'
(output / 'SHA256SUMS.txt').write_text(hashlib.sha256(exe.read_bytes()).hexdigest() + '  VELA-Setup.exe\n', encoding='utf-8')
print('Built VELA-Setup.exe; no JSON, credentials, user settings, or logs were added.')
