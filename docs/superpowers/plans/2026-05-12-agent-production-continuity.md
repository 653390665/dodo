# Agent Production Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Build the first controllable InkFlow production loop: one chapter production run that plans, drafts, audits continuity, proposes story-state updates, and waits for human review before applying changes.
**Architecture:** Implement a narrow vertical slice instead of a full autonomous novel factory. Add a typed Story State Ledger and Continuity Critic as pure, testable modules; persist Chapter Production Runs in SQLite; expose server endpoints that orchestrate the existing Planner/Writer/Critic prompts plus the new continuity pass; then add a review panel in the editor so users can accept or reject the generated chapter and state changes.
**Tech Stack:** React 19, TypeScript, Express 4, better-sqlite3, Vite 6, node:test, existing server-side LLM adapter, existing SQLite `/api/db` bridge.

## Scope Check

This plan intentionally combines B and C because they are one vertical product loop:

- B: Agent production line for a single chapter.
- C: Long-form continuity control for the same generated chapter.

This plan does not implement:

- multi-chapter batch generation
- background job queues
- vector/RAG retrieval
- fully automatic state mutation without review
- new dependencies
- replacing the existing `/api/orchestrate` streaming endpoint

The first success condition is: **from one selected novel, InkFlow can produce one draft chapter, show continuity risks and proposed ledger changes, and apply the result only after user confirmation.**

## Existing Anchors

- `src/types.ts` already defines `Novel`, `Chapter`, `Character`, `Item`, `TimelineEvent`, `Foreshadowing`, and Copilot types.
- `src/lib/db.ts` owns SQLite initialization, row mapping, CRUD, and `notify()`.
- `server.ts` owns explicit AI endpoints and the DB method whitelist.
- `src/lib/agents.ts` already has `buildContextPrompt()` and context-pruning support through `activeEntityNames`.
- `src/components/EditorView.tsx` owns chapter generation, audit actions, agent drawer tabs, and chapter persistence.
- `src/lib/api.ts` owns frontend API wrappers.
- Tests use `node:test`, `assert/strict`, and temporary SQLite database paths.

## Task 1: Add Story State Ledger Types And Pure Builder

Files:

- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/types.ts`
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/story-state-ledger.ts`
- Test: `/Users/Zhuanz/Documents/dodo-inkflow/tests/story-state-ledger.test.ts`

### Steps

- [ ] Step 1: Write the failing test file.

Create `tests/story-state-ledger.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStoryStateLedger,
  summarizeStoryStateLedger,
  buildLedgerPromptFacts,
} from '../src/lib/story-state-ledger';
import type { Chapter, Character, Foreshadowing, Item, Novel, TimelineEvent } from '../src/types';

const now = 1_778_000_000_000;

const novel: Novel = {
  id: 'novel-1',
  title: '雨夜玄令',
  authorId: 'local-user',
  summary: '沉默刀客卷入玄铁令争夺。',
  status: 'ongoing',
  worldRules: '江湖势力围绕玄铁令争斗，刀法讲究时机与代价。',
  globalOutline: '第一卷围绕玄铁令失窃展开。',
  createdAt: now,
  updatedAt: now,
};

const chapters: Chapter[] = [
  {
    id: 'chapter-1',
    novelId: 'novel-1',
    title: '第一章',
    content: '林砚在雨夜入酒馆。',
    order: 1,
    wordCount: 10,
    sceneBeats: '雨夜酒馆，掌柜试探。',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'chapter-2',
    novelId: 'novel-1',
    title: '第二章',
    content: '玄铁令第一次露面。',
    order: 2,
    wordCount: 12,
    sceneBeats: '追兵逼近，玄铁令显形。',
    createdAt: now,
    updatedAt: now,
  },
];

const characters: Character[] = [
  {
    id: 'char-1',
    novelId: 'novel-1',
    name: '林砚',
    role: 'protagonist',
    summary: '寡言刀客，持有玄铁令。',
    traits: ['克制', '后发制人'],
    bio: '过去不明。',
    createdAt: now,
    updatedAt: now,
  },
];

const items: Item[] = [
  {
    id: 'item-1',
    novelId: 'novel-1',
    name: '玄铁令',
    type: '信物',
    description: '可号令旧盟的铁令，目前在林砚手中。',
    createdAt: now,
    updatedAt: now,
  },
];

const timelineEvents: TimelineEvent[] = [
  {
    id: 'time-1',
    novelId: 'novel-1',
    title: '玄铁令失窃',
    description: '各方势力开始追索玄铁令。',
    timestamp: '三日前',
    statusTag: '已发生',
    order: 1,
    createdAt: now,
    updatedAt: now,
  },
];

const foreshadowings: Foreshadowing[] = [
  {
    id: 'foreshadow-1',
    novelId: 'novel-1',
    title: '掌柜认识玄铁令',
    description: '掌柜看见玄铁令时没有惊讶。',
    status: 'planted',
    plantedChapterId: 'chapter-1',
    relatedCharacterIds: ['char-1'],
    createdAt: now,
    updatedAt: now,
  },
];

test('buildStoryStateLedger collects durable long-form state for one novel', () => {
  const ledger = buildStoryStateLedger({
    novel,
    chapters,
    characters,
    items,
    timelineEvents,
    foreshadowings,
  });

  assert.equal(ledger.novelId, 'novel-1');
  assert.equal(ledger.recentChapters.length, 2);
  assert.equal(ledger.entityStates.characters[0].name, '林砚');
  assert.equal(ledger.entityStates.items[0].name, '玄铁令');
  assert.equal(ledger.openForeshadowings.length, 1);
  assert.equal(ledger.timeline[0].title, '玄铁令失窃');
});

test('summarizeStoryStateLedger produces compact continuity context', () => {
  const ledger = buildStoryStateLedger({
    novel,
    chapters,
    characters,
    items,
    timelineEvents,
    foreshadowings,
  });

  const summary = summarizeStoryStateLedger(ledger);
  assert.match(summary, /雨夜玄令/);
  assert.match(summary, /林砚/);
  assert.match(summary, /玄铁令/);
  assert.match(summary, /掌柜认识玄铁令/);
  assert.equal(summary.length < 3000, true);
});

test('buildLedgerPromptFacts keeps facts grouped for continuity critic prompts', () => {
  const ledger = buildStoryStateLedger({
    novel,
    chapters,
    characters,
    items,
    timelineEvents,
    foreshadowings,
  });

  const facts = buildLedgerPromptFacts(ledger);
  assert.equal(facts.characters.includes('林砚'), true);
  assert.equal(facts.items.includes('玄铁令'), true);
  assert.equal(facts.foreshadowings.includes('掌柜认识玄铁令'), true);
  assert.equal(facts.recentChapters.includes('第二章'), true);
});
```

- [ ] Step 2: Run the test and confirm it fails because the module does not exist.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/story-state-ledger.test.ts
```

Expected output:

```text
not ok
ERR_MODULE_NOT_FOUND
```

- [ ] Step 3: Append the Story State Ledger types to `src/types.ts` after the `Foreshadowing` interface.

```ts
export interface StoryEntitySnapshot {
  id: string;
  name: string;
  kind: 'character' | 'location' | 'item' | 'faction' | 'powerLevel';
  summary: string;
  statusNote: string;
  updatedAt?: number;
}

export interface StoryStateLedger {
  novelId: string;
  title: string;
  summary: string;
  worldRules: string;
  globalOutline: string;
  recentChapters: Array<{
    id: string;
    title: string;
    order: number;
    sceneBeats: string;
    summary: string;
  }>;
  entityStates: {
    characters: StoryEntitySnapshot[];
    locations: StoryEntitySnapshot[];
    items: StoryEntitySnapshot[];
    factions: StoryEntitySnapshot[];
    powerLevels: StoryEntitySnapshot[];
  };
  timeline: Array<{
    id: string;
    title: string;
    timestamp: string;
    description: string;
    statusTag?: string;
    order: number;
  }>;
  openForeshadowings: Array<{
    id: string;
    title: string;
    description: string;
    status: Foreshadowing['status'];
    plantedChapterId?: string;
    payoffChapterId?: string;
    notes?: string;
  }>;
}
```

- [ ] Step 4: Create `src/lib/story-state-ledger.ts`.

```ts
import type {
  Chapter,
  Character,
  Faction,
  Foreshadowing,
  Item,
  Location,
  Novel,
  PowerLevel,
  StoryEntitySnapshot,
  StoryStateLedger,
  TimelineEvent,
} from '../types';

interface BuildStoryStateLedgerInput {
  novel: Novel;
  chapters: Chapter[];
  characters?: Character[];
  locations?: Location[];
  items?: Item[];
  factions?: Faction[];
  powerLevels?: PowerLevel[];
  timelineEvents?: TimelineEvent[];
  foreshadowings?: Foreshadowing[];
  recentChapterLimit?: number;
}

function compact(text: string | undefined, max = 360): string {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function chapterSummary(chapter: Chapter): string {
  const source = chapter.sceneBeats || chapter.content || '';
  return compact(source, 420);
}

function characterSnapshot(character: Character): StoryEntitySnapshot {
  return {
    id: character.id,
    name: character.name,
    kind: 'character',
    summary: compact(character.summary || character.bio, 260),
    statusNote: [
      character.role ? `role=${character.role}` : '',
      character.traits?.length ? `traits=${character.traits.join('、')}` : '',
    ].filter(Boolean).join('; '),
    updatedAt: character.updatedAt,
  };
}

function locationSnapshot(location: Location): StoryEntitySnapshot {
  return {
    id: location.id,
    name: location.name,
    kind: 'location',
    summary: compact(location.description, 260),
    statusNote: location.region ? `region=${location.region}` : '',
    updatedAt: location.updatedAt,
  };
}

function itemSnapshot(item: Item): StoryEntitySnapshot {
  return {
    id: item.id,
    name: item.name,
    kind: 'item',
    summary: compact(item.description, 260),
    statusNote: item.type ? `type=${item.type}` : '',
    updatedAt: item.updatedAt,
  };
}

function factionSnapshot(faction: Faction): StoryEntitySnapshot {
  return {
    id: faction.id,
    name: faction.name,
    kind: 'faction',
    summary: compact(faction.description, 260),
    statusNote: [
      faction.leader ? `leader=${faction.leader}` : '',
      faction.territory ? `territory=${faction.territory}` : '',
    ].filter(Boolean).join('; '),
    updatedAt: faction.updatedAt,
  };
}

function powerLevelSnapshot(powerLevel: PowerLevel): StoryEntitySnapshot {
  return {
    id: powerLevel.id,
    name: powerLevel.name,
    kind: 'powerLevel',
    summary: compact(powerLevel.description, 260),
    statusNote: [
      `tier=${powerLevel.tier}`,
      powerLevel.characteristics ? `characteristics=${powerLevel.characteristics}` : '',
    ].filter(Boolean).join('; '),
    updatedAt: powerLevel.updatedAt,
  };
}

export function buildStoryStateLedger(input: BuildStoryStateLedgerInput): StoryStateLedger {
  const recentChapterLimit = input.recentChapterLimit ?? 5;
  const orderedChapters = input.chapters.slice().sort((a, b) => a.order - b.order);
  const recentChapters = orderedChapters.slice(-recentChapterLimit).map((chapter) => ({
    id: chapter.id,
    title: chapter.title || `第 ${chapter.order} 章`,
    order: chapter.order,
    sceneBeats: compact(chapter.sceneBeats, 500),
    summary: chapterSummary(chapter),
  }));

  return {
    novelId: input.novel.id,
    title: input.novel.title,
    summary: compact(input.novel.summary, 600),
    worldRules: compact(input.novel.worldRules, 900),
    globalOutline: compact(input.novel.globalOutline, 900),
    recentChapters,
    entityStates: {
      characters: (input.characters || []).map(characterSnapshot),
      locations: (input.locations || []).map(locationSnapshot),
      items: (input.items || []).map(itemSnapshot),
      factions: (input.factions || []).map(factionSnapshot),
      powerLevels: (input.powerLevels || []).map(powerLevelSnapshot),
    },
    timeline: (input.timelineEvents || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((event) => ({
        id: event.id,
        title: event.title,
        timestamp: event.timestamp,
        description: compact(event.description, 280),
        statusTag: event.statusTag,
        order: event.order,
      })),
    openForeshadowings: (input.foreshadowings || [])
      .filter((entry) => entry.status !== 'payoff')
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        description: compact(entry.description, 280),
        status: entry.status,
        plantedChapterId: entry.plantedChapterId,
        payoffChapterId: entry.payoffChapterId,
        notes: compact(entry.notes, 220),
      })),
  };
}

function formatEntityList(title: string, entries: StoryEntitySnapshot[]): string {
  if (!entries.length) return `${title}\n- 无`;
  return `${title}\n${entries.map((entry) => `- ${entry.name}: ${entry.summary || '无摘要'}${entry.statusNote ? ` (${entry.statusNote})` : ''}`).join('\n')}`;
}

export function buildLedgerPromptFacts(ledger: StoryStateLedger): Record<string, string> {
  return {
    story: [
      `作品：${ledger.title}`,
      `摘要：${ledger.summary || '无'}`,
      `世界规则：${ledger.worldRules || '无'}`,
      `全局大纲：${ledger.globalOutline || '无'}`,
    ].join('\n'),
    recentChapters: ledger.recentChapters.length
      ? ledger.recentChapters.map((chapter) => `- ${chapter.title}: ${chapter.summary || chapter.sceneBeats || '无摘要'}`).join('\n')
      : '- 无',
    characters: formatEntityList('人物状态', ledger.entityStates.characters),
    locations: formatEntityList('地点状态', ledger.entityStates.locations),
    items: formatEntityList('道具状态', ledger.entityStates.items),
    factions: formatEntityList('势力状态', ledger.entityStates.factions),
    powerLevels: formatEntityList('力量体系', ledger.entityStates.powerLevels),
    timeline: ledger.timeline.length
      ? ledger.timeline.map((event) => `- [${event.timestamp || '未标时间'}] ${event.title}: ${event.description}`).join('\n')
      : '- 无',
    foreshadowings: ledger.openForeshadowings.length
      ? ledger.openForeshadowings.map((entry) => `- ${entry.title} (${entry.status}): ${entry.description}`).join('\n')
      : '- 无',
  };
}

export function summarizeStoryStateLedger(ledger: StoryStateLedger): string {
  const facts = buildLedgerPromptFacts(ledger);
  return [
    '【故事状态账本】',
    facts.story,
    '【近期章节】',
    facts.recentChapters,
    '【人物】',
    facts.characters,
    '【道具】',
    facts.items,
    '【时间线】',
    facts.timeline,
    '【未回收伏笔】',
    facts.foreshadowings,
  ].join('\n\n');
}
```

- [ ] Step 5: Run the ledger tests.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/story-state-ledger.test.ts
```

Expected output:

```text
# pass 3
# fail 0
```

## Task 2: Add Continuity Critic Pure Model

Files:

- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/types.ts`
- Create: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/continuity-critic.ts`
- Test: `/Users/Zhuanz/Documents/dodo-inkflow/tests/continuity-critic.test.ts`

### Steps

- [ ] Step 1: Write the failing test file.

Create `tests/continuity-critic.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContinuityCriticPrompt,
  extractContinuityReportJson,
  normalizeContinuityReport,
} from '../src/lib/continuity-critic';
import type { StoryStateLedger } from '../src/types';

const ledger: StoryStateLedger = {
  novelId: 'novel-1',
  title: '雨夜玄令',
  summary: '沉默刀客卷入玄铁令争夺。',
  worldRules: '玄铁令不能复制。',
  globalOutline: '第一卷围绕玄铁令失窃展开。',
  recentChapters: [
    {
      id: 'chapter-1',
      title: '第一章',
      order: 1,
      sceneBeats: '林砚入酒馆。',
      summary: '林砚持有玄铁令。',
    },
  ],
  entityStates: {
    characters: [
      {
        id: 'char-1',
        name: '林砚',
        kind: 'character',
        summary: '寡言刀客。',
        statusNote: '持有玄铁令',
      },
    ],
    locations: [],
    items: [
      {
        id: 'item-1',
        name: '玄铁令',
        kind: 'item',
        summary: '唯一铁令。',
        statusNote: 'type=信物',
      },
    ],
    factions: [],
    powerLevels: [],
  },
  timeline: [],
  openForeshadowings: [],
};

test('buildContinuityCriticPrompt asks for strict JSON and includes ledger facts', () => {
  const prompt = buildContinuityCriticPrompt({
    ledger,
    sceneBeats: '林砚把玄铁令交给掌柜。',
    draftContent: '林砚从怀里取出两枚玄铁令。',
  });

  assert.match(prompt, /严格输出 JSON/);
  assert.match(prompt, /雨夜玄令/);
  assert.match(prompt, /玄铁令不能复制/);
  assert.match(prompt, /两枚玄铁令/);
});

test('extractContinuityReportJson parses fenced model output', () => {
  const parsed = extractContinuityReportJson(`
\`\`\`json
{
  "score": 62,
  "issues": [
    {
      "severity": "high",
      "category": "item",
      "message": "玄铁令此前设定为唯一，草稿出现两枚。",
      "evidence": "两枚玄铁令"
    }
  ],
  "proposedPatch": {
    "timelineEventsToCreate": [],
    "foreshadowingUpdates": []
  }
}
\`\`\`
`);

  assert.equal(parsed.score, 62);
  assert.equal(parsed.issues[0].category, 'item');
});

test('normalizeContinuityReport clamps score and fills missing arrays', () => {
  const report = normalizeContinuityReport({
    score: 120,
    issues: [
      {
        severity: 'urgent',
        category: 'unknown',
        message: 'bad',
      },
    ],
  });

  assert.equal(report.score, 100);
  assert.equal(report.issues[0].severity, 'medium');
  assert.equal(report.issues[0].category, 'logic');
  assert.deepEqual(report.proposedPatch.timelineEventsToCreate, []);
  assert.deepEqual(report.proposedPatch.foreshadowingUpdates, []);
});
```

- [ ] Step 2: Run the test and confirm the module is missing.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/continuity-critic.test.ts
```

Expected output:

```text
not ok
ERR_MODULE_NOT_FOUND
```

- [ ] Step 3: Append continuity report types to `src/types.ts` after `StoryStateLedger`.

```ts
export type ContinuityIssueSeverity = 'low' | 'medium' | 'high';

export type ContinuityIssueCategory =
  | 'character'
  | 'timeline'
  | 'item'
  | 'location'
  | 'power'
  | 'foreshadowing'
  | 'logic';

export interface ContinuityIssue {
  severity: ContinuityIssueSeverity;
  category: ContinuityIssueCategory;
  message: string;
  evidence?: string;
  suggestedFix?: string;
}

export interface ProposedLedgerPatch {
  characterUpdates: Array<{
    characterId: string;
    summaryAppend: string;
  }>;
  itemUpdates: Array<{
    itemId: string;
    descriptionAppend: string;
  }>;
  foreshadowingUpdates: Array<{
    foreshadowingId: string;
    status: Foreshadowing['status'];
    notesAppend: string;
  }>;
  timelineEventsToCreate: Array<{
    title: string;
    timestamp: string;
    description: string;
    statusTag: string;
  }>;
  foreshadowingsToCreate: Array<{
    title: string;
    description: string;
    status: Foreshadowing['status'];
    plantedChapterId?: string;
  }>;
}

export interface ContinuityReport {
  score: number;
  issues: ContinuityIssue[];
  proposedPatch: ProposedLedgerPatch;
}
```

- [ ] Step 4: Create `src/lib/continuity-critic.ts`.

```ts
import type {
  ContinuityIssue,
  ContinuityIssueCategory,
  ContinuityIssueSeverity,
  ContinuityReport,
  ProposedLedgerPatch,
  StoryStateLedger,
} from '../types';
import { summarizeStoryStateLedger } from './story-state-ledger';

const ISSUE_SEVERITIES: ContinuityIssueSeverity[] = ['low', 'medium', 'high'];
const ISSUE_CATEGORIES: ContinuityIssueCategory[] = [
  'character',
  'timeline',
  'item',
  'location',
  'power',
  'foreshadowing',
  'logic',
];

function clampScore(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 70;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeIssue(raw: any): ContinuityIssue {
  const severity = ISSUE_SEVERITIES.includes(raw?.severity) ? raw.severity : 'medium';
  const category = ISSUE_CATEGORIES.includes(raw?.category) ? raw.category : 'logic';
  return {
    severity,
    category,
    message: typeof raw?.message === 'string' && raw.message.trim() ? raw.message.trim() : '连续性风险未说明。',
    evidence: typeof raw?.evidence === 'string' ? raw.evidence : undefined,
    suggestedFix: typeof raw?.suggestedFix === 'string' ? raw.suggestedFix : undefined,
  };
}

function emptyPatch(): ProposedLedgerPatch {
  return {
    characterUpdates: [],
    itemUpdates: [],
    foreshadowingUpdates: [],
    timelineEventsToCreate: [],
    foreshadowingsToCreate: [],
  };
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function normalizeContinuityReport(raw: any): ContinuityReport {
  const patch = raw?.proposedPatch || {};
  return {
    score: clampScore(raw?.score),
    issues: arrayOrEmpty<any>(raw?.issues).map(normalizeIssue),
    proposedPatch: {
      characterUpdates: arrayOrEmpty(patch.characterUpdates),
      itemUpdates: arrayOrEmpty(patch.itemUpdates),
      foreshadowingUpdates: arrayOrEmpty(patch.foreshadowingUpdates),
      timelineEventsToCreate: arrayOrEmpty(patch.timelineEventsToCreate),
      foreshadowingsToCreate: arrayOrEmpty(patch.foreshadowingsToCreate),
    },
  };
}

export function extractContinuityReportJson(text: string): ContinuityReport {
  const cleaned = text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
  return normalizeContinuityReport(JSON.parse(cleaned));
}

export function buildContinuityCriticPrompt(input: {
  ledger: StoryStateLedger;
  sceneBeats: string;
  draftContent: string;
}): string {
  return `
你是 InkFlow 的长篇连续性审稿员，只检查长篇一致性，不评价文风。

【故事状态账本】
${summarizeStoryStateLedger(input.ledger)}

【本章分镜】
${input.sceneBeats || '无'}

【本章草稿】
${input.draftContent || '无'}

请检查：
1. 人物状态是否矛盾。
2. 道具归属、唯一性、能力边界是否矛盾。
3. 时间线是否矛盾。
4. 地点移动是否缺少过渡。
5. 力量体系是否越界。
6. 已埋伏笔是否被遗忘，或是否出现新的可记录伏笔。

严格输出 JSON，不要输出 Markdown，不要添加解释文字。结构必须是：
{
  "score": 0到100的整数,
  "issues": [
    {
      "severity": "low" | "medium" | "high",
      "category": "character" | "timeline" | "item" | "location" | "power" | "foreshadowing" | "logic",
      "message": "问题说明",
      "evidence": "草稿中的证据",
      "suggestedFix": "建议修复"
    }
  ],
  "proposedPatch": {
    "characterUpdates": [
      { "characterId": "已有角色ID", "summaryAppend": "需要追加到角色摘要的状态变化" }
    ],
    "itemUpdates": [
      { "itemId": "已有道具ID", "descriptionAppend": "需要追加到道具描述的状态变化" }
    ],
    "foreshadowingUpdates": [
      { "foreshadowingId": "已有伏笔ID", "status": "planted" | "hinted" | "payoff", "notesAppend": "需要追加的伏笔说明" }
    ],
    "timelineEventsToCreate": [
      { "title": "事件标题", "timestamp": "相对或绝对时间", "description": "事件描述", "statusTag": "已发生" }
    ],
    "foreshadowingsToCreate": [
      { "title": "新伏笔标题", "description": "伏笔描述", "status": "planted", "plantedChapterId": "" }
    ]
  }
}
`;
}
```

- [ ] Step 5: Run the continuity critic tests.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/continuity-critic.test.ts
```

Expected output:

```text
# pass 3
# fail 0
```

## Task 3: Persist Chapter Production Runs In SQLite

Files:

- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/types.ts`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/db.ts`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/server.ts`
- Test: `/Users/Zhuanz/Documents/dodo-inkflow/tests/db-chapter-production-run.test.ts`

### Steps

- [ ] Step 1: Add run types to `src/types.ts` after `ContinuityReport`.

```ts
export type ChapterProductionRunStatus =
  | 'running'
  | 'review_required'
  | 'applied'
  | 'rejected'
  | 'failed';

export interface ChapterProductionRun {
  id: string;
  novelId: string;
  targetChapterId?: string;
  status: ChapterProductionRunStatus;
  userIntent: string;
  sceneBeats: string;
  draftContent: string;
  styleAudit: string;
  continuityReport: ContinuityReport;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] Step 2: Write the failing DB test.

Create `tests/db-chapter-production-run.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDb,
  createChapterProductionRun,
  createNovel,
  getChapterProductionRun,
  initDb,
  listChapterProductionRuns,
  updateChapterProductionRun,
} from '../src/lib/db';
import type { ChapterProductionRun, Novel } from '../src/types';

function baseNovel(): Novel {
  const now = Date.now();
  return {
    id: 'novel-prod-1',
    title: '生产测试',
    authorId: 'local-user',
    summary: '测试单章生产 run',
    status: 'ongoing',
    createdAt: now,
    updatedAt: now,
  };
}

function baseRun(): ChapterProductionRun {
  const now = Date.now();
  return {
    id: 'run-1',
    novelId: 'novel-prod-1',
    targetChapterId: 'chapter-1',
    status: 'review_required',
    userIntent: '写下一章雨夜追杀。',
    sceneBeats: '1. 追兵入城。2. 林砚逃入旧巷。',
    draftContent: '雨水压低了旧巷的檐声。',
    styleAudit: 'PASS：节奏稳定。',
    continuityReport: {
      score: 88,
      issues: [],
      proposedPatch: {
        characterUpdates: [],
        itemUpdates: [],
        foreshadowingUpdates: [],
        timelineEventsToCreate: [
          {
            title: '林砚入旧巷',
            timestamp: '第一卷第二夜',
            description: '林砚被追兵逼入旧巷。',
            statusTag: '已发生',
          },
        ],
        foreshadowingsToCreate: [],
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

test('chapter production run persists JSON report and status updates', () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-prod-run-${Date.now()}.db`);

  try {
    initDb(dbPath);
    createNovel(baseNovel());
    createChapterProductionRun(baseRun());

    const read = getChapterProductionRun('run-1');
    assert.ok(read);
    assert.equal(read!.status, 'review_required');
    assert.equal(read!.continuityReport.score, 88);
    assert.equal(read!.continuityReport.proposedPatch.timelineEventsToCreate[0].title, '林砚入旧巷');

    updateChapterProductionRun('run-1', {
      status: 'applied',
      styleAudit: 'PASS：已接受。',
    });

    const updated = getChapterProductionRun('run-1');
    assert.ok(updated);
    assert.equal(updated!.status, 'applied');
    assert.equal(updated!.styleAudit, 'PASS：已接受。');

    const runs = listChapterProductionRuns('novel-prod-1');
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, 'run-1');
  } finally {
    closeDb();
    fs.rmSync(dbPath, { force: true });
  }
});
```

- [ ] Step 3: Run the DB test and confirm missing exports.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/db-chapter-production-run.test.ts
```

Expected output:

```text
not ok
SyntaxError: The requested module '../src/lib/db' does not provide an export named
```

- [ ] Step 4: Modify `src/lib/db.ts` imports to include `ChapterProductionRun`.

```ts
import type {
  Novel,
  Character,
  Location,
  Item,
  Faction,
  PowerLevel,
  TimelineEvent,
  Chapter,
  ChapterVersion,
  Skill,
  IdeaFragment,
  Foreshadowing,
  SkillUsageRecord,
  ChapterProductionRun,
} from '../types';
```

- [ ] Step 5: Add the table inside the `db.exec()` initialization block after `foreshadowings`.

```sql
CREATE TABLE IF NOT EXISTS chapter_production_runs (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  target_chapter_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  user_intent TEXT DEFAULT '',
  scene_beats TEXT DEFAULT '',
  draft_content TEXT DEFAULT '',
  style_audit TEXT DEFAULT '',
  continuity_report TEXT DEFAULT '{}',
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
  FOREIGN KEY (target_chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
);
```

- [ ] Step 6: Add row mappers below `foreshadowingToRow()`.

```ts
function rowToChapterProductionRun(row: any): ChapterProductionRun {
  return {
    id: row.id,
    novelId: row.novel_id,
    targetChapterId: row.target_chapter_id || undefined,
    status: row.status,
    userIntent: row.user_intent || '',
    sceneBeats: row.scene_beats || '',
    draftContent: row.draft_content || '',
    styleAudit: row.style_audit || '',
    continuityReport: JSON.parse(row.continuity_report || '{}'),
    errorMessage: row.error_message || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function chapterProductionRunToRow(run: ChapterProductionRun): any {
  return {
    id: run.id,
    novel_id: run.novelId,
    target_chapter_id: run.targetChapterId || null,
    status: run.status,
    user_intent: run.userIntent,
    scene_beats: run.sceneBeats,
    draft_content: run.draftContent,
    style_audit: run.styleAudit,
    continuity_report: JSON.stringify(run.continuityReport),
    error_message: run.errorMessage || null,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}
```

- [ ] Step 7: Add CRUD functions near the end of `src/lib/db.ts`.

```ts
export function listChapterProductionRuns(novelId: string): ChapterProductionRun[] {
  const rows = getDb()
    .prepare('SELECT * FROM chapter_production_runs WHERE novel_id = ? ORDER BY created_at DESC')
    .all(novelId);
  return rows.map(rowToChapterProductionRun);
}

export function getChapterProductionRun(id: string): ChapterProductionRun | undefined {
  const row = getDb().prepare('SELECT * FROM chapter_production_runs WHERE id = ?').get(id);
  return row ? rowToChapterProductionRun(row) : undefined;
}

export function createChapterProductionRun(run: ChapterProductionRun): void {
  getDb().prepare(`
    INSERT INTO chapter_production_runs (
      id, novel_id, target_chapter_id, status, user_intent, scene_beats, draft_content,
      style_audit, continuity_report, error_message, created_at, updated_at
    )
    VALUES (
      @id, @novel_id, @target_chapter_id, @status, @user_intent, @scene_beats, @draft_content,
      @style_audit, @continuity_report, @error_message, @created_at, @updated_at
    )
  `).run(chapterProductionRunToRow(run));
  notify();
}

export function updateChapterProductionRun(id: string, data: Partial<ChapterProductionRun>): void {
  const existing = getChapterProductionRun(id);
  if (!existing) return;
  const merged: ChapterProductionRun = {
    ...existing,
    ...data,
    id,
    updatedAt: Date.now(),
  };
  getDb().prepare(`
    UPDATE chapter_production_runs
    SET novel_id=@novel_id,
        target_chapter_id=@target_chapter_id,
        status=@status,
        user_intent=@user_intent,
        scene_beats=@scene_beats,
        draft_content=@draft_content,
        style_audit=@style_audit,
        continuity_report=@continuity_report,
        error_message=@error_message,
        updated_at=@updated_at
    WHERE id=@id
  `).run(chapterProductionRunToRow(merged));
  notify();
}
```

- [ ] Step 8: Add DB whitelist entries in `server.ts`.

```ts
'listChapterProductionRuns', 'getChapterProductionRun', 'createChapterProductionRun', 'updateChapterProductionRun',
```

- [ ] Step 9: Add frontend DB wrappers to `src/lib/api.ts`.

```ts
import type { ChapterProductionRun } from '../types';

export async function listChapterProductionRuns(novelId: string): Promise<ChapterProductionRun[]> {
  return call('listChapterProductionRuns', novelId);
}

export async function getChapterProductionRun(id: string): Promise<ChapterProductionRun | undefined> {
  return call('getChapterProductionRun', id);
}
```

- [ ] Step 10: Run the DB test.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/db-chapter-production-run.test.ts
```

Expected output:

```text
# pass 1
# fail 0
```

## Task 4: Add Server-Side Chapter Production Run Endpoint

Files:

- Create: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/chapter-production.ts`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/server.ts`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts`
- Test: `/Users/Zhuanz/Documents/dodo-inkflow/tests/chapter-production.test.ts`

### Steps

- [ ] Step 1: Write pure helper tests.

Create `tests/chapter-production.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChapterProductionTitle,
  getNextChapterOrder,
  normalizeProductionIntent,
} from '../src/lib/chapter-production';
import type { Chapter } from '../src/types';

test('getNextChapterOrder returns one more than highest existing order', () => {
  const chapters = [
    { id: 'c1', order: 1 },
    { id: 'c3', order: 3 },
    { id: 'c2', order: 2 },
  ] as Chapter[];
  assert.equal(getNextChapterOrder(chapters), 4);
});

test('buildChapterProductionTitle formats next chapter title', () => {
  assert.equal(buildChapterProductionTitle(4), '第 4 章');
});

test('normalizeProductionIntent uses a practical default', () => {
  assert.equal(
    normalizeProductionIntent(''),
    '延续上一章剧情，生成下一章分镜、正文和连续性审计。',
  );
  assert.equal(normalizeProductionIntent('  追兵入城  '), '追兵入城');
});
```

- [ ] Step 2: Run the helper tests and confirm missing module.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/chapter-production.test.ts
```

Expected output:

```text
not ok
ERR_MODULE_NOT_FOUND
```

- [ ] Step 3: Create `src/lib/chapter-production.ts`.

```ts
import type { Chapter } from '../types';

export function getNextChapterOrder(chapters: Pick<Chapter, 'order'>[]): number {
  if (!chapters.length) return 1;
  return Math.max(...chapters.map((chapter) => chapter.order || 0)) + 1;
}

export function buildChapterProductionTitle(order: number): string {
  return `第 ${order} 章`;
}

export function normalizeProductionIntent(intent: string): string {
  const normalized = intent.trim();
  return normalized || '延续上一章剧情，生成下一章分镜、正文和连续性审计。';
}
```

- [ ] Step 4: Run helper tests.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/chapter-production.test.ts
```

Expected output:

```text
# pass 3
# fail 0
```

- [ ] Step 5: Add API wrappers to `src/lib/api.ts`.

```ts
export async function startChapterProductionRun(payload: {
  novelId: string;
  targetChapterId?: string;
  userIntent: string;
}): Promise<ChapterProductionRun> {
  const res = await fetch('/api/chapter-production-runs/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to start chapter production run');
  return data.run;
}

export async function applyChapterProductionRun(runId: string): Promise<{ chapterId: string }> {
  const res = await fetch(`/api/chapter-production-runs/${runId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to apply chapter production run');
  return { chapterId: data.chapterId };
}
```

- [ ] Step 6: Add imports to `server.ts`.

```ts
import {
  buildChapterProductionTitle,
  getNextChapterOrder,
  normalizeProductionIntent,
} from './src/lib/chapter-production';
import {
  buildStoryStateLedger,
  summarizeStoryStateLedger,
} from './src/lib/story-state-ledger';
import {
  buildContinuityCriticPrompt,
  extractContinuityReportJson,
  normalizeContinuityReport,
} from './src/lib/continuity-critic';
```

- [ ] Step 7: Add helper functions inside `startServer()` before the endpoint declarations.

```ts
function buildEmptyContinuityReport() {
  return {
    score: 70,
    issues: [],
    proposedPatch: {
      characterUpdates: [],
      itemUpdates: [],
      foreshadowingUpdates: [],
      timelineEventsToCreate: [],
      foreshadowingsToCreate: [],
    },
  };
}

function parseJsonOrEmptyReport(raw: string) {
  try {
    return extractContinuityReportJson(raw);
  } catch {
    return normalizeContinuityReport(buildEmptyContinuityReport());
  }
}
```

- [ ] Step 8: Add the start endpoint after `/api/orchestrate`.

```ts
app.post('/api/chapter-production-runs/start', async (req, res) => {
  try {
    const { novelId = '', targetChapterId = '', userIntent = '' } = req.body;
    if (!novelId.trim()) {
      return res.status(400).json({ error: 'novelId is required' });
    }

    const novel = db.getNovel(novelId);
    if (!novel) {
      return res.status(404).json({ error: 'Novel not found' });
    }

    const chapters = db.listChapters(novelId);
    const characters = db.listCharacters(novelId);
    const locations = db.listLocations(novelId);
    const items = db.listItems(novelId);
    const factions = db.listFactions(novelId);
    const powerLevels = db.listPowerLevels(novelId);
    const timelineEvents = db.listTimelineEvents(novelId);
    const foreshadowings = db.listForeshadowings(novelId);
    const skills = db.listSkills().filter((skill: any) => (novel.mountedSkillIds || []).includes(skill.id));

    const ledger = buildStoryStateLedger({
      novel,
      chapters,
      characters,
      locations,
      items,
      factions,
      powerLevels,
      timelineEvents,
      foreshadowings,
    });
    const ledgerSummary = summarizeStoryStateLedger(ledger);
    const intent = normalizeProductionIntent(userIntent);
    const runId = Date.now().toString();
    const now = Date.now();

    const plannerPrompt = renderPromptTemplate(getPromptTemplate('editorAgent'), {
      PLANNER_SOUL,
      contextStr: ledgerSummary,
      userIntent: intent,
    });
    const sceneBeats = await generateText(getConfig(), { prompt: plannerPrompt });

    const writerPrompt = renderPromptTemplate(getPromptTemplate('orchestrateWriter'), {
      WRITER_SOUL,
      contextStr: ledgerSummary,
      skillsInfo: buildSkillsPrompt(skills),
      sceneBeats,
      criticFeedback: '初稿阶段，请全力输出。',
    });
    const draftContent = await generateText(getConfig(), { prompt: writerPrompt });

    const styleAuditPrompt = renderPromptTemplate(getPromptTemplate('manualAudit'), {
      contextStr: ledgerSummary.slice(0, 1200),
      skillsInfo: buildSkillsPrompt(skills).slice(0, 900),
      sceneBeats: sceneBeats.slice(0, 1400),
      draftContent: draftContent.slice(0, 2600),
    });
    const styleAudit = await generateText(getConfig(), { prompt: styleAuditPrompt });

    const continuityPrompt = buildContinuityCriticPrompt({
      ledger,
      sceneBeats,
      draftContent,
    });
    const rawContinuity = await generateText(getConfig(), { prompt: continuityPrompt });
    const continuityReport = parseJsonOrEmptyReport(rawContinuity);

    const run = {
      id: runId,
      novelId,
      targetChapterId: targetChapterId || undefined,
      status: 'review_required' as const,
      userIntent: intent,
      sceneBeats,
      draftContent,
      styleAudit,
      continuityReport,
      createdAt: now,
      updatedAt: now,
    };

    db.createChapterProductionRun(run);
    res.json({ run });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});
```

- [ ] Step 9: Add the apply endpoint after the start endpoint.

```ts
app.post('/api/chapter-production-runs/:runId/apply', async (req, res) => {
  try {
    const run = db.getChapterProductionRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ error: 'Production run not found' });
    }
    if (run.status !== 'review_required') {
      return res.status(400).json({ error: `Production run is not reviewable: ${run.status}` });
    }

    const chapters = db.listChapters(run.novelId);
    const now = Date.now();
    let chapterId = run.targetChapterId;

    if (chapterId && db.getChapter(chapterId)) {
      db.updateChapter(chapterId, {
        sceneBeats: run.sceneBeats,
        content: run.draftContent,
        critique: run.styleAudit,
        wordCount: run.draftContent.replace(/\s/g, '').length,
      });
    } else {
      const nextOrder = getNextChapterOrder(chapters);
      chapterId = `${now}`;
      db.createChapter({
        id: chapterId,
        novelId: run.novelId,
        title: buildChapterProductionTitle(nextOrder),
        volumeName: chapters.at(-1)?.volumeName || '正文卷',
        content: run.draftContent,
        order: nextOrder,
        wordCount: run.draftContent.replace(/\s/g, '').length,
        sceneBeats: run.sceneBeats,
        critique: run.styleAudit,
        createdAt: now,
        updatedAt: now,
      });
    }

    db.createChapterVersion({
      id: `${now + 1}`,
      chapterId,
      content: run.draftContent,
      wordCount: run.draftContent.replace(/\s/g, '').length,
      author: 'auto',
      createdAt: now,
    });

    const existingTimeline = db.listTimelineEvents(run.novelId);
    run.continuityReport.proposedPatch.timelineEventsToCreate.forEach((event, index) => {
      db.createTimelineEvent({
        id: `${now + 10 + index}`,
        novelId: run.novelId,
        title: event.title,
        timestamp: event.timestamp,
        description: event.description,
        statusTag: event.statusTag,
        order: existingTimeline.length + index + 1,
        createdAt: now,
        updatedAt: now,
      });
    });

    run.continuityReport.proposedPatch.foreshadowingsToCreate.forEach((entry, index) => {
      db.createForeshadowing({
        id: `${now + 100 + index}`,
        novelId: run.novelId,
        title: entry.title,
        description: entry.description,
        status: entry.status,
        plantedChapterId: chapterId,
        relatedCharacterIds: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    db.updateChapterProductionRun(run.id, {
      status: 'applied',
      targetChapterId: chapterId,
    });

    res.json({ chapterId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});
```

- [ ] Step 10: Run focused tests.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/story-state-ledger.test.ts tests/continuity-critic.test.ts tests/chapter-production.test.ts tests/db-chapter-production-run.test.ts
```

Expected output:

```text
# fail 0
```

## Task 5: Add Editor Review UI For Production Runs

Files:

- Create: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/ProductionRunReview.tsx`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/EditorView.tsx`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/api.ts`

### Steps

- [ ] Step 1: Create `src/components/ProductionRunReview.tsx`.

```tsx
import { AlertTriangle, CheckCircle2, Loader2, Play, XCircle } from 'lucide-react';
import type { ChapterProductionRun } from '../types';

interface ProductionRunReviewProps {
  run: ChapterProductionRun | null;
  userIntent: string;
  running: boolean;
  applying: boolean;
  error?: string | null;
  onIntentChange: (value: string) => void;
  onStart: () => void;
  onApply: () => void;
}

export function ProductionRunReview({
  run,
  userIntent,
  running,
  applying,
  error,
  onIntentChange,
  onStart,
  onApply,
}: ProductionRunReviewProps) {
  const issues = run?.continuityReport.issues || [];
  const timelineEvents = run?.continuityReport.proposedPatch.timelineEventsToCreate || [];
  const foreshadowings = run?.continuityReport.proposedPatch.foreshadowingsToCreate || [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-theme-border bg-white p-4">
        <div className="text-sm font-bold text-theme-text">单章自动生产</div>
        <p className="mt-1 text-xs leading-5 text-theme-muted">
          生成下一章分镜、正文、文风审计和连续性报告。结果只会进入预览，点击接受后才写入章节和状态账本。
        </p>
        <textarea
          value={userIntent}
          onChange={(event) => onIntentChange(event.target.value)}
          aria-label="生产意图"
          className="mt-3 h-24 w-full resize-none rounded-xl border border-theme-border bg-theme-sidebar/20 p-3 text-sm outline-none focus:border-theme-accent"
        />
        {error ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <XCircle size={14} />
            {error}
          </div>
        ) : null}
        <button
          onClick={onStart}
          disabled={running}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-theme-text px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {running ? '生产中...' : '开始生产一章'}
        </button>
      </div>

      {run ? (
        <div className="rounded-2xl border border-theme-border bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-theme-text">生产报告</div>
              <div className="mt-1 text-xs text-theme-muted">连续性评分 {run.continuityReport.score}/100</div>
            </div>
            <button
              onClick={onApply}
              disabled={applying || run.status !== 'review_required'}
              className="inline-flex items-center gap-2 rounded-xl bg-theme-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              接受并写入
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <section>
              <div className="text-xs font-bold uppercase tracking-wider text-theme-muted">分镜</div>
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-theme-sidebar/25 p-3 text-xs leading-5 text-theme-text">
                {run.sceneBeats}
              </pre>
            </section>
            <section>
              <div className="text-xs font-bold uppercase tracking-wider text-theme-muted">正文预览</div>
              <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-theme-sidebar/25 p-3 font-serif text-sm leading-7 text-theme-text">
                {run.draftContent}
              </pre>
            </section>
            <section>
              <div className="text-xs font-bold uppercase tracking-wider text-theme-muted">连续性问题</div>
              <div className="mt-2 space-y-2">
                {issues.length ? issues.map((issue, index) => (
                  <div key={`${issue.category}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <div className="flex items-center gap-2 font-bold">
                      <AlertTriangle size={13} />
                      {issue.severity} / {issue.category}
                    </div>
                    <div className="mt-1 leading-5">{issue.message}</div>
                    {issue.suggestedFix ? <div className="mt-1 text-amber-700">建议：{issue.suggestedFix}</div> : null}
                  </div>
                )) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    没有发现明显连续性冲突。
                  </div>
                )}
              </div>
            </section>
            <section>
              <div className="text-xs font-bold uppercase tracking-wider text-theme-muted">建议写入状态账本</div>
              <div className="mt-2 space-y-2 text-xs text-theme-muted">
                {timelineEvents.map((event, index) => (
                  <div key={`timeline-${index}`} className="rounded-xl border border-theme-border bg-theme-sidebar/20 px-3 py-2">
                    时间线：[{event.timestamp}] {event.title} - {event.description}
                  </div>
                ))}
                {foreshadowings.map((entry, index) => (
                  <div key={`foreshadow-${index}`} className="rounded-xl border border-theme-border bg-theme-sidebar/20 px-3 py-2">
                    新伏笔：{entry.title} - {entry.description}
                  </div>
                ))}
                {!timelineEvents.length && !foreshadowings.length ? (
                  <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 px-3 py-2">
                    本次没有建议新增时间线或伏笔。
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] Step 2: Modify `EditorView.tsx` imports.

```tsx
import { ProductionRunReview } from './ProductionRunReview';
import {
  applyChapterProductionRun,
  startChapterProductionRun,
} from '../lib/api';
import type { ChapterProductionRun } from '../types';
```

- [ ] Step 3: Extend the `agentTab` union in `EditorView.tsx` with `production`.

```ts
const [agentTab, setAgentTab] = useState<
  'copilot-home' | 'production' | 'outline' | 'planning' | 'quality' | 'trace' | 'bible' | 'skills' | 'versions' | 'ideas' | 'foreshadowing' | 'pacing'
>('copilot-home');
```

- [ ] Step 4: Add production run state near other editor state.

```ts
const [productionIntent, setProductionIntent] = useState('');
const [activeProductionRun, setActiveProductionRun] = useState<ChapterProductionRun | null>(null);
const [isProductionRunning, setIsProductionRunning] = useState(false);
const [isApplyingProductionRun, setIsApplyingProductionRun] = useState(false);
const [productionError, setProductionError] = useState<string | null>(null);
```

- [ ] Step 5: Add production handlers near `runCopilotAction`.

```ts
const handleStartProductionRun = async () => {
  setIsProductionRunning(true);
  setProductionError(null);
  try {
    const run = await startChapterProductionRun({
      novelId: novel.id,
      targetChapterId: currentChapter?.id,
      userIntent: productionIntent,
    });
    setActiveProductionRun(run);
    setAgentTab('production');
  } catch (error) {
    setProductionError(error instanceof Error ? error.message : String(error));
  } finally {
    setIsProductionRunning(false);
  }
};

const handleApplyProductionRun = async () => {
  if (!activeProductionRun) return;
  setIsApplyingProductionRun(true);
  setProductionError(null);
  try {
    const result = await applyChapterProductionRun(activeProductionRun.id);
    const freshChapters = await listChapters(novel.id);
    setChapters(freshChapters);
    setCurrentChapter(freshChapters.find((chapter) => chapter.id === result.chapterId) || freshChapters[0] || null);
    setActiveProductionRun({ ...activeProductionRun, status: 'applied', targetChapterId: result.chapterId });
  } catch (error) {
    setProductionError(error instanceof Error ? error.message : String(error));
  } finally {
    setIsApplyingProductionRun(false);
  }
};
```

- [ ] Step 6: Add a production tab button in the agent sidebar tab list.

```tsx
<button
  onClick={() => setAgentTab('production')}
  className={cn(
    'px-3 py-2 rounded-lg text-xs font-bold transition-colors',
    agentTab === 'production'
      ? 'bg-theme-accent text-white'
      : 'text-theme-muted hover:bg-theme-sidebar/50'
  )}
>
  自动生产
</button>
```

- [ ] Step 7: Render the panel in the agent drawer content area.

```tsx
{agentTab === 'production' && (
  <ProductionRunReview
    run={activeProductionRun}
    userIntent={productionIntent}
    running={isProductionRunning}
    applying={isApplyingProductionRun}
    error={productionError}
    onIntentChange={setProductionIntent}
    onStart={handleStartProductionRun}
    onApply={handleApplyProductionRun}
  />
)}
```

- [ ] Step 8: Add a quick entry button near the editor hero actions.

```tsx
<button
  onClick={() => {
    setAgentTab('production');
    setIsAgentSidebarOpen(true);
  }}
  className="px-3.5 py-2 rounded-xl border border-theme-border bg-white hover:bg-theme-sidebar/45 transition-colors text-sm font-medium flex items-center gap-2"
>
  <Bot size={15} className="text-theme-accent" />
  自动生产一章
</button>
```

- [ ] Step 9: Run TypeScript check.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

Expected output:

```text
> inkflow@1.0.0 lint
> tsc --noEmit
```

The command exits with status `0`.

## Task 6: Validation, Runtime Check, And Manual Smoke

Files:

- Read: `/Users/Zhuanz/Documents/dodo-inkflow/package.json`
- Read: `/Users/Zhuanz/Documents/dodo-inkflow/server.ts`
- Read: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/EditorView.tsx`

### Steps

- [ ] Step 1: Run all focused new tests.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test \
  tests/story-state-ledger.test.ts \
  tests/continuity-critic.test.ts \
  tests/chapter-production.test.ts \
  tests/db-chapter-production-run.test.ts
```

Expected output:

```text
# fail 0
```

- [ ] Step 2: Run the existing core tests.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/*.test.ts
```

Expected output:

```text
# fail 0
```

- [ ] Step 3: Run the type check.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

Expected output:

```text
> inkflow@1.0.0 lint
> tsc --noEmit
```

The command exits with status `0`.

- [ ] Step 4: Run the production build.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run build
```

Expected output:

```text
✓ built in
```

The existing Vite chunk-size warning is acceptable.

- [ ] Step 5: Start the app.

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run dev
```

Expected output:

```text
Vite dev middleware enabled
Server running on http://localhost:3000
```

- [ ] Step 6: Manually verify the endpoint rejects missing input.

```bash
curl -s -X POST http://localhost:3000/api/chapter-production-runs/start \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Expected output:

```json
{"error":"novelId is required"}
```

- [ ] Step 7: Manual browser smoke.

Open:

```text
http://localhost:3000
```

Verify:

```text
1. Open an existing novel.
2. Open 创作舞台.
3. Open 智能管家.
4. Open 自动生产.
5. Enter: 延续上一章，生成下一章并检查连续性。
6. Click 开始生产一章.
7. Confirm the UI shows 分镜, 正文预览, 连续性问题, and 建议写入状态账本.
8. Click 接受并写入.
9. Confirm the chapter content appears in the editor and a chapter version was created.
```

Expected result:

```text
No ErrorBoundary fallback.
No uncaught browser console exception.
No automatic story-state mutation before 接受并写入.
```

## Self-Review Checklist

- [ ] The plan implements a single-chapter vertical slice, not a broad autonomous factory.
- [ ] Story State Ledger is pure and testable before touching server routes.
- [ ] Continuity Critic has JSON normalization and does not depend on live LLM calls in tests.
- [ ] Production runs are persisted before they are applied.
- [ ] Applying a run writes chapter content and creates a version.
- [ ] Long-form state changes are proposed and reviewable before being written.
- [ ] No new dependency is introduced.
- [ ] All new server methods are either explicit endpoints or DB-whitelisted methods.
- [ ] Manual smoke checks verify that human confirmation gates state mutation.

## Execution Handoff

Recommended execution mode:

1. **Subagent-Driven:** Assign Task 1-2 to one worker, Task 3-4 to a second worker, Task 5 to a third worker, then have Codex integrate and run Task 6.
2. **Inline Execution:** Execute Task 1 through Task 6 in this session with a checkpoint after each task and no parallel file edits.

Use Subagent-Driven if the goal is speed. Use Inline Execution if the goal is easier review and fewer merge conflicts.
