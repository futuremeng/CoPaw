import json
from collections import Counter
from pathlib import Path

root = Path('/Users/futuremeng/.copaw/workspaces/default/projects/project-2ZHU4d/.knowledge/ner')
files = sorted(root.glob('*.ner.json'), key=lambda p: p.stat().st_mtime, reverse=True)
if not files:
    print('no_ner_files')
    raise SystemExit(0)

p = files[0]
d = json.loads(p.read_text(encoding='utf-8'))
mentions = [x for x in (d.get('entity_mentions') or []) if isinstance(x, dict)]
catalog = [x for x in (d.get('entity_catalog') or []) if isinstance(x, dict)]
label_mentions = Counter(str(x.get('label') or '').strip() or '(empty)' for x in mentions)
type_mentions = Counter(str(x.get('type') or '').strip() or '(empty)' for x in mentions)
label_catalog = Counter(str(x.get('label') or '').strip() or '(empty)' for x in catalog)

print('file=', p.name)
print('mtime=', p.stat().st_mtime)
print('mentions_count=', len(mentions))
print('catalog_count=', len(catalog))
print('has_type_field_in_mentions=', sum(1 for x in mentions if 'type' in x), '/', len(mentions))
print('mention_labels_top=', label_mentions.most_common(8))
print('mention_types_top=', type_mentions.most_common(8))
print('catalog_labels_top=', label_catalog.most_common(8))
print('has_ORG=', 'ORG' in label_mentions or 'ORG' in type_mentions)
print('has_GPE=', 'GPE' in label_mentions or 'GPE' in type_mentions)
print('has_LOC=', 'LOC' in label_mentions or 'LOC' in type_mentions)
