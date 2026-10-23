"""Customer launcher: select the newest downloaded connection without displaying it."""
import json
import os
import sys
from pathlib import Path
root = Path(__file__).resolve().parent
downloads = Path.home() / 'Downloads'
candidates = list(downloads.glob('vela-connection*.json')) + list(root.glob('vela-connection*.json'))
valid = []
for candidate in candidates:
    try:
        config = json.loads(candidate.read_text(encoding='utf-8-sig'))
        if config.get('APP_ORIGIN') == 'https://velatradingbot.vercel.app' and config.get('MT5_AGENT_TOKEN'):
            valid.append(candidate)
    except (OSError, ValueError):
        continue
if not valid:
    print('Download your connection file from VELA > Connections first. Keep it private.')
    raise SystemExit(1)
selected = max(valid, key=lambda item: item.stat().st_mtime)
print('Starting VELA with the latest connection file. Execution is disabled.', flush=True)
os.execv(sys.executable, [sys.executable, '-X', 'utf8', '-u', str(root / 'main.py'), '--config', str(selected)])
