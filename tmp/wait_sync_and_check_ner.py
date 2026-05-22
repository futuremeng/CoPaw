import json
import time
import urllib.request
from pathlib import Path

status_url = 'http://localhost:5173/api/knowledge/project-pipeline/status?project_id=project-2ZHU4d'
ner_dir = Path('/Users/futuremeng/.copaw/workspaces/default/projects/project-2ZHU4d/.knowledge/ner')

deadline = time.time() + 90
last = None
while time.time() < deadline:
    with urllib.request.urlopen(status_url, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    snap = {
        'status': data.get('status'),
        'stage': data.get('current_stage'),
        'started': data.get('last_started_at'),
        'finished': data.get('last_finished_at'),
        'updated': data.get('updated_at'),
    }
    if snap != last:
        print('status=', snap)
        last = snap
    if data.get('status') in {'succeeded', 'failed'}:
        break
    time.sleep(3)

files = sorted(ner_dir.glob('*.ner.json'), key=lambda p: p.stat().st_mtime, reverse=True)
print('ner_count=', len(files))
if files:
    p = files[0]
    d = json.loads(p.read_text(encoding='utf-8'))
    print('latest=', p.name)
    print('mtime=', p.stat().st_mtime)
    print('mentions=', len(d.get('entity_mentions') or []))
    print('catalog=', len(d.get('entity_catalog') or []))
