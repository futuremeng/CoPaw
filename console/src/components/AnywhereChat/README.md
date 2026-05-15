# AnywhereChat 模块说明

## 目标

`AnywhereChat` 是嵌入式对话组件，负责在非主聊天页面中提供完整聊天交互能力。近期已对齐主聊天组件的关键能力，包括语音录制快捷键、会话搜索、计划面板、审批卡片和消息历史导航。

## 关键文件

- `index.tsx`
  - AnywhereChat 主组件
  - 负责 Runtime UI 接入、会话状态同步、附件上传、自动继续、审批/计划/搜索入口
- `ChatSearchPanel.tsx`
  - AnywhereChat 专用搜索面板
  - 支持关键词高亮和会话命中回调
- `history.ts`
  - 历史消息合并与尾部用户消息恢复逻辑

## 纯函数模块（可测试）

- `approvalVisibility.ts`
  - 计算审批卡片排序、可见列表和隐藏数量
- `searchHighlight.ts`
  - 将文本拆分为高亮/非高亮片段（用于搜索命中渲染）
- `shortcutGuard.ts`
  - 判定是否触发语音快捷键（Ctrl/Cmd + Shift + M）
- `searchAnchorRetry.ts`
  - 判定搜索锚点重试是否应停止

## 测试

- `approvalVisibility.test.ts`
- `searchHighlight.test.ts`
- `shortcutGuard.test.ts`
- `searchAnchorRetry.test.ts`
- `ChatSearchPanel.test.tsx`

## 维护约定

1. UI 状态机与判定逻辑尽量分离：复杂条件应优先抽到纯函数模块。
2. 新增交互前先评估会话隔离：避免跨会话全局变量污染。
3. 搜索和审批相关改动需覆盖测试：至少补充一条正向和一条边界用例。
4. 优先保证 AnywhereChat 与主聊天组件行为一致，再做差异化增强。
