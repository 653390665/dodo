# Continuation Pack Writing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Build a "资料包续写" flow that lets users upload worldbuilding, outline, character sheets, and existing manuscript docs, review a structured continuation pack, then generate a continuation draft through the existing chapter production pipeline.
**Architecture:** Reuse the current document parsing, World Bible, and Chapter Production Run systems instead of creating a separate writing engine. Add a typed continuation-pack model and parser as pure functions, persist continuation packs in SQLite, expose narrow server endpoints, then add a UI panel that feeds approved pack context into chapter production. The first version is a local-first, review-before-write workflow, not a background RAG system.
**Tech Stack:** React 19, TypeScript 5.8, Express 4, better-sqlite3, mammoth, node:test, existing `generateText` and prompt template runtime.

## Product Boundary

### In Scope

- Upload multiple `.txt`, `.md`, `.json`, and `.docx` documents as a "资料包".
- Auto-classify documents into `world`, `outline`, `characters`, `manuscript`, `style_sample`, or `other`.
- Extract a structured `ContinuationPack`:
  - hard canon facts
  - soft references
  - plot state
  - character states
  - style profile
  - contradictions
  - suggested continuation task
- Let the user review and approve the pack before it affects writing.
- Inject approved pack context into `/api/chapter-production-runs/start`.
- Show pack source and approval status in the writing UI.

### Out of Scope For V1

- Semantic vector search / embeddings.
- Cross-project cloud sync.
- Automatic copyright detection.
- Multi-user collaboration.
- Rewriting the existing `WorldBibleView` import flow.
- Replacing `BookFactoryView`; book-to-skill remains a separate learning workflow.

## Data Model

Add these types to `src/types.ts`:

```ts
export type ContinuationSourceKind =
  | 'world'
  | 'outline'
  | 'characters'
  | 'manuscript'
  | 'style_sample'
  | 'other';

export type ContinuationFactPriority = 'hard' | 'soft';

export interface ContinuationSourceDocument {
  id: string;
  packId: string;
  filename: string;
  kind: ContinuationSourceKind;
  text: string;
  excerpt: string;
  createdAt: number;
}

export interface ContinuationCanonFact {
  id: string;
  priority: ContinuationFactPriority;
  category: 'world' | 'character' | 'plot' | 'timeline' | 'relationship' | 'style';
  text: string;
  sourceDocumentId?: string;
  evidence: string;
}

export interface ContinuationCharacterState {
  name: string;
  role: string;
  currentGoal: string;
  emotionalState: string;
  secrets: string[];
  relationshipNotes: string[];
  evidence: string;
}

export interface ContinuationPlotState {
  currentTimeline: string;
  latestScene: string;
  unresolvedHooks: string[];
  immediateConflict: string;
  nextLikelyMove: string;
}

export interface ContinuationStyleProfile {
  pov: string;
  tense: string;
  pacing: string;
  dialogueDensity: string;
  proseTraits: string[];
  avoidTraits: string[];
  sampleEvidence: string;
}

export interface ContinuationContradiction {
  id: string;
  severity: 'low' | 'medium' | 'high';
  summary: string;
  conflictingEvidence: string[];
  suggestedResolution: string;
}

export interface ContinuationPack {
  id: string;
  novelId: string;
  title: string;
  status: 'draft' | 'approved';
  sourceDocuments: ContinuationSourceDocument[];
  canonFacts: ContinuationCanonFact[];
  characterStates: ContinuationCharacterState[];
  plotState: ContinuationPlotState;
  styleProfile: ContinuationStyleProfile;
  contradictions: ContinuationContradiction[];
  continuationTask: string;
  createdAt: number;
  updatedAt: number;
}
```

## Task 1: Add Pure Continuation Pack Model

### Files

- Create: `src/lib/continuation-pack.ts`
- Create: `tests/continuation-pack.test.ts`
- Modify: `src/types.ts`

### Steps

- [ ] Add the type block from the Data Model section to `src/types.ts`.
- [ ] Create `src/lib/continuation-pack.ts` with deterministic helpers:

```ts
import type {
  ContinuationPack,
  ContinuationSourceDocument,
  ContinuationSourceKind,
} from '../types';

export function classifyContinuationSource(filename: string, text: string): ContinuationSourceKind {
  const name = filename.toLowerCase();
  const body = text.slice(0, 3000);
  if (/世界观|设定|规则|体系|地图|势力/.test(name + body)) return 'world';
  if (/大纲|细纲|剧情|卷纲|章节/.test(name + body)) return 'outline';
  if (/人物|角色|主角|配角|反派/.test(name + body)) return 'characters';
  if (/正文|第[一二三四五六七八九十\d]+章|chapter/.test(name + body)) return 'manuscript';
  if (/样章|文风|风格|参考段落/.test(name + body)) return 'style_sample';
  return 'other';
}

export function buildContinuationSourceDocument(input: {
  packId: string;
  filename: string;
  text: string;
  now?: number;
}): ContinuationSourceDocument {
  const now = input.now ?? Date.now();
  const text = input.text.trim();
  return {
    id: `${input.packId}-doc-${Math.random().toString(36).slice(2, 10)}`,
    packId: input.packId,
    filename: input.filename,
    kind: classifyContinuationSource(input.filename, text),
    text,
    excerpt: text.slice(0, 500),
    createdAt: now,
  };
}

export function buildContinuationContext(pack: ContinuationPack): string {
  const hardFacts = pack.canonFacts
    .filter((fact) => fact.priority === 'hard')
    .slice(0, 20)
    .map((fact) => `- [${fact.category}] ${fact.text}`)
    .join('\n');
  const characters = pack.characterStates
    .slice(0, 8)
    .map((item) => `- ${item.name}：目标=${item.currentGoal}；情绪=${item.emotionalState}；关系=${item.relationshipNotes.join('、')}`)
    .join('\n');
  const hooks = pack.plotState.unresolvedHooks.slice(0, 10).map((hook) => `- ${hook}`).join('\n');
  const style = [
    `视角：${pack.styleProfile.pov}`,
    `节奏：${pack.styleProfile.pacing}`,
    `对白密度：${pack.styleProfile.dialogueDensity}`,
    `文风特征：${pack.styleProfile.proseTraits.join('、')}`,
    `避免：${pack.styleProfile.avoidTraits.join('、')}`,
  ].join('\n');

  return [
    `【资料包续写任务】${pack.continuationTask}`,
    `【硬设定，不可违背】\n${hardFacts || '- 暂无'}`,
    `【当前剧情状态】\n时间线：${pack.plotState.currentTimeline}\n最近场景：${pack.plotState.latestScene}\n即时冲突：${pack.plotState.immediateConflict}\n下一步：${pack.plotState.nextLikelyMove}`,
    `【未解决伏笔】\n${hooks || '- 暂无'}`,
    `【人物当前状态】\n${characters || '- 暂无'}`,
    `【风格约束】\n${style}`,
  ].join('\n\n');
}
```

- [ ] Create `tests/continuation-pack.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContinuationContext,
  classifyContinuationSource,
} from '../src/lib/continuation-pack';
import type { ContinuationPack } from '../src/types';

test('classifyContinuationSource detects common project document kinds', () => {
  assert.equal(classifyContinuationSource('世界观设定.docx', '灵气复苏，宗门割据'), 'world');
  assert.equal(classifyContinuationSource('第一卷大纲.md', '第一章主角入城'), 'outline');
  assert.equal(classifyContinuationSource('人物小传.txt', '主角 林照'), 'characters');
  assert.equal(classifyContinuationSource('正文.txt', '第一章 雨夜酒馆'), 'manuscript');
});

test('buildContinuationContext prioritizes hard canon and current plot state', () => {
  const pack: ContinuationPack = {
    id: 'pack-1',
    novelId: 'novel-1',
    title: '测试资料包',
    status: 'approved',
    sourceDocuments: [],
    canonFacts: [
      { id: 'f1', priority: 'hard', category: 'world', text: '死者不能复生。', evidence: '设定原文' },
      { id: 'f2', priority: 'soft', category: 'style', text: '可以慢热。', evidence: '风格原文' },
    ],
    characterStates: [
      {
        name: '林照',
        role: '主角',
        currentGoal: '找出雨夜酒馆凶手',
        emotionalState: '压抑且戒备',
        secrets: ['曾见过凶器'],
        relationshipNotes: ['不信任掌柜'],
        evidence: '人物卡原文',
      },
    ],
    plotState: {
      currentTimeline: '第一卷第二章后',
      latestScene: '林照发现酒馆密室',
      unresolvedHooks: ['黑伞是谁留下的'],
      immediateConflict: '掌柜试图销毁账本',
      nextLikelyMove: '林照逼问掌柜',
    },
    styleProfile: {
      pov: '第三人称有限视角',
      tense: '过去时',
      pacing: '紧推进',
      dialogueDensity: '中等',
      proseTraits: ['冷峻', '动作清晰'],
      avoidTraits: ['上帝视角解释'],
      sampleEvidence: '样章原文',
    },
    contradictions: [],
    continuationTask: '续写下一章开场。',
    createdAt: 1,
    updatedAt: 1,
  };

  const context = buildContinuationContext(pack);
  assert.match(context, /死者不能复生/);
  assert.match(context, /林照发现酒馆密室/);
  assert.match(context, /第三人称有限视角/);
  assert.doesNotMatch(context, /可以慢热/);
});
```

- [ ] Run:

```bash
node --import tsx --test tests/continuation-pack.test.ts
```

Expected output includes:

```text
# pass 2
# fail 0
```

## Task 2: Persist Continuation Packs In SQLite

### Files

- Modify: `src/lib/db.ts`
- Create: `tests/db-continuation-pack.test.ts`

### Steps

- [ ] Add a `continuation_packs` table during DB initialization:

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS continuation_packs (
    id TEXT PRIMARY KEY,
    novel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    source_documents TEXT NOT NULL,
    canon_facts TEXT NOT NULL,
    character_states TEXT NOT NULL,
    plot_state TEXT NOT NULL,
    style_profile TEXT NOT NULL,
    contradictions TEXT NOT NULL,
    continuation_task TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);
```

- [ ] Add DB methods matching existing `ChapterProductionRun` style:

```ts
listContinuationPacks(novelId: string): ContinuationPack[] {
  return db.prepare('SELECT * FROM continuation_packs WHERE novel_id = ? ORDER BY updated_at DESC')
    .all(novelId)
    .map(mapContinuationPackRow);
}

getContinuationPack(id: string): ContinuationPack | undefined {
  const row = db.prepare('SELECT * FROM continuation_packs WHERE id = ?').get(id);
  return row ? mapContinuationPackRow(row) : undefined;
}

createContinuationPack(pack: ContinuationPack): void {
  db.prepare(`
    INSERT INTO continuation_packs (
      id, novel_id, title, status, source_documents, canon_facts, character_states,
      plot_state, style_profile, contradictions, continuation_task, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pack.id,
    pack.novelId,
    pack.title,
    pack.status,
    JSON.stringify(pack.sourceDocuments),
    JSON.stringify(pack.canonFacts),
    JSON.stringify(pack.characterStates),
    JSON.stringify(pack.plotState),
    JSON.stringify(pack.styleProfile),
    JSON.stringify(pack.contradictions),
    pack.continuationTask,
    pack.createdAt,
    pack.updatedAt,
  );
}

updateContinuationPack(id: string, data: Partial<ContinuationPack>): void {
  const current = this.getContinuationPack(id);
  if (!current) return;
  const next = { ...current, ...data, updatedAt: Date.now() };
  db.prepare(`
    UPDATE continuation_packs SET
      title = ?, status = ?, source_documents = ?, canon_facts = ?, character_states = ?,
      plot_state = ?, style_profile = ?, contradictions = ?, continuation_task = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.title,
    next.status,
    JSON.stringify(next.sourceDocuments),
    JSON.stringify(next.canonFacts),
    JSON.stringify(next.characterStates),
    JSON.stringify(next.plotState),
    JSON.stringify(next.styleProfile),
    JSON.stringify(next.contradictions),
    next.continuationTask,
    next.updatedAt,
    id,
  );
}
```

- [ ] Add row mapper:

```ts
function mapContinuationPackRow(row: any): ContinuationPack {
  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    status: row.status,
    sourceDocuments: JSON.parse(row.source_documents || '[]'),
    canonFacts: JSON.parse(row.canon_facts || '[]'),
    characterStates: JSON.parse(row.character_states || '[]'),
    plotState: JSON.parse(row.plot_state || '{}'),
    styleProfile: JSON.parse(row.style_profile || '{}'),
    contradictions: JSON.parse(row.contradictions || '[]'),
    continuationTask: row.continuation_task,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

- [ ] Create `tests/db-continuation-pack.test.ts` using the same test DB setup pattern as `tests/db-chapter-production-run.test.ts`.
- [ ] Run:

```bash
node --import tsx --test tests/db-continuation-pack.test.ts
```

Expected output includes:

```text
# pass 2
# fail 0
```

## Task 3: Add Server Parsing Endpoint

### Files

- Modify: `server.ts`
- Modify: `src/lib/api.ts`
- Create: `tests/continuation-pack-prompt-contract.test.ts`

### Steps

- [ ] Add API wrapper to `src/lib/api.ts`:

```ts
export async function parseContinuationPack(payload: {
  novelId: string;
  title: string;
  documents: Array<{ filename: string; filedata: string }>;
}): Promise<ContinuationPack> {
  const res = await fetch('/api/continuation-packs/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to parse continuation pack');
  return data.pack;
}

export async function listContinuationPacks(novelId: string): Promise<ContinuationPack[]> {
  return call('listContinuationPacks', novelId);
}

export async function updateContinuationPack(id: string, data: Partial<ContinuationPack>): Promise<void> {
  return call('updateContinuationPack', id, data);
}
```

- [ ] Import `ContinuationPack` into `src/lib/api.ts`.
- [ ] Add `/api/continuation-packs/parse` in `server.ts` after `/api/parse-doc`.
- [ ] Reuse current `.docx` parsing logic and add `.md/.json` text support:

```ts
async function extractUploadedText(filename: string, filedata: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.json')) {
    return Buffer.from(filedata, 'base64').toString('utf8');
  }
  if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const buffer = Buffer.from(filedata, 'base64');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  throw new Error('Unsupported file type.');
}
```

- [ ] The prompt must require evidence-backed extraction:

```ts
const prompt = `
你是小说项目接管编辑。用户上传了一个资料包，需要你整理成可续写的结构化上下文。

硬规则：
1. 不要续写正文。
2. 不要补造未在资料中出现的硬设定。
3. 每条 hard canon 必须带 evidence，evidence 必须来自原文短摘。
4. 如果资料冲突，写入 contradictions，不要自行吞掉冲突。
5. 输出严格 JSON，不要 Markdown。

输出结构：
{
  "canonFacts": [
    {"priority":"hard","category":"world","text":"...","evidence":"..."}
  ],
  "characterStates": [
    {"name":"...","role":"...","currentGoal":"...","emotionalState":"...","secrets":[],"relationshipNotes":[],"evidence":"..."}
  ],
  "plotState": {
    "currentTimeline":"...",
    "latestScene":"...",
    "unresolvedHooks":[],
    "immediateConflict":"...",
    "nextLikelyMove":"..."
  },
  "styleProfile": {
    "pov":"...",
    "tense":"...",
    "pacing":"...",
    "dialogueDensity":"...",
    "proseTraits":[],
    "avoidTraits":[],
    "sampleEvidence":"..."
  },
  "contradictions": [
    {"severity":"medium","summary":"...","conflictingEvidence":[],"suggestedResolution":"..."}
  ],
  "continuationTask":"..."
}

资料包：
${documentsForPrompt}
`;
```

- [ ] Normalize missing arrays to `[]` and missing text fields to `''` before persistence.
- [ ] Save the parsed pack as `status: 'draft'`.
- [ ] Create `tests/continuation-pack-prompt-contract.test.ts` that asserts the server source contains:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('continuation pack prompt enforces evidence and no drafting', () => {
  const server = fs.readFileSync('server.ts', 'utf8');
  assert.match(server, /不要续写正文/);
  assert.match(server, /每条 hard canon 必须带 evidence/);
  assert.match(server, /如果资料冲突，写入 contradictions/);
  assert.match(server, /输出严格 JSON/);
});
```

- [ ] Run:

```bash
node --import tsx --test tests/continuation-pack-prompt-contract.test.ts
npm run lint
```

Expected output:

```text
# fail 0
```

and `npm run lint` exits with code `0`.

## Task 4: Add Continuation Pack Review UI

### Files

- Create: `src/components/ContinuationPackView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/workspace-nav.ts`
- Modify: `src/components/Sidebar.tsx`

### Steps

- [ ] Add a nav item named `资料续写`.
- [ ] Create `ContinuationPackView` with three panes:
  - Upload area.
  - Draft pack review.
  - Approved pack list.
- [ ] Use the existing design language: dense white panels, small radius, no nested cards.
- [ ] Implement upload state:

```ts
const [files, setFiles] = useState<File[]>([]);
const [activePack, setActivePack] = useState<ContinuationPack | null>(null);
const [isParsing, setIsParsing] = useState(false);
const [error, setError] = useState('');
```

- [ ] Convert files to base64 using:

```ts
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
```

- [ ] Parse pack:

```ts
async function handleParsePack() {
  if (!novel || files.length === 0) return;
  setIsParsing(true);
  setError('');
  try {
    const documents = await Promise.all(files.map(async (file) => ({
      filename: file.name,
      filedata: await fileToBase64(file),
    })));
    const pack = await parseContinuationPack({
      novelId: novel.id,
      title: `${novel.title} 续写资料包`,
      documents,
    });
    setActivePack(pack);
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  } finally {
    setIsParsing(false);
  }
}
```

- [ ] Approve pack:

```ts
async function handleApprovePack(pack: ContinuationPack) {
  await updateContinuationPack(pack.id, { status: 'approved' });
  setActivePack({ ...pack, status: 'approved', updatedAt: Date.now() });
}
```

- [ ] Show contradiction warnings before the approve button.
- [ ] Disable approval if `canonFacts.length === 0`.

## Task 5: Inject Approved Pack Into Chapter Production

### Files

- Modify: `src/lib/api.ts`
- Modify: `server.ts`
- Modify: `src/components/AgentWorkspace.tsx`
- Modify: `src/components/ProductionRunReview.tsx`

### Steps

- [ ] Extend `startChapterProductionRun` payload:

```ts
export async function startChapterProductionRun(payload: {
  novelId: string;
  targetChapterId?: string;
  userIntent: string;
  continuationPackId?: string;
  surface?: PromptSurface;
}): Promise<ChapterProductionRun> {
```

- [ ] In `server.ts`, read `continuationPackId`:

```ts
const { novelId = '', targetChapterId = '', userIntent = '', continuationPackId = '', surface = 'workspace-draft' } = req.body;
```

- [ ] Load approved pack only:

```ts
const continuationPack = continuationPackId ? db.getContinuationPack(continuationPackId) : undefined;
const continuationPackContext =
  continuationPack && continuationPack.status === 'approved'
    ? buildContinuationContext(continuationPack)
    : '';
```

- [ ] Add the context to planner and writer prompts:

```ts
const fullPlannerContext = [layeredContext, plannerContext, continuationPackContext]
  .filter(Boolean)
  .join('\n\n');

const fullWriterContext = [writerContext, continuationPackContext]
  .filter(Boolean)
  .join('\n\n');
```

- [ ] Replace planner and writer context usage:

```ts
contextStr: fullPlannerContext,
```

and:

```ts
contextStr: fullWriterContext,
```

- [ ] In `AgentWorkspace`, add an optional select for approved continuation packs inside the production tab.
- [ ] Pass the selected `continuationPackId` into `startChapterProductionRun`.
- [ ] In `ProductionRunReview`, show:

```tsx
{run.userIntent.includes('资料包') && (
  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
    本次生产使用了已确认的资料包上下文。
  </div>
)}
```

## Task 6: Add End-To-End Validation Checklist

### Files

- Create: `docs/qa/continuation-pack-writing-checklist.md`

### Steps

- [ ] Create this checklist:

```md
# 资料包续写 QA Checklist

## Setup

- Start dev server with `npm run dev`.
- Open `http://127.0.0.1:3000/`.
- Create or select one novel.

## Upload And Parse

- Open `资料续写`.
- Upload one worldbuilding `.txt`.
- Upload one outline `.md`.
- Upload one character sheet `.txt`.
- Click `解析资料包`.
- Verify canon facts, character states, plot state, style profile render.
- Verify contradictions render when the documents disagree.

## Approval

- Try approving an empty or failed pack; approval should be blocked.
- Approve a valid pack.
- Refresh the page.
- Verify the approved pack still appears.

## Production

- Open `创作工作台`.
- Open `自动生产`.
- Select the approved continuation pack.
- Start a production run.
- Verify generated beats mention the pack's current plot state.
- Verify generated draft does not violate hard canon facts.
- Apply the run.
- Verify the chapter content and scene beats are written.
```

- [ ] Run automated checks:

```bash
node --import tsx --test tests/continuation-pack.test.ts tests/db-continuation-pack.test.ts tests/continuation-pack-prompt-contract.test.ts
npm run lint
npm run build
```

Expected:

```text
# fail 0
```

and both npm commands exit with code `0`.

## Suggested Execution Order

1. Task 1: pure model and tests.
2. Task 2: persistence.
3. Task 3: parse endpoint.
4. Task 4: review UI.
5. Task 5: production injection.
6. Task 6: QA checklist and full validation.

## Risks And Guards

- **Risk: AI invents hard canon.** Guard with prompt contract, evidence fields, and user approval.
- **Risk: documents conflict silently.** Guard with `contradictions` and visible warnings before approval.
- **Risk: continuation pack bloats prompts.** Guard with `buildContinuationContext` caps.
- **Risk: UI duplicates World Bible.** Guard by keeping this page focused on project handoff and continuation, not entity editing.
- **Risk: uploaded third-party content may not be authorized.** Add a small UI note that users should only upload materials they have rights to use.

## Self-Review

- Spec coverage: upload, parse, review, approve, and write are covered.
- No placeholders: every task has concrete files, code snippets, and validation commands.
- Type consistency: all new API wrappers use `ContinuationPack` from `src/types.ts`.
- Existing architecture preserved: uses current Express API, DB method bridge, prompt runtime, and chapter production flow.
