# Book-To-Skill Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Rework InkFlow's book analysis flow so a full-book upload produces a small, reliable deck of composable Skill cards rather than a misleading one-shot dimensional report.
**Architecture:** Split full-book analysis into staged evidence extraction: sample whole-book segments, extract local writing signals per segment, then aggregate them into a compact skill deck with coverage metadata and slot recommendations. Keep the user-facing output centered on cards that can be mounted in the writing workspace, while demoting raw analysis into lightweight evidence labels.
**Tech Stack:** React, TypeScript, Express, existing local DB/API layer, current Skill card types, Node test runner with `tsx`

## Task 1: Freeze The Product Spec For Whole-Book Skill Decks

**Files**
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/specs/2026-05-13-book-to-skill-deck-design.md`

1. - [ ] Write the design doc describing the new output model: one main voice card plus 2-4 support cards, with evidence coverage labels instead of generic dimension confidence panels.

```md
# InkFlow 整书拆卡设计

## 1. 目标
把“整本书拆书”从一次性分析报告，改成可直接进入 Skill 仓库与工作台装配的卡组产物。

## 2. 产物结构
- 主笔卡：1 张
- 副卡：2-4 张
- 每张卡必须有：
  - primaryDimension
  - dimensionTags
  - compositionProfile
  - slot recommendation
  - evidenceCoverage
  - evidenceMoments

## 3. 展示原则
- 主展示对象是卡组，不是维度分析面板
- 维度评分降级为“样本信号强度”或仅供内部计算
- 证据只回答“这张卡为什么成立、来自全书哪些阶段”

## 4. 覆盖标签
- full-book-stable
- opening-heavy
- mid-book-heavy
- climax-heavy
- weak-evidence

## 5. 风险边界
整本书上传不代表模型一次就能理解整本书，必须走“分段证据 -> 汇总成卡”的流程。
```

2. - [ ] Save the design doc and verify it names the card deck output, evidence coverage labels, and writing-workspace fit.

```bash
rg -n "主笔卡|副卡|evidenceCoverage|full-book-stable|工作台|装配" /Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/specs/2026-05-13-book-to-skill-deck-design.md
```

Expected output: matches for all named concepts

## Task 2: Add Failing Tests For Whole-Book Segmentation And Aggregation

**Files**
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-segmentation.test.ts`
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-aggregation.test.ts`

1. - [ ] Create a segmentation test that describes how a long uploaded book should be sliced into stage-aware evidence windows.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBookEvidenceSegments } from '../src/lib/book-skill-segmentation';

test('buildBookEvidenceSegments creates ordered whole-book slices for opening, middle, and climax evidence', () => {
  const text = Array.from({ length: 1200 }, (_, index) => `第${index}句内容`).join('\n');
  const segments = buildBookEvidenceSegments(text);

  assert.equal(segments.length >= 4, true);
  assert.equal(segments[0].stage, 'opening');
  assert.equal(segments.some((segment) => segment.stage === 'mid'), true);
  assert.equal(segments.some((segment) => segment.stage === 'climax'), true);
});
```

2. - [ ] Create an aggregation test that describes how segment evidence becomes one deck instead of a flat dimension score dump.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSkillDeckFromEvidence } from '../src/lib/book-skill-aggregation';

test('buildSkillDeckFromEvidence outputs one main card and bounded support cards with evidence coverage', () => {
  const deck = buildSkillDeckFromEvidence([
    {
      stage: 'opening',
      skillSignals: [{ dimension: 'style', weight: 0.92, evidence: '冷峻短句稳定出现' }],
    },
    {
      stage: 'mid',
      skillSignals: [{ dimension: 'character', weight: 0.74, evidence: '人物试探与克制反复出现' }],
    },
    {
      stage: 'climax',
      skillSignals: [{ dimension: 'plot', weight: 0.78, evidence: '冲突升级与悬念收束清晰' }],
    },
  ]);

  assert.equal(deck.mainCard != null, true);
  assert.equal(deck.supportCards.length >= 1, true);
  assert.equal(deck.supportCards.length <= 4, true);
  assert.equal(typeof deck.mainCard.evidenceCoverage, 'string');
});
```

3. - [ ] Run the new tests and confirm they fail because the new segmentation and aggregation helpers do not exist yet.

```bash
node --import tsx --test /Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-segmentation.test.ts /Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-aggregation.test.ts
```

Expected output: failure mentioning missing helper modules

## Task 3: Add Types For Evidence Segments, Coverage, And Deck Output

**Files**
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/types.ts`

1. - [ ] Add explicit types for whole-book evidence slicing and aggregated deck output.

```ts
export type BookEvidenceStage = 'opening' | 'early-mid' | 'mid' | 'late-mid' | 'climax';

export type SkillEvidenceCoverage =
  | 'full-book-stable'
  | 'opening-heavy'
  | 'mid-book-heavy'
  | 'climax-heavy'
  | 'weak-evidence';

export interface BookEvidenceSegment {
  id: string;
  stage: BookEvidenceStage;
  label: string;
  excerpt: string;
  startRatio: number;
  endRatio: number;
}

export interface SkillSignalEvidence {
  dimension: SkillDimension;
  weight: number;
  evidence: string;
}

export interface SegmentSkillEvidence {
  stage: BookEvidenceStage;
  skillSignals: SkillSignalEvidence[];
}

export interface SkillDeckCard extends Skill {
  evidenceCoverage: SkillEvidenceCoverage;
  evidenceMoments: BookEvidenceStage[];
}

export interface AggregatedSkillDeck {
  mainCard: SkillDeckCard;
  supportCards: SkillDeckCard[];
}
```

2. - [ ] Run `npm run lint` to confirm the new types integrate cleanly.

```bash
npm run lint
```

Expected output: `tsc --noEmit` exits `0`

## Task 4: Implement Whole-Book Segmentation Helper

**Files**
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/book-skill-segmentation.ts`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-segmentation.test.ts`

1. - [ ] Implement deterministic segment slicing so a long uploaded book yields multiple evidence windows.

```ts
import type { BookEvidenceSegment, BookEvidenceStage } from '../types';

const STAGE_WINDOWS: Array<{ stage: BookEvidenceStage; label: string; startRatio: number; endRatio: number }> = [
  { stage: 'opening', label: '开篇信号', startRatio: 0, endRatio: 0.18 },
  { stage: 'early-mid', label: '前中段信号', startRatio: 0.18, endRatio: 0.38 },
  { stage: 'mid', label: '中段信号', startRatio: 0.38, endRatio: 0.62 },
  { stage: 'late-mid', label: '后中段信号', startRatio: 0.62, endRatio: 0.82 },
  { stage: 'climax', label: '高潮与收束信号', startRatio: 0.82, endRatio: 1 },
];

export function buildBookEvidenceSegments(text: string): BookEvidenceSegment[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const length = normalized.length;
  return STAGE_WINDOWS.map((window, index) => {
    const start = Math.floor(length * window.startRatio);
    const end = Math.max(start + 1, Math.floor(length * window.endRatio));
    return {
      id: `segment-${index + 1}`,
      stage: window.stage,
      label: window.label,
      excerpt: normalized.slice(start, end).trim(),
      startRatio: window.startRatio,
      endRatio: window.endRatio,
    };
  }).filter((segment) => segment.excerpt.length > 0);
}
```

2. - [ ] Run the segmentation test and confirm it passes.

```bash
node --import tsx --test /Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-segmentation.test.ts
```

Expected output: `# pass 1`

## Task 5: Implement Evidence Aggregation Into Deck Cards

**Files**
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/book-skill-aggregation.ts`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-aggregation.test.ts`

1. - [ ] Implement evidence aggregation so repeated stable signals become cards, while weak signals stay out of the deck.

```ts
import type {
  AggregatedSkillDeck,
  SegmentSkillEvidence,
  SkillDeckCard,
  SkillDimension,
  SkillEvidenceCoverage,
} from '../types';

const DIMENSION_LABELS: Record<SkillDimension, string> = {
  style: '文风核心卡',
  character: '人物塑形卡',
  world: '世界规则卡',
  power: '战力体系卡',
  plot: '剧情推进卡',
  pacing: '节奏控制卡',
};

function deriveCoverage(stages: SegmentSkillEvidence['stage'][]): SkillEvidenceCoverage {
  const unique = Array.from(new Set(stages));
  if (unique.length >= 4) return 'full-book-stable';
  if (unique.every((stage) => stage === 'opening' || stage === 'early-mid')) return 'opening-heavy';
  if (unique.every((stage) => stage === 'mid' || stage === 'late-mid')) return 'mid-book-heavy';
  if (unique.every((stage) => stage === 'climax')) return 'climax-heavy';
  return 'weak-evidence';
}

export function buildSkillDeckFromEvidence(evidence: SegmentSkillEvidence[]): AggregatedSkillDeck {
  const buckets = new Map<SkillDimension, { total: number; moments: SegmentSkillEvidence['stage'][]; evidence: string[] }>();

  for (const segment of evidence) {
    for (const signal of segment.skillSignals) {
      const current = buckets.get(signal.dimension) || { total: 0, moments: [], evidence: [] };
      current.total += signal.weight;
      current.moments.push(segment.stage);
      current.evidence.push(signal.evidence);
      buckets.set(signal.dimension, current);
    }
  }

  const cards = Array.from(buckets.entries())
    .map(([dimension, bucket]) => {
      const coverage = deriveCoverage(bucket.moments);
      return {
        id: `deck-${dimension}`,
        name: DIMENSION_LABELS[dimension],
        description: bucket.evidence[0] || `${dimension} 信号`,
        style: dimension === 'style' ? bucket.evidence.join('；') : '',
        pacing: dimension === 'pacing' ? bucket.evidence.join('；') : '',
        characterTraits: dimension === 'character' ? bucket.evidence.join('；') : '',
        worldBuilding: dimension === 'world' ? bucket.evidence.join('；') : '',
        plotPattern: dimension === 'plot' ? bucket.evidence.join('；') : '',
        foreshadowing: dimension === 'plot' ? bucket.evidence.join('；') : '',
        stabilityScore: Math.round((bucket.total / bucket.moments.length) * 100),
        evaluationFeedback: `${coverage}｜基于整书分段证据汇总`,
        version: 1,
        createdAt: Date.now(),
        primaryDimension: dimension,
        dimensionTags: [dimension],
        compositionProfile: {
          styleWeight: dimension === 'style' ? 0.85 : 0.25,
          characterWeight: dimension === 'character' ? 0.85 : 0.25,
          worldWeight: dimension === 'world' ? 0.85 : 0.25,
          powerWeight: dimension === 'power' ? 0.85 : 0.25,
          plotWeight: dimension === 'plot' ? 0.85 : 0.25,
          pacingWeight: dimension === 'pacing' ? 0.85 : 0.25,
          conflictTags: [],
          blendHints: [],
        },
        evidenceCoverage: coverage,
        evidenceMoments: Array.from(new Set(bucket.moments)),
      } satisfies SkillDeckCard;
    })
    .filter((card) => card.stabilityScore >= 60)
    .sort((left, right) => right.stabilityScore - left.stabilityScore);

  if (cards.length === 0) {
    throw new Error('No strong enough deck cards could be derived from whole-book evidence');
  }

  return {
    mainCard: cards[0],
    supportCards: cards.slice(1, 5),
  };
}
```

2. - [ ] Run the aggregation test and confirm it passes.

```bash
node --import tsx --test /Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-aggregation.test.ts
```

Expected output: `# pass 1`

## Task 6: Refactor BookFactory To Show Deck-First Output

**Files**
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/BookFactoryView.tsx`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/types.ts`

1. - [ ] Replace the current “dimension attribution + dimension score” heavy panel with deck-first output.

```tsx
<section>
  <div className="text-[10px] font-bold text-theme-muted uppercase">整书拆卡结果</div>
  <h3 className="text-lg font-bold text-theme-text mt-1">先看这本书最终能给你哪几张可装配 Skill 卡</h3>
  <p className="text-xs text-theme-muted mt-2">
    系统会按整书分段证据汇总成主笔卡与副卡。这里展示的是可直接进入工作台的卡组，而不是一份静态分析报告。
  </p>
</section>
```

2. - [ ] Show each card with compact evidence labels instead of oversized dimension scoring boxes.

```tsx
<div className="flex flex-wrap gap-2 mt-3">
  <span className="rounded-full border border-theme-accent/30 bg-theme-accent/10 px-3 py-1 text-[11px] font-bold text-theme-accent">
    {selectedSkill.evidenceCoverage}
  </span>
  {selectedSkill.evidenceMoments.map((moment) => (
    <span key={moment} className="rounded-full border border-theme-border bg-white px-3 py-1 text-[11px] text-theme-muted">
      {moment}
    </span>
  ))}
</div>
```

3. - [ ] Change the explanatory copy so users understand these cards represent stable whole-book signals rather than total-book omniscience.

```tsx
<p className="text-xs text-theme-muted">
  这些卡基于整书分段样本汇总，只代表全书中稳定暴露出的可复用写法信号，不等于对整本书所有能力的完整判决。
</p>
```

4. - [ ] Keep manual JSON editing and save flow intact; only change the analytical presentation and card grouping narrative.

```bash
npm run lint
```

Expected output: `tsc --noEmit` exits `0`

## Task 7: Add Whole-Book Analysis Orchestration On The Server

**Files**
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/server.ts`
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/book-skill-segmentation.ts`
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/book-skill-aggregation.ts`

1. - [ ] Replace one-shot `/api/extract-skill` behavior with segmented evidence extraction.

```ts
const segments = buildBookEvidenceSegments(text);
const segmentEvidence = [];

for (const segment of segments) {
  const prompt = renderPromptTemplate(getPromptTemplate('extractSkill'), {
    text: segment.excerpt,
  });
  const raw = await withTimeout(
    generateText(getConfig(), { prompt, ...SKILL_EXTRACTION_LLM_OPTIONS }),
    SKILL_EXTRACTION_LLM_OPTIONS.timeoutMs + 2000,
    '拆书超时：当前模型响应过慢。建议先缩短样本文本，或稍后重试。',
  );
  const parsed = extractJsonPayload(raw);
  segmentEvidence.push({
    stage: segment.stage,
    skillSignals: coerceSignalsFromExtractedSkill(parsed),
  });
}

const deck = buildSkillDeckFromEvidence(segmentEvidence);
res.json({
  skills: [deck.mainCard, ...deck.supportCards],
  deck,
  segments,
});
```

2. - [ ] If one segment fails JSON parsing, return a stage-aware error instead of a silent global stall.

```ts
catch (error) {
  return res.status(502).json({
    error: `拆书失败：${segment.label} 的模型输出未能解析，请缩短文本或稍后重试。`,
  });
}
```

3. - [ ] Run lint and the targeted tests.

```bash
node --import tsx --test /Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-segmentation.test.ts /Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-aggregation.test.ts
npm run lint
```

Expected output:
- tests pass
- lint passes

## Task 8: Validate Deck Output Against Workspace Fit

**Files**
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/BookFactoryView.tsx`
- Inspect: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/skills/SkillLoadoutBoard.tsx`

1. - [ ] Make sure produced cards still read cleanly when mounted into existing loadout slots.

```bash
rg -n "primaryDimension|dimensionTags|compositionProfile|evaluationFeedback" /Users/Zhuanz/Documents/dodo-inkflow/src/components/skills/SkillLoadoutBoard.tsx
```

Expected output: existing loadout board consumes these fields

2. - [ ] Manually verify that a deck card still produces sensible slot messaging.

```md
Check in UI:
- 主笔卡 should map to slot 1 language
- 人物/世界/战力 cards should map to slot 2 language
- 剧情/节奏 cards should map to slot 3 language
```

3. - [ ] Run final verification.

```bash
node --import tsx --test /Users/Zhuanz/Documents/dodo-inkflow/tests/extract-skill-json.test.ts /Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-segmentation.test.ts /Users/Zhuanz/Documents/dodo-inkflow/tests/book-skill-aggregation.test.ts /Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-runtime.test.ts
npm run lint
npm run build
```

Expected output:
- all targeted tests pass
- lint passes
- build passes
