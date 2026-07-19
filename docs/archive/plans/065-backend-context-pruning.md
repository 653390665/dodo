# Plan 065: 对接 Context Pruning 至章节生成后端

## Goal
目前前端已实现活跃实体（人物、地点、道具）的嗅探与选择，但后端 `/api/chapter-production-runs/start` 仍然无脑加载全量 World Bible 词条注入 LLM。本计划旨在打通章节级局部变量过滤（Context Pruning），仅注入本章活跃的设定。

## Proposed Changes

### [MODIFY] [production.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/production.ts)
- 在 `/api/chapter-production-runs/start` 路由中，解析 `req.body` 中的 `activeEntityIds?: string[]` 参数。
- 修改 `buildProductionWriterContext` 或相关 Prompt 组装逻辑：
  - 如果提供了 `activeEntityIds`，则在获取 `characters`、`locations`、`items` 等列表时，过滤出 ID 存在于 `activeEntityIds` 中的实体。
  - 对于未被激活的实体，完全不塞入 Prompt，或者仅保留一行极为简短的摘要。

### [MODIFY] [EditorView.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/EditorView.tsx)
- 在触发章节生产请求时，从 Trace Panel 或组件 State 中提取出当前章节已 Pin/嗅探出的活跃实体 ID 列表，并作为 `activeEntityIds` 传入 POST 请求体。

## Verification Plan
1. 运行 `npx tsc --noEmit` 确保无编译错误。
2. 启动服务，在前端“场景追踪”面板中 Pin 一个角色并排除其他角色，发起章节生成。
3. 观察后端日志，确保注入给 LLM 的 Prompt 中只包含被 Pin 角色的详细设定。
