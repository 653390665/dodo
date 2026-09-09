# Plan 190: 依赖升级战役——@huggingface/transformers、Express 5、Vite 7、包管理器配置收敛

> **Executor instructions**: 按步骤顺序执行，每步独立提交、独立验证；任一步失败不影响已完成步骤。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- package.json package-lock.json server.ts server/embedding.ts scripts/ tests/package-runtime-dependencies.test.ts`
> 若有变更（尤其 lockfile），重新核对「Current state」的版本事实；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED-HIGH（迁移类；每步有独立回滚点）
- **Depends on**: Plan 186、186（测试安全网先落地）
- **Category**: migration
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

四项依赖债务，其中一项有**时间压力**：

1. **@xenova/transformers 已停更**（上游更名 @huggingface/transformers）：lockfile 锁死 2023 年的 onnxruntime 1.14，且靠 sharp/protobufjs 两条 overrides 追安全补丁。**CI 已给 @xenova/transformers 与 sharp 设了 2026-09-30 到期的豁免**（`.github/workflows/build.yml` audit 步骤）——到期后生产依赖审计将变红，这是硬 deadline。
2. **Express 4**：唯一大版本滞后的服务端核心，`body-parser` override 就是在给 Express 4 传递依赖打补丁；Express 5 已稳定。
3. **Vite 6**：接近支持窗口边缘，生态逐步只测新大版本。
4. **包管理器三方配置残留**：npm lockfile + `pnpm.onlyBuiltDependencies` + `allowScripts`（精确版本钉，`esbuild@0.28.1` 条目已与 lockfile 脱节）。

## Current state

版本事实（读自 package.json 与 lockfile）：

- `@xenova/transformers ^2.17.2`（2.x 末版）；依赖 onnxruntime-web/node 1.14.0、`sharp ^0.32.0`；overrides 强推 sharp 0.35.3、protobufjs ^6.8.8→7.6.5（`package.json:91-93`）
- `express ^4.22.1`；`@types/express ^4.17.21`；override `body-parser ^1.20.6`
- `vite ^6.4.3`；`@vitejs/plugin-react ^5.2.0`
- `server.ts:119` — `app.get('*', ...)` 通配路由（Express 5 的 path-to-regexp v8 唯一硬破坏点）
- `server.ts:128-133` — middlewareMode 内嵌 Vite dev server
- `server/embedding.ts:6` — `@xenova/transformers` 的唯一 import 点
- `package.json` build.files / asarUnpack 含 onnxruntime/sharp 二进制清单；`tests/package-runtime-dependencies.test.ts` 守护打包清单

注意：本机 npm 损坏期间**不要执行 install**——本计划的所有 install 步骤要求在 npm 可用的环境执行（或先修复 npm，见 Plan 191 的 DX-1 项）。若执行环境 npm 不可用，整个计划 BLOCKED 并报告。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 安装 | `npm install` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| 后端全量 | `npm test` | 全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| 构建 | `npm run build` | exit 0 |
| E2E | `npx playwright test` | 全绿 |
| 生产审计 | `npm audit --omit=dev` | 0 高危（或全部在豁免期内） |

## Scope

**In scope**：

- `package.json` / `package-lock.json`
- `server.ts`（仅通配路由与 Vite 中间件的兼容改动）
- `server/embedding.ts`（包名/导入切换）
- `scripts/build-server.mjs`、`scripts/rebuild.mjs` 等（仅当打包清单需同步）
- `tests/package-runtime-dependencies.test.ts`、`tests/embedding.test.ts` 的适配

**Out of scope**：

- React/Zustand/Tailwind 等其他依赖升级
- 换 HTTP 框架、换构建工具
- embedding 模型更换（只换运行时包，模型与向量维度不变是验收前提）

## Git workflow

四步各一次提交（每步独立可回滚）；消息如 `build(deps): migrate @xenova/transformers to @huggingface/transformers`；完成即提交，不 push。

## Steps

### Step 1: @xenova/transformers → @huggingface/transformers（最优先，有 deadline）

1. `npm install @huggingface/transformers@^3` 并卸载 `@xenova/transformers`。
2. `server/embedding.ts` 更新 import 与 env 配置（v3 的 `env`/`pipeline` 导出大体兼容：`grep -n "xenova\|transformers" server/embedding.ts` 全量替换；模型 id、缓存目录、`quantized` 选项逐项核对）。
3. 清理 overrides 中仅为它而设的条目（sharp/protobufjs——`npm ls sharp protobufjs` 确认无其他需求方后移除 override，让生态自己解析）。
4. 打包清单同步：`package.json` 的 build.files / asarUnpack 中 onnxruntime/sharp 路径按新依赖树调整；跑 `npm run build:electron` 的子集（`node scripts/build-server.mjs`）+ `tests/package-runtime-dependencies.test.ts`。
5. `.github/workflows/build.yml` audit 步骤：确认 @xenova/transformers 豁免条目删除或不再命中。
6. 向量兼容验证：`tests/embedding.test.ts` 全过 + 用既有库跑一次 `searchSimilar` 断言维度 384 不变（`grep -n "384\|dimensions" server/embedding.ts server/vector-store.ts` 定位维度断言）。

**Verify**: `npm test` 全绿；`npm audit --omit=dev` 无 @xenova/transformers 相关告警；`npm run build` exit 0

### Step 2: Express 4 → 5

1. `npm install express@^5 @types/express@^5`；删除 `body-parser` override（`npm ls body-parser` 确认消失或已由 express5 内部管理）。
2. `server.ts:119` 的 `app.get('*', ...)` 改为 Express 5 语法：`app.get('/*splat', ...)` 或改用 `app.use((req,res)=>...)` 兜底（选与该路由语义最贴近者，读 :115-125 现状决定）。
3. 全仓 grep Express 5 破坏点：`grep -rn "app.get('\*\|app.all('\*" server.ts server/routes/`；`res.status().json()` 链与 async 错误处理语义差异由路由级 try/catch 现状吸收（仓库存量代码普遍手写 try/catch，预期兼容）。
4. 全量 `npm test`（90 个路由文件的路由测试是主安全网）；E2E 全量。

**Verify**: `npm test`、`npx playwright test` 全绿；`npm ls express` → 5.x

### Step 3: Vite 6 → 7

1. `npm install vite@^7 @vitejs/plugin-react@latest`。
2. 三条链路逐一验证：`npm run dev`（middlewareMode 内嵌 dev server，`server.ts:128-133`）、`npm run build`、`npm run test:frontend`（vitest 4 与 vite 7 的互操作）。
3. 若 vitest 4 需要配套升级（`npm ls vitest` 观察对等依赖告警），升 minor 不升大版本。

**Verify**: 三条链路全绿；`npm ls vite` → 7.x

### Step 4: 包管理器配置收敛

1. `grep -rn "allowScripts\|onlyBuiltDependencies" package.json scripts/ .github/ tests/`——确认无工具消费（Lavamoat 类工具未配置即视为无消费）。
2. 删除 `package.json` 的 `pnpm` 块与 `allowScripts` 块（`onlyBuiltDependencies` 里的 sharp 若 Step 1 后仍需允许构建脚本且团队确认只有 npm 一条链，也一并删除；保留亦需注释说明消费者）。
3. `npm install` 一次验证 lockfile 与 manifest 一致。

**Verify**: `grep -c "allowScripts" package.json` → 0（或带注释保留）；`npm install` exit 0、`git diff package-lock.json` 仅预期变更

## Test plan

每步的验证即测试；最终全量：`npm run typecheck`、`npm test`、`npm run test:frontend`、`npm run build`、`npx playwright test`、`npm audit --omit=dev`。

## Done criteria

- [ ] `npm ls @huggingface/transformers express vite` 全部为新大版本
- [ ] overrides 中不再有 sharp/protobufjs/body-parser（或附消费者注释）
- [ ] CI audit 豁免清单与实际告警一致（@xenova 条目移除）
- [ ] 全部六条验证命令绿
- [ ] `git status` 干净、四步各自成提交
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- `@huggingface/transformers` v3 的 embedding 输出维度 ≠ 384 或与存量 `vector_chunks` 不兼容——**不能**简单重算全库（用户数据），STOP 报告迁移方案（双读/重建索引策略需产品决策）。
- Express 5 下 >10 个路由测试失败（错误处理语义系统性差异）——回退 Step 2，报告失败分布。
- Vite 7 与 vitest 4 无法共存且 vitest 大版本升级波及 800+ 用例——回退 Step 3，Vite 升级另立计划。
- 执行环境 npm 不可用且无法修复——整计划 BLOCKED（先修 npm）。

## Maintenance notes

- 评审关注点：每步独立成提交是回滚的前提；打包清单（build.files/asarUnpack）与实际 node_modules 树的一致性由 `tests/package-runtime-dependencies.test.ts` 守护，该测试必须随步更新而非删除。
- Step 1 完成后，CI audit 的 `exemptions` 对象应仅剩仍在豁免期内的条目（理想为空）。
- Plan 191 的 DX-1（pre-commit 修复 npm 依赖）若先落地，本计划的 install 步骤在其之后执行更稳。
