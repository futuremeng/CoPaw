# Projects Frontend-Backend Alignment Matrix

Last updated: 2026-05-28
Scope: Project workspace and ProjectDetailPage alignment between frontend (`console`) and backend (`src/qwenpaw/app/routers`).

## Alignment Rules (Must)

1. Naming style must align with upstream conventions for file names, symbol names, and type names.
2. Project page must not call low-level API modules directly; it should go through domain facades/adapters.
3. Facade imports in page layer must use hooks barrel exports.
4. Any intentional divergence from upstream style must be documented in the PR summary.

## Current Status Summary

- Data-layer decoupling: **Done**
- Page-level direct API decoupling: **Done**
- Contract/error semantics hardening: **Partial** (frontend normalize baseline done)
- UX parity with workspace flows: **Partial**
- Large-scale performance parity: **Not done**

## Capability Matrix

| Capability | Backend | Frontend API | Page/Facade | Status | Gap |
|---|---|---|---|---|---|
| Query project files | `coding_project` + agents project APIs | `agentsApi.queryProjectFiles` | `projectScopedAdapter.queryFiles` -> `useProjectWorkspaceFacade` | Done | - |
| Project file tree | project file-tree APIs | `agentsApi.listProjectFileTree` | `projectScopedAdapter.listTree` -> facade | Done | - |
| Read/write/move/delete/upload (project) | project file APIs | `agentsApi.*` | adapter + facade | Done | - |
| File summary | project summary API | `agentsApi.getProjectFileSummary` | `adapter.getFileSummary` -> facade | Done | - |
| Pipeline list/run/retry/import | pipeline APIs | `agentsApi.*` | `useProjectPipelineFacade` | Done | error semantics still string-heavy |
| Agent/project list/delete/watch lease | agent/project APIs | `agentsApi.*` | `useProjectAgentFacade` | Done | lease lifecycle can be more observable |
| Workspace file ops (`mkdir/move/delete`) | `workspace.py` | `workspaceApi` | `workspaceScopedAdapter` | Partial | backend capability still missing or not fully mapped |
| SSE watch/reconnect policy | `/workspace/watch` + clone stream | custom fetch readers | adapter/UI local impl | Partial | no unified SSE client |
| Binary constraints precheck (size/mime) | backend validation | binary endpoints | UI preview/upload flow | Partial | precheck is incomplete |
| Large directory scalability | recursive listing | `/workspace/code-files` | local filter/sort in adapter | Not done | needs pagination or tree-by-dir contract |

## Work Packages

Progress note (2026-05-28): Added shared frontend error normalizer for Projects facades/adapters with contract tests covering `status/code/message` mapping and inference.
Progress note (2026-05-28): Rolled out structured backend error detail (`detail.code`, `detail.message`) for first batch of project file operations (upload/delete/mkdir/move).

### WP-A (Contract Baseline)

1. Introduce structured error codes for key backend endpoints used by Projects.
2. Add frontend error normalization mapping (`status + code + message`) in facades.
3. Add contract tests for conflict/invalid-path/not-found/permission mapping.

Deliverables:
- Backend error response shape spec
- Frontend normalize helpers and tests

### WP-B (UX Parity)

1. Align file area interactions with workspace behavior: loading/empty/error states and batch flows.
2. Surface realtime/task conflict/recovery state in primary view instead of implicit logs.
3. Render `recent_error_source` and `recovery_hint` with actionable recovery buttons.

Deliverables:
- Updated `ProjectDetailPage` and related panels
- UX-oriented tests for visible state transitions

### WP-C (Performance and Reliability)

1. Replace full-list heavy flows with paged/dir-scoped listing for large repositories.
2. Add a shared SSE client utility (heartbeat, reconnect, frame parsing).
3. Add binary/upload precheck to match backend constraints before request.

Deliverables:
- API contract updates
- frontend adapter updates
- reliability/perf verification logs

## Verification Gates

1. `ProjectDetailPage.architecture.test.ts` passes (no direct low-level API usage).
2. Facade/adapters tests are all green.
3. Contract tests cover structured error mapping.
4. Manual validation includes:
   - refresh/resume correctness,
   - SSE interruption recovery,
   - conflict handling feedback,
   - large-directory responsiveness.
