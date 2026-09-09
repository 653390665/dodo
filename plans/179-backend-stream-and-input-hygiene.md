# Plan 179: 后端 LLM 流式与输入卫生——流中重试不重发 token、UUID 主键、prompt 上限、jobId 加密随机

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- server/lib/server-llm.ts server/routes/production.ts server/routes/world.ts server/routes/agents.ts server/routes/audit.ts server/routes/continuation.ts server/validation.ts server/helpers/chapter-completion.ts server/lib/config.ts .gitignore`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED（server-llm 重试语义影响所有 LLM 调用方）
- **Depends on**: none
- **Category**: bug + security（防御性维护）
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

六个后端正确性/卫生缺陷：

1. **流式重试重发 token**：流中网络错误（ECONNRESET 等）发生在已向客户端下发若干 token 之后时，重试会通过同一个 `onToken` 重发新完整文本——正文流式预览出现重复拼接，且与最终落库正文不一致。
2. **`Date.now()` 派生主键**：同毫秒两次 apply 触发 INSERT 主键冲突，回滚整个事务并 500（计划 005「Date.now→UUID」的残留）。
3. **prompt 上下文数组无上限**：`existingNames`/`existingForeshadowings` 可放大单次 LLM 调用成本到数十 MB。
4. **`validation-debug.log` 未进 .gitignore**：调试开关开启后手稿片段可被 `git add -A` 带入版本库。
5. **`extract-entities` 直读 req.body**：同文件唯一无 zod schema 的入口。
6. **jobId 用 `Math.random()`**：非加密随机（3 处）；另有 `'你的key'` 魔法哨兵散布 2 处。

## Current state

相关文件与角色：

- `server/lib/server-llm.ts` — 多 provider LLM 客户端（流式读取 ~840-930，重试判定 ~993-1012）
- `server/id.ts` — 既有 `generateId()` = `crypto.randomUUID()`
- `server/routes/production.ts:1220,1237` — apply 落库的 ID 派生
- `server/routes/world.ts` — extract-entities schema（:311-314）、prompt 拼接（:866, :923）、jobId（:395）
- `server/validation.ts:15-24` — 校验调试日志
- `server/routes/continuation.ts:1558-1581` — extract-entities 直读 body
- `server/lib/config.ts:61` — apiKey 默认 `''`

现状摘录：

```ts
// server/lib/server-llm.ts:840-846, 874-877 — 每次尝试内：token 下发即置 emittedContent
let emittedContent = false;
const reasoningFilter = createReasoningStreamFilter((token) => {
  onToken(token);
  emittedContent = true;
});
...
fullText += token;
reasoningFilter.push(token);
```

```ts
// server/lib/server-llm.ts:994-1012 — 重试判定对 isRetryableNetworkError 一律 continue，无「已下发」守卫
const isRetryable = !controller.signal.aborted && !isAbort && (
  ... || isRetryableNetworkError(error) || ...
);
if (attempt < maxAttempts && isRetryable) {
  ...
  await sleep(retryDelay);
  continue;
}
```

```ts
// server/routes/production.ts:1220, 1237 — apply 落库 ID
chapterId = `${now}`;
...
db.createChapterVersion({
  id: `${now + 1}`,
```

```ts
// server/routes/world.ts:311-314 — 无上限数组
const extractEntitiesPayloadSchema = z.object({
  text: z.string().optional().default(''),
  existingNames: z.array(z.string()).optional().default([]),
});
// world.ts:866 — ${existingNames.join(', ')} 直接进 prompt
// world.ts:923 — ${JSON.stringify(existingForeshadowings)} 直接进 prompt（schema 为 z.array(z.unknown())）
```

```ts
// server/routes/world.ts:395（agents.ts:194、audit.ts:83 同模式）
const id = 'job_' + Math.random().toString(36).substring(2, 15);
```

```ts
// server/validation.ts:18-19 — 调试日志写 cwd
const errorLogPath = path.join(process.cwd(), 'validation-debug.log');
```

```ts
// server/routes/continuation.ts:1558-1560 — 同文件唯一裸入口
const { packId, novelId: reqNovelId, databaseGeneration: reqGeneration } = req.body;
if (!packId || typeof packId !== 'string') { ... }
```

```ts
// server/routes/production.ts:623 与 server/helpers/chapter-completion.ts:56 — 魔法哨兵
... || getConfig().apiKey === '你的key' || !getConfig().apiKey;
```

仓库惯例：路由级 zod schema 先例见 `server/routes/world.ts:308-325`（每路由 payload schema + 注释说明）；`dbIdSchema` 在 `server/validation.ts`。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 后端定向 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/<file>.test.ts` | 全过 |
| 后端全量 | `npm test` | 全绿 |
| Lint | `node node_modules/eslint/bin/eslint.js <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**：

- `server/lib/server-llm.ts`（仅重试判定段）
- `server/routes/production.ts`（ID 三处 + 哨兵一处）
- `server/routes/world.ts`（schema 上限 + jobId）
- `server/routes/agents.ts`、`server/routes/audit.ts`（jobId）
- `server/routes/continuation.ts`（extract-entities schema 化）
- `server/validation.ts`（日志路径）、`.gitignore`
- `server/lib/config.ts` + `server/helpers/chapter-completion.ts`（哨兵归一）
- 对应测试文件

**Out of scope**：

- `wrapUserInput` 防注入包裹的全量推广（涉及多 prompt 模板回归，另立计划；本计划不动 prompt 模板）
- `server-llm.ts` 的兼容性模式/DeepSeek 特判逻辑
-baseUrl SSRF 面（BYOK 设计权衡，已记录在案不处理）

## Git workflow

每个独立缺陷一次提交；消息如 `fix(llm): never retry streaming attempts that already emitted tokens`；完成即提交，不 push。

## Steps

### Step 1: 流中已下发 token 后禁止重试

`server/lib/server-llm.ts`：在尝试循环外层声明 `let everEmittedTokens = false;`；`reasoningFilter` 回调与 `if (!emittedContent) onToken(sanitized.text)` 两处下发时置 `everEmittedTokens = true`。重试判定（:994 起）最前面加：

```ts
// Tokens already reached the client on a previous attempt — a retry would
// re-send the full text through the same onToken and duplicate content.
if (everEmittedTokens) throw error;
```

位置：在计算 `isRetryable` 之前。注意 strict promptGuard 模式下 onToken 被替换为 no-op（:554-561），`everEmittedTokens` 保持 false，重试语义不变。

**Verify**: typecheck 0 错误；`grep -n "everEmittedTokens" server/lib/server-llm.ts` ≥3 命中

### Step 2: apply 落库改用 generateId()

`server/routes/production.ts`：文件头 import `{ generateId } from '../id.js'`（相对路径以文件现状为准，同目录其他路由已有先例）。三处替换：`:1220` `chapterId = \`${now}\`` → `chapterId = generateId();`；`:1182` 附近占位 `targetChapterId: chapterId || \`${now}\`` → `chapterId || generateId()`（先核对该行现状再改）；`:1237` version id → `generateId()`。

**Verify**: `grep -n '`${now' server/routes/production.ts` 无命中；typecheck 0 错误

### Step 3: prompt 上下文上限

`server/routes/world.ts` schema 收紧 + 拼接前截断：

```ts
existingNames: z.array(z.string().max(200)).max(200).optional().default([]),
existingForeshadowings: z.array(z.unknown()).max(200).optional(),
```

并在 :866 与 :923 的模板字符串内改为对拼接结果截断（复用同文件 `chapterContent.substring(0, 15000)` 先例）：

```ts
${existingNames && existingNames.length > 0 ? existingNames.join(', ').substring(0, 8000) : '无'}
${existingForeshadowings ? JSON.stringify(existingForeshadowings).substring(0, 8000) : '无'}
```

**Verify**: typecheck 0 错误；`ls tests | grep -E "world|extract"` 相关测试全过

### Step 4: 调试日志出库 + .gitignore

1. `server/validation.ts:18` 的 `process.cwd()` 改为 `os.tmpdir()`（import `os`）。
2. `.gitignore` 的「Temporary scratch files and logs」段追加一行 `validation-debug.log`。

**Verify**: `grep -n "validation-debug.log" .gitignore` 命中

### Step 5: extract-entities schema 化

`server/routes/continuation.ts:1558-1581`：仿照同文件 `approve-import` 的模式定义并 safeParse：

```ts
const extractEntitiesRequestSchema = z.object({
  packId: dbIdSchema,
  novelId: dbIdSchema.optional(),
  databaseGeneration: z.number().int().nonnegative().optional(),
}).strict();
```

用解析结果替换散检；错误文案保持与兄弟路由一致（400 + 中文 error）。`dbIdSchema` 从 `../validation.js` import（以文件既有 import 为准）。

**Verify**: typecheck 0 错误；`ls tests | grep continuation` 全部通过

### Step 6: jobId 加密随机 + 哨兵归一

1. `world.ts:395`、`agents.ts:194`、`audit.ts:83` 的 `'job_' + Math.random()...` / `'audit_' + Math.random()...` 改为 `` `job_${generateId()}` `` / `` `audit_${generateId()}` ``（import `generateId`；注意保留各自前缀，jobId 格式变化对客户端透明——客户端只透传）。
2. `server/lib/config.ts`：在 AppConfig 附近新增 `export function isLlmConfigured(): boolean`；`getConfig()` 或加载归一处把 `'你的key'` 折算为 `''`（读配置文件后 `if (cfg.apiKey?.trim() === '你的key') cfg.apiKey = '';`）。`production.ts:623` 与 `chapter-completion.ts:56` 的哨兵比较改为 `!isLlmConfigured()`。

**Verify**: `grep -rn "Math.random().toString(36)" server/routes/` 无命中；`grep -rn "你的key" server/ --include="*.ts"` 仅剩 config.ts 归一处

### Step 7: 回归测试

1. `tests/chapter-production.test.ts`（或新增 `tests/apply-run-ids.test.ts`）：apply 成功后断言新章节 id 与 version id 形如 UUID（`/^[0-9a-f-]{36}$/`），且两次连续 apply 不冲突。
2. `tests/` 新增 `tests/llm-stream-retry.test.ts`：仿照既有 server-llm 相关测试的 fetch mock 方式（`grep -rln "server-llm" tests/` 找先例），构造「首次流式响应发 2 个 token 后 socket 错误」→ 断言不重试、错误上抛；对照「0 token 即失败」→ 断言重试成功且 onToken 序列无重复。
3. extract-entities schema：在 `tests/pack-sync-integration.test.ts` 风格下加一条 400 用例（缺 packId / 多余字段 strict 拒绝）。

**Verify**: `npm test` 全绿

## Test plan

见 Step 7。全量 `npm test` 必须全绿（server-llm 被所有 LLM 路由依赖，回归面最大）。

## Done criteria

- [ ] typecheck 0 错误；`npm test` 全绿
- [ ] `grep -n '`${now' server/routes/production.ts` 无命中
- [ ] `grep -rn "Math.random().toString(36)" server/` 无命中
- [ ] `grep -n "你的key" server/routes/production.ts server/helpers/chapter-completion.ts` 无命中
- [ ] `grep -n "validation-debug.log" .gitignore` 命中
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- `server-llm.ts` 的重试结构已重构（如 attempt 循环改为类/状态机）——按新结构等价实现，无法等价则 STOP。
- jobId 前缀被客户端或测试硬编码断言长度/字符集——先列出断言位置。
- `'你的key'` 出现在用户配置迁移文档之外的第三处（说明还有未知消费方）。

## Maintenance notes

- 评审关注点：`everEmittedTokens` 必须**跨尝试**存活（声明在循环外）；strict 模式 no-op onToken 行为不得回退。
- 哨兵归一后，旧配置文件中的 `'你的key'` 在读取时被清洗——配置导出/导入链路（db.ts 导入的是 DB 不是 config）不受影响，但评审应确认 config 导出不暴露该清洗逻辑。
- 计划 110/121 治理过流式断连；本计划的「已下发不重试」与其「断连 abort」互补，勿混淆。
