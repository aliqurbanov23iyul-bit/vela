"""Build a customer ZIP from an explicit public-source allowlist only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
root = Path(__file__).resolve().parents[1]
files = {'main.py':'agent/main.py','market.py':'agent/market.py',
         'requirements.txt':'agent/requirements.txt','Start-VELA.cmd':'agent/customer-start.cmd',
         'launch.py':'agent/customer-launch.py','READ-ME.txt':'agent/customer-readme.txt'}
target = root / 'public' / 'vela-windows-agent.zip'
with ZipFile(target, 'w', compression=ZIP_DEFLATED) as archive:
    for name, source in files.items():
        item = ZipInfo('VELA-Agent/' + name, date_time=(2026, 1, 1, 0, 0, 0))
        item.compress_type = ZIP_DEFLATED
        archive.writestr(item, (root / source).read_bytes())
with ZipFile(target) as archive:
    assert set(archive.namelist()) == {'VELA-Agent/' + name for name in files}
    assert archive.testzip() is None
print('Customer agent package verified: 6 public source files; no connection/config files.')
