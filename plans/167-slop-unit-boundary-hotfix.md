# Plan 167: 修复词级质量规则的数字单位误报

## Status

- **State**: DONE (2026-08-23; reviewed against isolated commit `93b9b01`)
- **Priority**: P0
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug / tests
- **Planned at**: working tree inspected 2026-08-23; base commit `f4eac24`

## Why this matters

真实 Provider 探针显示，正文中的自然时间短语“十分钟”被 `十分` 副词规则拦截，`server/lib/server-llm.ts` 因 `quality_rejected` 拒绝整次生成。该误报发生在审稿 JSON 解析之前，会把正常正文伪装成模型质量失败，并阻断后续 Plan 162/166 的真实评测。

## Current state

- `shared/lib/slop-scorer.ts:74-76` 使用 `/十分[地]?/g`，会在“十分钟”“十分之一”等数字/单位短语中命中“十分”。
- `tests/chapter-polish.test.ts:201-225` 已验证分类聚合，但没有数字、时间、比例和专名豁免。
- Provider 失败证据：`generateText()` 返回 `ProviderError(code=quality_rejected)`，原因片段为“十分钟”命中 `副词弱化「十分...」`。

## Scope

### In scope

- `shared/lib/slop-scorer.ts`
- `tests/chapter-polish.test.ts`

### Out of scope

- 不修改 Provider、Prompt、质量分阈值或数据库。
- 不删除“十分紧张”“十分危险”等真正副词检测。
- 不扩大禁词表，不引入随机改写、同义词替换或模型参数变化。

## Steps

### Step 1: 修复词边界

将 `十分` 检测改为上下文感知的纯规则：跳过“十分钟”“十分之一”及数字/单位组合；保留真正修饰形容词或动词的“十分……”命中。规则必须保持现有 `SlopHit` 分类、行号和建议字段兼容。

**Verify**: `npx vitest -c vitest.config.frontend.ts run tests/chapter-polish.test.ts` → 全部通过。

### Step 2: 增加回归测试

在 `tests/chapter-polish.test.ts` 增加三组断言：

1. “十分钟后”“十分之一”“十米/十秒”等自然数量表达不产生 `tell_dont_show` 命中；
2. “十分紧张”“十分危险”仍产生对应命中；
3. 混合段落只报告真正副词，不能因为同段存在“十分钟”而整体失败。

**Verify**: `npx vitest -c vitest.config.frontend.ts run tests/chapter-polish.test.ts` → 新增断言通过。

### Step 3: 总验收

```bash
npm run typecheck
npm run lint
npx vitest -c vitest.config.frontend.ts run tests/chapter-polish.test.ts tests/draft-quality.test.ts
git diff --check
```

## Done criteria

- [x] 数字/时间/比例/单位短语不触发 `十分` 副词误报。
- [x] 真正的“十分+形容词/状态”仍被检测。
- [x] 只修改 Scope 文件，无依赖、数据库或 Provider 变更。
- [x] 定向测试、typecheck、lint、diff check 通过。

## Review evidence

- Isolated worktree: `/private/tmp/inkflow-plan167`, commit `93b9b01`.
- Scope review: only `shared/lib/slop-scorer.ts` and `tests/chapter-polish.test.ts` changed.
- `node --import tsx --test tests/chapter-polish.test.ts`: 20/20 passed, including quantity, adverb, and mixed-expression cases.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.
- The planned Vitest command was not a valid repository gate because `vitest.config.frontend.ts` includes `src/tests` and does not discover `tests/`; this was recorded rather than treated as a pass. `tests/draft-quality.test.ts` is also absent from the isolated worktree.

## STOP conditions

- 需要修改 `server/lib/server-llm.ts`、质量门阈值或 Provider 配置才能通过。
- 无法在不误伤真实副词的情况下区分数量短语。
- 当前 `slop-scorer.ts` 与摘录漂移，需先更新计划而不是直接改。

## Maintenance notes

以后新增副词规则必须配套数字/单位、专名和普通修饰语三类测试，不能用单个 substring 命中作为质量判定。
