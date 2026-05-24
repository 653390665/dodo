# InkFlow Code Quality Assessment

日期：2026-05-20  
模式：sampled assessment  
仓库路径：`/Users/Zhuanz/Documents/dodo-inkflow`

## User-confirmed facts

- 本次评估目标是 `dodo-inkflow`
- 评估用途是质量基线与优化优先级排序，不是发布结论

## Repository evidence

### Assessment scope

- Scale: `197` files
- Sampling strategy: medium/large boundary sampled assessment
- Files sampled:
  - [package.json](/Users/Zhuanz/Documents/dodo-inkflow/package.json:1)
  - [README.md](/Users/Zhuanz/Documents/dodo-inkflow/README.md:1)
  - [src/components/AgentWorkspace.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/AgentWorkspace.tsx:24)
  - [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:4)
  - [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:35)
  - [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:904)
  - [tests/prompt-runtime.test.ts](/Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-runtime.test.ts:6)
  - [tests/audit-five-dimension-contract.test.ts](/Users/Zhuanz/Documents/dodo-inkflow/tests/audit-five-dimension-contract.test.ts:5)
- Files not inspected:
  - 多数组件细节
  - 多数数据库测试
  - 长尾 prompt research vendor 目录

### Key evidence

1. 工程脚本比较完整，包含 `lint`、`smoke:runtime`、`build:electron`、`package`，见 [package.json](/Users/Zhuanz/Documents/dodo-inkflow/package.json:9)
2. README 对用户路径、安装和创作流程说明较完整，见 [README.md](/Users/Zhuanz/Documents/dodo-inkflow/README.md:1)
3. `AgentWorkspace` 同时承担了大量 tab 编排与多类 props，见 [src/components/AgentWorkspace.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/AgentWorkspace.tsx:24) 和 [src/components/AgentWorkspace.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/AgentWorkspace.tsx:177)
4. `api.ts` 同时承载 CRUD、SSE、story cards、production runs、LLM prompt endpoints，见 [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:4) 和 [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:208)
5. `agents.ts` 里仍有迁移残留和类型债，例如 `any[]`、`Promise<any>`、已退化为抛错壳的接口，见 [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:53) 与 [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:184)
6. 服务端真实主入口已经偏向统一编排流，例如 `/api/orchestrate`、`/api/audit`、`/api/chapter-production-runs/start-stream`，见 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:1315) 和 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:1433)
7. prompt/runtime contract test 已存在，见 [tests/prompt-runtime.test.ts](/Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-runtime.test.ts:6)
8. quality gate / audit contract test 已存在，见 [tests/audit-five-dimension-contract.test.ts](/Users/Zhuanz/Documents/dodo-inkflow/tests/audit-five-dimension-contract.test.ts:5)

## Inferences

- InkFlow 已经不是简单原型，而是功能较全的桌面写作应用
- 当前优化的关键不在“功能不够”，而在“主工作台和 agent surface 的结构收口”

## Unknowns / limits

- 没有全量阅读所有测试，不能断言测试覆盖已足够
- 没有 fresh 跑 `npm run lint` / `runtime-smoke`，因此不声明当前构建状态
- 没有逐个检查 server route 的内部实现细节，只确认了入口分布

## Composite score

| Dimension | Weight | Score | Grade |
|---|---:|---:|---|
| Readability & Style | 25% | 75 | B |
| Architecture Design | 25% | 77 | B |
| Refactoring Health | 20% | 72 | B |
| Engineering Practices | 15% | 83 | A |
| Code Smell Detection | 15% | 66 | C |
| **Weighted Total** | 100% | **75.0** | **B** |

## Dimension details

### Readability & Style — 75 (B)

优点：

- `package.json`、README、prompt/runtime 相关命名较统一
- prompt surface mapping 的测试意图清晰，见 [tests/prompt-runtime.test.ts](/Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-runtime.test.ts:6)

扣分：

- `AgentWorkspace` props 面过宽，阅读成本高，见 [src/components/AgentWorkspace.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/AgentWorkspace.tsx:24)
- `api.ts` 的统一 transport 文件过大，语义混杂，见 [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:4)

### Architecture Design — 77 (B)

优点：

- 服务端主入口已经清楚地集中在 `server.ts`
- prompt/runtime contract 已单独抽到测试层

扣分：

- `api.ts` 同时承担 repository client、SSE、LLM workflow transport 三类职责
- `agents.ts` 既保留 context builder，又残留旧入口壳接口，边界不够干净

### Refactoring Health — 72 (B)

优点：

- 已经开始把生产流和 prompt/runtime 抽成独立模块

扣分：

- `writerAgentPhase` / `criticAgentPhase` 这类迁移残留表明旧路径尚未完全退出，见 [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:184)
- 大工作台组件和宽 API 面说明 change locality 仍偏差

### Engineering Practices — 83 (A)

优点：

- build/lint/package/smoke 脚本齐全，见 [package.json](/Users/Zhuanz/Documents/dodo-inkflow/package.json:9)
- README 面向最终用户的说明比较扎实
- prompt/runtime 与 audit contract tests 已建立

扣分：

- 这次没有 fresh verification 证据，因此不能把“脚本存在”直接等同于“当前都通过”

### Code Smell Detection — 66 (C)

主要 smell：

- `Large Component`: `AgentWorkspace`
- `Wide Transport Layer`: `api.ts`
- `Stale Compatibility Layer`: `agents.ts` 里的旧 agent 壳接口
- `Type Escape`: `any[]` / `Promise<any>`

## Top improvements

1. **[High] 拆分 `AgentWorkspace` 的 orchestration 层**
   - Evidence: [src/components/AgentWorkspace.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/AgentWorkspace.tsx:24)
   - Direction: 先拆 `ProductionPanel`、`KnowledgePanel`、`DiagnosticsPanel`

2. **[High] 收口 `src/lib/agents.ts` 的迁移残留**
   - Evidence: [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:184)
   - Direction: 删除无调用方旧接口，或改成 typed adapter

3. **[High] 拆分 `api.ts` 的 transport 职责**
   - Evidence: [src/lib/api.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts:4)
   - Direction: 区分 db client、prompt client、production client

4. **[Medium] 清理类型逃逸**
   - Evidence: [src/lib/agents.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/lib/agents.ts:53)
   - Direction: 先从 `any[]`、`Promise<any>`、trace entity map 的 `any` 开始

5. **[Medium] 把 runtime / fallback 观测统一成可追踪模型**
   - Evidence: server 入口与 production endpoints 已成体系，见 [server.ts](/Users/Zhuanz/Documents/dodo-inkflow/server.ts:1529)
   - Direction: beats / draft / audit source 统一记录为 `model | fallback`

## Highlights

1. InkFlow 的产品完成度和工程完成度已经超过“prompt demo”，有明确的桌面应用主线
2. prompt/runtime contract test 与 audit contract test 已经把最脆弱的 AI 行为层部分锁住了一部分
