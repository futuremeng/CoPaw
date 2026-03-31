# Upstream Issue Draft: React flushSync warning in @agentscope-ai/chat

## Suggested Title

`@agentscope-ai/chat 1.1.56 triggers "flushSync was called from inside a lifecycle method" warning during chat/session flows`

## Suggested Labels

- bug
- frontend
- react
- chat

## Summary

When integrating `@agentscope-ai/chat` in a React 18 app, browser console shows:

> Warning: flushSync was called from inside a lifecycle method.

The warning appears in normal chat/session interactions. We verified this is not caused by local `node_modules` patching (none used), and the package source contains multiple `flushSync` callsites that can run during lifecycle/effect-driven update paths.

## Environment

- React: 18.x
- Package: `@agentscope-ai/chat@1.1.56`
- App: Vite + React + TypeScript
- Browser: Chrome (also reproducible in Chromium-based browsers)

## Reproduction (Minimal)

1. Install `@agentscope-ai/chat@1.1.56` in a React 18 app.
2. Render chat UI/session list components from this package.
3. Perform normal session operations:
   - load/open chat page
   - switch/create/remove/select session
   - send/stream messages
4. Open browser console.
5. Observe warning:
   - `Warning: flushSync was called from inside a lifecycle method`

## Expected Behavior

No React lifecycle warning in normal session/message flows.

## Actual Behavior

The warning appears repeatedly in chat/session operations, polluting console and making real regressions harder to detect.

## Evidence

The published package `@agentscope-ai/chat@1.1.56` includes multiple `flushSync` callsites, for example:

- `components/AgentScopeRuntimeWebUI/core/Chat/hooks/useChatMessageHandler.tsx`
- `components/AgentScopeRuntimeWebUI/core/Chat/hooks/useChatController.tsx`
- `components/AgentScopeRuntimeWebUI/core/Context/ChatAnywhereSessionsContext.tsx`
- `components/ChatAnywhere/hooks/useSessionList.tsx`
- `components/Bubble/hooks/usePaginationItemsData.tsx`

Also present in compiled `lib/*` counterparts.

## Impact

- Console noise in development and testing
- Harder to identify real runtime issues
- Causes concern for integrators even when business behavior is correct

## Notes From Integrator Side

- We avoided any direct `node_modules` patching.
- We already applied integration-level mitigations (e.g., deferring some route/session sync updates), but warning can still be triggered from package internals.
- This indicates root fix should be handled in package implementation.

## Requested Fix Direction

- Replace/limit `flushSync` usage in lifecycle-sensitive paths.
- Ensure updates are scheduled in a React-safe way for React 18 lifecycle/effect semantics.
- Add regression test to ensure no lifecycle warning is emitted in normal chat/session operations.

## Optional Attachments To Add Before Posting

- [ ] Full browser console stack trace screenshot
- [ ] Minimal repro repo link
- [ ] React/Browser exact version matrix

---

## 中文补充（给内部记录）

这条 warning 的根因在依赖包内部 `flushSync` 调用路径，不建议在业务仓库通过改 `node_modules` 规避。对上游 issue 的诉求应聚焦在包实现修复和回归测试覆盖。