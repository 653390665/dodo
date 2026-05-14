# Prompt Optimization From GitHub References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 从 25+ GitHub 小说/Agent/Prompt 项目中提炼提示词结构，建立 InkFlow 的提示词评测与优化体系，首个目标让 Story Cards 在 10s 内稳定返回贴合用户输入的 3 张方案卡。
**Architecture:** 外部仓库作为只读参考源放到 `docs/prompt-research/vendor/`，InkFlow 内部以 `src/config/prompt-templates.ts` 为提示词源，配合 benchmark 脚本和 contract test 验证速度、JSON 完整率、用户输入贴合度。不改产品功能代码，只改 prompt 文本和后端解析逻辑。
**Tech Stack:** TypeScript, Node.js, `node:test`, `extractJsonPayload`, OpenAI-compatible API.

---

## Reference Repositories（25+）

### Tier 1 — 多 Agent 协作（架构参考）

| 项目 | Stars | 借鉴点 | 映射到 InkFlow |
|------|-------|--------|---------------|
| [Novel-OS](https://github.com/mrigankad/Novel-OS) | 新兴 | 5-Agent 编辑流水线，每章 6 道质量门禁 | Chapter Production, Critic |
| [Morpheus](https://github.com/papysans/Morpheus) | 新兴 | L1/L2/L3 三层记忆 + 运行态记忆 + 开放线程追踪 | Story State Ledger |
| [ainovel-cli](https://github.com/voocel/ainovel-cli) | 新兴 | 卷弧双层滚动规划，7 维质量评审，500+ 章上下文策略 | Chapter Production |
| [Novel Studio for Copilot CLI](https://github.com/tiny-flowlab/novel-studio-copilot-cli) | 新兴 | 13 专职 Agent，分规划/写作/质检三层 | AgentWorkspace 架构 |
| [NovelGenerator](https://github.com/KazKozDev/NovelGenerator) | 成熟 | 多 agent 分工、编辑 agent、最终一致性 pass | ProductionRunReview |

### Tier 2 — 知识图谱 + RAG（一致性参考）

| 项目 | Stars | 借鉴点 | 映射到 InkFlow |
|------|-------|--------|---------------|
| [SAGA](https://github.com/Lanerra/saga) | 新兴 | Neo4j 知识图谱 + 向量检索，矛盾检测 + 图谱自愈 | World Bible, Continuity |
| [WenShape（文枢）](https://github.com/unitagain/WenShape) | 新兴 | BM25+实体增强+对数距离衰减，卡片系统（人物/世界观/文风） | Book Factory, Skill Deck |
| [StoryCraft Agent](https://github.com/johannhartmann/storyteller) | v3.0 | 6 叙事结构 + 情节线追踪 + 角色知识系统 + SQLite 持久化 | Orchestrate, Chapter Planning |

### Tier 3 — 全自动 Pipeline（流程参考）

| 项目 | Stars | 借鉴点 | 映射到 InkFlow |
|------|-------|--------|---------------|
| [autonovel](https://github.com/NousResearch/autonovel) | 高 | 4 阶段 Pipeline，评分循环，去 AI 味免疫系统，已产出 79K 词小说 | Chapter Production, Audit |
| [AI-Novel-Writing-Assistant](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant) | 高 | AI 导演式开书定盘，写法引擎，整本生产主链 | Onboarding, WelcomeView |
| [novel-creator-skill](https://github.com/leenbj/novel-creator-skill) | 高 | 去AI味 7 类检测+两遍润色，事件 cooldown，Iron Law | Audit, Critic, Skill Extraction |
| [Book-Agent](https://forum.level1techs.com/t/my-ai-powered-novel-writing-pipeline-book-agent-generating-epistemically-controlled-long-form-fiction/243193) | — | 16 阶段 Pipeline，认知控制（角色知识/秘密/线索调度），Prose Consistency Layer | Chapter Production, Continuity |
| [NovelWriter](https://github.com/KudoShusak/NovelWriter) | 新兴 | 本地 Ollama，线性 Pipeline: Plot→World→Outline→Scene | 整体架构参考 |
| [NovelForger](https://github.com/cedrusdang/NovelForger) | 新兴 | LangGraph+Gemini，creative LLM vs evaluator LLM 分离，few-shot prompt 示例 | Prompt 设计模式 |

### Tier 4 — 提示词模板（直接可拆）

| 项目 | Stars | 借鉴点 | 映射到 InkFlow |
|------|-------|--------|---------------|
| [novel_prompter](https://github.com/AHA1GE/novel_prompter) | 新兴 | 4 段结构化提示词（世界观/角色/大纲/场景），纯前端离线 | Story Cards, World Bible |
| [AI-Prompts-for-Worldbuilding](https://github.com/monju252/AI-Prompts-for-Worldbuilding) | 新兴 | 10+ 类世界构建提示词模板，含示例输出 | World Bible |
| [TheatreLM-v2.1](https://huggingface.co/datasets/G-reen/TheatreLM-v2.1-Characters) | — | 5000 角色卡 + 原始生成 prompt（世界构建/角色创建/大纲/知识书） | Skill Extraction, Character |
| [Poppet RP Framework](https://github.com/Huzderu/poppet-rp-framework) | 新兴 | CoT 模板 10 评估维度，反 melodrama/反便利/物理写实/非语言交流 | Critic, Writer |
| [awesome-chatgpt-prompts](https://github.com/f/awesome-chatgpt-prompts) | 极高 | role framing、短约束、格式分层 | 所有 prompt 的角色说明 |

### Tier 5 — 中文网文实战

| 项目 | Stars | 借鉴点 | 映射到 InkFlow |
|------|-------|--------|---------------|
| [Long-Novel-GPT](https://github.com/MaoXiaoYuZ/Long-Novel-GPT) | 1.1k | GPT 长篇生成，含各类小说 Prompt 和教程 | Onboarding, Chapter |
| [AI-automatically-generates-novels](https://github.com/a497799589-code/ai-automatically-generates-novels) | 840 | v5.2，思维导图+智能拆书+润色+快捷词条，数百工作室在用 | Book Factory |
| [AINOVEL](https://github.com/wgknob/AINOVEL) | 4.6k | 多章节自动衔接上下文和伏笔，GUI+向量检索一致性 | Chapter Production |
| [91Writing](https://github.com/ponysb/91Writing) | 1.4k | Vue3 + 多模型，智能小说创作工具 | 前端参考 |
| [novel-pro](https://github.com/lgz-star/novel-pro) | — | Truth System（fact ledgers+snapshots），上下文膨胀控制 | Story State Ledger |
| [Chinese-WebNovel-Skill](https://github.com/Tomsawyerhu/Chinese-WebNovel-Skill) | — | "Distill structure, not style"，网文结构萃取 | Skill Extraction |
| [writers-loop](https://github.com/xxsang/writers-loop) | — | Frame→Ask→Plan→Draft→Critique→Revise→Learn | Orchestrate |

---

## Scope Guard

- 不直接复制外部仓库提示词正文
- 不引入新运行时依赖
- 不改模型供应商配置
- 不重构 UI
- 不把 vendor 仓库源码提交进主仓库
- Story Cards 同步等待不超过 10s

---

## Task 1: 建立提示词研究目录

**Files:**
- Create: `docs/prompt-research/README.md`
- Create: `docs/prompt-research/github-reference-map.md`
- Create: `docs/prompt-research/story-card-prompt-benchmark.md`

**Steps:**

- [ ] 创建研究目录结构

```bash
mkdir -p docs/prompt-research/vendor
```

- [ ] 写入 `docs/prompt-research/README.md`

```md
# InkFlow Prompt Research

原则：
1. 只学习结构，不复制提示词原文
2. 每条借鉴必须映射到 InkFlow 的具体功能
3. 每次提示词改动必须通过 benchmark 和 contract test
4. 评估维度优先级：贴合用户输入 > JSON 完整率 > 速度 > 文风质量
```

- [ ] 写入 `docs/prompt-research/github-reference-map.md`

```md
## Multi-Agent 架构
| 项目 | 借鉴 | 映射 |
| Novel-OS | 5-Agent 编辑流水线，6 道质量门禁 | Chapter Production |
| Morpheus | L1/L2/L3 三层记忆 + 开放线程追踪 | Story State Ledger |
| ... (完整表格同上 Reference Repositories 节) |
```

---

## Task 2: 拉取 GitHub 参考仓库（只读）

**Files:**
- Modify: `.gitignore`
- Create ignored directory: `docs/prompt-research/vendor/`

**Steps:**

- [ ] 在 `.gitignore` 加入

```gitignore
docs/prompt-research/vendor/
```

- [ ] Clone Tier 1-3 仓库（只读，不提交进主仓库）

```bash
cd docs/prompt-research/vendor
git clone --depth 1 https://github.com/mrigankad/Novel-OS.git
git clone --depth 1 https://github.com/papysans/Morpheus.git
git clone --depth 1 https://github.com/NousResearch/autonovel.git
git clone --depth 1 https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant.git
git clone --depth 1 https://github.com/leenbj/novel-creator-skill.git
git clone --depth 1 https://github.com/johannhartmann/storyteller.git
git clone --depth 1 https://github.com/AHA1GE/novel_prompter.git
git clone --depth 1 https://github.com/Tomsawyerhu/Chinese-WebNovel-Skill.git
git clone --depth 1 https://github.com/xxsang/writers-loop.git
git clone --depth 1 https://github.com/f/awesome-chatgpt-prompts.git
```

---

## Task 3: 建立 InkFlow 提示词资产地图

**Files:**
- Read: `src/config/prompt-templates.ts`
- Read: `src/lib/prompt-runtime.ts`
- Create: `docs/prompt-research/inkflow-prompt-asset-map.md`

**Steps:**

- [ ] 列出所有 `PromptTemplateKey` 并标记风险

```md
| Key | 功能 | 输出 | 当前风险 | 优化方向 |
| storyCards | 开始新作品 | JSON | 慢、JSON截断 | 短prompt、schema压缩 |
| setupTaskRefine | 设定助手 | text | 上下文过宽 | 单设定项、小步补全 |
| editorAgent | 分镜生成 | md | 可能泛化 | 强制场景块结构 |
| orchestrateWriter | 正文生成 | prose | 长、慢 | 分镜约束和上下文裁剪 |
| manualAudit | 审计 | md | 建议不可执行 | 结构化问题清单 |
| extractSkill | 拆书 | JSON | 长文本慢 | 分段证据+deck schema |
| inspirationSystem | 灵感 | text | 内容泛化 | 方向差异化 |
| generateOutline | 大纲 | md | 结构松散 | 卷级规划约束 |
```

---

## Task 4: 写 Story Cards benchmark 脚本

**Files:**
- Create: `scripts/benchmark-story-cards.mjs`

**Steps:**

- [ ] 用真实 prompt + MiniMax M2.7 测 5 个输入 × 4 个超时档位

```js
import { performance } from 'node:perf_hooks';
import { getConfig } from '../src/lib/config';
import { mergePromptTemplates } from '../src/config/prompt-templates';
import { generateText } from '../src/lib/server-llm';
import { extractJsonPayload } from '../src/lib/extract-skill-json';

const cases = [
  '一个乞丐捡到玉玺的故事',
  '一个现代医生穿越到修仙门派当杂役',
  '一个失忆公主在边境小城开酒馆',
  '一个失败的网文作者被困进自己烂尾小说',
  '一个记忆可以交易的都市悬疑故事',
];

function render(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? ''));
}

const config = getConfig();
const template = mergePromptTemplates(config.promptTemplates).storyCards;

for (const ideaSeed of cases) {
  for (const timeoutMs of [8000, 15000, 30000, 60000]) {
    const prompt = render(template, {
      ideaSeed, chatContext: '',
      expectedWordCount: 180000, storyFocus: '剧情推进', pacingPreference: '紧推进',
    });
    const started = performance.now();
    try {
      const raw = await generateText(config, { prompt, timeoutMs, maxAttempts: 1, maxTokens: 4096 });
      let cards = 0, parse = 'ok';
      try {
        const parsed = extractJsonPayload(raw);
        cards = Array.isArray(parsed?.cards) ? parsed.cards.length : 0;
        if (cards !== 3) parse = `cards=${cards}`;
      } catch (e) { parse = e.message; }
      console.log(JSON.stringify({
        ideaSeed, timeoutMs,
        elapsedMs: Math.round(performance.now() - started),
        rawChars: raw.length, parse, cards,
      }));
    } catch (e) {
      console.log(JSON.stringify({
        ideaSeed, timeoutMs,
        elapsedMs: Math.round(performance.now() - started),
        error: e.message,
      }));
    }
  }
}
```

- [ ] 运行 benchmark

```bash
npx tsx scripts/benchmark-story-cards.mjs > docs/prompt-research/story-card-benchmark-results.jsonl
```

预期：输出 JSONL，每行一个测试结果。

---

## Task 5: 优化 storyCards prompt

**Files:**
- Modify: `src/config/prompt-templates.ts`
- Modify: `server.ts`（story-cards 端点）
- Create: `tests/story-cards-prompt-contract.test.ts`

**Steps:**

- [ ] 压缩 prompt：1085 → < 500 字符，每字段加长度约束

```ts
storyCards: `
网文开书策划：根据用户输入生成 3 张方向不同的故事方案卡。

输入：{{ideaSeed}} | 字数：{{expectedWordCount}}字 | {{storyFocus}} | {{pacingPreference}}

每字段 ≤ 50字，只输出 JSON，不输出思考过程、markdown、解释。

{
  "cards": [
    {
      "id": "card-1",
      "hook": "一句话卖点（必须包含用户输入核心词）",
      "protagonist": "主角设定",
      "coreConflict": "核心冲突",
      "tone": "故事气质",
      "whyItWorks": "为什么值得写",
      "starterSeeds": {"worldSeed":"","relationshipSeed":"","chapterOneSeed":""},
      "planningFit": {"recommendedLength":"","recommendedFocus":"","recommendedPacing":"","reason":""},
      "riskNote": "最容易写崩的点",
      "mixTags": ["2-4字标签"],
      "signals": {"tone":"","conflictType":"","worldWeight":0.5,"characterWeight":0.5,"pacingPreference":"tight"}
    }
  ]
}

规则：必须返回 3 张 cards，方向必须不同，不要正文片段。
`.trim()
```

- [ ] `server.ts` 中 story-cards 端点保持 8s 超时 + `extractJsonPayload`

```ts
const raw = await generateText(getConfig(), { prompt, timeoutMs: 8_000, maxAttempts: 1, maxTokens: 4096 });
const parsed = extractJsonPayload(raw);
const cards = Array.isArray(parsed?.cards) ? parsed.cards : Array.isArray(parsed) ? parsed : [parsed];
```

- [ ] 写 contract test

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../src/config/prompt-templates';

test('storyCards prompt requires strict JSON and user-input anchoring', () => {
  const prompt = mergePromptTemplates().storyCards;
  assert.match(prompt, /只输出 JSON|不输出/);
  assert.match(prompt, /必须返回 3 张|3 张/);
  assert.match(prompt, /用户输入/);
  assert.match(prompt, /≤ ?50/);
});
```

- [ ] 运行验证

```bash
node --import tsx --test tests/story-cards-prompt-contract.test.ts
```

预期：`# pass 1`

---

## Task 6: 引入提示词质量评分

**Files:**
- Create: `src/lib/prompt-quality.ts`
- Create: `tests/prompt-quality.test.ts`

**Steps:**

- [ ] 写评分函数

```ts
export interface PromptQualityReport {
  inputAnchoringScore: number;
  schemaCompletenessScore: number;
  parseSuccess: boolean;
  latencyBucket: 'fast' | 'ok' | 'slow' | 'timeout';
}

export function classifyLatency(elapsedMs: number): PromptQualityReport['latencyBucket'] {
  if (elapsedMs <= 8000) return 'fast';
  if (elapsedMs <= 30000) return 'ok';
  if (elapsedMs <= 60000) return 'slow';
  return 'timeout';
}

export function scoreInputAnchoring(output: string, inputSeed: string): number {
  const keywords = inputSeed.replace(/[的了一个是这那是]/g, '').split('').filter(Boolean);
  const hits = keywords.filter((k) => output.includes(k)).length;
  return Math.min(1, hits / Math.max(1, keywords.length * 0.3));
}
```

- [ ] 写测试

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLatency, scoreInputAnchoring } from '../src/lib/prompt-quality';

test('classifyLatency', () => {
  assert.equal(classifyLatency(7000), 'fast');
  assert.equal(classifyLatency(15000), 'ok');
  assert.equal(classifyLatency(45000), 'slow');
  assert.equal(classifyLatency(90000), 'timeout');
});

test('scoreInputAnchoring rewards keyword matches', () => {
  const score = scoreInputAnchoring('乞丐在街头捡到一块刻着龙纹的玉玺', '一个乞丐捡到玉玺的故事');
  assert.ok(score > 0.3);
});
```

- [ ] 运行

```bash
node --import tsx --test tests/prompt-quality.test.ts
```

预期：`# pass 2`

---

## Task 7: 验证

**Commands:**

```bash
npm run lint
node --import tsx --test tests/*.test.ts
npm run build
npm run build:electron
npx tsx scripts/benchmark-story-cards.mjs
```

**Expected:**

```text
tsc --noEmit passes
110+ tests pass（含新增 contract test 和 quality test）
vite build succeeds
build:electron succeeds
benchmark prints JSONL rows
```

---

## Commit Plan

```bash
# Commit 1: research infrastructure
git add docs/prompt-research/README.md \
        docs/prompt-research/github-reference-map.md \
        docs/prompt-research/inkflow-prompt-asset-map.md \
        .gitignore
git commit -m "docs: add prompt research directory and GitHub reference map"

# Commit 2: benchmark + quality scoring
git add scripts/benchmark-story-cards.mjs \
        src/lib/prompt-quality.ts \
        tests/prompt-quality.test.ts
git commit -m "feat: add prompt benchmark script and quality scoring"

# Commit 3: storyCards prompt optimization
git add src/config/prompt-templates.ts \
        server.ts \
        tests/story-cards-prompt-contract.test.ts
git commit -m "perf: compress storyCards prompt with field caps and JSON-only rule"

# Commit 4: benchmark results
git add docs/prompt-research/story-card-benchmark-results.jsonl
git commit -m "docs: record story card model benchmark results"
```

---

## 后续模块顺序

1. **Story Cards**（本计划）— 用户第一入口，当前痛感最大
2. **设定助手 / World Bible** — 参考 AI-Prompts-for-Worldbuilding + TheatreLM 模板
3. **分镜生成 / Scene Beats** — 参考 novel-creator-skill 大纲锚点 + StoryCraft 叙事结构
4. **正文生成 / Draft Writer** — 参考 Morpheus chapter-first + Book-Agent PCL
5. **审计修复 / Critic + Polish** — 参考 Novel-OS 6 道门禁 + Poppet CoT 模板
6. **Skill 萃取 / Style Extraction** — 参考 Chinese-WebNovel-Skill + autonovel 声音指纹

## Self-Review

- 25+ GitHub 项目按 5 个 Tier 分类，每个标注借鉴点和映射模块
- 不直接复制外部文本，只拆结构
- Task 1-7 每步有具体代码、命令、预期输出
- 无 TBD / placeholder
- 不改产品功能代码（只改 prompt 文本和后端 JSON 解析）
