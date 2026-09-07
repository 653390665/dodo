# 001 — 能力卡单动词交互收敛

## 背景（为什么）

能力商店/能力中心的"启用一张卡"当前需要三段式操作：勾选 → "加入本次配置候选" → "应用配置"（运行类则是"运行诊断"），且提示语按包 ID 硬编码四套（`SkillsStudioView.tsx:174-176`）。同屏出现 5 种状态短语、3 段说明文案（其中"应用配置后，主卡与辅卡影响作品后续正文……"重复 3 次）、单卡 6-10 个 9px 徽章。业务埋点显示高级能力采纳率 <2%（418 事件中 capability_viewed 仅 11），交互复杂度是直接原因。

用户原话："选择方式都不一样，有的是应用，有的是配置，有的需要选择，这个流程是不是特别复杂"、"配置完了之后还要在其他地方进行选择配置"。

## 现状摘录（漂移检测锚点）

```ts
// SkillsStudioView.tsx:65-78
return '应用所选配置并返回写作';
// ...
return '加入本次配置候选';
// SkillsStudioView.tsx:174-176
if (packageId.includes('audit') || packageId.includes('diagnostic')) return '加入本次配置候选后点运行诊断';
if (packageId.includes('humanization') || packageId.includes('patch')) return '加入本次配置候选后点生成预览';
if (packageId.includes('onboarding')) return '加入本次配置候选后点应用配置';
```

状态与草稿机：`configurationDraft`、`stageConfiguration()`（`SkillsStudioView.tsx:712,803`）、"本次配置"标签页。

## 目标交互

1. **装配类卡（equip）**：唯一按钮「启用」。点击 → 弹一条确认条（非模态）：显示"将影响：作品后续正文 / 仅本章"+ 落位去向（主卡/辅卡/常用技法）→ 确认后**内部一次完成**提交+应用，底部出现 5 秒撤销条（撤销=恢复装配前 profile）。
2. **执行类卡（direct-exec / diagnostic / utility）**：唯一按钮「运行」。点击 → 直接执行（保留现有 confirm 费用提示），产出报告照旧。
3. **删除"本次配置候选"草稿态**：`stageConfiguration/configurationDraft` 流程退役；启用失败自动回滚到操作前 profile 深拷贝。
4. **徽章瘦身**：每卡最多 2 个徽章——`作用范围`（作品正文/仅本章/一次性诊断）+ `改正文/只读`。其余（大纲期、授权增强、仅运行一次、阶段节点）移入详情抽屉（点卡片名展开）。
5. **不可用卡折叠**：disabled 卡移入底部"需解锁"折叠分组，不再与可用卡同屏混排。
6. **重复说明清理**：三处重复的"应用配置后……"长说明删两处，保留工作台副标题一处并缩短为一行。

## 涉及文件

- `src/components/SkillsStudioView.tsx`（主战场；2750 行，改弹窗、卡片按钮、状态短语函数 65-176、草稿机）
- `src/components/book-factory/EquipPanel.tsx`（如有装配入口，对齐单动词）
- `src/tests/skills-studio-plan158.test.tsx`、`src/tests/skills-studio-candidates.test.tsx`、`src/tests/plan158-frontend-cleanup.test.ts`（断言同步）

## 实施步骤

1. 在 `SkillsStudioView` 内新增 `enableCapability(asset)`：深拷贝当前 `projectPreferenceProfile` → 按卡类型直接写入（equip→卡组/技法；路径复用现有 `buildV3CapabilityProfile` / `stageConfiguration` 的最终写入分支）→ 成功后调 `toast('已启用「X」，将影响…', 'success')` 并挂 5 秒撤销条（撤销=写回深拷贝）；失败 toast error 并自动回滚。
2. 执行类卡按钮统一为「运行」，直接调用现有运行分支（不经草稿）。
3. 删除 `configurationDraft/stageConfiguration/clearStaleDraft` 相关 UI 与状态（保留数据写入函数供 enableCapability 复用）；同步删除"本次配置"标签页入口。
4. 徽章组件收敛：新增 `CapabilityBadges` 子组件（输出 ≤2 徽章），替换现有散落的徽章拼接；详情抽屉承接被移除的元数据。
5. 不可用卡移入 `<details>` "需解锁"分组。
6. 测试更新：所有断言"加入本次配置候选/应用所选配置"的用例改为断言「启用」后 profile 直接变更。

## 验证（每步后跑）

- `npx tsc --noEmit` → 0 错误
- `npx eslint src/components/SkillsStudioView.tsx` → 0 问题
- `npx vitest -c vitest.config.frontend.ts run src/tests/skills-studio-plan158.test.tsx src/tests/skills-studio-candidates.test.tsx src/tests/plan158-frontend-cleanup.test.ts` → 全过
- 手动：能力商店点「启用」一张结构卡 → 无中间态，作品卡组 0/3 → 1/3，撤销条 5 秒内点击可回退

## 边界

- 不改后端 `/api/novels/:id/writing-style/*`、不动 quota 商业化判定（`dispatchCapabilityUnavailable` 保留）
- 不动 `resolveWritingStyleRequest`（写法确认留存化刚落地，勿扰）
- `iban-word`… 死代码清理不在本计划

## 完成标准

- [ ] 组件代码 grep `加入本次配置候选|应用所选配置` = 0 命中
- [ ] 每张卡按钮 ≤1 个动词，徽章 ≤2 个
- [ ] 撤销条可用且 5 秒后消失
- [ ] 上述测试全绿

## 维护提示

后续 004（启用即落位）会扩展 `enableCapability` 的落位规则；006 会在此文件做术语替换。撤销条实现可复用 `appConfirm` 同款 host 模式。
