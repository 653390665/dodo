# Reference Architecture And Prompt Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Build a staged reference architecture and prompt asset layering system for InkFlow so external product learnings can be integrated without breaking the current mainline.
**Architecture:** First formalize the design into repo-local product artifacts, then refactor prompt definitions into a typed asset layer, and finally wire stage-aware selection into the existing onboarding, workspace, and review flows. The user should experience fewer explicit prompt choices while the system gains stronger internal structure.
**Tech Stack:** React, TypeScript, existing Express API routes, existing prompt template registry, Node test runner with `tsx`

## Task 1: Freeze The Design Artifacts

**Files**
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/specs/2026-05-12-reference-architecture-and-prompt-layering-design.md`
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/plans/2026-05-12-reference-architecture-and-prompt-layering.md`

1. - [ ] Save the approved design doc into the specs folder.

```bash
test -f /Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/specs/2026-05-12-reference-architecture-and-prompt-layering-design.md
```

Expected output: command exits `0`

2. - [ ] Re-read the design and confirm it names all four product layers and all six prompt stages.

```bash
rg -n "开书层|骨架层|章节推进层|修稿层|discovery|foundation|planning|drafting|polish|review" /Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/specs/2026-05-12-reference-architecture-and-prompt-layering-design.md
```

Expected output: matches for all four layers and six stages

3. - [ ] Save this implementation plan in the plans folder.

```bash
test -f /Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/plans/2026-05-12-reference-architecture-and-prompt-layering.md
```

Expected output: command exits `0`

## Task 2: Write The Failing Prompt Asset Test

**Files**
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-asset.test.ts`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/types.ts`

1. - [ ] Create a new test file describing the prompt asset contract before implementation.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROMPT_STAGE_ORDER,
  buildPromptAssetMap,
  getPromptAssetsByStage,
} from '../src/lib/prompt-assets';

test('prompt asset map exposes all six stages in stable order', () => {
  assert.deepEqual(PROMPT_STAGE_ORDER, [
    'discovery',
    'foundation',
    'planning',
    'drafting',
    'polish',
    'review',
  ]);
});

test('getPromptAssetsByStage groups existing templates into stage buckets', () => {
  const assets = buildPromptAssetMap();

  assert.equal(getPromptAssetsByStage(assets, 'discovery').some((asset) => asset.id === 'storyCards'), true);
  assert.equal(getPromptAssetsByStage(assets, 'foundation').some((asset) => asset.id === 'setupTaskRefine'), true);
  assert.equal(getPromptAssetsByStage(assets, 'planning').some((asset) => asset.id === 'editorAgent'), true);
  assert.equal(getPromptAssetsByStage(assets, 'drafting').some((asset) => asset.id === 'orchestrateWriter'), true);
  assert.equal(getPromptAssetsByStage(assets, 'polish').some((asset) => asset.id === 'manualAudit'), true);
  assert.equal(getPromptAssetsByStage(assets, 'review').some((asset) => asset.id === 'orchestrateCritic'), true);
});
```

2. - [ ] Run the new test and confirm it fails because the prompt asset layer does not exist yet.

```bash
node --import tsx --test /Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-asset.test.ts
```

Expected output: failure mentioning missing `../src/lib/prompt-assets`

## Task 3: Implement The Prompt Asset Layer

**Files**
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/prompt-assets.ts`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/types.ts`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/config/prompt-templates.ts`

1. - [ ] Add prompt stage and prompt asset types to `src/types.ts`.

```ts
export type PromptStage =
  | 'discovery'
  | 'foundation'
  | 'planning'
  | 'drafting'
  | 'polish'
  | 'review';

export interface PromptAsset {
  id: string;
  title: string;
  stage: PromptStage;
  goal: string;
  inputs: string[];
  template: string;
  outputShape: 'json' | 'markdown' | 'plain-text';
  riskNotes: string[];
  successSignal: string;
}
```

2. - [ ] Create `src/lib/prompt-assets.ts` and map every existing template into a prompt asset.

```ts
import { DEFAULT_PROMPT_TEMPLATES, PROMPT_TEMPLATE_DEFINITIONS } from '../config/prompt-templates';
import type { PromptAsset, PromptStage } from '../types';

export const PROMPT_STAGE_ORDER: PromptStage[] = [
  'discovery',
  'foundation',
  'planning',
  'drafting',
  'polish',
  'review',
];

const STAGE_BY_TEMPLATE = {
  inspirationSystem: 'discovery',
  storyCards: 'discovery',
  setupTaskRefine: 'foundation',
  editorAgent: 'planning',
  generateOutline: 'planning',
  orchestrateWriter: 'drafting',
  manualAudit: 'polish',
  orchestrateCritic: 'review',
  extractSkill: 'review',
} as const satisfies Record<string, PromptStage>;

export function buildPromptAssetMap(): PromptAsset[] {
  return PROMPT_TEMPLATE_DEFINITIONS.map((definition) => ({
    id: definition.key,
    title: definition.label,
    stage: STAGE_BY_TEMPLATE[definition.key],
    goal: definition.description,
    inputs: definition.variables,
    template: DEFAULT_PROMPT_TEMPLATES[definition.key],
    outputShape: definition.key === 'storyCards' ? 'json' : 'markdown',
    riskNotes: [],
    successSignal: definition.description,
  }));
}

export function getPromptAssetsByStage(assets: PromptAsset[], stage: PromptStage) {
  return assets.filter((asset) => asset.stage === stage);
}
```

3. - [ ] Run the prompt asset test and make sure it passes.

```bash
node --import tsx --test /Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-asset.test.ts
```

Expected output:

```text
# pass 2
# fail 0
```

## Task 4: Add Stage-Aware Selection Tests

**Files**
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-stage-routing.test.ts`
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/prompt-stage-routing.ts`

1. - [ ] Write a failing test for stage routing based on product surface.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPromptStageForSurface } from '../src/lib/prompt-stage-routing';

test('selectPromptStageForSurface routes onboarding to discovery or foundation', () => {
  assert.equal(selectPromptStageForSurface('welcome'), 'discovery');
  assert.equal(selectPromptStageForSurface('world-onboarding'), 'foundation');
});

test('selectPromptStageForSurface routes active chapter work to planning or drafting', () => {
  assert.equal(selectPromptStageForSurface('workspace-beats'), 'planning');
  assert.equal(selectPromptStageForSurface('workspace-draft'), 'drafting');
});

test('selectPromptStageForSurface routes cleanup tasks to polish and review', () => {
  assert.equal(selectPromptStageForSurface('chapter-polish'), 'polish');
  assert.equal(selectPromptStageForSurface('chapter-review'), 'review');
});
```

2. - [ ] Run the test and confirm it fails before implementation.

```bash
node --import tsx --test /Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-stage-routing.test.ts
```

Expected output: failure mentioning missing `prompt-stage-routing`

## Task 5: Implement Stage Routing Helpers

**Files**
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/prompt-stage-routing.ts`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/WelcomeView.tsx`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/AIAssistant.tsx`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/EditorView.tsx`

1. - [ ] Implement stage routing helper.

```ts
import type { PromptStage } from '../types';

export type PromptSurface =
  | 'welcome'
  | 'world-onboarding'
  | 'workspace-beats'
  | 'workspace-draft'
  | 'chapter-polish'
  | 'chapter-review';

export function selectPromptStageForSurface(surface: PromptSurface): PromptStage {
  switch (surface) {
    case 'welcome':
      return 'discovery';
    case 'world-onboarding':
      return 'foundation';
    case 'workspace-beats':
      return 'planning';
    case 'workspace-draft':
      return 'drafting';
    case 'chapter-polish':
      return 'polish';
    case 'chapter-review':
      return 'review';
  }
}
```

2. - [ ] Add non-invasive labels or comments in the relevant components so future work can bind stage-specific prompt assets without guessing the surface intent.

```ts
const promptSurface = 'welcome';
```

```ts
const promptSurface = 'workspace-draft';
```

3. - [ ] Run the routing test and confirm it passes.

```bash
node --import tsx --test /Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-stage-routing.test.ts
```

Expected output:

```text
# pass 3
# fail 0
```

## Task 6: Verify Integration Safety

**Files**
- Verify only

1. - [ ] Run the targeted tests together.

```bash
node --import tsx --test /Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-asset.test.ts /Users/Zhuanz/Documents/dodo-inkflow/tests/prompt-stage-routing.test.ts /Users/Zhuanz/Documents/dodo-inkflow/tests/onboarding-model.test.ts /Users/Zhuanz/Documents/dodo-inkflow/tests/assistant-suggestion.test.ts
```

Expected output: all tests pass

2. - [ ] Run the full suite.

```bash
node --import tsx --test tests/*.test.ts
```

Expected output: full suite passes

3. - [ ] Run TypeScript validation.

```bash
npm run lint
```

Expected output:

```text
> inkflow@1.0.0 lint
> tsc --noEmit
```

4. - [ ] Run production build.

```bash
npm run build
```

Expected output: Vite build completes successfully, chunk warning allowed

## Task 7: Update Reference Docs

**Files**
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/specs/2026-05-12-product-mainline-review.md`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/specs/2026-05-12-reference-architecture-and-prompt-layering-design.md`

1. - [ ] Add a short note to the product mainline review that prompt architecture now follows stage-aware internal layering rather than user-visible template selection.

```md
- Prompt 能力按内部阶段分层组织，不直接暴露为用户主导航。
```

2. - [ ] Re-read the new design doc and ensure every prompt stage is still named exactly once in the summary section.

```bash
rg -n "discovery|foundation|planning|drafting|polish|review" /Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/specs/2026-05-12-reference-architecture-and-prompt-layering-design.md
```

Expected output: all six stage names present

## Task 8: Final Self-Review And Handoff

**Files**
- Review only

1. - [ ] Scan the plan for placeholders and remove them.

```bash
rg -n "TODO|TBD|appropriate|similar to" /Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/plans/2026-05-12-reference-architecture-and-prompt-layering.md
```

Expected output: no matches

2. - [ ] Confirm the plan only covers one subsystem: reference architecture and prompt layering.

```bash
rg -n "PromptStage|PromptAsset|prompt-stage-routing|reference architecture" /Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/plans/2026-05-12-reference-architecture-and-prompt-layering.md
```

Expected output: matches only in this subsystem scope

3. - [ ] Choose execution mode.

Recommended:
- **Subagent-Driven**: use fresh workers for Task 3, Task 5, and Task 7, then integrate and verify centrally.

Alternative:
- **Inline Execution**: execute tasks in this session with checkpoints after Task 3 and Task 5.
