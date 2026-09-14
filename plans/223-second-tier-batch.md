# Plan 223: 第二梯队打包——8 项 S 级发现批处理（DX-02/04、CORR-04/05、DOCS-03、DEPS-03、覆盖率分母、env 文档）

> **Executor instructions**: 8 项相互独立，每项单独 commit（便于回滚与 review）。每项完成后跑该项 Verify。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat d6c2ed2..HEAD -- .github/workflows/build.yml package.json vitest.config.frontend.ts server/routes/db.ts README.md .env.example src/lib/product-events-client.ts src/components/Library.tsx`
> 若有变更，先对照各项 Current state 核对；不一致视为该项 STOP。

## Status

- **Priority**: P3（8 项 S 级发现打包，单项影响中低但总量可观）
- **Effort**: M（8 项合计）
- **Risk**: LOW（各项均小改）
- **Depends on**: none（⑧ 与 212 的关系见该项 Current state）
- **Category**: tech-debt + dx + docs
- **Planned at**: commit `d6c2ed2`, 2026-09-15（发现：improve 四路审计第二梯队）

## Why this matters

8 项 S 级发现的打包批次，单项不值得一计划、合计值得一次清账：双构建浪费、下载时序缺陷、README 两处失实、env 文档缺口、导出裸文件 fallback 违背备份规范精神、prepare 吞错、未使用依赖、覆盖率报告失真。

## Current state（2026-09-15 亲读核实，锚点基于 `d6c2ed2`）

① **双构建**：`.github/workflows/build.yml:83-86` 已先 `npm run build` 再 `npx playwright test`；`playwright.config.ts` webServer command 又 `npm run build && ...`（212 加的）；`test:all` 同样先 build——同一链路 vite build 跑两遍。
② **同步 revokeObjectURL**：`src/lib/product-events-client.ts:65`、`src/components/Library.tsx:248` 在 `a.click()` 后立即 revoke；对照 `src/lib/download-client.ts:43-48` 的 `setTimeout(() => URL.revokeObjectURL(url), 0)` 延迟模式。
③ **README 失实**：`README.md:239`「3 秒防抖」vs `src/lib/editor-write-queue.ts:94` `delayMs = 1000`（调用方未覆盖）；状态表验证日期 2026-08-17。
④ **env 文档缺口**：README:272 宣称「全部运行时环境变量见 .env.example」，未收录的运行时旋钮：`INKFLOW_RATE_LIMIT_SCALE`（rate-limit.ts:12）、`INKFLOW_ONBOARDING_GRANT_SCALE`、`INKFLOW_NOTIFY_PROBE_THRESHOLD`（db-instance.ts:217）、`INKFLOW_INDEX_BACKFILL_DEBOUNCE_MS`/`INKFLOW_INDEX_BACKFILL_MIN_CHARS`（chapter-index.ts:26,31）、`INKFLOW_PACKAGED_PORT`（electron.cjs:131）。
⑤ **导出裸文件 fallback**：`server/routes/db.ts:402-403` `else if (existsSync(DB_PATH)) res.download(DB_PATH, 'inkflow-data.db')`——未初始化但文件在场时直接下发主库（WAL 下可能缺最新提交），与 docs/specs/sqlite-backup.md「一律 db.backup() 快照」精神不一致。
⑥ **prepare 吞错**：`package.json:33` `"... || true"`。
⑦ **未使用依赖**：`autoprefixer ^10.4.21`（无 postcss.config，Tailwind v4 自带前缀处理）、`@axe-core/react ^4.12.1`（零 import，实际用裸 axe-core）。
⑧ **覆盖率失真**：`vitest.config.frontend.ts` coverage 块无 `include`——分母含 server/** 全仓（前端永不可达文件 0% 拉低均值），棘轮基线 59/52/55/61 随源文件增减漂移；两套件共写 `coverage/` 互相覆盖。

## Scope

**In scope**：上述 8 项各自的最小修复。
**Out of scope**：双轨测试基建合并（DX-05 另立）；棘轮体系重构（⑧ 只重锚分母）。

## Steps（每步一项，独立 commit）

### Step ①: 双构建消除

`playwright.config.ts` webServer command 去掉 `npm run build &&`，改为构建存在性前置检查（server.ts 启动前或 webServer 的 stdout 匹配不可行时，用 command 前置 `node -e "require('fs').existsSync('dist/index.html') || (console.error('dist 缺失：先 npm run build'), process.exit(1))" && ...`）。本地裸 `npx playwright test` 场景由该检查兜底防 212 陷阱复活。

**Verify**: build.yml 全链路绿（CI 已前置 build）；本地删 dist 后跑任一 E2E → 明确报错提示先 build；恢复后跑 mobile spec 绿

### Step ②: 延迟 revoke 对齐

两处改 `setTimeout(() => URL.revokeObjectURL(url), 0)`。

**Verify**: 相关测试绿；grep 确认全仓下载点统一为延迟模式

### Step ③: README 修正

:239 改「1 秒防抖」；状态表验证日期刷新为 2026-09-15 并复核「当前能力/当前限制」两列与 210/215 后现状。

**Verify**: 文档落盘；grep 无「3 秒防抖」残留

### Step ④: env 旋钮入册

`.env.example` 增「测试/调优旋钮（默认行为不变）」小节收录 5 个变量；README:272 措辞保持成立。

**Verify**: 变量清单与代码 grep 对齐（`grep -rn "INKFLOW_" server/ electron.cjs --include="*.ts"` 核对）

### Step ⑤: 导出 fallback 收口

`db.ts:402-403` `existsSync(DB_PATH)` 分支改为 404（同 else 分支文案：数据文件未就绪），删除裸文件下发。

**Verify**: 后端备份/导出相关测试绿；新增或调整断言「未初始化时 404 不下发文件」

### Step ⑥: prepare 显式警告

`|| true` 改为失败时 `echo "warn: pre-commit 安装失败，提交门未生效" >&2`（不阻塞安装）。

**Verify**: 人为制造失败场景（只读模拟：hooks 目录不可写场景走查脚本逻辑）确认警告输出

### Step ⑦: 删未使用依赖

`npm rm autoprefixer @axe-core/react`。

**Verify**: `npm run build` 绿 + 前端全量绿；`grep -rn "autoprefixer\|@axe-core/react" src/ scripts/` 零命中

### Step ⑧: 覆盖率分母收窄

vitest coverage 块加 `include: ['src/**']`；输出目录改 `coverage/frontend`（node:test 侧不动或移 `coverage/backend`）；棘轮阈值按新分母实测重锚（Plan 187 基线数字更新并在注释注明重锚原因）。

**Verify**: `npm run test:frontend`（带 coverage）产物只含 src/；阈值通过；后端全量绿

## Done criteria

- [ ] 8 项全部落地且各自 Verify 通过
- [ ] 台账 223 行落账（8 子项勾选状态）

## STOP conditions

- ⑧ 重锚后发现新分母下真实覆盖率低于 40%（说明此前的「失真」实际在遮掩大缺口）→ 停止报告数字，基线处置另行确认。
- ⑤ 改 404 后发现有测试/流程依赖裸文件下发 → 停止报告消费方。
