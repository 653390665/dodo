# Plan 236: 白标清洗器四副本合一（CORR-02 执行）+ 失实指针修正（第三轮审查，P1）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 95111f4..HEAD -- shared/lib/prompt-sanitizer.ts scripts/generate-public-catalog.ts src/lib/capability-governance.ts shared/lib/public-skill-catalog.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1（4 份漂移副本是已知正确性债 CORR-02；本轮新增 1 处指向本计划的失实注释需要一并修正）
- **Effort**: S-M
- **Risk**: MED（白标语义面——剥除规则变化直接影响卡面标题与消毒端点行为）
- **Depends on**: 无（221 前置已就绪）
- **Category**: fix（CORR-02 正式执行；第三轮审查产出）
- **Planned at**: commit `6451c43`, 2026-09-16（来源：第三轮深度审查 · 指针失实 + backlog 转正）

## Why this matters

白标清洗器存在 4 份漂移副本（CORR-02）：正典 `prompt-sanitizer.ts:127 sanitizeWhiteLabelText`（硬编码品牌表）、生成脚本 `generate-public-catalog.ts cleanText`、生成文件内嵌 `public-skill-catalog.ts` 的同名函数（「X出品|专用|定制|私有化|自用」通配，比正典更宽）、freshness 守卫镜像。漂移的实证后果已经发生：232 的空标题过滤必须刻意用渲染路径那份才能拦住 `fire角色定制`（见 capability-governance.ts:3-5 注释），且该注释写"两份实现合一见 233"——233 实际未做，指针失实。台账第三梯队 CORR-02 记录"运行时消毒端点不剥竞品词"，221（同名消除 + 规范化）前置已就绪。

## Current state（2026-09-16 亲读核实，锚点基于 `6451c43`）

1. 正典 `shared/lib/prompt-sanitizer.ts:127`：硬编码品牌表 `【(?:风华出品|小飞鸡|天马|私有化|自用)】` + `(?:风华出品|小飞鸡出品|风华出品的|沐殇专用|乐乐乐专用|牧殇角色|fire定制)`；另有 URL/QQ/微信剥除。
2. 生成文件内嵌副本 `shared/lib/public-skill-catalog.ts`（约 :7497）：通配规则 `【[^】]*(?:出品|专用|定制|私有化|自用)[^】]*】` + `[\u4e00-\u9fa5A-Za-z0-9_-]{1,24}(?:出品|专用|定制)`——**剥除面比正典宽**（fire角色定制 被剥空，正典不剥）。
3. 渲染路径（PlazaAssetCard、capability-governance 232 过滤）用**生成版**；运行时消毒端点（server 用正典）用**正典版**——同一张卡"消毒前预览"与"落库后"行为可能不一致。
4. `src/lib/capability-governance.ts:3-5`：232 留下的注释"两份实现合一见 233"——**233 未做，指针失实**。
5. 台账第三梯队 CORR-02：白标清洗器 4 份漂移副本（正典/生成脚本 cleanText/生成文件内嵌/守卫镜像），运行时消毒端点不剥竞品词。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 重生成 | `node --import tsx scripts/generate-public-catalog.ts` | 副本数 38 不变 |
| freshness | `NODE_ENV=test node --test --import tsx tests/public-catalog-freshness.test.ts tests/catalog-copy-uniqueness.test.ts` | 全绿 |
| 前端定向 | `npx vitest run --config vitest.config.frontend.ts src/tests/skills-studio-plan158.test.tsx src/tests/style-shelf-decks.test.tsx src/tests/capability-craft.test.ts src/tests/plaza-asset-card-refine.test.tsx src/tests/cold-start-guidance.test.tsx` | 全绿 |
| 全量 | `npm run test:frontend && npm test` | 全绿 |

## Scope

**In scope**：
- 四副本合一到正典：生成文件不再内嵌 sanitizer 函数副本（改为 re-export 正典或由消费方直连 prompt-sanitizer）；freshness 守卫镜像改为仅校验"输出与管线一致"所必需的部分
- 正典规则**行为取并集**（吸收生成版的通配剥除）——使「渲染剥空判定」「消毒端点」「生成副本」三处行为一致；执行前先跑**差异枚举**：对全部公开目录 title 逐张对比两版输出，差异清单留档
- 修正 `capability-governance.ts:3-5` 失实注释，指向 236 的实际交付
- 台账 CORR-02 行核销（若为文本行则注记）

**Out of scope**：
- 运行时消毒端点的竞品词行为变更之外的消毒语义重设计
- `analyzeAndSanitize`（命中统计版）的合并
- 小飞鸡等品牌散卡的卡面视觉（品牌词是否展示属产品决策，不在合一范围）

## Steps

### Step 1: 差异枚举（先量化再动手）

对 PUBLIC_SKILL_GOVERNANCE_CATALOG + SANITIZED_SKILL_COPIES + CURATED 全部 title 跑两版 sanitizer，输出差异卡清单（id、原题、正典输出、生成版输出），留档。

**Verify**: 差异清单入 commit message；若差异 >10 张触发 STOP 评估

### Step 2: 正典吸收通配 + 生成文件去内嵌

正典加入「X出品|专用|定制」通配两条规则（保留硬编码品牌表以覆盖 小飞鸡 等无关键词品牌）；生成器不再 emit 内嵌副本（re-export 正典）；capability-governance 过滤与渲染路径自然同源；修正 :3-5 注释。

**Verify**: typecheck 0；重生成后 diff 仅函数区；freshness 全绿

### Step 3: 回归 + 真页面复核 + 台账

**Verify**: Step 命令表全绿；真页面 spot check（fire角色定制仍被拦、克苏鲁副本标题不变、套牌数不变）；台账落账

## Done criteria

- [ ] 全仓 sanitizer 展示函数仅剩正典一份实现 + 守卫对输出的校验
- [ ] 差异枚举清单留档；失实注释已修正
- [ ] 台账落账

## STOP conditions

- 行为取并集导致 >10 张现有公开卡面标题变化 → 停止，附差异清单拍板（白标语义面）
- 生成文件去内嵌后出现浏览器 bundle 依赖问题（正典含 Node 侧依赖）→ 停止，改评估正典拆纯函数文件方案
