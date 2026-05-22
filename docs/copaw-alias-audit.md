# CoPaw Alias Audit (copaw as qwenpaw compatibility namespace)

Date: 2026-05-07

## Rule

copaw should behave as a live compatibility alias of qwenpaw.
Shared module ownership should stay in qwenpaw, while copaw provides thin forwarding shims.
copaw-specific capabilities should be added only as modules not present in qwenpaw.

## Findings Summary

- Shared Python modules compared: 27 with content differences
- copaw-only modules (extension-allowed): 5
- qwenpaw-only modules: 442
- High-priority rule violations: 12

## Conformant (extension-allowed)

These modules exist only in copaw and align with the extension rule:

- src/copaw/knowledge/architecture.py
- src/copaw/knowledge/enrichment_pipeline.py
- src/copaw/knowledge/facades.py
- src/copaw/knowledge/graphify_provider.py
- src/copaw/knowledge/local_graph_provider.py

## Non-conformant: Reverse Alias Direction (P0)

qwenpaw currently imports from copaw for shared modules, which inverts ownership:

- src/qwenpaw/knowledge/graph_ops.py
- src/qwenpaw/knowledge/hanlp_runtime.py
- src/qwenpaw/knowledge/manager.py
- src/qwenpaw/knowledge/module_skills.py

## Non-conformant: Dual Shared Implementation Drift (P1)

These are shared-path modules where copaw is not a thin forward shim and differs from qwenpaw implementation:

- src/copaw/__init__.py
- src/copaw/knowledge/__init__.py
- src/copaw/agents/tools/__init__.py
- src/copaw/agents/tools/graph_query.py
- src/copaw/agents/tools/memify_run.py
- src/copaw/agents/tools/memify_status.py
- src/copaw/agents/tools/triplet_focus_search.py

## Recommended Adjustment Order

1. Flip P0 reverse shims first:
   - Move canonical knowledge implementation ownership to qwenpaw/* for the 5 modules above.
   - Convert copaw counterparts to thin forwarding wrappers to qwenpaw.

2. Remove P1 dual drift in shared modules:
   - Keep only one canonical implementation in qwenpaw.
   - Convert copaw shared-path modules to lightweight forwarding wrappers.

3. Add CI guardrails:
   - Block new reverse shims (qwenpaw importing copaw for shared paths).
   - Block non-shim drift on shared paths unless explicitly waived.

## Suggested Guardrail Checks

- Reverse import detection in src/qwenpaw: fail if shared modules contain "from copaw." imports.
- Shared-path parity policy:
  - either exact match,
  - or copaw thin shim to qwenpaw.
- Extension whitelist:
  - allow copaw-only modules only under approved extension directories.

## Upstream Comparison Mode

Use the boundary check script to compare current state against an upstream ref.

- Local boundary check:
   - `python scripts/check_namespace_boundaries.py`
- Compare against upstream ref:
   - `python scripts/check_namespace_boundaries.py --upstream-ref agentscope-ai/main`

Recommended policy:

- Block merges when `reverse_imports` is non-zero for non-allowlisted files.
- Block merges when `non_thin_shared` grows versus upstream baseline.
- Keep extension-only modules in copaw under approved prefixes.
