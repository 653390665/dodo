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
   消费 `RUNTIME_STYLE_CATALOG = [...PROMPT_GOVERNANCE_CATALOG, ...SANITIZED_SKILL_COPIES]`，
   且过滤条件强制 `runtimeStatus === 'active' && isRuntimeReady && sanitizationStatus ===
   'runtime-ready'`，即只有消毒完成且运行就绪的条目才会出现在货架。
2. **需解锁白名单**：`getSanitizeRequiredAssets()`——投影待消毒候选卡（卡片壳信息：标题 /
   目标 / 成功信号），**不投影正文**；正文的解锁必须走服务端消毒端点（生成 `sanitized-` 副本
   落库），前端以副本消费。

除此之外，任何新面板 / 新投影 / 新导出不得把 `sanitize-required` 或未消毒候选的正文渲染给用户，
也不得绕过 `sanitizationStatus` 过滤直接把治理目录条目当可用能力供出。

## 实现锚点

- 投影与判定：`src/lib/capability-governance.ts`（`RUNTIME_STYLE_CATALOG`、
  `getOptionalStyleAssets`、`getSanitizeRequiredAssets`、`isSanitizeRequiredAsset`）。
  Plan 220 起，`isSanitizeRequiredAsset` / `hasGeneratedSanitizedCopy` 为模块级预计算 Set，O(1)。
- 消费面：`SkillsStudioView`（文风与正文页签）、`StyleShelf` / `PlazaAssetCard`
  （`onSanitize` 仅在 `isSanitizeRequiredAsset` 为真时展示）。
- 消毒数据源：`SANITIZED_SKILL_COPIES`（`shared/lib/public-skill-catalog.ts`，生成产物；
  其模板与生成逻辑在 `scripts/generate-public-catalog.ts`）。

## 守护测试

- `src/tests/skills-studio-plan158.test.tsx` 004 号断言：副本单源化语义（已有消毒副本的候选
  不再进"需解锁"分组，其副本作为正式文风卡可选用）。
- `tests/public-catalog-freshness.test.ts`：生成产物与源注册表一致性。
- `tests/de-ai-tells-guard.test.ts`：消毒正文不得命中署名 / 联系方式 / 竞品 / 水印词模式。

## 已知缺口

- 消毒运行时端点（`/sanitize` 类）无自动化 E2E 覆盖（plan 213 执行记录：010 用例随单源化删除，
  端点保留）。
- `PROMPT_GOVERNANCE_CATALOG`（`prompt-governance-catalog.ts`，治理注册表源）与
  `PUBLIC_SKILL_GOVERNANCE_CATALOG`（`public-skill-catalog.ts`，生成产物）现为**双库**：
  导出名已区分（Plan 221），内容合并或消费侧单源化留待"消毒缺口收口"后评估（见 plans/README
  backlog「白标清洗单源化」「governance 契约测试」）。
