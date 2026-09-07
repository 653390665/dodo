# 003 — 护栏策略面板化 + 流程排他确认

## 背景（为什么）

**护栏错位**：运行时事实是 `buildGuardrails`（`server/helpers/writing-style-service.ts:610-625`）把 `placementTier === 'core-default'` 的护栏**无条件注入全部三阶段**（planner/writer/critic，962/982/984 行）——护栏已经全局强制。但商店里"系统护栏 9"摆成可勾选的卡，暗示护栏是可选内容。用户正确地发问："好的小说难道是只符合部分护栏需求，而不是全部吗？"——答案是全部，UI 在撒谎。

**流程排他**：创作流程是唯一"整体替换"语义的配置（切换会替换流程+关联配置），但现在切换只有一处 `window.confirm` 时代的提示（已部分迁移 appConfirm），缺少"将替换什么"的对比信息。

## 目标

1. **护栏从商店移除**："系统护栏 9" 页签从能力商店删除；改为独立的「质量标准」设置区（设置弹窗或能力中心顶部策略卡）：
   - 展示 core-default 护栏清单，全部标记"✅ 已自动生效"（只读，不可取消）；
   - 增强护栏（configured `guardrailIds`）作为开关组：开/关即时生效（写 `guardrailIds`），带一行说明"增强护栏会追加到默认检查之后"。
2. **能力中心"护栏状态"卡**与新区块打通：显示"默认 N 条已生效 + 增强 M 条"。
3. **流程切换对比确认**：`SkillsStudioView.tsx:770-786` 的 appConfirm 文案升级为动态清单——"切换到「X」将替换当前流程「Y」；以下内容将被重置：流程步骤进度"。仍复用 appConfirm。

## 涉及文件

- `src/components/SkillsStudioView.tsx`（删护栏页签；流程确认文案）
- `src/components/SettingsModal.tsx`（新增"质量标准"区块；或能力中心内嵌——建议能力中心，理由：与写作强相关且需读 novel 数据）
- `src/components/WorldBibleOnboarding.tsx:40`（`defaultGuardrail` 取法保持不变，验证不回归）
- `server/helpers/writing-style-service.ts`（无改动——运行时已正确）
- `src/tests/skills-studio-plan158.test.tsx`（护栏相关断言同步）

## 实施步骤

1. 新组件 `GuardrailPolicyPanel`：读 `PROMPT_GOVERNANCE_CATALOG` 按 `placementTier==='core-default'` 渲染只读清单（"已自动生效"）；增强项渲染开关（onChange 写 `capabilityProfile.guardrailIds` 增删，复用 `persistProjectPreferenceProfile`）。
2. 能力中心顶部"护栏状态"卡加"管理"按钮 → 打开该面板；商店删"系统护栏"页签与相关分支（`SkillsStudioView` 内 guardrail 类目过滤）。
3. 流程切换 confirm 文案动态化：列出旧流程名/新流程名/将重置的进度标签数。
4. 后端零改动——`guardrailIds` 读写链路已存在。

## 验证

- `npx tsc --noEmit` → 0
- `npx eslint src/components/SkillsStudioView.tsx src/components/SettingsModal.tsx` → 0
- `npx vitest -c vitest.config.frontend.ts run src/tests/skills-studio-plan158.test.tsx` → 全过
- 手动：商店无护栏页签；能力中心可开关增强护栏并即时保存；切流程弹出含清单的确认

## 边界

- 不动 core-default 注入逻辑与 `placementTier` 数据
- 不把护栏做成"可逐条启停的卡"——core 永远全开

## 完成标准

- [ ] 商店 grep `系统护栏` 页签 = 0
- [ ] 质量标准面板可开关增强护栏并持久化
- [ ] 流程切换确认含替换清单
