import json
import urllib.request

url = 'http://localhost:5173/api/knowledge/project-sync/status?project_id=project-2ZHU4d'
with urllib.request.urlopen(url, timeout=30) as resp:
    data = json.loads(resp.read().decode('utf-8'))

keys = [
    'status', 'current_stage', 'stage_message', 'progress', 'last_started_at', 'last_finished_at', 'updated_at', 'last_error'
]
print({k: data.get(k) for k in keys})
l2 = data.get('l2_metrics') or {}
print('l2=', {k: l2.get(k) for k in ['total_chunks','ner_done_chunks','ner_entity_count','syntax_done_chunks']})
sem = data.get('semantic_engine') or {}
print('semantic=', {k: sem.get(k) for k in ['status','reason_code','reason']})
