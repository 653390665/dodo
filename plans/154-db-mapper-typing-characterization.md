# Plan 154: 完成 Skill Row 渐进类型迁移验收

> **Executor instructions**: This is a reconciled remainder plan. Skill is the single table selected for this iteration. Do not migrate Novel, Chapter, SkillUsageRecord, or remove the legacy DbRow alias.
>
> **Drift check (run first)**: `git diff --stat dff4445..HEAD -- server/lib/db-mappers.ts server/lib/db/skills.ts tests/db-mappers.test.ts plans/154-db-mapper-typing-characterization.md` and the same command without `dff4445..HEAD`.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt | tests
- **Planned at**: commit `dff4445` + current worktree, reconciled 2026-08-10
- **Execution state**: DONE (2026-08-10)

## Why this matters

Skill 已完成本轮唯一的表级迁移，继续扩到第二张表会违反“每次只迁移一表”的风险边界。剩余工作只修正测试与真实 nullability，确保当前迁移有可信 characterization 后结束。

## Current state

- `rowToSkill(row: SkillRow)` 与 `listSkillVersions() as SkillRow[]` 已落地。
- `safeJsonParse<T>` 的公开返回签名已从 `any` 收紧为 `T`；内部 `JSON.parse`、顶层 legacy eslint disable 和其他 `DbRow` mapper 本轮不处理。
- `SkillRow` 已按 SQLite 真实 nullability 建模，必填 Skill 字段稳定归一，`updated_at = 0` 不再丢失。
- 10 个 characterization 覆盖 Skill nullable/坏 JSON，以及 Novel/Chapter legacy 坏 JSON 降级；未迁移第二张表。
- Coordinator 已复跑 mapper（10/10）、typecheck、改动源码 ESLint 和 diff check，均通过。

## Scope

**In scope**: `server/lib/db-mappers.ts`, `server/lib/db/skills.ts`, `tests/db-mappers.test.ts`.

**Out of scope**: 第二张表迁移、`SkillUsageRecordRow`、删除 `DbRow`/eslint disable、schema/migration、shared type 重写、超过三个文件的级联修复。

## Remaining steps

### Step 1: 对齐 SkillRow 真实 nullability

仅将真实可空列收紧为正确 union，例如 `feedback_score: number | null`；不得把所有字段改为 optional 来迎合测试。确认 `rowToSkill` 将 nullable 可选字段稳定归一为 `undefined`。

### Step 2: 修正 characterization

删除或重命名伪“undefined”用例；SQLite `SELECT *` 的存在列应以 `null`/默认值建模。新增断言覆盖 `feedbackScore`、`updatedAt`、`parentSkillId`、`sourceBadge` 等 nullable 字段归一，以及 Skill JSON 的 null/坏 JSON fallback。补 Novel 坏 JSON和 Chapter 坏 `workflow_meta` 的现状锁定，但不改变其 mapper 签名。

### Step 3: 验证范围并结束本轮迁移

不得因测试发现 legacy `DbRow` 而迁移 Novel/Chapter。把它们保留为下一次“一表一测”的候选，而不是本计划未完成项。

**Verify**:

```bash
node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/db-mappers.test.ts
npm run typecheck
npx eslint server/lib/db-mappers.ts server/lib/db/skills.ts
git diff --check
```

## Done criteria

- [x] Skill 是本轮唯一迁移表，签名和实际可空列一致。
- [x] nullable 归一、null JSON、坏 JSON、Novel/Chapter legacy 降级均有真实断言。
- [x] 不存在名称声称覆盖 undefined、实际却使用默认值的测试。
- [x] 定向 mapper、typecheck、源码 lint、diff check 通过。
- [x] 未改 schema/migration，未扩到第四个文件。

## STOP conditions

- 真实 SELECT 列与 SkillRow 无法在三个文件内对齐。
- 修复要求迁移第二张表、删除 DbRow 或修改 schema。
- 类型调整引发超过五个调用文件的级联。

## Maintenance notes

下一轮如继续，应在 Novel 和 Chapter 中只选一个，并先添加独立 plan；不要把 `JSON.parse` 的遗留 any 与单表迁移绑在一起。
