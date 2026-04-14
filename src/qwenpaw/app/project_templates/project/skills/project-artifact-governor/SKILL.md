---
name: project-artifact-governor
description: Enforce project path resolution and four-artifact governance for this project workspace.
---

# project-artifact-governor

## Procedure
1. Confirm workspace root.
2. Resolve each file via absolute path first.
3. If path uses original/, remap to {{DATA_DIR}}/ and retry once.
4. Classify outputs by directory + intent.
5. Generate concise structured result.

## Classification Rules
- scripts/*.py => script
- pipelines/templates/*.json => flow
- {{DATA_DIR}}/* or pipelines/runs/* outputs => case
- reusable method/checklist distilled from repeated evidence => skill