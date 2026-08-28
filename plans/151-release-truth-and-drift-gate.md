# Plan 151: 收口发布真实性与依赖漂移门禁

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. This plan is a release-governance change, not a dependency upgrade by itself.
>
> **Drift check (run first)**: `git diff --stat dff4445..HEAD -- package.json package-lock.json .github/workflows/build.yml README.md docs/release-readiness.md docs/dependency-upgrade-evaluation.md` and `git diff --stat -- package.json package-lock.json .github/workflows/build.yml README.md docs/release-readiness.md docs/dependency-upgrade-evaluation.md`. This plan was written against commit `dff4445` plus the current uncommitted worktree; STOP only when the live excerpts no longer match the Current state below.

## Status

- **Execution status**: DONE (2026-08-09)
- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: release | security | docs | tests
- **Planned at**: commit `dff4445` + current worktree, 2026-08-09

## Why this matters

代码门禁已经通过，但发布文档仍混有历史测试数字、过期的“技能仓库”入口和不一致的离线能力叙述。生产依赖审计当前为 0 vulnerabilities，旧 Plan 107 的“大版本升级”没有现实安全触发条件；先把证据、文案和 CI 口径统一，才能避免一次无必要的升级破坏 Electron 原生 ABI。

## Current state

- `package.json` 已有 `test:all`、`test:coverage:backend` 和 `test:coverage:frontend`；生产依赖使用 `npm audit --omit=dev`，当前命令结果为 0 vulnerabilities。
- `.github/workflows/build.yml` 已运行 typecheck、lint、audit、后端/前端测试、覆盖率、Playwright 和 macOS/Windows 打包，但 audit 仍保留 `@xenova/transformers`/`sharp` 的历史白名单分支。
- `docs/release-readiness.md` 的测试数字是 712/712、383/383、10/10，而当前 Plan 150 基线是 798/798、475/475、Chromium 5/5、Pixel 5 4/4。
- `docs/dependency-upgrade-evaluation.md` 仍把 `npm update ...` 写成下一步动作，且写有过期的 explicit-any 5/5 目标；这与当前零漏洞、原生模块风险和真实 lint 口径不一致。

## Scope

**In scope**: `README.md`, `docs/release-readiness.md`, `docs/dependency-upgrade-evaluation.md`, `.github/workflows/build.yml`, `package.json`（仅在需要增加已有门禁的脚本别名时）。

**Out of scope**: 任何业务逻辑、数据库 schema、支付系统、Electron major、`better-sqlite3`/`sharp` major、用户数据迁移。

## Steps

### Step 1: 建立单一发布证据表

更新发布报告为“能力 / 限制 / 验证日期”三栏，数字只来自本轮命令输出；补充测试数据库隔离、WAL `backup()` 快照和未验证平台。删除不存在的“技能仓库”入口，明确 `能力商店 → 我的技能` 的实际关系。

**Verify**: `rg -n "712|383|技能仓库|100% Offline|完全离线" README.md docs/release-readiness.md` → 仅允许历史记录或明确说明，不得作为当前能力承诺。

### Step 2: 把依赖升级改成证据触发策略

在依赖评估文档中记录 2026-08-09 的 `npm audit --omit=dev` 结果为 0；将“立即 npm update”改为季度/安全公告触发的评估流程，保留 Electron 原生 ABI、`sharp` 平台包和回滚条件。不得用旧的漏洞白名单掩盖新的漏洞。

**Verify**: `npm audit --omit=dev` → total 0；`rg -n "npm update|5/5|白名单" docs/dependency-upgrade-evaluation.md` → 只出现条件性流程和历史说明。

### Step 3: 收紧 CI 发布门禁口径

让 CI 在 audit 结果为零时直接成功；只有出现漏洞时才输出包名、严重级别和豁免到期日，禁止无限期静默 allowlist。保留现有隔离数据库与双平台打包步骤，并上传审计 JSON、coverage 摘要和 Playwright 报告作为 artifact。

**Verify**: `npm run typecheck && npm run lint && npm test && npm run test:frontend && npm run build` → 全部 exit 0；`git diff --check` → 无输出。

## Test plan

- CI 静态检查 audit=0、audit>0 无豁免、audit>0 有带到期日豁免三种 shell 分支。
- 文档门禁检查当前测试数字、入口名、离线限制和 WAL 表述不回退。
- 在临时 SQLite 与 `test-results/` 路径下运行现有全量测试，禁止读写运行中的 `data.db`。

## Done criteria

- [ ] 发布报告与 README 当前数字一致，且所有能力/限制/验证日期可追溯。
- [ ] `npm audit --omit=dev` 为 0 时 CI 不依赖历史漏洞白名单。
- [ ] 文档不再承诺无 API Key 时可生成模型内容。
- [ ] typecheck、lint、后端/前端测试、build、Playwright 和 `git diff --check` 通过。
- [ ] 仅修改 Scope 内文件。

## STOP conditions

- 当前 audit 出现未分类漏洞，或需要修改生产代码才能解释漏洞。
- 任何文档数字无法由一次可复现命令得到。
- 为通过门禁需要删除测试、放宽数据库隔离或跳过 Electron smoke。

## Maintenance notes

每次发布只更新证据表和验证日期，不复制旧轮次数字。依赖升级必须另开计划并先完成 characterization、原生 ABI 和双平台 smoke。
