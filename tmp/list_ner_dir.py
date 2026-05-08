from pathlib import Path

root = Path('/Users/futuremeng/.copaw/workspaces/default/projects/project-2ZHU4d/.knowledge/ner')
print('exists=', root.exists())
if root.exists():
    entries = sorted(root.glob('*'))
    print('count=', len(entries))
    for p in entries[:20]:
        print(p.name)
