import json
import time
import urllib.request

url = 'http://localhost:5173/api/knowledge/project-pipeline/status?project_id=project-2ZHU4d'
vals = []
for _ in range(3):
    with urllib.request.urlopen(url, timeout=30) as resp:
        d = json.loads(resp.read().decode('utf-8'))
    vals.append((d.get('status'), d.get('last_started_at'), d.get('updated_at')))
    time.sleep(1)
for i, item in enumerate(vals, start=1):
    print(i, item)
