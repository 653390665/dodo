# Plan 255: 日志卫生与仓库账实对齐——logger 脱敏收口 + ID 字符集 + 启动日志 0600 + dev 漏洞清零 + 过时账目销账

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update the status row for plan 255 in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 391abf4..HEAD -- server/logger.ts server/lib/server-llm.ts server/validation.ts server/lib/db/world.ts electron.cjs MEMORY.md package-lock.json`
> 有变更则对照「Current state」原文，不符即 STOP。

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none（与 253/254 无文件交集）
- **Category**: security / docs
- **Planned at**: commit `391abf4`, 2026-09-20

## Why this matters

2026-09-20 审计发现三类小而实的卫生问题：(1) `logger.error` 对 Error 实例直接输出 `err.stack`，绕过仓库的用户内容脱敏层——provider 错误响应体（可能含账号标识、请求片段）经 `throw new Error(...内嵌响应体...)` 落入持久化启动日志；(2) ID 字段无字符集校验且回显进 Error message，可向持久化日志注入伪造行；(3) 启动日志文件权限 0644，与同目录 `.auth-token`/`config.json` 的 0600 基线不一致。另有仓库账目问题：dev 工具链 5 个已知漏洞待清、MEMORY.md 两条过时待销账、85 个已被 .gitignore 的测试截图仍被 git 追踪。

## Current state

- `server/logger.ts:44-48` — error 分支绕过 sanitize：
  ```ts
  error: (context: string, err?: unknown) => {
    const safe = err instanceof Error ? err.stack || `${err.name}: ${err.message}` : sanitize(err);
    console.error(`[ERROR] ${context}`, safe);
  },
  ```
  而 `sanitize()`（:26-31）对字符串的规则是 >200 字符替换为 `[redacted N chars]`；对 Error 对象经 `Object.entries` 得空对象（message/stack 不可枚举）。即：Error 实例的完整 message（含内嵌的 provider 响应体）不经任何检查直接输出。
- `server/lib/server-llm.ts:1411-1412` — embedding 降级路径把响应体内嵌进 Error：
  ```ts
  const errorText = await response.text();
  throw new Error(`Embedding request failed (${response.status}): ${errorText}`);
  ```
- `server/routes/production.ts:557` — `logger.error(String(e))`：String 化后虽走 sanitize 字符串规则（>200 截断），但 ≤200 字符的短错误体（含敏感片段）原样落盘。
- `server/validation.ts:48` — `export const dbIdSchema = z.string().min(1).max(200);` 无字符集约束。
- `server/lib/db/world.ts:248-253` — ID 原样回显进 Error message：
  ```ts
  throw new Error(
    `Invalid entity type: sourceType="${rel.sourceType}", targetType="${rel.targetType}". Must be one of: ${ENTITY_TYPES.join(', ')}`
  );
  ```
- `electron.cjs:155-163` — 启动日志写入未设 mode，脱敏正则只覆盖 sk-/Bearer/JWT 三形态：
  ```ts
  const STARTUP_LOG_REDACTION = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|eyJ[A-Za-z0-9_-]{20,})/g;
  function writeStartupLog(message) {
    try {
      const redacted = String(message).replace(STARTUP_LOG_REDACTION, '[redacted]');
      fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
      fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${redacted}\n`);
    } catch {}
  }
  ```
  同目录基线：`.auth-token`/`.server-identity` 0600（`server/middleware/auth.ts:31-33`）、`config.json` 0600（`server/lib/config.ts:245,270`）。
- `MEMORY.md` — 「环境事实」段记载 npm 损坏（自称"修复 npm 后删除本条"，实际 npm v12.0.2 已可用）；「待决」段记载 `.tdai/` 未加 eslint ignores（实际 `eslint.config.mjs:16` 已有 `'.tdai'`）。
- `.gitignore` 已含 `gui-test-screenshots/`，但 `git ls-files gui-test-screenshots/` 仍有 85 个文件（ignore 对已追踪文件无效）。
- `npm audit --package-lock-only`（2026-09-20 实测）：5 漏洞 = browserslist 1 high + baseline-browser-mapping 1 moderate + vitest/@vitest/mocker/@vitest/coverage-v8 链 3 moderate；生产依赖零漏洞。前两者 `npm audit fix` 可清；vitest 链需 `--force`（本计划不执行 --force，见 Out of scope）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| 后端定向 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/<file>` | all pass |
| Lint | `npx eslint <改动文件> --max-warnings=0` | exit 0 |
| 漏洞扫描 | `npm audit --package-lock-only` | browserslist/baseline-browser-mapping 消失 |
| 追踪检查 | `git ls-files gui-test-screenshots/ \| wc -l` | 0 |

## Scope

**In scope**:
- `server/logger.ts`（error 分支脱敏）
- `server/lib/server-llm.ts`（错误体截断，仅 :1411 一行）
- `server/routes/production.ts`（:557 logger 调用形态）
- `server/validation.ts`（dbIdSchema 字符集）
- `server/lib/db/world.ts`（回显单行化）
- `electron.cjs`（appendFileSync mode + chmod 修复）
- `package-lock.json`（npm audit fix 产物）
- `MEMORY.md`（销两条过时账）
- git index（gui-test-screenshots 85 文件 untrack，磁盘文件不动）

**Out of scope**（do NOT touch）:
- `npm audit fix --force` / vitest 大版本变更——影响全部 143 个前端测试的运行器，须操作者单独批准后另立计划。
- `memory/` 目录下 2 个已追踪文件（`memory/2026-09-08.md`、`memory/user-working-rules.md`）是否 untrack 与 MEMORY.md「不入库」声明矛盾——属操作者决策，本计划只在 MEMORY.md 中登记待决，不动 git。
- `sanitize()` 的字段表与 200 字符阈值本身。
- `electron.cjs` 其余段落（spawn/restart/watchdog）。

## Steps

### Step 1: logger.error 对 Error 走脱敏

`server/logger.ts` error 分支改为：Error 实例时取 `${err.name}: ${err.message}` 过 `sanitize()`（借力既有 >200 截断），堆栈帧保留：
```ts
error: (context: string, err?: unknown) => {
  if (err instanceof Error) {
    const safeHead = sanitize(`${err.name}: ${err.message}`);
    const frames = typeof err.stack === 'string' ? err.stack.split('\n').slice(1).join('\n') : '';
    console.error(`[ERROR] ${context}`, frames ? `${safeHead}\n${frames}` : safeHead);
  } else {
    console.error(`[ERROR] ${context}`, sanitize(err));
  }
},
```

**Verify**: `npm run typecheck`；`grep -rn "logger.error" server/ | head -20` 人工过目确认无依赖"完整 message 输出"的测试（有则重锚断言）。

### Step 2: 错误源头减敏

`server-llm.ts:1411` 改为 `throw new Error(\`Embedding request failed (\${response.status}): \${errorText.slice(0, 300)}\`)`；`production.ts:557` 的 `logger.error(String(e))` 改为 `logger.error('chapter production start failed', e)`（走 Step 1 的新路径）。

**Verify**: `npm run typecheck`；`NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/production-start-failure.test.ts`（若无此文件，跑 `ls tests/ | grep production` 选 start 相关测试）→ 全绿。

### Step 3: dbIdSchema 字符集 + 回显单行化

`validation.ts:48` 改为 `z.string().regex(/^[0-9a-zA-Z:_-]{1,200}$/)`（现网 ID 为生成的短 id/UUID 形态，均在其内）。`world.ts:249-253` 的 Error message 中 `rel.sourceType`/`rel.targetType` 回显加 `.replace(/[\r\n\t]+/g, ' ')` 单行化。

**Verify**: `npm run typecheck`；后端全库相关测试 `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/world.test.ts tests/db-rpc-validation.test.ts`（文件名以 `ls tests/ | grep -E 'world|db'` 实际为准）→ 全绿；若出现 ID 字符集拒绝合法值的红测试，把 regex 放宽为排除控制字符形态 `/^[^\r\n\t\x00-\x1f]{1,200}$/` 并在 commit message 记录原因。

### Step 4: 启动日志 0600

`electron.cjs` writeStartupLog：`fs.appendFileSync(startupLogPath, ..., { mode: 0o600 })`；追加存在性修复：
```js
try { fs.chmodSync(startupLogPath, 0o600); } catch {}
```
（放在 append 之后，兼容已有 0644 文件的一次性修复——仿 `server/middleware/auth.ts` 的"repair permissions on legacy files"先例。）

**Verify**: `node --check electron.cjs` exit 0；`grep -rn "startupLog" tests/ | head -5` 若有对应测试则跑之。

### Step 5: dev 漏洞清零 + 账目销账

1. `npm audit fix`（不带 --force）→ 确认 browserslist/baseline-browser-mapping 消失，vitest 链 3 条 moderate 保留属预期。
2. `MEMORY.md`：「环境事实」段删除 npm 损坏条目，替换为一行「2026-09-20：npm 已恢复可用（v12.0.2，对 Node 22.22.0 有版本支持告警，功能正常）；vitest 链 3 条 moderate dev 漏洞待操作者批准 --force 升级」；「待决」段删除 `.tdai/` 条目（已落地 eslint.config.mjs:16），新增一条「memory/ 两文件已入库 vs 声明不入库的矛盾待操作者拍板」。

**Verify**: `npm audit --package-lock-only 2>&1 | tail -3` → 5 变 3（仅 vitest 链）；`git status` 显示 package-lock.json + MEMORY.md。

### Step 6: untrack 测试截图

`git rm -r --cached gui-test-screenshots/`（磁盘文件保留，.gitignore 已覆盖）。**不动 memory/ 下两文件。**

**Verify**: `git ls-files gui-test-screenshots/ | wc -l` → 0；`ls gui-test-screenshots/ | head -3` → 文件仍在磁盘。

## Test plan

- Step 1/2 影响日志输出，现有测试若断言了 error 日志内容会红——重锚断言而非删除。
- 收尾：`npm run typecheck` + `npm test`（全量后端）+ `npx eslint server/logger.ts server/lib/server-llm.ts server/validation.ts server/lib/db/world.ts --max-warnings=0`。

## Done criteria

- [ ] `npm run typecheck` exit 0；`npm test` 全量通过
- [ ] `npm audit --package-lock-only` 仅剩 vitest 链 3 条 moderate
- [ ] `git ls-files gui-test-screenshots/ | wc -l` = 0
- [ ] `grep -n "min(1).max(200)" server/validation.ts` 无匹配（已被 regex 版取代）
- [ ] `ls -l ~/.inkflow/` 下启动日志（若本机存在）权限为 600（新写入后生效）
- [ ] MEMORY.md 两条过时账已销
- [ ] 改动文件全部在 In scope 清单内；`plans/README.md` 255 行状态更新

## STOP conditions

- Current state 原文与实际代码不符。
- Step 3 的 ID regex 放宽到排除控制字符形态后仍有测试红（说明存在含控制字符的存量 ID——数据问题需人工处理）。
- `npm audit fix` 触发了 lockfile 中生产依赖的变更（只允许 dev 链变更，出现生产依赖即回滚并报备）。

## Maintenance notes

- 后续新增 `logger.error` 调用点时不需要再考虑脱敏（已在 logger 层收口）；但**禁止**再引入 `throw new Error(...内嵌完整外部响应体...)` 的模式——错误体先截断/摘要再入 Error。
- 审查重点：Step 1 的堆栈帧保留逻辑不能把 message 行重复输出；Step 5 的 audit fix diff 里不能出现生产依赖。
