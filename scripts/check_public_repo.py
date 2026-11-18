"""Fail CI if private data or common credential formats enter the public repo."""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
bad_paths = re.compile(r'(^|/)(data/|\.env(?:\..*)?$|mangawatcher\.json$)|\.(?:sqlite3?|db|bak|pem|p12|pfx|key)$', re.I)
secrets = re.compile(rb'github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}')
failures = []
for name in filter(None, tracked):
    if bad_paths.search(name) and not name.endswith('.env.example'):
        failures.append(name + ': private file path')
        continue
    path = ROOT / name
    if path.is_file() and path.stat().st_size < 2_000_000 and secrets.search(path.read_bytes()):
        failures.append(name + ': credential pattern')
if failures:
    raise SystemExit('Public repository check failed:\n' + '\n'.join(failures))
print(f'Public repository check passed: {len(list(filter(None, tracked)))} tracked files')
