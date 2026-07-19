# Agent API Surface Inventory

日期：2026-05-20

目标：盘点 InkFlow 当前 agent 相关 API surface，区分 active runtime entry、legacy shell、以及后续需要收口的接口。

## 1. Current Split

### A. Frontend DB / repository API layer

`src/lib/api.ts` 当前承担了一个很宽的前端调用面：

- `call(method, ...args)` 统一走 `/api/db`，见 [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:4)
- `EventSource('/api/db/events')` 提供共享 SSE 通知，见 [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:31)
- 从 [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:72) 开始导出大量 CRUD 包装函数
- 另外又并列存在 prompt / generation / extraction / production endpoints，例如：
  - `/api/extract-skill` 见 [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:162)
  - `/api/story-cards` 见 [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:216)
  - `/api/chapter-production-runs/start` 见 [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:299)
  - `/api/inspiration` 见 [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:402)

结论：

- 这里现在同时承担 repository client、stream status、LLM workflow client 三类职责

### B. Legacy local agent helper layer

`src/lib/agents.ts` 仍保留旧式本地 helper：

- `buildContextPrompt` 是活跃的上下文构造逻辑，见 [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:35)
- `filterEntities(entities: any[])` 仍有类型债，见 [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:53)
- `extractWorldSetupPhase` 与 `editorAgentPhase` 仍直接打服务端 endpoint，见 [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:142) 与 [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:160)
- `writerAgentPhase` / `criticAgentPhase` 已退化为抛错壳接口，明确提示迁移到 `/api/orchestrate` / `/api/audit`，见 [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:184) 与 [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:194)

结论：

- `agents.ts` 已经不是完整 active orchestration layer，更像“上下文构造 + 部分旧入口残留”

### C. Server active runtime entrypoints

服务端真实运行入口主要在 `server.ts`：

- `/api/story-cards` 见 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:904)
- `/api/setup-task-refine` 见 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:972)
- `/api/extract-world-setup` 见 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:1002)
- `/api/editor-agent` 见 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:1063)
- `/api/audit` 见 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:1315)
- `/api/orchestrate` 见 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:1433)
- `/api/chapter-production-runs/start` 见 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:1529)
- `/api/chapter-production-runs/start-stream` 见 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:1739)
- `/api/extract-skill` 见 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:2266)

结论：

- 当前主运行面已经偏向服务端编排，不再是前端本地 helper 主导

## 2. Proposed Classification

### Active

- `/api/orchestrate`
- `/api/audit`
- `/api/chapter-production-runs/start`
- `/api/chapter-production-runs/start-stream`
- `/api/story-cards`
- `/api/extract-skill`

### Transitional

- `/api/editor-agent`
- `/api/extract-world-setup`
- `src/lib/agents.ts` 中仍然直接 fetch 服务端但未完全合并的 helper

### Legacy shell

- `writerAgentPhase`
- `criticAgentPhase`

## 3. Refactor Direction

推荐收口目标：

1. `src/lib/api.ts`
   - 保留为 frontend transport layer
   - 进一步分成：
     - `db-client`
     - `prompt-client`
     - `production-client`

2. `src/lib/agents.ts`
   - 收窄成：
     - context builder
     - typed adapters only
   - 删除长期无调用方的 legacy shell

3. `server.ts`
   - 继续作为 active runtime entry owner
   - 后续按 domain 提炼 route handlers，但这不是第一轮必须项

## 4. Immediate Next Steps

1. 搜索 `writerAgentPhase` / `criticAgentPhase` 的调用方
2. 确认 `editorAgentPhase` 是否仍是必要公开接口
3. 若无调用方，直接安排删除 legacy shell
4. 若仍有调用方，改成明确 adapter，并加 deprecation test

## 5. Acceptance

完成第一轮 API 收口盘点后，应能回答：

1. 哪些接口是现在真正主入口
2. 哪些接口只是迁移残留
3. 哪些文件应该先拆 transport，再拆 orchestration
