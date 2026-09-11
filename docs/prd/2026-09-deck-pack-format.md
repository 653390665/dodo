# PRD：能力卡/拆书 Deck 导出与导入格式（Deck Pack v1）

> 状态：设计 spike 产出（Plan 192）。产品拍板前不进入实施。
> 来源审计：第 30 轮 DIRECTION-1——「能力商店有店无流通」。

## 1. 问题与价值

拆书工厂消耗真实 LLM 调用产出「主笔卡 + 副卡组」（`Skill.deconstructionCardType`，经 `deckGroupId` 天然分组），是用户投入最重的资产。当前换机只能整库备份恢复（`/api/db/import-file`），无法单卡组备份、无法分享给其他作者。复用基建已齐：jszip 双端在用、白标消毒管线已有（`sanitizeWhiteLabelText`）。

## 2. 数据面盘点（2026-09-11 实测）

- `shared/types/skills.ts:44` `Skill`：自包含实体，无跨表强外键；血缘字段 `parentSkillId`/`lineageRootId`、分组字段 `deckGroupId`、治理字段 `sanitizationStatus`/`runtimeStatus`/`sourceBadge`/`sourceType`/`accessTier`。
- `server/lib/db/skills.ts`：`listSkills/getSkill/createSkill/deleteSkill/listSkillVersions`。
- 运行时数据（**不导出**）：`usageStats`、`feedbackScore`、`executionScore`、`stabilityScore`（机器学习产物，跨机无意义）。
- 消毒管线：`sanitizeWhiteLabelText`（shared 运行时可用；生成脚本内同源）——按模式物理剥离微信/QQ/电话/邮箱/竞品水印，泛化品牌词不在覆盖面，导出承诺以管线输出为准。
- **原型实测发现（schema 前置缺口）**：`server/lib/db/skills.ts:58` 的 `insertColumns` **不含** `deck_group_id`、`deconstruction_card_type`、`sanitization_status`、`runtime_status`、`source_type`、`access_tier`、`is_runtime_ready`——deck 分组与治理字段目前**不落库**（仅存在于共享类型与运行时校验入参）。实施计划的前置工作：扩列或以 manifest 落库承载分组。

## 3. Deck Pack v1 格式

```text
<deck-id>.inkdeck (zip)
├── manifest.json
└── cards/<card-id>.json     # 每卡一份，字段为 Skill 的导出子集
```

`manifest.json`：

```json
{
  "format": "inkflow-deck-pack",
  "formatVersion": 1,
  "deckId": "deck-…",
  "title": "人类可读标题",
  "exportedAt": "ISO-8601",
  "sanitized": true,
  "cards": [{ "id": "…", "file": "cards/…json", "deconstructionCardType": "style-card" }]
}
```

字段规则：

1. **导出子集**：`Skill` 全部内容字段 + 血缘/分组/证据字段（`evidenceCoverage`/`evidenceMoments`/`methodChain`/`whyThisSkillWorks`）；**排除**运行时字段（§2 所列）与 `version`（导入侧从 1 重新计数）。
2. **重标识（re-id）**：导入时所有 id 统一加 `imp-<hash8>-` 前缀重映射（`id`/`parentSkillId`/`lineageRootId`/`deckGroupId`/fusionMeta 内引用），避免跨机冲突；映射表只在导入会话内存在。
3. **消毒承诺**：导出前对每个字符串字段跑 `sanitizeWhiteLabelText`（与生成脚本同源），`manifest.sanitized=true` 表示已过管线；`sanitizationStatus` 导出统一置 `sanitized`。
4. **不导出的治理字段**：`accessTier` 与 `sourceType` 一律不随文件流通（付费边界红线见 `docs/archive/monetization-boundary.md`）；`sourceType='licensed'|'built-in'` 的卡**拒绝导出**（只允许用户自产卡）。`sourceType` 缺失未授权的卡会被 `server/capabilities/manifest.ts` 的 `validateSkillPersistence` 拒收（SKILL_CARD_SOURCE_INVALID，原型实测）——因此**导入时统一置 `sourceType='plaza'`（广场免费）**，不信任原值。

## 4. 导入信任边界

导入的 deck **必须**过消毒管线双跑（导出侧已跑 + 导入侧重跑快照比对），不信任 manifest 声明。落库门禁（`server/capabilities/manifest.ts:100` `validateSkillCardForScope`）要求含 `deconstructionCardType` 的卡必须 `isRuntimeReady=true + sanitizationStatus='runtime-ready' + runtimeStatus='active'`，且 `sourceType` ∈ 授权枚举——原型实测缺任一即 `SKILL_CARD_SOURCE_INVALID`/`SKILL_CARD_NOT_RUNTIME_READY` 拒收。因此导入卡统一：`sourceType='book-extracted'`（既有授权枚举，拆书专属）+ 消毒通过后 runtime-ready/active（与 `/api/skills/sanitize` 端点落库先例一致）；`accessTier` 不导出不落库（默认免费）。

## 5. 实施切面（拍板后另立实施计划，预估 M）

- 服务端：`/api/skills/pack` 导出（GET，zip 流）+ 导入（POST multipart）两个路由；复用 skills.ts 的 rateLimit。
- 前端：`SkillDetailDrawer` / 货架分组菜单加「导出卡组 / 导入卡组」。
- 版本化：`formatVersion` 从 1 起；v2 迁移读 manifest 分支处理。

## 6. 开放问题（产品决策项）

1. 分享是否携带 `evidenceMoments`（含原书片段，版权边界）？默认导出时剥离 excerpt 只留结构。
2. 导入冲突策略：同 `deckGroupId` 已存在时合并还是另建？（默认另建。）
3. 是否提供「导出为公开 plaza 卡」的投稿通道（涉及服务端审核，超出本地优先边界）。
4. `fewShots` 例文是否算用户原创内容可分享？（默认随卡导出。）
5. 跨版本 Skill.schema 演进的向前兼容字段（未知字段导入时保留还是丢弃？默认保留在 `extra` 不参与运行）。

## 7. 原型验证

`scripts/deck-pack-prototype.ts`（spike 已交付）：构造 2 卡 deck → 导出（消毒快照 + zip）→ 临时库导入（re-id + 落库）→ 断言消毒一致、计数一致、id 映射一致。运行：`node --import tsx scripts/deck-pack-prototype.ts`。
