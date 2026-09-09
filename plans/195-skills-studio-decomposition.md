# Plan 195: SkillsStudioView 分解一期——lint 抑制清账 + 状态入 store 先行（EditorView 先例）

> **Executor instructions**: 按 Phase 执行；Phase 1 为机械清账（直接可执行），Phase 2 为受控分解，Phase 3 为设计评估（只产出评估，不实施）。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 状态行。

## Status

- **Priority**: P3
- **Effort**: L（Phase 1 为 S；Phase 2 为 M；Phase 3 仅评估）
- **Risk**: MED（Phase 2 触碰行为敏感的 effect 时序）
- **Depends on**: none（与 docs/plans/014 的 Phase 5b「EditorView 拆分」同族，执行前先读该账目避免撞车）
- **Category**: tech-debt
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

`SkillsStudioView.tsx`（3069 行、30 个 useState、15 条 eslint-disable 全仓最多）是能力中心的单点回归面；`WorldBibleView.tsx`（1415 行、36 个 useState）自带组件内 fetch 封装。近 6 个连续提交都在围绕 handlers 对象的 react-hooks/refs 误报反复增删抑制指令——lint 拉锯本身在消耗注意力。EditorView（2108 行）已完成同规模分解（011 计划：props 97→62，状态进 store、流程进 hooks、面板进子组件），模式已被验证。本计划按「先清账、再分解、后评估」推进一期。

## Current state

```bash
# 抑制分布（grep 自 0dfbbcf）
# src/ 不含 tests：eslint-disable 共 63 条
#   SkillsStudioView.tsx 15、EditorView 5、WorldBibleView 4、WorldBibleAssistant 4、AIAssistant 4
# 类型分布：react-hooks/set-state-in-effect ×34、purity ×12、refs ×若干
grep -rn "eslint-disable" src/ --include="*.tsx" --include="*.ts" | grep -v tests | wc -l
```

- `src/components/SkillsStudioView.tsx` — 头部一次性 import 30+ 助手模块
- `src/components/WorldBibleView.tsx:278-287` — 组件内 `fetchGovernance` 私有封装（网络层归位由 Plan 188 处理；本计划不重复）
- 先例：`src/stores/`（10 个 store，15-113 行）+ `src/lib/hooks/`（useEditorData 等 15 hooks）+ git log 011 批次

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 定向测试 | `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/skills-studio-plan158.test.ts` | 39 用例全过 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| Lint | `node node_modules/eslint/bin/eslint.js src/components/SkillsStudioView.tsx --max-warnings=0` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |

## Scope

**In scope**：

- `src/components/SkillsStudioView.tsx` 及其 `src/components/skills/` 子组件
- `src/stores/`（新建 skills 相关 store，如 Phase 2 需要）
- `src/components/WorldBibleView.tsx`（仅 effect 类抑制的同类清账）
- `eslint.config.mjs`（仅当 Phase 1 判定为「规则误报」时的文件级豁免登记）

**Out of scope**：

- 任何交互/视觉行为变更（分解是等价重构）
- `docs/plans/014` 管辖的 EditorView Phase 5b
- WorldBibleView 的网络层（Plan 188）
- 一次性大拆（3069 行不可能一个计划吃完；本计划只吃 Phase 1/2 圈定的部分）

## Git workflow

每个 Phase 至少一次提交；消息如 `refactor(skills): triage eslint suppressions (phase 1)`；完成即提交，不 push。

## Steps

### Phase 1: 抑制清账（机械，S）

对 63 条 eslint-disable 逐条分类并处理，判定规则固定：

1. **真误报**（规则在该写法下确为 false positive，如 handlers 对象上的 react-hooks/refs）：集中登记到 `eslint.config.mjs` 的文件级/行级豁免，**必须带一行原因注释**；从源码行删除行内 disable。
2. **真问题**（effect 内同步派生状态等真实隐患）：列入「Phase 2 待消化清单」写进本文件执行报告，**不在 Phase 1 改行为**。
3. **过时抑制**（代码已改，指令残留）：直接删除。

产出：执行报告含 63 条的分类表（文件:行 → 误报/真问题/过时 → 处置）。

**Verify**: `grep -rn "eslint-disable" src/ --include="*.tsx" --include="*.ts" | grep -v tests | wc -l` ≤ 63 且每个残留均有 config 登记或 Phase 2 清单对应；`npm run test:frontend` 全绿；lint 对改动文件 exit 0

### Phase 2: 状态入 store 先行（受控分解，M）

按 011 先例，把 Phase 1 清单中「真问题」聚集的 + SkillsStudioView 中最大块的纯 UI 状态迁出：

1. 选点规则（按序取前 3 块，宁少勿滥）：候选片段（candidateCardIds 等）、包配置弹窗状态、货架筛选状态——以「状态被 ≥2 个互不相邻的 JSX 区消费」为迁移标准。
2. 每块：新建 `src/stores/skills-*-store.ts`（15-113 行规格，照 `src/stores/editor-data-store.ts` 的形态）→ SkillsStudioView 改订阅 → 对应 `skills-studio-plan158.test.ts` 用例全绿 → 提交。
3. `WorldBibleView` 的 set-state-in-effect 类抑制若在 Phase 1 清了真问题标签，同法小步处理（最多 2 处）。

**Verify**: 每个 store 落地后定向测试 + 全量前端测试全绿；`wc -l src/components/SkillsStudioView.tsx` 逐块下降并在报告记录

### Phase 3: 进一步分解评估（只评估，不实施）

产出 `plans/notes-194-phase3-assessment.md`（或并入执行报告）：按 EditorView 先例给出 SkillsStudioView 的目标结构（哪些面板已存在于 `src/components/skills/` 可直接外移、哪些 handler 组成一个 hook、props 预期降幅），列 3 个最小可独立合并的后续 PR 切片与各自测试面。供产品/维护者决策，不在本计划实施。

**Verify**: 评估文档存在且含 3 个切片方案

## Test plan

每步全绿门槛：`src/tests/skills-studio-plan158.test.ts`（39 行为级用例，分解的安全网）+ `npm run test:frontend`。Phase 2 每块迁移必须先跑一次定向测试确立基线。

## Done criteria

- [ ] Phase 1 分类表完成，行内 disable 残留均有去处
- [ ] Phase 2 完成 ≤3 块状态迁移且全绿
- [ ] Phase 3 评估文档产出
- [ ] typecheck、前后端测试全绿
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- Phase 1 中某条抑制删除后出现测试无法覆盖的行为差异（无测试保护的 effect）——该条保留并标注「需先补测试」。
- Phase 2 的 store 化导致 `skills-studio-plan158.test.ts` 出现时序类失败（act 警告以外的真实状态泄漏）——回退该块。
- 与 docs/plans/014 的执行产生文件冲突（同一时段有人在做 EditorView Phase 5b）——协调后再动。

## Maintenance notes

- 评审关注点：Phase 2 是等价重构——diff 不应出现条件逻辑变化；每块一个提交便于二分回滚。
- 后续切片以 Phase 3 评估为准另行立计划；WorldBibleView 全量分解不属本计划。
- lint 抑制的长期治理口径：新代码禁止新增行内 disable（除非 config 登记或附「需先补测试」标注）。
