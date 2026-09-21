# Plan 260: 技法优先度系统——能力卡装配引入角色与排序（覆盖商店全卡与创作链路卡）

> **Executor instructions**: Follow step by step. Run every verification command and
> confirm the expected result before moving on. Touch only in-scope files. If any
> STOP condition occurs, stop and report — do not improvise. Commit per step
> (`feat(capabilities): plan260 <中文一句话>`), do not push. SKIP plans/README.md
> updates — reviewer maintains the index. Audit every claim against actual tool
> results before reporting. Reply with exactly the report format at the end.

## Status

- **Priority**: P2 · **Effort**: M · **Risk**: MED（动 profile schema 与生成组装）
- **Depends on**: none
- **Category**: feature
- **Planned at**: commit `2c7e305` 之后的当前 HEAD（开工前 `git rev-parse --short HEAD` 记录为准）

## Why this matters

技法泳道当前对 `projectTechniqueIds` **append-only、无优先级**：11 张卡全量按装备顺序注入
生成 prompt，互斥风格卡（口语化「轻快」vs 克苏鲁「压抑」）没有仲裁，模型自行调和导致
风格互扰（Run C 实证：设定泄漏+审计拒绝）。产品裁决：能力卡需要显式优先度——**用户排
顺序，系统按序注入**。同时商店所有卡（含创作链路 licensed 卡 private-175/179、克苏鲁
题材 sanitized 卡、内置 built-in 卡）统一走同一装配语义：装备时可标角色（基调/强化/
季节），排序决定注入顺序。

## Current state（已亲核锚点）

- `shared/types/preferences.ts:45` 区域 — `ProjectCapabilityProfile`：
  ```ts
  export interface ProjectCapabilityProfile {
    version: 3;
    activeFlowId?: string;
    projectSkillDeck: ProjectSkillDeck;
    favoriteTechniqueIds: string[];
    projectTechniqueIds?: string[];
    guardrailIds?: string[];
    capabilityMemberships?: CapabilityMembership[];
    migrationPendingIds?: string[];
  }
  ```
- `shared/lib/project-preference-profile.ts` — `normalizeProjectPreferenceProfile`：
  `projectTechniqueIds` 归一化为去重字符串数组（:93-105 区域的 deck 归一化同文件）。
- **注入顺序即优先级**（已实测）：`server/helpers/writing-style-service.ts:1506`
  `buildTechniquesResilient([...projectTechniqueIds, ...chapterTechniqueIds])` —
  数组顺序 = 各阶段 prompt 注入顺序；`:1071-1123` 按 id 查 manifest 分桶
  （planner/writer/critic），桶内保持传入顺序。
- **技法 prompt 组装**：`:1112-1117` 附近 — `resolveRuntimeCuratedPrompts` 还原白标
  占位克隆 + `resolveCuratedTechniquePrompt` 私表技法 + catalog template 三级回退。
- **装配入口（前端）**：`src/components/SkillsStudioView.tsx:1401-1441`
  `handleApplyDeck`/`:1359` 区域 — 装备时 append `projectTechniqueIds`；
  `:932` `overviewTechniqueIds` 总览读取。
- **用户已手动重排**（当前顺序即用户意图，迁移时按此初始化 order）：
  `prose-mouth-flavor-clone → prose-action-booster → bible-character-arc →
  bible-world-builder-clone → opening-gold-three → private-179-clone →
  private-175-clone`。
- 仓库约定：中文注释、prettier 单引号、eslint `--max-warnings=0`。

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| 后端定向 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/<file>` | all pass |
| 前端定向 | `npm run test:frontend -- src/tests/<file>` | all pass |
| Lint | `npx eslint <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**:
- `shared/types/preferences.ts`（ProjectCapabilityProfile 增 `techniquePriorities?` 字段）
- `shared/lib/project-preference-profile.ts`（归一化 techniquePriorities）
- `server/helpers/writing-style-service.ts`（注入前按优先级排序 + 角色标注）
- `src/components/SkillsStudioView.tsx`（技法总览的角色标记 + 上移/下移/设为基调控件）
- `tests/`、`src/tests/` 重锚与新增

**Out of scope**（do NOT touch）:
- `projectSkillDeck` 卡组泳道（已独立含容量闸）
- 本章 overlay（chapter workflowMeta）语义
- 付费闸（accessTier/licensed 定位不变——优先度不影响付费状态）
- 拖拽排序 UI（本期用按钮，拖拽另立）

## Steps

### Step 1: schema 扩展
`ProjectCapabilityProfile` 增：
```ts
/** Plan 260：技法装配优先度。base=基调（冲突时胜出），accent=强化，seasonal=按卷启停。 */
techniquePriorities?: Array<{ id: string; role: 'base' | 'accent' | 'seasonal'; order: number }>;
```
归一化：`normalizeProjectPreferenceProfile` 中对 techniquePriorities 去重（按 id 唯一）、
role 白名单校验、order 缺省按出现序填充；`projectTechniqueIds` 中未出现在
priorities 里的 id，视为 accent（按原数组序）。**向后兼容**：无 priorities 字段的旧
profile 行为完全不变。
**Verify**: `npm run typecheck` → 0；既有 profile 归一化测试全绿。

### Step 2: 生成侧排序 + 角色标注
`buildTechniquesResilient` 之前：按 priorities 排序 projectTechniqueIds
（base → accent(order) → seasonal(order) → 未标注按原序）。技法注入 prompt 时带
角色标注：planner/writer 段内每条技法 prompt 前缀 `【基调技法：X】` / `【强化技法：X】`
/ `【季节技法：X】`（仅 base 角色用「基调」，其余「强化」/「季节」）。
**Verify**: 定向测试全绿（见 Test plan）。

### Step 3: 前端装配控件
SkillsStudioView 技法总览（`:932` overviewTechniqueIds 区域）为每张技法卡增加：
- 角色徽标（基调/强化/季节）
- 「设为基调」「上移」「下移」三个小按钮（直接改 profile 的
  techniquePriorities + projectTechniqueIds 顺序，走既有 updateNovel 保存链路）
**Verify**: `npm run typecheck`；涉及组件的既有测试重锚/新增。

## Test plan

- 新增 `tests/technique-priority.test.ts`：归一化（去重/白名单/order 填充）、
  排序稳定性（base > accent(order) > seasonal(order) > 未标注）、向后兼容
  （无 priorities 时与旧顺序逐字节一致）。
- 前端：SkillsStudioView 技法区角色徽标渲染 + 排序按钮行为用例（仿既有
  skills-studio 测试脚手架）。
- 收尾：`npm test` + `npm run test:frontend` 全量。

## Done criteria

- [ ] typecheck 0；两套全量绿
- [ ] priorities 缺省时行为与现状逐字节一致（向后兼容）
- [ ] 设为基调的卡在生成 prompt 中排首位且带【基调】标注
- [ ] 商店全类型卡（built-in/licensed/plaza-sanitized）装配后均可设角色
- [ ] 改动文件在 In scope 内

## STOP conditions

- `normalizeProjectPreferenceProfile` 结构与锚点不符（被并行重构）。
- 排序改动导致既有生成测试出现无法语义重锚的红（>5 处）。
- 发现 profile version 需要升版（v3→v4）才能承载——报备，勿自行升版。

## Maintenance notes

- 后续「一键推荐卡组」直接产出 techniquePriorities（推荐引擎已有 AI 排序能力）。
- 审查重点：向后兼容（旧 profile 零迁移可用）与排序稳定性（同 role 内保持稳定序）。

## 汇报格式

STATUS: COMPLETE | STOPPED
STEPS / STOPPED BECAUSE / FILES CHANGED / NOTES