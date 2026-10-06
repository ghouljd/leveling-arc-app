"""Empaqueta dist para el Worker de Cloudflare con activos estáticos."""
import hashlib
import json
import re
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
required = ['index.html', 'sw.js', 'manifest.webmanifest', '_headers', 'robots.txt', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png']
for name in required:
    if not (dist / name).is_file():
        raise SystemExit(f'Falta {name}; ejecutar npm run build primero.')
manifest = json.loads((dist / 'manifest.webmanifest').read_text())
assert manifest['display'] == 'standalone'
for icon in manifest['icons']:
    assert (dist / icon['src'].lstrip('/')).is_file()
sw = (dist / 'sw.js').read_text()
precache = json.loads(re.search(r'PRECACHE=(\[.*?\]);', sw).group(1))
for url in precache:
    assert (dist / ('index.html' if url == '/' else url.lstrip('/'))).is_file(), url
files = sorted(p for p in dist.rglob('*') if p.is_file())
assert len(files) < 1000
for p in files:
    assert p.stat().st_size < 25 * 1024 * 1024
    assert not p.is_symlink()
    assert p.name == '_headers' or p.suffix in {'.html', '.js', '.css', '.webmanifest', '.png', '.txt'}, p.name
    if p.suffix in {'.html', '.js', '.css', '.webmanifest', '.txt'}:
        content = p.read_text()
        assert not re.search(r'sb_secret_[A-Za-z0-9_-]{20,}', content)
        assert not re.search(r'-----BEGIN (?:RSA )?PRIVATE KEY-----[A-Za-z0-9+/=\s]{64,}', content)
filename = sys.argv[1] if len(sys.argv) > 1 else 'winter-arc-cloudflare.zip'
assert re.fullmatch(r'winter-arc-[a-z0-9-]+\.zip', filename), 'Nombre de paquete inválido'
out = root.parent / 'Entregas' / filename
out.parent.mkdir(exist_ok=True)
with ZipFile(out, 'w', compression=ZIP_DEFLATED) as archive:
    for p in files:
        archive.write(p, p.relative_to(dist).as_posix())
with ZipFile(out) as archive:
    assert archive.testzip() is None
    assert 'index.html' in archive.namelist()
checksum = hashlib.sha256(out.read_bytes()).hexdigest()
out.with_suffix('.sha256').write_text(checksum + '  ' + out.name + '\n')
print(json.dumps({'archive': str(out), 'files': len(files), 'bytes': out.stat().st_size, 'sha256': checksum, 'precacheFilesVerified': len(precache)}))
