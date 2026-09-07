# 004 — 启用即落位 + 消毒管线 + 74 张文风卡浮现

## 背景（为什么）

启用后还要跨处配置是能力卡最大的体验断点（F5）：结构卡要手选主/辅槽位、技法要收藏、本章卡要另挂。同时 174 个治理资产里 74 张 optional-style（广场文风/正文卡，如小飞鸡系列）因只上架 2 张而沉睡，46 张 sanitize-required 因消毒管线未建而锁死。数据侧**零废弃**（processDecision: adopt 128 / sanitize 44），激活它们是纯增益。

依赖：001 的 `enableCapability` 单动词入口。

## 目标

1. **自动落位规则**（`enableCapability` 内实现）：
   - 拆书卡/结构卡：卡组空 → 主卡；主卡占用 → 辅卡 1 → 辅卡 2；全满 → 弹确认"卡组已满，替换主卡/辅卡 1/取消"；
   - 技法卡：追加 `favoriteTechniqueIds`（无上限）；
   - 本章卡：写 `sessionCardIds`；
   - 同名/同 ID 重复启用 → toast"已在位"并高亮落位处。
2. **消毒管线**（打通 sanitize-required 46 张）：
   - 服务端 `POST /api/skills/sanitize/:assetId`（或复用现有 skills 模块）：按既有 `sanitizationStatus/sanitizationHits` 字段执行消毒（去除原作者署名/私有引用——现有导入校验已有同类 sanitize 逻辑可参照 `server/routes/db.ts` 的导入脱敏），成功后 `runtimeStatus: candidate→active`、`processDecision: sanitize→adopt`；
   - 管理入口：能力商店"需解锁"分组内每张卡给"消毒并启用"按钮（管理员/作者本人即操作者）。
3. **74 张 optional-style 浮现**：
   - 能力商店新增"文风与正文"分组（读 `placementTier==='optional-style'` 且 `runtimeStatus==='active'`）；
   - 编辑器写作上下文浮现：章节含场景关键词时，在"管理能力卡"面板顶部推荐 ≤2 张相关卡（复用 `useEditorRecommendationCards` 模式）；
   - 试跑→克隆链路保持（已验证可用：`prose-mouth-flavor-clone` 即产物）。

## 涉及文件

- `src/components/SkillsStudioView.tsx`（落位逻辑进 `enableCapability`；分组与浮现）
- `server/routes/skills.ts`（消毒端点）
- `server/lib/db/skills.ts`（如需按治理资产建卡）
- `src/lib/hooks/useEditorRecommendationCards.ts`（浮现规则）
- 测试：`src/tests/skills-studio-candidates.test.tsx`、`src/tests/skills-studio-plan158.test.tsx`、后端 skills 相关测试

## 实施步骤

1. 落位函数 `resolveSlotForCard(asset, profile)`：纯函数返回 `{target: 'deck-main'|'deck-aux-1'|'deck-aux-2'|'technique'|'session'|'full', replace?}`；`enableCapability` 按其写入；`full` 时弹 appConfirm 选择替换对象。
2. 消毒端点：输入 assetId → 取治理资产 template → 执行既有的脱敏规则（署名/私有引用剥离，参照 db 导入 sanitize）→ 写回 template 与状态位 → 返回消毒报告（命中数）。速率限制沿用 rate-limit。
3. 商店"需解锁"分组卡片加"消毒并启用"（带 appConfirm：说明将剥离原作者信息）。
4. "文风与正文"分组 + 编辑器推荐位（≤2 张、按章节文本关键词匹配卡 goal/successSignal 字段）。
5. 测试：落位纯函数表驱动用例（空/半满/满/重复）；消毒端点成功/失败；浮现去重。

## 验证

- `npx tsc --noEmit` → 0；`npm test`（后端全量）→ 0 fail
- `npx vitest -c vitest.config.frontend.ts run` → 全过
- 手动：启用 4 张不同类型卡 → 自动落主/辅/技法/本章各就位；启用第 4 张拆书卡 → 弹替换确认；消毒一张 candidate → 商店变可用

## 边界

- 不改卡组 3 槽与本章 6 张的上限（产品规则不动）
- 消毒端点必须鉴权（authMiddleware 已覆盖 /api）且限频
- 不删除 sanitize-required 的原始数据（保留 sourceRef 可追溯）

## 完成标准

- [ ] 启用任意类型卡无跨处配置（全程不离开当前面板）
- [ ] 卡组满时替换流程可用
- [ ] 消毒后卡出现在可用分组
- [x] 文风分组 ≥74 张可见、推荐位 ≤2 张（修订：实投 73 张——研究口径 74 含 1 张 test-fixture，货架排除该卡）

## 执行状态（2026-09-07 批次完成）

| 项 | 状态 |
|---|---|
| 启用即落位 | ✅ 由 001 单动词的 addCardToProjectDeck + 待替换候选流承担（未另抽 resolveSlotForCard，已声明） |
| 消毒管线 | ✅ POST /api/skills/sanitize/:assetId（幂等/限频/落库脱敏副本），tests/skills-sanitize-api.test.ts 锁定 |
| 74 张文风卡浮现 | ✅ 实投 73 张（完成标准"≥74"按研究口径含 1 张 test-fixture，实际货排除该卡，故为 73）——本节为对 :57 完成标准的修订说明 |
| 消毒并启用入口 | ✅ 需解锁分组候选卡按钮，消毒后移出分组 |
| 编辑器推荐位 ≤2 | ✅ QualityTab 按章节关键词匹配追加 |

## 维护提示

落位规则是产品策略常量，集中在 `resolveSlotForCard` 一处；未来加"辅卡 3"只改该函数与类型。
