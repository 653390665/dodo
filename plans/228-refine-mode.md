# Plan 228: 重构模式——来料加工管线，人设/大纲重构首两张卡（G2/P0，依赖 227）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat b3a5bcc..HEAD -- server/routes/production.ts shared/lib/public-skill-catalog.ts src/lib/skills-studio-governance.ts src/components/SkillsStudioView.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P0（迁移者人群的入口：带大纲/人设家底的作者现在只能「从灵感开始」）
- **Effort**: L
- **Risk**: MED-HIGH（新执行链路 + prompt 契约 + 候选落地；但全部复用已验证机制）
- **Depends on**: 227（craft 签名——重构卡的识别与输入绑定依据）
- **Category**: feature（能力商店诊断 · 来料加工）
- **Planned at**: commit `b3a5bcc`, 2026-09-15（来源：四轮思考 · 工序轮「重构 = 你的旧料 × 卡的方向」）

## Why this matters

已有大纲/角色/世界观资料的用户（老书迁移、半途启动）进店后被流程第一步「脑洞灵感闪耀」劝退。卡目录里人设/大纲类卡的 prompt 全按「从零生成」书写，用户的既有资料只能当背景上下文，不能作为加工对象。「重构」是缺失的中间动词：保留既定事实、结构性重组。地基三件全在：ledger 里有用户的料（characters/worldRules/sceneBeats）、非正文产物有候选机制（isWorldCandidateArtifact/isOutlineCandidateOutput）、正文有 version+review_required 全套安全模型。

## Current state（2026-09-15 亲读核实，锚点基于 `b3a5bcc`）

1. 用户资料在库：`buildStoryStateLedger` 消费 `characters/locations/items/factions/foreshadowings` + `worldRules` + 章节内容（production.ts 初始化链路）；`sceneBeats` 存于章节。
2. 候选机制：`src/lib/skills-studio-governance` 导出 `isOutlineCandidateOutput`/`isWorldCandidateArtifact`；能力包应用链路已把 outline/world 产物作为候选呈现（`packageComponentResults` 相关流）。
3. 安全模型先例：正文生产 run 的 `review_required` + `createProductionVersion` 版本链（production.ts，216/218 刚加固过）。
4. 卡 prompt 现状：人设/大纲类卡（如 `square-183` 人设卡）模板按生成书写；`inputs: ["content"]` 占位无绑定语义。
5. 227 交付 craft 签名：`mode: 'refine'` 的卡 + `inputs: ['characters'|'chapters-outline']` 可被程序识别。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 后端定向 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/<新用例>` | 全绿 |
| 前端定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/<新用例>` | 全绿 |
| 全量 | `npm run test:unit` | 全绿 |

## Scope

**In scope**：
- 目录新增两张 `mode: 'refine'` 卡：**人设重构**（inputs: characters → output: characters）与**大纲重构**（inputs: chapters-outline → output: detailed-outline），prompt 契约明确「保留既定事实，只做结构性重组与扩充；不得新增与现有设定冲突的事实」
- 执行链路：应用重构卡时读 ledger 对应资料作为**主输入**注入 prompt（非背景上下文）；产物一律走候选（outline/world candidate 机制）→ 预览 → 接受后落库；不提供直写路径
- 应用 UI：选重构卡时展示「将使用你的现有资料：角色设定 N 条 / 大纲 M 章」绑定确认
- 配额：复用 generateProse 保留/提交/退款语义（有候选产出即 commit）

**Out of scope**：
- 正文重构（已有审稿/精修链路覆盖，后续按需）
- 重构历史/多候选对比（版本机制已有，先不加壳）
- 套牌顺序调用（229）

## Steps

### Step 1: 两张重构卡入库 + 签名

目录源（或覆盖表）加两张卡，`craft.mode='refine'`；生成 + freshness；prompt 按「事实保留清单 + 重组指令」书写并附产物 JSON 形状（对齐候选识别器）。

**Verify**: freshness 3/3；签名完备性测试绿；卡面在 226 症候层可被「重构」向命中（如适用）

### Step 2: 执行链路（后端）

重构执行端点/复用既有能力执行端点：读 ledger 资料 → 组装主输入 prompt → LLM → 产物走候选校验（isWorld/OutlineCandidate）→ 落候选。确定性测试：mock LLM 返回结构化产物，断言候选落库、原资料零改动、配额 commit。

**Verify**: 后端定向测试绿（含「LLM 失败 → 配额 refund、无候选残留」）

### Step 3: 绑定 UI + 候选预览（前端）+ 回归

应用流绑定确认（现有资料清单 + 勾选）；候选预览面板复用既有 outline/world candidate 渲染；接受后刷新对应面板。前端全量 + typecheck。

**Verify**: 组件测试（绑定确认/候选预览/接受）；前端全量绿；台账落账

## Done criteria

- [ ] 带现成人设/大纲的用户可一键「用卡重构我的资料」，产物走候选、原资料零风险
- [ ] 两张重构卡端到端绿（含失败退款路径）
- [ ] 台账落账

## STOP conditions

- LLM 重构产物结构化候选校验通过率过低（试运行 <70%）→ 停止，报告 prompt 契约与候选识别器的匹配情况，先调契约再继续。
- 候选机制无法承载人设/大纲粒度（字段级冲突）→ 停止报告，评估扩展候选结构而非硬套。
