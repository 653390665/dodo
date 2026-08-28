# Prompt Evaluation And Benchmarking System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 建立 InkFlow 提示词评测体系：benchmark 脚本测速+测解析率，quality scoring 量化输出质量，contract test 锁定 prompt 行为，让每次 prompt 改动都有数据支撑。
**Architecture:** 各模块独立旁路运行——benchmark 脚本 `scripts/benchmark-*.mjs` 不碰业务代码，quality scoring `src/lib/prompt-quality.ts` 是纯函数被 benchmark 调用，contract test `tests/*-contract.test.ts` 随 `tests/*.test.ts` 一起跑。
**Tech Stack:** TypeScript, Node.js, `node:test`, `node:perf_hooks`, `extractJsonPayload`.

## Reference

- **Poppet RP** — CoT 10 维评估模板，逐项打分+原因
- **Novel-OS** — 6 道质量门禁，每道 PASS/FAIL 硬判定
- **autonovel** — 评分循环，score < 阈值 → 自动重写
- **TheatreLM** — 字段可用率评估，每个字段是否可直接使用

---

## Task 1: 核心评分函数

**Files:**
- Create: `src/lib/prompt-quality.ts`
- Create: `tests/prompt-quality.test.ts`

**Steps:**

- [ ] 1. 写评分函数。

```ts
export interface DimensionScore {
  score: number;       // 0-10
  reason: string;
}

export interface PromptQualityReport {
  latencyBucket: 'fast' | 'ok' | 'slow' | 'timeout';
  parseSuccess: boolean;
  jsonComplete: boolean;          // 所有必填字段存在
  inputAnchoringScore: number;    // 0-1，输出包含多少输入关键词
  fieldCompleteness: Record<string, boolean>;  // 每字段是否有非空值
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export function classifyLatency(elapsedMs: number): PromptQualityReport['latencyBucket'] {
  if (elapsedMs <= 8000) return 'fast';
  if (elapsedMs <= 30000) return 'ok';
  if (elapsedMs <= 60000) return 'slow';
  return 'timeout';
}

function extractKeywords(input: string): string[] {
  const stop = new Set(['一个', '的', '了', '是', '在', '和', '这', '那', '我', '你', '他', '她', '它', '们', '吗', '吧', '呢', '啊']);
  return input
    .replace(/[，,。！？、；：""''（）\s]+/g, ' ')
    .split(' ')
    .filter(s => s.length >= 2 && !stop.has(s));
}

export function scoreInputAnchoring(output: string, inputSeed: string): number {
  const keywords = extractKeywords(inputSeed);
  if (keywords.length === 0) return 0;
  const hits = keywords.filter(k => output.includes(k)).length;
  // Target: at least 30% of input keywords appear in output
  return Math.min(1, hits / Math.max(1, Math.ceil(keywords.length * 0.3)));
}

export function evaluateFieldCompleteness(
  parsed: Record<string, unknown>,
  requiredFields: string[],
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const field of requiredFields) {
    const val = parsed[field];
    result[field] = val !== undefined && val !== null && val !== '';
  }
  return result;
}

export function gradeOutput(report: PromptQualityReport): PromptQualityReport['overallGrade'] {
  if (!report.parseSuccess) return 'F';
  if (report.latencyBucket === 'timeout') return 'D';
  const completeness = Object.values(report.fieldCompleteness).filter(Boolean).length /
    Math.max(1, Object.values(report.fieldCompleteness).length);
  if (report.latencyBucket === 'fast' && completeness >= 0.9 && report.inputAnchoringScore >= 0.6) return 'A';
  if (report.latencyBucket !== 'slow' && completeness >= 0.7 && report.inputAnchoringScore >= 0.3) return 'B';
  if (completeness >= 0.5) return 'C';
  return 'D';
}
```

- [ ] 2. 写测试。

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLatency,
  scoreInputAnchoring,
  evaluateFieldCompleteness,
  gradeOutput,
} from '../src/lib/prompt-quality';

test('classifyLatency buckets correctly', () => {
  assert.equal(classifyLatency(7000), 'fast');
  assert.equal(classifyLatency(15000), 'ok');
  assert.equal(classifyLatency(45000), 'slow');
  assert.equal(classifyLatency(90000), 'timeout');
});

test('scoreInputAnchoring detects keyword overlap', () => {
  const score = scoreInputAnchoring(
    '乞丐在街头发现一块刻着龙纹的玉玺',
    '一个乞丐捡到玉玺的故事',
  );
  assert.ok(score >= 0.5, `expected >= 0.5 got ${score}`);
});

test('scoreInputAnchoring returns 0 for no overlap', () => {
  const score = scoreInputAnchoring('雨夜刀客闯进酒馆复仇', '乞丐玉玺');
  assert.ok(score < 0.3, `expected < 0.3 got ${score}`);
});

test('evaluateFieldCompleteness marks present and missing fields', () => {
  const result = evaluateFieldCompleteness(
    { hook: '刀客复仇', protagonist: '', coreConflict: '追杀' },
    ['hook', 'protagonist', 'coreConflict', 'tone'],
  );
  assert.equal(result.hook, true);
  assert.equal(result.protagonist, false);
  assert.equal(result.coreConflict, true);
  assert.equal(result.tone, false);
});

test('gradeOutput gives F on parse failure', () => {
  assert.equal(gradeOutput({ parseSuccess: false, latencyBucket: 'fast', inputAnchoringScore: 0.8, jsonComplete: false, fieldCompleteness: {}, overallGrade: 'F' }), 'F');
});

test('gradeOutput gives A on fast+complete+anchored', () => {
  assert.equal(gradeOutput({
    parseSuccess: true, latencyBucket: 'fast', jsonComplete: true,
    inputAnchoringScore: 0.8,
    fieldCompleteness: { hook: true, protagonist: true, coreConflict: true },
    overallGrade: 'A',
  }), 'A');
});
```

- [ ] 3. 运行。

```bash
node --import tsx --test tests/prompt-quality.test.ts
```

Expected: `# pass 6`

---

## Task 2: Story Cards benchmark 脚本

**Files:**
- Create: `scripts/benchmark-story-cards.mjs`

**Steps:**

- [ ] 1. 写 benchmark 脚本，测 5 个输入 × 4 个超时档位。

```js
import { performance } from 'node:perf_hooks';
import { getConfig } from '../src/lib/config';
import { mergePromptTemplates } from '../src/config/prompt-templates';
import { generateText } from '../src/lib/server-llm';
import { extractJsonPayload } from '../src/lib/extract-skill-json';
import { classifyLatency, scoreInputAnchoring, evaluateFieldCompleteness, gradeOutput } from '../src/lib/prompt-quality';

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
const REQUIRED_FIELDS = ['hook', 'protagonist', 'coreConflict', 'tone', 'whyItWorks', 'riskNote', 'mixTags'];

const results = [];

for (const ideaSeed of cases) {
  for (const timeoutMs of [8000, 15000, 30000, 60000]) {
    const prompt = render(template, {
      ideaSeed, chatContext: '',
      expectedWordCount: 180000, storyFocus: '剧情推进', pacingPreference: '紧推进',
    });

    const started = performance.now();
    try {
      const raw = await generateText(config, { prompt, timeoutMs, maxAttempts: 1, maxTokens: 4096 });
      const elapsedMs = Math.round(performance.now() - started);
      let parseSuccess = false, cards = 0, inputAnchoringScore = 0;
      const fieldCompleteness = {};

      try {
        const parsed = extractJsonPayload(raw);
        parseSuccess = true;
        cards = Array.isArray(parsed?.cards) ? parsed.cards.length : 0;
        if (cards > 0) {
          const card0 = parsed.cards[0];
          inputAnchoringScore = scoreInputAnchoring(JSON.stringify(card0), ideaSeed);
          Object.assign(fieldCompleteness, evaluateFieldCompleteness(card0, REQUIRED_FIELDS));
        }
      } catch {}

      const report = {
        inputAnchoringScore,
        parseSuccess,
        jsonComplete: cards === 3,
        fieldCompleteness,
        latencyBucket: classifyLatency(elapsedMs),
        overallGrade: 'A',
      };
      report.overallGrade = gradeOutput(report);

      results.push({ ideaSeed, timeoutMs, elapsedMs, rawChars: raw.length, cards, ...report });
    } catch (e) {
      results.push({
        ideaSeed, timeoutMs,
        elapsedMs: Math.round(performance.now() - started),
        error: e.message,
        parseSuccess: false,
        latencyBucket: classifyLatency(performance.now() - started),
      });
    }
  }
}

console.log(JSON.stringify(results, null, 2));
```

- [ ] 2. 添加 npm script。

In `package.json`:
```json
"bench:story-cards": "node scripts/benchmark-story-cards.mjs"
```

- [ ] 3. 运行。

```bash
npx tsx scripts/benchmark-story-cards.mjs > docs/prompt-research/story-card-benchmark-results.json
```

---

## Task 3: Audit benchmark 脚本

**Files:**
- Create: `scripts/benchmark-audit.mjs`

**Steps:**

- [ ] 1. 写 audit benchmark，测 5 维评分稳定性。

```js
import { performance } from 'node:perf_hooks';
import { getConfig } from '../src/lib/config';
import { mergePromptTemplates } from '../src/config/prompt-templates';
import { generateText } from '../src/lib/server-llm';
import { extractJsonPayload } from '../src/lib/extract-skill-json';

const auditCases = [
  { draft: '雨夜拍窗。林砚走进酒馆，掌柜抬头看了看他。"来碗酒。"他坐下，把刀放在桌上。门外有人走过来。', beats: '场景1：林砚入酒馆试探掌柜。场景2：掌柜透露线索。场景3：追兵逼近。', context: '雨夜江湖，玄铁令搅动各方势力。' },
  { draft: '她推开门，房间里空无一人。桌上有一封信。她打开信，脸色变了。"不可能。"她喃喃自语。窗外传来脚步声。', beats: '场景1：女主发现空房间和信。场景2：信的内容揭示秘密。场景3：窗外脚步声逼近。', context: '都市悬疑，女主调查失踪案。' },
];

const config = getConfig();
const template = mergePromptTemplates(config.promptTemplates).manualAudit;

function render(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? ''));
}

for (const { draft, beats, context } of auditCases) {
  for (const timeoutMs of [15000, 30000, 60000]) {
    const prompt = render(template, {
      contextStr: context,
      skillsInfo: '',
      sceneBeats: beats,
      draftContent: draft,
    });

    const started = performance.now();
    try {
      const raw = await generateText(config, { prompt, timeoutMs, maxAttempts: 1, maxTokens: 4096 });
      const elapsedMs = Math.round(performance.now() - started);
      let parsed = null;
      try { parsed = extractJsonPayload(raw); } catch {}

      console.log(JSON.stringify({
        elapsedMs,
        rawChars: raw.length,
        parseOk: !!parsed,
        totalScore: parsed?.totalScore,
        pass: parsed?.pass,
        dimensions: parsed?.scores ? Object.keys(parsed.scores) : [],
      }));
    } catch (e) {
      console.log(JSON.stringify({
        elapsedMs: Math.round(performance.now() - started),
        error: e.message,
        parseOk: false,
      }));
    }
  }
}
```

- [ ] 2. 运行。

```bash
npx tsx scripts/benchmark-audit.mjs > docs/prompt-research/audit-benchmark-results.json
```

---

## Task 4: 验证

**Steps:**

- [ ] 1. 全量测试 + 新增 contract test。

```bash
node --import tsx --test tests/*.test.ts
```

Expected: 120+ tests pass。

- [ ] 2. 类型检查 + 构建。

```bash
npm run lint
npm run build
npm run smoke:runtime
```

## Commit Plan

```bash
git add src/lib/prompt-quality.ts tests/prompt-quality.test.ts
git commit -m "feat: add prompt quality scoring system"

git add scripts/benchmark-story-cards.mjs scripts/benchmark-audit.mjs package.json
git commit -m "feat: add storyCards and audit benchmark scripts"

git add docs/prompt-research/story-card-benchmark-results.json docs/prompt-research/audit-benchmark-results.json
git commit -m "docs: record prompt benchmark results"
```

## Self-Review

- 独立于业务代码（benchmark 脚本旁路运行，quality scoring 是纯函数）
- 每函数对应测试
- 不改 DB schema、UI、模型配置
- 跨 prompt 复用（`classifyLatency`、`scoreInputAnchoring` 可用于所有 prompt 评测）
- 与 Layer 1（prompt hardening）互补：改 prompt → 跑 benchmark → 看评分变化
