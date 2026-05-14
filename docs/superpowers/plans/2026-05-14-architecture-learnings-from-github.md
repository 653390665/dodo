# Architecture Learnings From GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 从 25+ GitHub 项目中提炼可落地的架构思想——硬门禁阻断、记忆分层、认知控制——不改现有架构骨架，以最小侵入方式增强 Audit、Continuity、Context 三个模块。
**Architecture:** 三个改动各自独立：Audit 加门禁阈值（10 行 server.ts）、Continuity 加分层摘要（纯函数、不碰 DB）、Context 加角色已知信息隔离（纯函数、不碰 DB）。每个改动对应一个已有测试文件的增强。
**Tech Stack:** TypeScript, `src/lib/audit-structured.ts`, `src/lib/story-state-ledger.ts`, `src/lib/continuity-critic.ts`, `node:test`.

## Reference

| 项目 | 借鉴思想 | 落地方式 |
|------|---------|---------|
| **Novel-OS** | 6 道质量门禁，任一 FAIL 则整章退回 | audit 加 `pass` 硬阻断 + `minScore` 阈值 |
| **Morpheus** | L1 全文/L2 章节组/L3 当前章节记忆分层 | `buildStoryStateLedger` 输出分 3 层摘要 |
| **Book-Agent** | 认知控制——角色知道什么、读者知道什么、隐藏什么 | `continuity-critic` 加角色视角检查 |
| **autonovel** | 免疫系统——正则扫描禁词 + LLM 评判双轨 | `manualAudit` 加禁词检测层 |
| **SAGA** | 图谱自愈——检测到矛盾自动修补 | continuity 报告输出可应用的 patch（已部分实现） |

---

## Task 1: Audit 硬门禁

**思想来源:** Novel-OS 6 道质量门禁，autonovel score < 阈值 → 重写

**Files:**
- Modify: `src/lib/audit-structured.ts`
- Modify: `server.ts`（audit 端点）
- Modify: `tests/audit-structured.test.ts`

**Steps:**

- [ ] 1. 在 `audit-structured.ts` 中加门禁判断函数。

```ts
export interface AuditGateResult {
  pass: boolean;
  blockReason: string | null;
  criticalFails: string[];
}

export function evaluateAuditGate(
  scores: Record<string, number>,
  fatalIssues: Array<{ dimension: string; severity: string }>,
): AuditGateResult {
  const GATE_MIN_TOTAL = 30;       // 总分 < 30 → FAIL
  const GATE_MIN_DIMENSION = 4;    // 任一维度 < 4 → FAIL
  const GATE_MAX_CRITICAL = 0;     // 任何 critical severity → FAIL

  const criticalFails: string[] = [];

  // Check total score
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total < GATE_MIN_TOTAL) {
    criticalFails.push(`总分 ${total} < 阈值 ${GATE_MIN_TOTAL}`);
  }

  // Check individual dimensions
  for (const [dim, score] of Object.entries(scores)) {
    if (score < GATE_MIN_DIMENSION) {
      criticalFails.push(`${dim} ${score} < 阈值 ${GATE_MIN_DIMENSION}`);
    }
  }

  // Check for critical issues
  const criticalIssues = fatalIssues.filter(i => i.severity === 'critical');
  if (criticalIssues.length > GATE_MAX_CRITICAL) {
    criticalFails.push(`${criticalIssues.length} 个严重问题未解决`);
  }

  return {
    pass: criticalFails.length === 0,
    blockReason: criticalFails.length > 0 ? criticalFails.join('；') : null,
    criticalFails,
  };
}
```

- [ ] 2. 在 `server.ts` audit 端点中调用门禁。

在 audit 端点返回数据时追加 `gate` 字段：

```ts
import { evaluateAuditGate } from './src/lib/audit-structured';

// After extracting scores and fatalIssues from audit result:
const dimensionScores: Record<string, number> = {};
if (auditData.scores) {
  for (const [dim, val] of Object.entries(auditData.scores)) {
    dimensionScores[dim] = (val as { score: number }).score;
  }
}
const gate = evaluateAuditGate(dimensionScores, fatalIssues);

res.json({
  ...existingFields,
  gate,
});
```

- [ ] 3. 写测试。

```ts
// Add to tests/audit-structured.test.ts

import { evaluateAuditGate } from '../src/lib/audit-structured';

test('evaluateAuditGate passes clean audit', () => {
  const result = evaluateAuditGate(
    { '可读性': 8, '分镜执行度': 7, '冲突推进度': 7, '风格契合度': 6, '网文章节感': 7 },
    [],
  );
  assert.equal(result.pass, true);
  assert.equal(result.blockReason, null);
});

test('evaluateAuditGate fails on low dimension', () => {
  const result = evaluateAuditGate(
    { '可读性': 8, '分镜执行度': 3, '冲突推进度': 7, '风格契合度': 6, '网文章节感': 7 },
    [],
  );
  assert.equal(result.pass, false);
  assert.match(result.blockReason || '', /分镜执行度/);
});

test('evaluateAuditGate fails on low total', () => {
  const result = evaluateAuditGate(
    { '可读性': 4, '分镜执行度': 4, '冲突推进度': 4, '风格契合度': 4, '网文章节感': 4 },
    [],
  );
  assert.equal(result.pass, false);
  assert.match(result.blockReason || '', /总分/);
});

test('evaluateAuditGate fails on critical issues', () => {
  const result = evaluateAuditGate(
    { '可读性': 8, '分镜执行度': 7, '冲突推进度': 7, '风格契合度': 6, '网文章节感': 7 },
    [{ dimension: '可读性', severity: 'critical' }],
  );
  assert.equal(result.pass, false);
});
```

- [ ] 4. 运行。

```bash
node --import tsx --test tests/audit-structured.test.ts
node --import tsx --test tests/*.test.ts
```

---

## Task 2: 记忆分层摘要

**思想来源:** Morpheus L1（全书）/L2（章节组）/L3（当前章节）记忆体系

**Files:**
- Modify: `src/lib/story-state-ledger.ts`
- Modify: `tests/story-state-ledger.test.ts`

**Steps:**

- [ ] 1. 在 `story-state-ledger.ts` 中加分层层级定义。

```ts
export interface LayeredLedger {
  /** L1: 全书级——固定背景，每本书仅生成一次 */
  world: string;
  /** L2: 卷/弧级——当前卷的关键事件摘要 */
  currentArc: string;
  /** L3: 章节级——最近 N 章的人物状态、开放伏笔 */
  recentChapters: string;
}

export function buildLayeredLedgerSummary(ledger: StoryStateLedger, currentChapterOrder: number): LayeredLedger {
  // L1: World rules + global outline
  const world = [
    ledger.worldRules || '',
    ledger.globalOutline || '',
  ].filter(Boolean).join('\n');

  // L2: Current arc based on chapter proximity
  const arcChapters = ledger.chapters
    .filter(ch => Math.abs(ch.order - currentChapterOrder) < 20)
    .sort((a, b) => a.order - b.order);
  const currentArc = arcChapters
    .map(ch => `第${ch.order}章: ${ch.title}`)
    .join('\n');

  // L3: Last 5 chapters with character states and open threads
  const recentChapters = ledger.chapters
    .filter(ch => ch.order <= currentChapterOrder && ch.order > currentChapterOrder - 5)
    .sort((a, b) => a.order - b.order)
    .map(ch => {
      const charsInChapter = ledger.characters
        .filter(c => ch.content?.includes(c.name))
        .map(c => `${c.name}(${c.role})`)
        .slice(0, 5);
      return `第${ch.order}章「${ch.title}」出场: ${charsInChapter.join('、')}`;
    }).join('\n');

  return { world, currentArc, recentChapters };
}
```

- [ ] 2. 在 `server.ts` 的 chapter-production 端点中使用分层摘要。

替换当前 `buildProductionPlannerContext` 中的平铺上下文，改为分层注入：

```ts
const ledger = buildStoryStateLedger({ novel, chapters, characters, locations, items, factions, powerLevels, timelineEvents, foreshadowings });
const layered = buildLayeredLedgerSummary(ledger, chapters.length);

const plannerContext = [
  `【世界观(L1)】${layered.world}`,
  `【当前卷(L2)】${layered.currentArc}`,
  `【最近章节(L3)】${layered.recentChapters}`,
].join('\n\n');
```

- [ ] 3. 写测试。

```ts
// Add to tests/story-state-ledger.test.ts

import { buildLayeredLedgerSummary } from '../src/lib/story-state-ledger';

test('buildLayeredLedgerSummary returns L1/L2/L3 layers', () => {
  const ledger = {
    worldRules: '江湖围绕玄铁令争斗',
    globalOutline: '林砚卷入玄铁令危机',
    chapters: [
      { id: '1', order: 1, title: '雨夜酒馆', content: '林砚走进酒馆' },
      { id: '2', order: 2, title: '追兵逼近', content: '靴声在门外停住' },
      { id: '3', order: 3, title: '玄铁令现', content: '掌柜拿出令牌' },
    ],
    characters: [{ name: '林砚', role: 'protagonist' }],
  };
  const result = buildLayeredLedgerSummary(ledger, 3);
  assert.ok(result.world.includes('玄铁令'));
  assert.ok(result.currentArc.includes('追兵逼近'));
  assert.ok(result.recentChapters.includes('林砚'));
});
```

- [ ] 4. 运行。

```bash
node --import tsx --test tests/story-state-ledger.test.ts
```

---

## Task 3: 角色视角检查

**思想来源:** Book-Agent 认知控制——跟踪每个角色在此时知道什么，什么对读者隐藏

**Files:**
- Modify: `src/lib/continuity-critic.ts`
- Modify: `tests/continuity-critic.test.ts`

**Steps:**

- [ ] 1. 在 continuity-critic 的 prompt 中添加角色视角检查。

在 `buildContinuityCriticPrompt` 函数的输出结构中追加：

```ts
// Add to the output JSON schema in continuity prompt:
`
"characterKnowledgeIssues": [
  {
    "character": "角色名",
    "chapter": "第X章",
    "issue": "该角色在此时不应该知道Y，但在动作/对话中表现出了知情",
    "severity": "major|minor"
  }
]
`
```

- [ ] 2. 在 `normalizeContinuityReport` 中添加默认值。

```ts
characterKnowledgeIssues: report.characterKnowledgeIssues || [],
```

- [ ] 3. 更新类型定义。

在 `src/types.ts` 的 `ContinuityReport` 接口中添加：

```ts
characterKnowledgeIssues?: Array<{
  character: string;
  chapter: string;
  issue: string;
  severity: 'major' | 'minor';
}>;
```

- [ ] 4. 写测试。

```ts
// Add to tests/continuity-critic.test.ts

import { normalizeContinuityReport } from '../src/lib/continuity-critic';

test('continuity report normalizes character knowledge issues', () => {
  const report = normalizeContinuityReport({
    score: 70,
    issues: [],
    characterKnowledgeIssues: [
      { character: '林砚', chapter: '第3章', issue: '不应该知道掌柜身份', severity: 'major' },
    ],
    proposedPatch: {},
  });
  assert.equal(report.characterKnowledgeIssues.length, 1);
  assert.equal(report.characterKnowledgeIssues[0].character, '林砚');
});

test('continuity report defaults empty character knowledge issues', () => {
  const report = normalizeContinuityReport({ score: 70, issues: [], proposedPatch: {} });
  assert.deepEqual(report.characterKnowledgeIssues, []);
});
```

- [ ] 5. 运行。

```bash
node --import tsx --test tests/continuity-critic.test.ts
```

---

## Task 4: 禁词检测层

**思想来源:** autonovel 免疫系统——机械检测（正则扫描禁词）+ LLM 评判双轨

**Files:**
- Create: `src/lib/ban-word-scanner.ts`
- Create: `tests/ban-word-scanner.test.ts`

**Steps:**

- [ ] 1. 写禁词扫描器。

```ts
// Generic AI-writing patterns that make prose feel inauthentic
const DEFAULT_BAN_PATTERNS = [
  { pattern: /总而言之/gi, label: 'AI结论词' },
  { pattern: /总的来说/gi, label: 'AI结论词' },
  { pattern: /此外/gi, label: 'AI过渡词' },
  { pattern: /通过(.{1,20})方式/gi, label: 'AI万能句式' },
  { pattern: /在(.{1,20})的过程中/gi, label: 'AI万能句式' },
  { pattern: /主角/gi, label: '元叙事称谓' },
  { pattern: /故事/gi, label: '元叙事' },
  { pattern: /本章/gi, label: '作者口吻' },
  { pattern: /读者/gi, label: '作者口吻' },
  { pattern: /(.{1,10})\1{3,}/gi, label: '机械重复' },
];

export interface BanWordHit {
  word: string;
  label: string;
  index: number;
}

export function scanForBanWords(
  text: string,
  patterns = DEFAULT_BAN_PATTERNS,
): BanWordHit[] {
  const hits: BanWordHit[] = [];
  for (const { pattern, label } of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      hits.push({ word: match[0], label, index: match.index });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

export function formatBanWordReport(hits: BanWordHit[]): string {
  if (hits.length === 0) return '';
  const byLabel: Record<string, string[]> = {};
  for (const hit of hits) {
    (byLabel[hit.label] ||= []).push(`\`${hit.word}\``);
  }
  return Object.entries(byLabel)
    .map(([label, words]) => `- **${label}**: ${words.join('、')}`)
    .join('\n');
}
```

- [ ] 2. 在 `server.ts` audit 端点中集成扫描。

```ts
import { scanForBanWords, formatBanWordReport } from './src/lib/ban-word-scanner';

// In audit endpoint, after receiving draftContent:
const banHits = scanForBanWords(draftContent || '');
const banReport = formatBanWordReport(banHits);
// Append to audit response:
res.json({
  ...existingFields,
  banWordHits: banHits.length,
  banWordReport: banReport || null,
});
```

- [ ] 3. 写测试。

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanForBanWords, formatBanWordReport } from '../src/lib/ban-word-scanner';

test('scanForBanWords detects AI meta-narrative terms', () => {
  const hits = scanForBanWords('总而言之，主角在这个故事中成长了');
  const labels = hits.map(h => h.label);
  assert.ok(labels.includes('AI结论词'));
  assert.ok(labels.includes('元叙事称谓'));
});

test('scanForBanWords is clean for natural prose', () => {
  const hits = scanForBanWords('雨停了。林砚收起刀，走进夜色。');
  assert.equal(hits.length, 0);
});

test('formatBanWordReport groups by label', () => {
  const report = formatBanWordReport([
    { word: '总而言之', label: 'AI结论词', index: 0 },
    { word: '总的来说', label: 'AI结论词', index: 30 },
  ]);
  assert.match(report, /AI结论词/);
  assert.match(report, /总而言之/);
  assert.match(report, /总的来说/);
});
```

- [ ] 4. 运行。

```bash
node --import tsx --test tests/ban-word-scanner.test.ts
```

---

## Task 5: 最终验证

**Steps:**

- [ ] 1. 全量测试。

```bash
node --import tsx --test tests/*.test.ts
```

Expected: 130+ tests pass（Layer 2 新增 ~6 tests，Layer 3 新增 ~10 tests）。

- [ ] 2. 类型检查 + 构建 + 冒烟。

```bash
npm run lint
npm run build
npm run smoke:runtime
```

- [ ] 3. 手动测试 audit 门禁。

```bash
curl -s -X POST http://localhost:3000/api/audit \
  -H 'Content-Type: application/json' \
  -d '{"draftContent":"雨夜拍窗。林砚走进酒馆。掌柜抬头。","sceneBeats":"场景1：试探。","contextStr":"雨夜江湖，玄铁令搅动各方势力。"}'
```

Expected: 返回 `gate.pass` 字段（true 或 false）。

## Commit Plan

```bash
# Task 1: Audit gate
git add src/lib/audit-structured.ts server.ts tests/audit-structured.test.ts
git commit -m "feat: add hard audit gate with min score threshold"

# Task 2: Memory layering
git add src/lib/story-state-ledger.ts tests/story-state-ledger.test.ts
git commit -m "feat: add L1/L2/L3 layered ledger summary"

# Task 3: Character knowledge
git add src/lib/continuity-critic.ts src/types.ts tests/continuity-critic.test.ts
git commit -m "feat: add character knowledge perspective check"

# Task 4: Ban word scanner
git add src/lib/ban-word-scanner.ts tests/ban-word-scanner.test.ts server.ts
git commit -m "feat: add AI-pattern ban word scanner to audit"
```

## Self-Review

- 三个 Layer 的计划现在都覆盖了：
  - Layer 1 (`five-principle-prompt-hardening.md`) — Prompt 文本优化
  - Layer 2 (`prompt-evaluation-system.md`) — 评测体系
  - Layer 3 (`architecture-learnings-from-github.md`) — 架构借鉴
- 每个改动局限在单模块：audit-structured.ts / story-state-ledger.ts / continuity-critic.ts / ban-word-scanner.ts
- 不改 DB schema、UI、模型配置
- 每个功能对应测试
- 借鉴来源标注清晰（Novel-OS / Morpheus / Book-Agent / autonovel）
