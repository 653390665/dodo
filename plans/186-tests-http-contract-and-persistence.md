# Plan 186: 测试补强一期——HTTP 契约与持久层危险区（config 空键、deleteChapter、错误映射、EditorView 特征）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- server/routes/config.ts server/lib/db/chapters.ts server/routes/db.ts tests/chapter-capability-meta-route.test.ts tests/delete-novel-fk.test.ts src/tests/editor-generation-flow-lifecycle.test.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW（纯新增测试）
- **Depends on**: none（建议先于 Plan 178/189 执行，为其提供安全网）
- **Category**: tests
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

四个「危险的未测试区」：

1. **POST /api/config 空 Key 保留规则只有无测试的路由层副本**——回归会静默清空用户 API Key；`/api/config/sync` 零覆盖。
2. **deleteChapter 持久层零覆盖**——它是暴露给渲染进程的破坏性 RPC，级联（chapter_versions ON DELETE CASCADE）失效无报警；对照 deleteNovel 有级联测试，形成不对称。
3. **/api/db 错误映射长尾**——`CHAPTER_CANDIDATE_QUALITY_FAILED→422`、`CHAPTER_SCOPE_MISMATCH→403` 只在 db-lib 层测过，HTTP 级无断言；前端按状态码分支（422 弹质量门禁、409 重生成提示），映射回归会让用户看到笼统 500。
4. **EditorView hook 接线**——生命周期测试测的是 mock，真实 hooks 之间的实参传递（`databaseGeneration`、seq、baselineHash）可双向断裂而无测试变红；这是全仓最典型的高改动+接缝无覆盖点。

## Current state

相关文件与角色：

- `server/routes/config.ts:50-67,69-81` — POST /api/config 与 /api/config/sync
- `server/lib/db/chapters.ts:52-54` — `deleteChapter`
- `server/routes/db.ts:1038-1064` — 错误串→状态码手工映射
- `tests/embedding-status-route.test.ts:7,29` — 既有「起 express + registerRoutes」测试范式
- `tests/delete-novel-fk.test.ts` — 既有级联测试范式
- `tests/chapter-capability-meta-route.test.ts:51,64,74` — 已挂载 registerDbRoutes 的 200/400/409 断言
- `tests/production-stream-disconnect.test.ts:44-46` — 空 apiKey 产出确定性 fallback 的先例
- `src/tests/editor-generation-flow-lifecycle.test.ts:9-46` — mock 掉 hooks 的生命周期测试（本计划不破坏它，另加真实接线特征测试）

现状摘录：

```ts
// server/routes/config.ts:55 — 空 Key 保留（无 HTTP 级测试）
apiKey: apiKey || existing.apiKey,
```

```ts
// server/routes/db.ts:1046-1054（映射长尾）
if (message.includes('CHAPTER_CANDIDATE_QUALITY_FAILED')) return res.status(422)...
if (message.includes('CHAPTER_SCOPE_MISMATCH')) return res.status(403)...
```

```ts
// chapter-capability-meta-route.test.ts 的既有范式（51-74）：注册真实路由 + fetch 断言状态码与 code
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 后端定向 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/<新文件>.test.ts` | 全过 |
| 后端全量 | `npm test` | 全绿 |
| 前端定向 | `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/<文件>` | 全过 |
| Typecheck | `npm run typecheck` | exit 0 |

## Scope

**In scope**：

- `tests/config-route-contract.test.ts`（新建）
- `tests/delete-chapter-cascade.test.ts`（新建）
- `tests/chapter-capability-meta-route.test.ts`（扩展 3 个用例）
- `src/tests/editor-wiring-contract.test.tsx`（新建）
- 被测源码文件**不改**（纯测试计划；若测试暴露真实 bug，STOP 上报另立修复）

**Out of scope**：

- E2E 扩面与 CI/覆盖率（Plan 187）
- 固定 sleep 改造的集成测试（本计划 Step 5 一并做，量小）
- 任何源码行为变更

## Git workflow

每类一次提交；消息如 `test(config): lock empty-key preservation at route level`；完成即提交，不 push。

## Steps

### Step 1: /api/config HTTP 契约

新建 `tests/config-route-contract.test.ts`，范式照 `tests/embedding-status-route.test.ts`（起 express → `registerConfigRoutes` → fetch）。`grep -n "registerConfigRoutes" server/routes/config.ts` 确认导出名与注册签名。用例：

1. 预存 config（apiKey=`'sk-existing'`）→ POST `/api/config` body `{ apiKey: '' }` → 断言 200 且落盘 config 的 apiKey 仍为 `'sk-existing'`（临时 config 目录：`grep -n "INKFLOW_CONFIG_DIR" server/lib/config.ts` 用 env 指向 tmp）。
2. POST 合法新 key → 落盘更新。
3. POST `/api/config/sync` → 断言 200 且响应/缓存行为与 `updateCachedApiKey` 一致（`grep -n "sync" server/routes/config.ts` 读语义后写断言）。

**Verify**: `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/config-route-contract.test.ts` 全过

### Step 2: deleteChapter 级联

新建 `tests/delete-chapter-cascade.test.ts`，范式照 `tests/delete-novel-fk.test.ts`：临时库 initDb → 建 novel/chapter/两个 version/一个 production run → `deleteChapter(chapterId)` → 断言：返回 true；versions 0 行；production run 的去向按 schema 断言（`grep -n "chapter_production_runs" server/lib/db-init.ts` 看是否有 FK/CASCADE——没有则断言 run 保留且 target 悬空为合法现状）；兄弟章节完好；删除不存在 id 返回 false。

**Verify**: 同 Step 1 命令模式，全过

### Step 3: /api/db 错误映射长尾

扩展 `tests/chapter-capability-meta-route.test.ts`（已挂载真实 db 路由）加 3 用例，每个先在 db-lib 层构造出对应错误态再走 HTTP：

1. 过期候选接受 → 409 + code（可能已有，若无则补）。
2. 质量门禁失败路径 → 422 + `CHAPTER_CANDIDATE_QUALITY_FAILED`（构造方式参考 `tests/chapter-candidate-acceptance.test.ts:63` 的 db 层触发，改走 HTTP）。
3. scope 不匹配 → 403 + `CHAPTER_SCOPE_MISMATCH`。

若某错误态无法从 HTTP 层构造，降级为直接断言映射函数（把 `server/routes/db.ts:1038-1064` 的映射抽成可导入纯函数属源码改动——超出本计划边界，此时 STOP 上报）。

**Verify**: `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/chapter-capability-meta-route.test.ts` 全过

### Step 4: EditorView 接线特征测试

新建 `src/tests/editor-wiring-contract.test.tsx`：**不 mock 生成 hooks**，只 mock transport client 层（`vi.mock('../lib/db-transport')` 等既有 mock 方式，参照 `src/tests/components.test.tsx`），mount EditorView 最小 props（参照 `src/tests/editor-generation-flow-lifecycle.test.ts` 的挂载方式但去掉 `vi.mock` hooks 的部分）。断言：

1. 触发生成按钮 → mock 的 generation client 收到的实参含 `databaseGeneration`（数值）与正确的 chapterId/novelId。
2. 接受候选 → 保存 client 收到 `baselineHash`/`source` 字段（以真实 client 签名为准，`grep -n "baselineHash" src/lib/` 核对字段名）。

允许的最小 mock 面：网络层 client + `window.matchMedia` 等 jsdom 缺口。若 EditorView 挂载在纯 jsdom 下依赖过多浏览器 API，允许缩窄为「直接调用 `useEditorGenerationFlow` 返回的 handler 并断言 client 实参」的 hook 级测试——二选一，报告所选路径。

**Verify**: `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/editor-wiring-contract.test.tsx` 全过

### Step 5: 集成测试固定 sleep 改事件等待

三处小改（不改语义，仅把 sleep 换成带 deadline 的轮询等待）：

- `tests/pack-sync-integration.test.ts:101,181,960,980,1041,1060` 的 10ms 循环轮询：抽出局部 `waitFor(predicate, timeoutMs=5000)` helper（文件内定义即可），替换裸 sleep。
- `tests/world-character-state-generation.test.ts:102` 的 250ms 固定等待：改为等待状态断言成立的轮询。
- `tests/production-stream-disconnect.test.ts:132` 的 20ms：同上。

**Verify**: 三个文件单独跑全过；`npm test` 全绿

## Test plan

本计划全部产出即测试；回归命令为 `npm test` + `npm run test:frontend` 全绿。

## Done criteria

- [ ] 4 个新建/扩展测试文件全部通过
- [ ] `npm test`、`npm run test:frontend` 全绿
- [ ] `grep -n "waitFor" tests/pack-sync-integration.test.ts` ≥1 命中且原裸 sleep 循环已替换
- [ ] `git status` 无 in-scope 之外的改动（尤其无源码改动）
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 任一新测试暴露真实 bug（如空 Key 确实会清空）——保留失败测试（标记 `// FIXME(plan)` 跳过并注明），STOP 上报，修复另立计划。
- config 路由注册方式与范式不符（如挂在复合路由器下无法独立注册）——改用 app 级集成（起完整 server.ts）后仍失败则 STOP。
- EditorView 特征测试的 mock 面超过 6 个模块——说明组件耦合过重，报告清单并交付 hook 级替代。

## Maintenance notes

- 评审关注点：测试断言的是**当前正确行为**（特征测试），不是理想行为；注释里写清「本测试锁定 X 语义，变更需产品决策」。
- Step 4 的接线测试是 Plan 178（生成互斥）与 Plan 190（依赖升级）的安全网——依赖图上排在它们之前。
- `waitFor` helper 若被多个文件需要，后续可提到 `tests/helpers/`。
