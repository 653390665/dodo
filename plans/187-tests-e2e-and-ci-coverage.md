# Plan 187: 测试补强二期——四大视图 E2E、真实管线旅程、CI 去重与覆盖率门槛棘轮

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- tests/e2e .github/workflows/build.yml vitest.config.frontend.ts playwright.config.ts package.json`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED（真实管线 E2E 有时序 flaky 风险；CI/覆盖率改动影响门禁口径）
- **Depends on**: none（真实管线 E2E 建议在 Plan 182/182 落地后验收体验）
- **Category**: tests + dx
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

1. **WorldBible / AgentWorkspace / BookFactory / ProjectCockpit 四大真实功能面零 E2E**——它们的跨层接线只被 mock 掉 transport 的 jsdom 单测覆盖，payload 契约漂移不会有任何 E2E 变红；AgentWorkspace 是近 60 天第二高改动区。
2. **旗舰 E2E 全部 stub 生产流端点**——`core-flow.spec.ts` 拦截 `start-stream`/`apply`，fixture 事件序列是手写的；真实路由演进后 E2E 仍全绿而生产 UI 坏掉。仓库已有确定性快路径（空 apiKey → fallback 事件）未被 E2E 利用。
3. **CI 把最贵的两段各跑两遍**（test 与 coverage 版本），15 分钟预算偏紧。
4. **前端覆盖率门槛（branches 33%）只防删测试**；后端 90% 门基于 node 原生覆盖率（只统计已加载模块），系统性虚高。

## Current state

相关文件与角色：

- `tests/e2e/` — 12 个 spec；`unified-creation-new-project.spec.ts:17-112` 是 `page.route` fixture 模式的范本
- `playwright.config.ts:40-56` — webServer：`DISABLE_VITE_DEV_MIDDLEWARE=1 node --import tsx server.ts`，端口 3001，`PLAYWRIGHT_TEST: 'true'`，env 可注入
- `tests/production-stream-disconnect.test.ts:44-46` — 空 apiKey/`promptGuardLevel: 'disabled'` → 确定性 fallback 事件的既有路径
- `.github/workflows/build.yml` — check job（`grep -n "npm run test" .github/workflows/build.yml` 列出重复步骤）
- `vitest.config.frontend.ts:18-23` — thresholds statements 40 / branches 33 / functions 32 / lines 42；`maxWorkers: 1`
- `TEST_REPORT_2026-08-17.md` — 记录 114 文件一次跑 OOM（exit 137），现 122 文件

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| E2E 全量 | `npx playwright test`（需先 `npm run build`） | 全绿 |
| E2E 单文件 | `npx playwright test tests/e2e/<spec>.spec.ts` | 全过 |
| 前端覆盖率 | `npm run test:coverage:frontend` | 门槛通过并输出真实值 |
| 后端覆盖率 | `npm run test:coverage:backend` | 通过（口径见 Step 5） |

## Scope

**In scope**：

- `tests/e2e/world-bible-journey.spec.ts`、`agent-workspace-journey.spec.ts`、`book-factory-journey.spec.ts`、`cockpit-journey.spec.ts`（新建）
- `tests/e2e/real-pipeline-journey.spec.ts`（新建，真实 start-stream→apply）
- `playwright.config.ts`（如需为 real-pipeline 注入 env）
- `.github/workflows/build.yml`（去重 + timeout）
- `vitest.config.frontend.ts`（门槛棘轮 + pool 评估）

**Out of scope**：

- 移动端 spec、视觉回归
- 后端覆盖率工具替换为 c8（作为 Step 5 的调查结论输出，不强制实施）
- Electron 打包链路测试

## Git workflow

每类一次提交；消息如 `test(e2e): world bible minimal journey`；完成即提交，不 push。

## Steps

### Step 1: 四大视图最小旅程 spec

每个视图一条 spec，模式照 `unified-creation-new-project.spec.ts`（`page.route` 确定性 fixture + 真实 `/api/db` 写 + 断言回显；LLM 端点一律 stub）。每个 spec 三段式：

- **world-bible-journey**：从书选一章 → 进 world 视图（经 Plan 175 的入口；若 174 未落地则用 `page.evaluate` 直调导航或 URL hash——以现有导航机制为准，`grep -n "currentView" src/components/AppShell.tsx` 确认视图切换载体）→ 新建一个角色条目 → 断言列表回显。
- **agent-workspace-journey**：打开工作台智能管家 → 断言知识/生产/追踪面板挂载 → 触发一次生产 run 创建（stub LLM 流）→ 断言 run 状态徽标出现。
- **book-factory-journey**：进拆书工厂 → 上传 txt（`setInputFiles` 小文本）→ stub extract 端点 → 断言技能卡生成回显。
- **cockpit-journey**：选书进驾驶舱（同上入口策略）→ 断言行动推荐卡片渲染 → 点击一条推荐 → 断言跳转到编辑器（不 stub cockpit 的静默执行——那是 spec 行为）。

**Verify**: `npx playwright test tests/e2e/world-bible-journey.spec.ts tests/e2e/agent-workspace-journey.spec.ts tests/e2e/book-factory-journey.spec.ts tests/e2e/cockpit-journey.spec.ts` → 全过

### Step 2: 真实管线旅程（不打 page.route）

新建 `tests/e2e/real-pipeline-journey.spec.ts`：

1. `playwright.config.ts` 的 webServer env 追加 `API_KEY: ''`（空 key → 生产路由产出确定性 fallback 事件，同 `tests/production-stream-disconnect.test.ts:44-46` 机制）；必要时加 `PROMPT_GUARD_LEVEL: 'disabled'` 等价 env（`grep -n "promptGuardLevel\|PROMPT_GUARD" server/lib/config.ts` 核对 env 名）。
2. spec 流程：选书 → 选章 → 点生成正文 → **不拦截** `/api/db` 与 `chapter-production-runs/start-stream` → 轮询断言（`expect.poll`）候选卡片出现 → 接受 → 断言 `getChapter` 回读的 content 为 fallback 草稿特征（非空即可）。
3. 该 spec 单独 `test.describe.configure({ retries: 1 })` 容忍一次时序抖动；总超时放宽（`test.setTimeout(120_000)`）。

**Verify**: `npx playwright test tests/e2e/real-pipeline-journey.spec.ts` → 连跑 3 次全过（`--repeat-each=3`）

### Step 3: CI 去重与预算

`.github/workflows/build.yml` check job：删除纯 `npm run test` 与 `npm run test:frontend` 步骤（coverage 版本已蕴含 pass/fail），保留 coverage 步骤；`timeout-minutes: 15` → `25`。

**Verify**: `grep -c "npm run test:" .github/workflows/build.yml` 较改前减少 2；workflow YAML 语法检查（本地 `node -e "require('js-yaml')"` 可省，靠 push 后 CI 首跑验证，报告注明）

### Step 4: 前端覆盖率门槛棘轮

1. `npm run test:coverage:frontend` 记录真实 statements/branches/functions/lines（OOM 风险见 Step 6）。
2. `vitest.config.frontend.ts:18-23` 门槛设为「真实值向下取整到个位」——棘轮从当前真实水平开始，杜绝虚低门槛。
3. README 或 plans/README 记录新基线数字与本计划日期。

**Verify**: `npm run test:coverage:frontend` 退出码 0 且输出的真实值 ≥ 新门槛

### Step 5: 后端覆盖率口径调查（只调查 + 文档化）

跑一次 `npm run test:coverage:backend`，对比「被任何测试 import 过的路由文件」清单（`grep -rln "registerRoutes\|register.*Routes" tests/ | wc -l` vs `ls server/routes/ | wc -l`）。结论写进 `plans/README.md` 本计划行备注：node 原生覆盖率未覆盖的分母有哪些（预期 `chapter-completion.ts` 等零挂载文件）。是否换 c8 作为结论输出，不实施。

**Verify**: plans/README 备注含未覆盖文件清单

### Step 6: 前端套件内存韧性

`vitest.config.frontend.ts`：`pool: 'threads'` → 评估 `pool: 'forks'`（jsdom + 大组件树在 threads 单 worker 下是 OOM 记录的成因）。跑全量验证内存与时长；若 forks 后仍接近 OOM，在 README「开发指南」补一行「低内存机器分批跑法」（`node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/a*` 分段示例）。以实测数据为准，报告中给出前后内存/时长对比（`/usr/bin/time -l` 采样）。

**Verify**: `npm run test:frontend` 全绿且未 OOM；报告含实测对比

## Test plan

本计划全部产出即测试；回归为 E2E 全量 + 前后端测试全绿。

## Done criteria

- [ ] 5 个新 spec 通过；`npx playwright test` 全量全绿
- [ ] real-pipeline spec `--repeat-each=3` 稳定
- [ ] CI 步骤去重完成、timeout 25
- [ ] 覆盖率门槛棘轮完成并记录基线
- [ ] 后端覆盖率口径备注写入 plans/README
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 四视图任一在 E2E 环境下无法稳定进入（依赖 Electron-only API）——报告该视图的阻塞点，允许将该视图降级为「HTTP 层契约测试」并在报告说明。
- real-pipeline 的 fallback 路径在空 key 下不再产出确定性事件（生产路由已改）——报告新行为，重新设计断言前 STOP。
- CI 去重后 coverage 步骤超 25 分钟——恢复双跑并报告实测时长，棘轮另议。

## Maintenance notes

- 评审关注点：fixture stub 与真实契约的漂移正是本计划要治的病——新增 spec 尽量少 stub（只 stub LLM），`/api/db` 走真实链路。
- Plan 175 落地后 cockpit-journey 的入口步骤应改用真实切换器；Plan 174 落地后 world-bible-journey 需处理删除确认弹窗（点确认）。
- 覆盖率棘轮是持续机制：每次大功能合入后顺手 +1~2，防止门槛腐化。
