# Plan 256: 拆书卡组容量扩容（辅卡 2→4）+ 已生效配置总览

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. Touch only the files
> listed as in scope. If any STOP condition occurs, stop immediately and report.
> Do not improvise. Commit per step; do not push. SKIP any instruction to update
> `plans/README.md` — your reviewer maintains the index. Before reporting, audit
> every claim against an actual tool result; report failures/skips plainly. Reply
> with exactly the report format at the end.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED（动服务端校验边界 + 配置 UI）
- **Depends on**: none
- **Category**: feature
- **Planned at**: commit `897170b`, 2026-09-20

## Why this matters

用户实证痛点：能力卡库存多但「作品卡组」永远 3/3 满；而套牌/链路卡整剂启用走的是
`projectTechniqueIds`（无上限数组），**不占卡组空位**——同样是"作品默认配置"，
拆书卡占格、其他卡不占格，容量规则与 UI 呈现割裂。本计划：①拆书卡组辅卡容量
2→4（单一常量源，服务端校验与 UI 同步）；②卡组区域升级为「已生效配置总览」，
把占格的卡组与不占格的技法/护栏按工位分组呈现，消除心智割裂。

## Current state（已亲核锚点）

- **服务端容量校验**：`server/helpers/writing-style-service.ts:455-475` —
  ```ts
  const supportIds = deckRecord.supportCardIds;
  if (!Array.isArray(supportIds) || supportIds.length > 2 || supportIds.some(...)) {
    throw new WritingStyleRequestError(400, 'PROJECT_SKILL_DECK_INVALID', '作品卡组格式无效');
  }
  ```
  另有 `mainId === undefined && supportIds.length > 0` → PROJECT_SKILL_DECK_MAIN_REQUIRED。
- **前端硬编码**：`src/components/SkillsStudioView.tsx:893-901` —
  ```ts
  const deckSummaryCards = [
    { slot: '主卡', id: ...mainCardId },
    ...[0, 1].map((index) => ({ slot: `辅卡 ${index + 1}`, id: ...supportCardIds[index] })),
  ].map(...)
  ```
  `:898` 附近文案 `可添加 1 张主卡、2 张辅卡`；`:908` `作品卡组已满`；`:2111`
  `仅拆书卡占用：一张主卡，最多两张辅卡`；`:1627` 卡组已满 toast。
- **泳道②（不占格）**：`SkillsStudioView.tsx:1401-1432` `handleApplyDeck` 把套牌卡
  append 进 `projectTechniqueIds`（无上限）；服务端生成消费点
  `writing-style-service.ts:1136` `resolveFavoriteTechniqueIds`。
- **名字解析与工位签名（总览要复用）**：
  `src/components/AgentWorkspaceProductionPanel.tsx:195`
  `...(capabilityProfile?.projectSkillDeck.supportCardIds || []).map(resolveName)`；
  `src/lib/capability-craft.ts` `getCraftSignature(asset).station`；
  工位中文标签参照 `src/components/skills/StyleShelf.tsx` `STATION_LABELS`
  （outline=大纲 / deconstruct=拆书 / concept=设定命名 / platform-check=平台检验 /
  prose=正文 / guardrail=护栏）。
- 仓库约定：中文注释、prettier 单引号、eslint `--max-warnings=0`。

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| 后端定向 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/<file>` | all pass |
| 前端定向 | `npm run test:frontend -- src/tests/<file>` | all pass |
| Lint | `npx eslint <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**:
- `shared/lib/project-preference-profile.ts`（新增容量常量）
- `server/helpers/writing-style-service.ts`（校验改用常量，2→4）
- `src/components/SkillsStudioView.tsx`（槽位渲染、文案、已生效总览块）
- `tests/`、`src/tests/` 对应测试（改边界 + 新增总览用例）

**Out of scope**（do NOT touch）:
- `projectTechniqueIds` 的 append 语义与容量（保持无上限）
- `guardrailIds` 默认护栏逻辑
- `ProjectSkillDeck` 类型形状（mainCardId + supportCardIds 结构不变，只放宽数量）
- 配置会话/迁移（capability-configuration-session、capabilities/migration.ts）
- 本章 overlay（chapter workflowMeta）

## Steps

### Step 1: 容量常量单源化
`shared/lib/project-preference-profile.ts` 顶部（导入区之后）新增：
```ts
/** 作品卡组辅卡容量上限（Plan 256：由 2 扩至 4；服务端校验与 UI 槽位共用此常量）。 */
export const PROJECT_DECK_MAX_SUPPORT_CARDS = 4;
```
`server/helpers/writing-style-service.ts` 的 `supportIds.length > 2` 改为
`supportIds.length > PROJECT_DECK_MAX_SUPPORT_CARDS`（import 该常量）。
**Verify**: `npm run typecheck` → 0 错误。

### Step 2: 服务端校验边界测试
`grep -rn "PROJECT_SKILL_DECK_INVALID" tests/ | head` 定位既有校验测试：把
"3 张辅卡 400"类断言改为 4 张通过、5 张 400；补"主卡必填"既有断言保持。
**Verify**: 定向后端测试全绿。

### Step 3: 前端槽位常量化
`SkillsStudioView.tsx:893-901` 的 `...[0, 1].map(...)` 改为
`...Array.from({ length: PROJECT_DECK_MAX_SUPPORT_CARDS }, (_, index) => ...)`
（import 常量）；`:898` 文案 `可添加 1 张主卡、2 张辅卡` →
`可添加 1 张主卡、4 张辅卡`；`:2111` `最多两张辅卡` → `最多四张辅卡`；
检查 `作品卡组已满`（:908 附近）与 `:1627` toast 的满判断随新容量自然成立。
**Verify**: `npm run typecheck`；前端定向（`grep -rln "作品卡组" src/tests/` 定位
涉及文件）全绿。

### Step 4: 已生效配置总览
在作品卡组 summary 卡片（:2084-2126 区域）内新增「已生效能力总览」块：
- 三段：**拆书卡组（占格）**——主卡/辅卡名；**作品默认技法（不占格）**——
  `projectTechniqueIds` 解析出的卡名列表（名字解析仿
  AgentWorkspaceProductionPanel.tsx:195 的 resolveName 模式；若既有
  `resolveDeckCard` 可复用则复用）；**护栏**——`guardrailIds` 计数
  （驾驶舱已有护栏状态卡，此处只引用计数）。
- 按工位分组：`getCraftSignature(asset).station` → 中文标签
  （StyleShelf 的 STATION_LABELS 同款映射，可在本组件内内联同款映射，
  勿 import 组件文件）。
- 每段标注容量语义：「占卡组格」/「不占格 · 无上限」/「默认自动生效」。
- 空态：未配置时显示引导文案「从能力商店选用卡组或技法」。
**Verify**: `npm run typecheck`；前端定向全绿；新增总览用例（见 Test plan）。

## Test plan

- 后端：Step 2 的校验边界测试（4 过 / 5 拒 / 主卡必填不回归）。
- 前端：在 `src/tests/style-shelf-decks.test.tsx` 或涉及作品卡组的既有测试文件
  （`grep -rln "作品卡组" src/tests/`）新增：①总览块渲染三段标题；②projectTechniqueIds
  有值时技法段显示数量且标注「不占格」；③空态引导文案。
- 收尾：`npm test` 全量 + `npm run test:frontend` 全量。

## Done criteria

- [ ] `npm run typecheck` exit 0；`npm test` 与 `npm run test:frontend` 全量通过
- [ ] `grep -n "length > 2" server/helpers/writing-style-service.ts` 无匹配
- [ ] `grep -rn "PROJECT_DECK_MAX_SUPPORT_CARDS" shared server src | wc -l` ≥ 3
      （常量定义 + 服务端 + 前端各至少一处）
- [ ] UI 文案无「两张辅卡」残留（`grep -rn "两张辅卡" src/` 无匹配）
- [ ] 总览块三段渲染且有测试守护
- [ ] 改动文件全部在 In scope 内（`git status`）

## STOP conditions

- Current state 锚点与实际代码不符（配置面板重构过）。
- 槽位渲染从 `[0, 1]` 改为动态后，配置会话保存链路出现容量外断言红且无法
  在本计划内修（说明会话层另有硬编码，报备）。
- 总览需要的名字解析在客户端不可得（既无 resolveName 也无 manifest 查询），
  需要新增 API 才能实现——报备缩减范围。

## Git workflow

- 分支：`advisor/256-deck-capacity-overview`（审查者预建）。
- 每步一个 commit：`feat(capabilities): plan256 <中文一句话>`。不 push。

## Maintenance notes

- 未来调容量只动 `PROJECT_DECK_MAX_SUPPORT_CARDS` 一处。
- 审查重点：服务端校验放宽后，5 张辅卡的 prompt 膨胀是否被质量门兜住
  （buildSkillsPrompt 长度）——若 critic 阶段出现超长相关失败，回滚容量并报备。
- Plan 241 反馈数据攒够后，「已生效总览」可加一键移除/替换入口（本计划不做）。

## 汇报格式（最后一条消息严格按此）

STATUS: COMPLETE | STOPPED
STEPS: 逐步——done/skipped + 验证命令与结果
STOPPED BECAUSE: （仅 STOPPED 时）
FILES CHANGED: 列表
NOTES: 偏差/意外/判断题