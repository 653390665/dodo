# Plan 219: AGENTS.md 测试命令地图——消灭「npm test 全绿假象」（DX-01）

> **Executor instructions**: 按步骤顺序执行。完成后更新 `plans/README.md` 中本计划的状态行。

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx（验证基线缺口）
- **Planned at**: commit `d6c2ed2`, 2026-09-15（发现：improve 四路审计 DX-01）

## Why this matters

`package.json` 的 `test` 脚本只跑 `tests/*.test.ts`（后端 node:test）；133 个前端测试文件（src/tests，vitest）不在其中。AGENTS.md 的 Validation 节只写「Run the smallest relevant validation after edits」，无任何命令——按 improve playbook 这是验证基线缺口：任何 agent/贡献者改完 `src/` 跑 `npm test` 得到全绿假象。

## Current state（2026-09-15 亲读核实，锚点基于 `d6c2ed2`）

- `package.json:15` `"test": "NODE_ENV=test node --test ... tests/*.test.ts"`；`test:frontend`（vitest）与 `test:all`（含 build+E2E，非日常用）各自独立；无两套件聚合的非 E2E 脚本。
- AGENTS.md「Validation」节：三行原则性描述，零具体命令。

## Steps

### Step 1: package.json 增聚合脚本

`"test:unit": "npm test && npm run test:frontend"`（不含 build/E2E，日常可跑）。

**Verify**: `npm run test:unit` 两套件先后全绿

### Step 2: AGENTS.md 增命令地图

在 Validation 节追加：

```markdown
## 测试命令地图（改哪里跑什么）
- 改 `server/`、`shared/` 后端逻辑 → `npm test`（定向：`node --test --import tsx tests/<file>`）
- 改 `src/` 前端 → `npm run test:frontend -- src/tests/<file>`（全量：`npm run test:frontend`）
- 改 `shared/` 前后端共享契约 → 两者都跑
- UI 主链路改动 → `npx playwright test`（自动 build）
- 提交前一键：`npm run test:unit`（两套单测，不含 build/E2E）
```

**Verify**: 文档落盘；地图中每条命令逐条实际执行一次确认可跑

## Done criteria

- [ ] `test:unit` 脚本可用；AGENTS.md 命令地图每条命令实测通过
- [ ] 台账落账

## STOP conditions

- 无。
