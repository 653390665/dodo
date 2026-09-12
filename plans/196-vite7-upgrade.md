# Plan 196: Vite 6→7 升级（Plan 190 Step 3 遗留）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat f39b597..HEAD -- package.json package-lock.json vite.config.ts vitest.config.frontend.ts server.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED（vitest 4 与 vite 7 的互操作未实证；打包链复用 build）
- **Depends on**: 190（Step 1/2/4 已 DONE，本计划即其 Step 3）
- **Category**: deps
- **Planned at**: commit `f39b597`, 2026-09-12

## Why this matters

Vite 7 已发布而本项目停在 ^6.4.3；滞后意味着 dev/build 链路的安全修复与性能改进持续缺位，且越晚跨大版本积累的配置漂移越大。Plan 190 执行时因三链路验证工作量独立而显式遗留，本计划单独收口。

## Current state

- `package.json:88`（devDependencies）`"vite": "^6.4.3"`；行 47（**dependencies**）`"@vitejs/plugin-react": "^5.2.0"`；行 89 `"vitest": "^4.1.9"`；行 72 `"@vitest/coverage-v8": "4.1.9"`（精确锁定）；行 46 `"@tailwindcss/vite": "^4.2.4"`。
- 三链路入口：`npm run dev`（`INKFLOW_ENABLE_DEV_AUTH_TOKEN=true tsx server.ts`）、`npm run build`（`vite build`）、`npm run test:frontend`（`vitest -c vitest.config.frontend.ts run`）。
- `server.ts:128-141`：非 production 且未设 `DISABLE_VITE_DEV_MIDDLEWARE=1` 时，动态 `import('vite')` 创建 `middlewareMode: true, appType: 'spa'` 的内嵌 dev server 并挂 `vite.middlewares`。
- `vite.config.ts`：`plugins: [react(), tailwindcss()]`、`base: './'`、alias `@`、`server.hmr` 固定端口 24679（Playwright 场景）、`proxy: {'/api': 'http://localhost:3000'}`（middlewareMode 下不生效，dev 代理由 server.ts 的 express 承担）、`manualChunks`（radix-vendor/lucide/markdown-vendor）。
- `vitest.config.frontend.ts` 独立于根 vite.config（仅 react 插件、jsdom、pool threads、maxWorkers 1、coverage thresholds 59/52/55/61——Plan 187 棘轮基线）。
- CI（`.github/workflows/build.yml`）覆盖升级验证的门：typecheck/lint/format、`npm run test:coverage:frontend`（vitest 链路）、"Build production assets"（vite build）、E2E（构建产物）、打包 jobs（`npm run package` 内含 build）。
- E2E webServer 以 `DISABLE_VITE_DEV_MIDDLEWARE=1` 运行（不吃 dev 链路），本地 Step 2 需手动覆盖 dev 链路冒烟。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 升级 | `npm install --save-dev vite@^7 && npm install --save-dev @vitejs/plugin-react@latest` | exit 0，lockfile 仅预期变更 |
| 版本核对 | `npm ls vite @vitejs/plugin-react vitest` | vite 7.x、vitest 4.x 无 peer 冲突告警 |
| build 链路 | `npm run build` | exit 0，产物 dist/ 完整 |
| vitest 链路 | `npm run test:frontend` | 884/884 全绿 |
| dev 链路 | `DISABLE_VITE_DEV_MIDDLEWARE= node --import tsx server.ts` + 浏览器/HTTP 冒烟 | 200 且 HMR 不报错 |
| E2E | `npm run build && npx playwright test` | 21 passed（8 个预存陈旧 spec 红，口径见 plans/README 行 187/190） |
| 打包冒烟 | `npm run build && node scripts/build-server.mjs` | exit 0 |

## Scope

**In scope**：

- `package.json` / `package-lock.json`：vite ^7、@vitejs/plugin-react latest 并从 dependencies 挪到 devDependencies（纯构建期使用）
- `vite.config.ts`：仅 vite 7 要求的配置迁移（如有 deprecation）
- 验证不改业务代码；vitest 只允许 minor 升级

**Out of scope**：

- vitest 大版本升级（波及 884 用例，另立）
- Electron 打包配置调整（npmRebuild: false 不受影响）

## Steps

### Step 1: 升级依赖 + package hygiene

`@vitejs/plugin-react` 从 dependencies 挪到 devDependencies。跑 `npm ls vite @vitejs/plugin-react vitest` 确认无 peer 冲突；若 vitest 4 对 vite 7 报 peer 告警，按 vitest 文档升 minor（不升大版本）。

**Verify**: `npm ls vite` → 7.x；`npm run typecheck` → 0 错误

### Step 2: 三链路验证

1. `npm run build` → exit 0，抽查 dist/assets 分包与升级前一致（radix-vendor/lucide/markdown-vendor 三块仍在）。
2. `npm run test:frontend` → 884/884。
3. dev 链路：起 `node --import tsx server.ts`（不设 DISABLE_VITE_DEV_MIDDLEWARE），`curl -s localhost:3000 | head -5` 返回 HTML 且控制台无 vite 报错；再跑一条带 vite 转换的断言（请求任一 src 模块 URL 返回 JS 而非 404）。

**Verify**: 三链路全绿

### Step 3: E2E + 打包冒烟

`npm run build && npx playwright test` → 21 passed（8 个预存陈旧 spec 红为已知基线，见 plans/README 行 187/190）；`node scripts/build-server.mjs` exit 0。

**Verify**: 同上

## Test plan

本计划的验证即测试；全部通过后不改任何业务代码。

## Done criteria

- [ ] `npm ls vite` → 7.x，peer 无冲突
- [ ] dev / build / test:frontend 三链路绿
- [ ] E2E 与打包冒烟通过（基线口径内）
- [ ] `plans/README.md` 状态行已更新（190 行 Step3 勾销或本行 DONE）

## STOP conditions

- vitest 4 与 vite 7 无法共存，且 vitest 大版本升级会波及 884 用例语义 → 回退 Step 1，报告互操作细节，Vite 升级另立。
- vite 7 移除的 API 导致 manualChunks/HMR 配置需要业务级重写（非机械迁移）→ STOP 报告具体 deprecation。

## Maintenance notes

落地后：190 行的 PARTIAL 备注可改为 DONE；`.github/workflows/build.yml` 的 Node 版本约束如被 vite 7 要求提升，顺带在 PR 里注明。
