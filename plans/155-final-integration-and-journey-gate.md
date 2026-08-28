# Plan 155: 完成 151-154 总装与创作旅程验收

> **Executor instructions**: This plan is verification-only except for plan status/document evidence. Do not fix product code inside a gatekeeper task; report failures to the owning plan executor.
>
> **Drift check (run first)**: confirm Plans 151-154 are marked DONE in `plans/README.md` and inspect `git status --short`. Stop if any dependency remains TODO, IN PROGRESS, or BLOCKED.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: Plans 151, 152, 153, 154 DONE
- **Category**: tests | release
- **Planned at**: commit `dff4445` + current worktree, 2026-08-10
- **Execution state**: DONE (2026-08-10)

## Why this matters

151 的全量门禁早于 152-154 的后续改动，不能继续作为当前发布证据。最终必须在合并后的同一工作区重新验证静态检查、后端、前端、构建、核心创作旅程、移动端和依赖审计。

## Scope

**In scope**: read-only verification output、Playwright artifacts、`plans/README.md` 与相关计划状态/证据更新。

**Out of scope**: 产品源码修复、生产 `data.db`、依赖升级、schema/migration、共享测试端口。

## Execution model

并发 Gatekeeper 必须物理隔离：

1. Static Agent：`typecheck`、`lint`、`lint:any`、`git diff --check`。
2. Unit Agent：后端与前端测试串行运行，使用 `tests/helpers/test-db-preload.ts` 和隔离数据库。
3. E2E Agent：独立端口、独立临时 SQLite，串行运行 Chromium 与 mobile-chromium，完成后清理测试文件。
4. Coordinator：审查全部退出码、失败日志、git diff 范围和 artifact，不接受子 Agent 自报代替证据。

开始前先确认 `3001` 未被占用；`playwright.config.ts` 在测试环境固定端口且禁止自动换端口。必须先完成 `npm run build`，因为 E2E server 以 `DISABLE_VITE_DEV_MIDDLEWARE=1` 从 `dist` 提供静态文件。

## Verification gates

```bash
npm run typecheck
npm run lint
npm run lint:any
npm test
npm run test:frontend
npm run build
npx playwright test tests/e2e/plan150-capability-governance.spec.ts tests/e2e/mobile-layout.spec.ts --project=chromium
npx playwright test tests/e2e/plan150-capability-governance.spec.ts tests/e2e/mobile-layout.spec.ts --project=mobile-chromium
npm audit --omit=dev
git diff --check
```

E2E 若配置中的 project/spec 组合不支持上述命令，先读取 `playwright.config.ts`，只调整命令，不改产品代码。不得并发复用端口或数据库。

两次 Playwright 必须串行：`chromium` 执行两个指定 spec；`mobile-chromium` 受 `testMatch` 限制，只执行 `mobile-layout.spec.ts`。结束且 webServer 停止后，清理已解析的 `test-results/inkflow-e2e.db`、`-wal`、`-shm` 与 `test-results/e2e-config`；保留失败截图、trace 和报告作为证据。

若裸 `npm audit --omit=dev` 非 0，不得自行宣称通过；按 `.github/workflows/build.yml` 与 Plan 151 的到期豁免逻辑解析 JSON。未知漏洞、过期豁免或超出 `@xenova/transformers` / `sharp` 记录范围均失败。

## Done criteria

- [x] 151-154 均由 Coordinator 复核为 DONE。
- [x] 所有命令 fresh exit 0，测试计数和日期写入 `plans/README.md`。
- [x] E2E 使用独立端口/数据库，未触碰运行中的 `data.db`。
- [x] 浏览器旅程覆盖：当前阶段进入能力页、返回写作、写法确认后生成、窄屏无重叠。
- [x] `npm audit --omit=dev` 为 0。
- [x] 开发服务器最终可访问，并向用户提供实际 URL。

## Execution evidence (2026-08-10)

- Static: typecheck、lint、lint:any（30/35）、diff check 均 exit 0。
- Unit: Node 803/803；Vitest 76 files、491/491。
- Build: Vite production build exit 0。
- Chromium: 两个指定 spec 合并运行 9/9；mobile-chromium 5/5。
- E2E 首轮真实暴露并修复两项测试合同：Welcome 首发起点漏点“启用推荐创作流程”；Plan150 spec 共用进程级 story-card 限流桶。最终仅在测试内提供稳定的故事卡前置数据，未放宽生产限额。
- Audit: `npm audit --omit=dev` 为 0 vulnerabilities。
- Isolation: `~/.inkflow/data.db`、WAL、SHM 的 size/mtime/inode 在门禁前后完全一致；`test-results/inkflow-e2e.db*` 和 `test-results/e2e-config` 已清理。

## STOP conditions

- 任一依赖计划未 DONE。
- 测试只能通过读取或写入生产 `data.db`。
- 失败需要改产品源码；返回对应 152/153/154 executor 修复后重新跑全门禁。

## Maintenance notes

任何 152-154 范围源码在本门禁后再次变化，155 证据立即失效，必须重新执行。
