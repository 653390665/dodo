# 治理目录消毒与白标安全规范（capability-sanitize）

> 对应 AGENTS.md「技术不变式」第四条。改动 `capability-governance.ts`、`SkillsStudioView` /
> `StyleShelf` 等货架投影面、`public-skill-catalog` / `prompt-governance-catalog` 或消毒端点前，
> 先读本规范。

## 为什么有这条规范（失效模式：白标泄露）

治理目录的 `sanitize-required` 候选卡来自**广场共享与第三方去构造**（sourceGroup plaza /
licensed），原貌正文可能携带原作者署名、联系方式、竞品品牌词与水印话术。这些内容若以任何形式
**直达用户渲染层**，即构成"白标泄露"：用户在 InkFlow 界面上看到别家产品或他人的品牌化内容。
185/197 战役要消灭的正是这一失效模式；210 通过"源目录重建真实正文 + 渲染切副本"完成单源化。

## 不变式

**渲染投影只允许两条路径，候选原貌禁止直达渲染。**

1. **文风可选集**：`getOptionalStyleAssets()`（`src/lib/capability-governance.ts`）——
   消费 `RUNTIME_STYLE_CATALOG = [...PUBLIC_SHELL_CATALOG, ...SANITIZED_SKILL_COPIES]`，
   且过滤条件强制 `runtimeStatus === 'active' && isRuntimeReady && sanitizationStatus ===
   'runtime-ready'`，即只有消毒完成且运行就绪的条目才会出现在货架。
2. **需解锁白名单**：`getSanitizeRequiredAssets()`——投影待消毒候选卡（卡片壳信息：标题 /
   目标 / 成功信号），**不投影正文**；正文的解锁必须走服务端消毒端点（生成 `sanitized-` 副本
   落库），前端以副本消费。

除此之外，任何新面板 / 新投影 / 新导出不得把 `sanitize-required` 或未消毒候选的正文渲染给用户，
也不得绕过 `sanitizationStatus` 过滤直接把治理目录条目当可用能力供出。

3. **渲染层目录边界（Plan 262 B1，2026-09-28）**：渲染层**只能**消费生成产物
   `shared/lib/public-skill-catalog.ts`（公开池 `PUBLIC_SKILL_GOVERNANCE_CATALOG`、全量壳目录
   `PUBLIC_SHELL_CATALOG`、消毒副本 `SANITIZED_SKILL_COPIES`），**禁止** import 源治理目录
   `shared/lib/prompt-governance-catalog.ts`——它携带 `template` 全文，会让未消毒正文进渲染包。
   壳目录 = 全量源资产（`template` 物理清空）的投影；`template` 的派生语义（壳判定）在生成期
   固化为 `isShellBody`，供护栏审计等消费方复用。

## 实现锚点

- 投影与判定：`src/lib/capability-governance.ts`（`RUNTIME_STYLE_CATALOG`、
  `getOptionalStyleAssets`、`getSanitizeRequiredAssets`、`isSanitizeRequiredAsset`）。
  Plan 220 起，`isSanitizeRequiredAsset` / `hasGeneratedSanitizedCopy` 为模块级预计算 Set，O(1)。
- 消费面：`SkillsStudioView`（文风与正文页签）、`StyleShelf` / `PlazaAssetCard`
  （`onSanitize` 仅在 `isSanitizeRequiredAsset` 为真时展示）。
- 消毒数据源：`SANITIZED_SKILL_COPIES`（`shared/lib/public-skill-catalog.ts`，生成产物；
  其模板与生成逻辑在 `scripts/generate-public-catalog.ts`）。
- **渲染层目录来源**：`PUBLIC_SHELL_CATALOG`（同文件，生成产物；全量源资产、`template` 物理清空、
  固化 `isShellBody`）。生成逻辑：`scripts/lib/public-catalog-pipeline.ts` 的 `buildPublicCatalogModel()`
  → `model.shellCatalog`（去重顺序 = 源目录优先、注册表补缺）。
- **壳判定单源**：`shared/lib/prompt-shell.ts`（`isShellTemplatePrompt`）。`shared/lib/guardrail-scope.ts`
  的 `isShellGuardrail` 优先读 `isShellBody`，源目录侧仍走模板判定，两侧结论一致（有守卫测试）。
- **判据单源**：`shared/lib/capability-runtime-readiness.ts`（`isRuntimeReadyAsset` /
  `hasRuntimeReadySanitization`，M5② 收口）。「这张卡能不能用」的三元判定只此一处，禁止再手抄
  比较；守卫 `tests/capability-runtime-readiness.test.ts` 会扫描仓内源码。

## 守护测试

- `src/tests/skills-studio-plan158.test.tsx` 004 号断言：副本单源化语义（已有消毒副本的候选
  不再进"需解锁"分组，其副本作为正式文风卡可选用）。
- `tests/public-catalog-freshness.test.ts`：生成产物与源注册表一致性。
- `tests/de-ai-tells-guard.test.ts`：消毒正文不得命中署名 / 联系方式 / 竞品 / 水印词模式。
- `tests/renderer-catalog-shell.test.ts`（Plan 262 B1）：① 静态边界（`src/**` 非测试文件不得 import
  源治理目录）；② 壳目录无正文；③ id 覆盖源目录 / 公开池；④ 治理字段逐条零漂移；⑤ 壳标记固化与
  「引用壳」分类两侧一致；⑥ 渲染层治理函数在壳目录上仍可用。

## 已知缺口

- **准入判据单源化已完成（M5②，2026-09-28）**：`isRuntimeReady && runtimeStatus === 'active' &&
  sanitizationStatus === 'runtime-ready'` 原本被手抄在 14 处前后端调用点，现全部改引用
  `shared/lib/capability-runtime-readiness.ts`（定义处 1，手抄 0）。**剩余面（未一并单源）**：
  `isWhiteLabeled` / `grade` / `score` / `placementTier` / `deconstructionCardType` 等附加准入条件
  仍散在各投影函数内，属下一步结构收口。
- 消毒运行时端点（`/sanitize` 类）无自动化 E2E 覆盖（plan 213 执行记录：010 用例随单源化删除，
  端点保留）。
- `PROMPT_GOVERNANCE_CATALOG`（源）与 `PUBLIC_SKILL_GOVERNANCE_CATALOG` / `PUBLIC_SHELL_CATALOG`
  （生成产物）现为**双库**：导出名已区分（Plan 221）。**渲染侧已单源**（Plan 262 B1：渲染层只消费
  生成产物，源目录仅作生成输入）；服务端仍读源目录（要正文），合并评估留给 plans/README backlog
  「白标清洗单源化」「governance 契约测试」。
- **「需解锁」恒为 0（2026-09-28 拍板：非缺陷结案）**：`getSanitizeRequiredAssets()` 实测返回 **0 条**——「需解锁」
  白名单当前为空（源目录口径同样为 0：13 张候选或已有副本、或标题判为垃圾/重复）。该投影面目前是
  该分组在 0 项时不渲染（`src/components/SkillsStudioView.tsx:3231`），契约由测试保留（`src/tests/skills-studio-plan158.test.tsx:1856`）⇒ **恒为 0 是正确结果**：Plan 210 单源消毒后每张候选都有 `sanitized-` 副本，既不需修谓词也不需下线投影面。
