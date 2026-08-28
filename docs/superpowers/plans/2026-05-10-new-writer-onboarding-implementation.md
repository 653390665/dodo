# New Writer Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 为 InkFlow 增加面向 `AI 协同新手` 的起步主线：从灵感对话生成故事方案卡，选中后落库为新作品，并进入带引导壳层的设定记忆页，再放行到创作舞台。
**Architecture:** 先抽离一层纯函数 onboarding 模型，锁定故事方案卡、设定任务卡和 Skill 推荐逻辑；再补服务端生成故事方案卡和设定草稿的接口，并接入现有 prompt template 体系；最后改造 `App`、`AIAssistant` 和 `WorldBibleView`，把“灵感聊天工具”升级为默认新作品入口，并用一层 onboarding shell 包住现有设定页。
**Tech Stack:** React 19, TypeScript, Express, better-sqlite3, node:test, tsx, motion/react, lucide-react

## Scope Guard

本计划只覆盖 `新手起步主线`。

包含：

- `灵感对话 -> 故事方案卡`
- 方案卡落库为 `Novel + Chapter + 初始 Character 草稿`
- 新手引导型设定记忆壳层
- 基于方案卡的 `3 张 Skill` 规则推荐

不包含：

- 创作舞台协作副驾重构（已在 [2026-05-10-copilot-stage-redesign.md](/Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/plans/2026-05-10-copilot-stage-redesign.md:1)）
- 拆书工厂结果页动作链
- Skill 仓库版本化 / 试驾 / 权重进化（已在 [2026-05-07-skill-composition-implementation.md](/Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/plans/2026-05-07-skill-composition-implementation.md:1)）

## Existing Anchors

实现前先认清当前代码锚点，避免走偏：

- `src/App.tsx`
  - 当前 `handleCreateNovelFromIdea()` 直接创建标题为 `灵感新作` 的作品并进入 `EditorView`
- `src/components/AIAssistant.tsx`
  - 当前是通用灵感聊天 UI，支持 `提取设定 / 保存到作品 / 转新作品`
- `src/components/WorldBibleView.tsx`
  - 当前已有完整设定后台：全局设定、角色、地点、物品、势力、力量体系、时间线
- `src/config/prompt-templates.ts`
  - 当前模板体系已支持设置页编辑与 `/api/prompt-template-test`
- `src/lib/api.ts`
  - 当前 DB CRUD 通过 `/api/db`
  - AI 端点是显式 `/api/...`

## Task 1: 抽离 onboarding 纯函数模型和失败测试

**Files:**
- Create: `src/lib/onboarding-model.ts`
- Modify: `src/types.ts`
- Test: `tests/onboarding-model.test.ts`

- [ ] **Step 1: 先写失败测试，锁定故事方案卡、设定任务卡和 Skill 推荐行为**

Create `tests/onboarding-model.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSetupTasksFromStoryCard,
  countCompletedSetupTasks,
  recommendSkillsForStoryCard,
  type StoryCardSkillSignal,
} from '../src/lib/onboarding-model';
import type { Skill, StoryIdeaCard } from '../src/types';

function makeCard(overrides: Partial<StoryIdeaCard> = {}): StoryIdeaCard {
  return {
    id: 'card-1',
    hook: '雨夜刀客误拿玄铁令，被各方势力逼入死局。',
    protagonist: '一个寡言、克制、总在后发制人的年轻刀客。',
    coreConflict: '主角必须在洗清嫌疑和守住令牌之间做选择。',
    tone: '冷峻、悬疑、压迫感强',
    whyItWorks: '开篇就有危机，人物目标和外部追杀同时成立。',
    starterSeeds: {
      worldSeed: '江湖势力围绕玄铁令争斗，刀法讲究时机与代价。',
      relationshipSeed: '主角与酒馆掌柜表面试探、实则互相钓话。',
      chapterOneSeed: '第一章从雨夜入酒馆开始，以门外靴声逼近收尾。',
    },
    riskNote: '如果先把令牌秘密说穿，悬疑感会塌。',
    mixTags: ['rain-night', 'martial', 'suspense'],
    signals: {
      tone: 'grim',
      conflictType: 'survival-mystery',
      worldWeight: 0.82,
      characterWeight: 0.68,
      pacingPreference: 'tight',
    },
    ...overrides,
  };
}

function makeSkill(partial: Partial<Skill> & Pick<Skill, 'id' | 'name'>): Skill {
  return {
    id: partial.id,
    name: partial.name,
    description: '',
    style: '',
    pacing: '',
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 1,
    createdAt: 1,
    primaryDimension: 'style',
    dimensionTags: ['style'],
    compositionProfile: {
      styleWeight: 0.5,
      characterWeight: 0.5,
      worldWeight: 0.5,
      powerWeight: 0.5,
      plotWeight: 0.5,
      pacingWeight: 0.5,
      conflictTags: [],
      blendHints: [],
    },
    ...partial,
  };
}

test('buildSetupTasksFromStoryCard seeds six onboarding tasks from one card', () => {
  const tasks = buildSetupTasksFromStoryCard(makeCard());
  assert.equal(tasks.length, 6);
  assert.equal(tasks[0].key, 'protagonist');
  assert.equal(tasks[0].status, 'drafted');
  assert.equal(tasks[2].key, 'world-rules');
  assert.equal(tasks[4].key, 'chapter-one');
});

test('countCompletedSetupTasks only counts confirmed tasks', () => {
  const tasks = buildSetupTasksFromStoryCard(makeCard());
  tasks[0].status = 'confirmed';
  tasks[1].status = 'confirmed';
  tasks[2].status = 'drafted';
  assert.equal(countCompletedSetupTasks(tasks), 2);
});

test('recommendSkillsForStoryCard returns top three ranked skills with reasons', () => {
  const card = makeCard();
  const skills = [
    makeSkill({
      id: 'style-1',
      name: '冷峻刀锋',
      primaryDimension: 'style',
      dimensionTags: ['style', 'plot'],
      compositionProfile: {
        styleWeight: 0.92,
        characterWeight: 0.2,
        worldWeight: 0.1,
        powerWeight: 0.1,
        plotWeight: 0.6,
        pacingWeight: 0.75,
        conflictTags: [],
        blendHints: ['grim'],
      },
    }),
    makeSkill({
      id: 'world-1',
      name: '铁血江湖',
      primaryDimension: 'world',
      dimensionTags: ['world', 'power'],
      compositionProfile: {
        styleWeight: 0.1,
        characterWeight: 0.1,
        worldWeight: 0.88,
        powerWeight: 0.8,
        plotWeight: 0.4,
        pacingWeight: 0.3,
        conflictTags: [],
        blendHints: ['martial'],
      },
    }),
    makeSkill({
      id: 'char-1',
      name: '压抑型对峙',
      primaryDimension: 'character',
      dimensionTags: ['character', 'plot'],
      compositionProfile: {
        styleWeight: 0.2,
        characterWeight: 0.85,
        worldWeight: 0.1,
        powerWeight: 0.1,
        plotWeight: 0.78,
        pacingWeight: 0.6,
        conflictTags: [],
        blendHints: ['suspense'],
      },
    }),
    makeSkill({
      id: 'slow-1',
      name: '散文化慢节奏',
      primaryDimension: 'pacing',
      dimensionTags: ['pacing'],
      compositionProfile: {
        styleWeight: 0.4,
        characterWeight: 0.2,
        worldWeight: 0.1,
        powerWeight: 0.1,
        plotWeight: 0.2,
        pacingWeight: 0.2,
        conflictTags: [],
        blendHints: ['lyrical'],
      },
    }),
  ];

  const ranked = recommendSkillsForStoryCard(card, skills);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].skillId, 'style-1');
  assert.equal(ranked.every((entry) => entry.reason.length > 0), true);
});
```

- [ ] **Step 2: 运行测试，确认模块尚未存在**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/onboarding-model.test.ts
```

Expected:

```text
not ok ... ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: 扩展 `src/types.ts`，加入 onboarding 领域类型**

Append after existing `ViewType`-adjacent types:

```ts
export interface StoryCardStarterSeeds {
  worldSeed: string;
  relationshipSeed: string;
  chapterOneSeed: string;
}

export interface StoryCardSkillSignal {
  tone: string;
  conflictType: string;
  worldWeight: number;
  characterWeight: number;
  pacingPreference: 'tight' | 'balanced' | 'slow-burn';
}

export interface StoryIdeaCard {
  id: string;
  hook: string;
  protagonist: string;
  coreConflict: string;
  tone: string;
  whyItWorks: string;
  starterSeeds: StoryCardStarterSeeds;
  riskNote: string;
  mixTags: string[];
  signals: StoryCardSkillSignal;
}

export type SetupTaskKey =
  | 'protagonist'
  | 'core-conflict'
  | 'world-rules'
  | 'relationship'
  | 'chapter-one'
  | 'tone';

export type SetupTaskStatus = 'empty' | 'drafted' | 'confirmed' | 'needs-work';

export interface SetupTaskDraft {
  key: SetupTaskKey;
  title: string;
  summary: string;
  status: SetupTaskStatus;
  source: 'story-card' | 'ai-refine' | 'user-edit';
}

export interface StorySkillRecommendation {
  skillId: string;
  score: number;
  reason: string;
}

export interface OnboardingDraftState {
  ideaSeed: string;
  cards: StoryIdeaCard[];
  selectedCardId?: string;
  setupTasks: SetupTaskDraft[];
  acceptedSkillIds: string[];
}
```

- [ ] **Step 4: 实现 `src/lib/onboarding-model.ts` 最小纯函数**

Create `src/lib/onboarding-model.ts`:

```ts
import type {
  SetupTaskDraft,
  Skill,
  StoryIdeaCard,
  StorySkillRecommendation,
} from '../types';

const TASK_META: Array<{ key: SetupTaskDraft['key']; title: string; pick: (card: StoryIdeaCard) => string }> = [
  { key: 'protagonist', title: '主角是谁', pick: (card) => card.protagonist },
  { key: 'core-conflict', title: '核心冲突', pick: (card) => card.coreConflict },
  { key: 'world-rules', title: '世界规则 / 故事背景', pick: (card) => card.starterSeeds.worldSeed },
  { key: 'relationship', title: '关键关系', pick: (card) => card.starterSeeds.relationshipSeed },
  { key: 'chapter-one', title: '第一章起点', pick: (card) => card.starterSeeds.chapterOneSeed },
  { key: 'tone', title: '风格与读感', pick: (card) => card.tone },
];

export function buildSetupTasksFromStoryCard(card: StoryIdeaCard): SetupTaskDraft[] {
  return TASK_META.map((meta) => ({
    key: meta.key,
    title: meta.title,
    summary: meta.pick(card),
    status: meta.pick(card).trim() ? 'drafted' : 'empty',
    source: 'story-card',
  }));
}

export function countCompletedSetupTasks(tasks: SetupTaskDraft[]): number {
  return tasks.filter((task) => task.status === 'confirmed').length;
}

function paceWeight(preference: StoryIdeaCard['signals']['pacingPreference']) {
  if (preference === 'tight') return 0.85;
  if (preference === 'slow-burn') return 0.3;
  return 0.55;
}

export function recommendSkillsForStoryCard(
  card: StoryIdeaCard,
  skills: Skill[],
): StorySkillRecommendation[] {
  return skills
    .map((skill) => {
      const profile = skill.compositionProfile;
      if (!profile) {
        return {
          skillId: skill.id,
          score: 0,
          reason: `${skill.name} 缺少维度画像，无法稳定匹配当前故事方案。`,
        };
      }

      const score =
        profile.styleWeight * 100 +
        profile.plotWeight * 45 +
        profile.worldWeight * card.signals.worldWeight * 100 +
        profile.characterWeight * card.signals.characterWeight * 100 +
        profile.pacingWeight * paceWeight(card.signals.pacingPreference) * 100;

      const reasonBits: string[] = [];
      if ((skill.dimensionTags || []).includes('style')) reasonBits.push('能贴合当前故事气质');
      if ((skill.dimensionTags || []).includes('world') && card.signals.worldWeight >= 0.6) reasonBits.push('能补强世界规则表达');
      if ((skill.dimensionTags || []).includes('character') && card.signals.characterWeight >= 0.6) reasonBits.push('能强化人物对峙感');
      if ((skill.dimensionTags || []).includes('plot')) reasonBits.push('能承接当前冲突推进');
      if ((skill.dimensionTags || []).includes('pacing') && card.signals.pacingPreference === 'tight') reasonBits.push('适合紧张推进节奏');

      return {
        skillId: skill.id,
        score,
        reason: reasonBits[0] || '与当前方案维度画像较为接近。',
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
```

- [ ] **Step 5: 重新跑测试并确认通过**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/onboarding-model.test.ts
```

Expected:

```text
# tests 3
# pass 3
```

## Task 2: 补 Prompt 模板和服务端故事方案卡接口

**Files:**
- Modify: `src/config/prompt-templates.ts`
- Modify: `server.ts`
- Modify: `src/lib/api.ts`
- Test: `tests/onboarding-api-shape.test.ts`

- [ ] **Step 1: 先写失败测试，锁定服务端返回结构清洗函数**

Create `tests/onboarding-api-shape.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoryCardsResponse } from '../src/lib/onboarding-model';

test('normalizeStoryCardsResponse unwraps cards array from JSON payload', () => {
  const cards = normalizeStoryCardsResponse(`
  {
    "cards": [
      {
        "id": "c1",
        "hook": "一句话卖点",
        "protagonist": "主角设定",
        "coreConflict": "核心冲突",
        "tone": "冷峻悬疑",
        "whyItWorks": "有钩子",
        "starterSeeds": {
          "worldSeed": "世界种子",
          "relationshipSeed": "关系种子",
          "chapterOneSeed": "第一章种子"
        },
        "riskNote": "风险",
        "mixTags": ["x"],
        "signals": {
          "tone": "grim",
          "conflictType": "survival-mystery",
          "worldWeight": 0.7,
          "characterWeight": 0.6,
          "pacingPreference": "tight"
        }
      }
    ]
  }
  `);

  assert.equal(cards.length, 1);
  assert.equal(cards[0].starterSeeds.chapterOneSeed, '第一章种子');
});
```

- [ ] **Step 2: 跑测试，确认缺少 `normalizeStoryCardsResponse`**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/onboarding-api-shape.test.ts
```

Expected:

```text
not ok ... missing export 'normalizeStoryCardsResponse'
```

- [ ] **Step 3: 扩展 prompt template key，新增故事方案卡与设定细化模板**

Update `src/config/prompt-templates.ts`:

```ts
export type PromptTemplateKey =
  | 'inspirationSystem'
  | 'storyCards'
  | 'setupTaskRefine'
  | 'editorAgent'
  | 'manualAudit'
  | 'orchestrateWriter'
  | 'orchestrateCritic'
  | 'extractSkill'
  | 'generateOutline';
```

Add template definitions:

```ts
{
  key: 'storyCards',
  label: '故事方案卡',
  description: '根据灵感对话结果生成 3 张可选故事方案卡。',
  variables: ['ideaSeed', 'chatContext'],
},
{
  key: 'setupTaskRefine',
  label: '设定项细化',
  description: '围绕单个设定任务继续细化草稿。',
  variables: ['taskTitle', 'currentDraft', 'userRequest', 'storyContext'],
},
```

Add default templates:

```ts
storyCards: `
你是一个资深网文策划编辑。请根据用户的灵感种子和上下文，生成 3 张差异明确、可继续写的故事方案卡。

【灵感种子】
{{ideaSeed}}

【对话上下文】
{{chatContext}}

请严格输出 JSON：
{
  "cards": [
    {
      "id": "card-1",
      "hook": "一句话卖点",
      "protagonist": "主角设定摘要",
      "coreConflict": "核心冲突",
      "tone": "故事气质 / 文风",
      "whyItWorks": "为什么值得写",
      "starterSeeds": {
        "worldSeed": "世界观或背景种子",
        "relationshipSeed": "关键关系种子",
        "chapterOneSeed": "第一章起点种子"
      },
      "riskNote": "最容易写崩的点",
      "mixTags": ["标签1", "标签2"],
      "signals": {
        "tone": "grim | bright | lyrical | sharp",
        "conflictType": "冲突类型短语",
        "worldWeight": 0-1,
        "characterWeight": 0-1,
        "pacingPreference": "tight | balanced | slow-burn"
      }
    }
  ]
}

要求：
1. 三张卡必须方向不同，不能只是换同义词。
2. 不要输出正文片段，不要写成大段散文。
3. 每张卡都必须能直接映射到设定记忆页。
`.trim(),
setupTaskRefine: `
你是一个小说设定协作助手。你的任务不是重写整部小说，而是围绕某一个设定项给出更稳、更清晰、更可继续创作的版本。

【当前设定项】
{{taskTitle}}

【当前草稿】
{{currentDraft}}

【故事上下文】
{{storyContext}}

【用户希望修改的方向】
{{userRequest}}

请输出一个 120-220 字的改写结果，要求：
1. 保持可直接写入设定记忆页。
2. 不要写成问答，不要写成大纲符号列表。
3. 优先补足动机、限制、关系、后果。
`.trim(),
```

- [ ] **Step 4: 在 `src/lib/onboarding-model.ts` 中补清洗函数**

Append:

```ts
export function normalizeStoryCardsResponse(raw: string): StoryIdeaCard[] {
  const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : Array.isArray(parsed) ? parsed : [];
  return cards;
}
```

- [ ] **Step 5: 在 `server.ts` 新增故事方案卡和设定细化接口**

Add routes after `/api/inspiration`:

```ts
  app.post('/api/story-cards', async (req, res) => {
    try {
      const { ideaSeed = '', chatContext = '' } = req.body;
      if (!ideaSeed.trim()) {
        return res.status(400).json({ error: 'ideaSeed is required' });
      }
      const prompt = renderPromptTemplate(getPromptTemplate('storyCards'), {
        ideaSeed,
        chatContext,
      });
      let raw = await generateText(getConfig(), { prompt });
      raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(raw);
      res.json({ cards: Array.isArray(parsed?.cards) ? parsed.cards : [] });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/setup-task-refine', async (req, res) => {
    try {
      const { taskTitle = '', currentDraft = '', userRequest = '', storyContext = '' } = req.body;
      if (!taskTitle.trim()) {
        return res.status(400).json({ error: 'taskTitle is required' });
      }
      const prompt = renderPromptTemplate(getPromptTemplate('setupTaskRefine'), {
        taskTitle,
        currentDraft,
        userRequest,
        storyContext,
      });
      const text = await generateText(getConfig(), { prompt });
      res.json({ text });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });
```

- [ ] **Step 6: 在 `src/lib/api.ts` 暴露新客户端方法**

Append:

```ts
import type { StoryIdeaCard } from '../types';

export async function generateStoryCards(payload: {
  ideaSeed: string;
  chatContext: string;
}): Promise<StoryIdeaCard[]> {
  const res = await fetch('/api/story-cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to generate story cards');
  return data.cards;
}

export async function refineSetupTask(payload: {
  taskTitle: string;
  currentDraft: string;
  userRequest: string;
  storyContext: string;
}): Promise<string> {
  const res = await fetch('/api/setup-task-refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to refine setup task');
  return data.text;
}
```

- [ ] **Step 7: 跑新增测试和类型检查**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/onboarding-api-shape.test.ts
npm run lint
```

Expected:

```text
# pass 1
```

and

```text
Found 0 errors.
```

## Task 3: 新建 onboarding 组件并把 AIAssistant 升级为主入口

**Files:**
- Create: `src/components/onboarding/StoryCardDeck.tsx`
- Create: `src/components/onboarding/StoryCardPreview.tsx`
- Modify: `src/components/AIAssistant.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 改 `AIAssistant` props，支持“生成故事方案卡”而不是直接创建作品**

Update props:

```ts
interface AIAssistantProps {
  onCreateDraft?: (payload: { ideaSeed: string; chatContext: string }) => void;
}
```

Replace old usage:

```ts
export function AIAssistant({ onCreateDraft }: AIAssistantProps = {}) {
```

Replace CTA button:

```tsx
{onCreateDraft && (
  <button
    onClick={() =>
      onCreateDraft({
        ideaSeed: msg.content,
        chatContext: messages.map((entry) => `${entry.role}: ${entry.content}`).join('\n\n'),
      })
    }
    className="inline-flex items-center gap-2 rounded-full border border-theme-border/60 bg-theme-sidebar/20 px-3 py-2 text-xs font-bold text-theme-muted transition-colors hover:border-theme-accent hover:text-theme-accent"
    title="基于这段灵感生成故事方案卡"
  >
    <BookPlus size={14} />
    生成故事方案卡
  </button>
)}
```

- [ ] **Step 2: 创建故事方案卡组件**

Create `src/components/onboarding/StoryCardPreview.tsx`:

```tsx
import type { StoryIdeaCard } from '../../types';

export function StoryCardPreview({
  card,
  selected,
  onSelect,
  onMix,
}: {
  card: StoryIdeaCard;
  selected: boolean;
  onSelect: () => void;
  onMix: () => void;
}) {
  return (
    <article className={`rounded-3xl border p-5 shadow-sm ${selected ? 'border-theme-accent bg-theme-sidebar/20' : 'border-theme-border bg-white'}`}>
      <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">故事方案</div>
      <h3 className="text-lg font-serif font-bold text-theme-text mb-3">{card.hook}</h3>
      <div className="space-y-3 text-sm text-theme-text">
        <p><span className="font-bold">主角</span> {card.protagonist}</p>
        <p><span className="font-bold">冲突</span> {card.coreConflict}</p>
        <p><span className="font-bold">气质</span> {card.tone}</p>
        <p className="text-theme-muted">{card.whyItWorks}</p>
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={onSelect} className="rounded-full bg-theme-accent px-4 py-2 text-xs font-bold text-white">
          选这个
        </button>
        <button onClick={onMix} className="rounded-full border border-theme-border px-4 py-2 text-xs font-bold text-theme-text">
          拿来混搭
        </button>
      </div>
    </article>
  );
}
```

Create `src/components/onboarding/StoryCardDeck.tsx`:

```tsx
import type { StoryIdeaCard } from '../../types';
import { StoryCardPreview } from './StoryCardPreview';

export function StoryCardDeck({
  cards,
  selectedCardId,
  onSelectCard,
  onMixCard,
  onRefreshBatch,
}: {
  cards: StoryIdeaCard[];
  selectedCardId?: string;
  onSelectCard: (card: StoryIdeaCard) => void;
  onMixCard: (card: StoryIdeaCard) => void;
  onRefreshBatch: () => void;
}) {
  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-serif font-bold text-theme-text">故事方案卡</h2>
          <p className="text-sm text-theme-muted">先选方向，再进入设定记忆立骨架。</p>
        </div>
        <button onClick={onRefreshBatch} className="rounded-full border border-theme-border px-4 py-2 text-xs font-bold text-theme-text">
          继续刷一批
        </button>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {cards.map((card) => (
          <StoryCardPreview
            key={card.id}
            card={card}
            selected={card.id === selectedCardId}
            onSelect={() => onSelectCard(card)}
            onMix={() => onMixCard(card)}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: 在 `App.tsx` 增加 onboarding 视图和草稿状态**

Update imports:

```ts
import { generateStoryCards, createNovel, createChapter, createCharacter, listSkills } from './lib/api';
import { StoryCardDeck } from './components/onboarding/StoryCardDeck';
import { buildSetupTasksFromStoryCard, recommendSkillsForStoryCard } from './lib/onboarding-model';
import type { OnboardingDraftState, StoryIdeaCard } from './types';
```

Add state:

```ts
const [onboardingDraft, setOnboardingDraft] = useState<OnboardingDraftState | null>(null);
```

Replace `handleCreateNovelFromIdea` with:

```ts
const handleCreateDraftFromIdea = async ({ ideaSeed, chatContext }: { ideaSeed: string; chatContext: string }) => {
  setLoading(true);
  try {
    const cards = await generateStoryCards({ ideaSeed, chatContext });
    setOnboardingDraft({
      ideaSeed,
      cards,
      setupTasks: [],
      acceptedSkillIds: [],
    });
    setCurrentView('ai');
  } finally {
    setLoading(false);
  }
};
```

Add card selection handler:

```ts
const handleSelectStoryCard = async (card: StoryIdeaCard) => {
  const newNovelId = Date.now().toString();
  const now = Date.now();
  const nextNovel: Novel = {
    id: newNovelId,
    title: card.hook.slice(0, 18) || '新作品',
    authorId: 'local-user',
    summary: `${card.hook}\n\n${card.whyItWorks}`,
    globalOutline: `${card.coreConflict}\n\n${card.starterSeeds.chapterOneSeed}`,
    worldRules: card.starterSeeds.worldSeed,
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    status: 'ongoing',
    createdAt: now,
    updatedAt: now,
  };

  await createNovel(nextNovel);
  await createChapter({
    id: (now + 1).toString(),
    novelId: newNovelId,
    title: '第一章',
    content: '',
    order: 0,
    wordCount: 0,
    sceneBeats: card.starterSeeds.chapterOneSeed,
    volumeName: '默认卷',
    createdAt: now,
    updatedAt: now,
  });

  if (card.protagonist.trim()) {
    await createCharacter({
      id: (now + 2).toString(),
      novelId: newNovelId,
      name: '待命名主角',
      role: 'protagonist',
      summary: card.protagonist,
      traits: [],
      bio: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  const skills = await listSkills();
  const recommended = recommendSkillsForStoryCard(card, skills);

  setSelectedNovel(nextNovel);
  setOnboardingDraft({
    ideaSeed: onboardingDraft?.ideaSeed || card.hook,
    cards: onboardingDraft?.cards || [card],
    selectedCardId: card.id,
    setupTasks: buildSetupTasksFromStoryCard(card),
    acceptedSkillIds: recommended.map((entry) => entry.skillId),
  });
  setCurrentView('world');
};
```

- [ ] **Step 4: 在 `App.tsx` 的 `ai` 视图里切换成“灵感 or 方案卡”**

Replace:

```tsx
{currentView === 'ai' && (
  <AIAssistant onCreateNovel={handleCreateNovelFromIdea} />
)}
```

With:

```tsx
{currentView === 'ai' && !onboardingDraft && (
  <AIAssistant onCreateDraft={handleCreateDraftFromIdea} />
)}
{currentView === 'ai' && onboardingDraft && (
  <div className="h-full overflow-y-auto px-8 py-10 bg-theme-bg/30">
    <StoryCardDeck
      cards={onboardingDraft.cards}
      selectedCardId={onboardingDraft.selectedCardId}
      onSelectCard={handleSelectStoryCard}
      onMixCard={(card) => console.log('mix later', card.id)}
      onRefreshBatch={() => handleCreateDraftFromIdea({ ideaSeed: onboardingDraft.ideaSeed, chatContext: onboardingDraft.ideaSeed })}
    />
  </div>
)}
```

- [ ] **Step 5: 运行类型检查**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

Expected:

```text
Found 0 errors.
```

## Task 4: 给 World Bible 加 onboarding shell 和设定任务协作面板

**Files:**
- Create: `src/components/onboarding/SetupTaskCard.tsx`
- Create: `src/components/onboarding/SetupAssistantPanel.tsx`
- Modify: `src/components/WorldBibleView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建设定任务卡组件**

Create `src/components/onboarding/SetupTaskCard.tsx`:

```tsx
import type { SetupTaskDraft } from '../../types';

export function SetupTaskCard({
  task,
  active,
  onSelect,
  onConfirm,
}: {
  task: SetupTaskDraft;
  active: boolean;
  onSelect: () => void;
  onConfirm: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-3xl border p-4 text-left transition-colors ${active ? 'border-theme-accent bg-theme-sidebar/20' : 'border-theme-border bg-white'}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold text-theme-text">{task.title}</span>
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-theme-muted">{task.status}</span>
      </div>
      <p className="text-sm leading-6 text-theme-muted line-clamp-4">{task.summary || '这项还没有草稿。'}</p>
      <div className="mt-3 flex gap-2">
        <span className="rounded-full border border-theme-border px-3 py-1 text-[11px] font-bold text-theme-text">继续聊这项</span>
        <span
          onClick={(event) => {
            event.stopPropagation();
            onConfirm();
          }}
          className="rounded-full bg-theme-accent px-3 py-1 text-[11px] font-bold text-white"
        >
          确认
        </span>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: 创建右侧设定助手面板**

Create `src/components/onboarding/SetupAssistantPanel.tsx`:

```tsx
import React from 'react';
import type { SetupTaskDraft, StoryIdeaCard } from '../../types';

export function SetupAssistantPanel({
  task,
  card,
  draftInput,
  onDraftInputChange,
  onSubmit,
  isLoading,
}: {
  task?: SetupTaskDraft;
  card?: StoryIdeaCard;
  draftInput: string;
  onDraftInputChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}) {
  return (
    <aside className="w-[360px] shrink-0 border-l border-theme-border/60 bg-white px-5 py-6">
      <div className="mb-4">
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">设定助手</div>
        <h3 className="mt-2 text-xl font-serif font-bold text-theme-text">{task?.title || '先选择一个设定项'}</h3>
        <p className="mt-2 text-sm leading-6 text-theme-muted">
          {task?.summary || card?.hook || '选中左侧任务后，这里会围绕该设定项继续协作。'}
        </p>
      </div>
      <textarea
        value={draftInput}
        onChange={(event) => onDraftInputChange(event.target.value)}
        placeholder="例如：主角别太像套路男主，给他一个更具体的代价。"
        className="min-h-[180px] w-full rounded-3xl border border-theme-border bg-theme-bg/20 px-4 py-3 text-sm outline-none"
      />
      <button
        onClick={onSubmit}
        disabled={!task || !draftInput.trim() || isLoading}
        className="mt-4 w-full rounded-2xl bg-theme-accent px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {isLoading ? 'AI 细化中...' : '让 AI 细化这项'}
      </button>
    </aside>
  );
}
```

- [ ] **Step 3: 修改 `WorldBibleView` props，允许挂 onboarding shell**

Update signature:

```ts
export function WorldBibleView({
  novel,
  onboarding,
}: {
  novel: Novel;
  onboarding?: {
    card?: StoryIdeaCard;
    tasks: SetupTaskDraft[];
    acceptedSkillIds: string[];
    onSelectTask: (key: SetupTaskDraft['key']) => void;
    onConfirmTask: (key: SetupTaskDraft['key']) => void;
    activeTask?: SetupTaskDraft;
    assistantInput: string;
    onAssistantInputChange: (value: string) => void;
    onAssistantSubmit: () => void;
    assistantLoading: boolean;
    completedCount: number;
    canEnterEditor: boolean;
    onEnterEditor: () => void;
  };
}) {
```

At top of render, add onboarding header block before current tabs:

```tsx
{onboarding && (
  <div className="border-b border-theme-border/60 bg-theme-bg/30 px-8 py-5">
    <div className="flex items-center justify-between gap-6">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">新手起步</div>
        <h2 className="mt-2 text-2xl font-serif font-bold text-theme-text">先把故事骨架立住，再进入创作舞台</h2>
        <p className="mt-2 text-sm text-theme-muted">
          已完成 {onboarding.completedCount}/3 项核心设定。先确认主角、冲突、世界规则，再去写第一章会更稳。
        </p>
      </div>
      <button
        onClick={onboarding.onEnterEditor}
        disabled={!onboarding.canEnterEditor}
        className="rounded-2xl bg-theme-accent px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {onboarding.canEnterEditor ? '进入创作舞台' : '再确认设定后进入写作'}
      </button>
    </div>
  </div>
)}
```

Wrap current body layout:

```tsx
{onboarding ? (
  <div className="flex flex-1 overflow-hidden">
    <div className="flex-1 overflow-y-auto px-6 py-6 bg-theme-bg/20">
      <div className="grid gap-4 lg:grid-cols-2">
        {onboarding.tasks.map((task) => (
          <SetupTaskCard
            key={task.key}
            task={task}
            active={task.key === onboarding.activeTask?.key}
            onSelect={() => onboarding.onSelectTask(task.key)}
            onConfirm={() => onboarding.onConfirmTask(task.key)}
          />
        ))}
      </div>
    </div>
    <SetupAssistantPanel
      task={onboarding.activeTask}
      card={onboarding.card}
      draftInput={onboarding.assistantInput}
      onDraftInputChange={onboarding.onAssistantInputChange}
      onSubmit={onboarding.onAssistantSubmit}
      isLoading={onboarding.assistantLoading}
    />
  </div>
) : (
  <div className="flex-1 flex overflow-hidden">
    {/* existing tabs and content remain unchanged */}
  </div>
)}
```

- [ ] **Step 4: 在 `App.tsx` 管理 onboarding shell 状态并传给 `WorldBibleView`**

Add state:

```ts
const [activeSetupTaskKey, setActiveSetupTaskKey] = useState<SetupTaskDraft['key'] | undefined>(undefined);
const [assistantInput, setAssistantInput] = useState('');
const [assistantLoading, setAssistantLoading] = useState(false);
```

Add handlers:

```ts
const handleConfirmSetupTask = (key: SetupTaskDraft['key']) => {
  setOnboardingDraft((prev) =>
    prev
      ? {
          ...prev,
          setupTasks: prev.setupTasks.map((task) =>
            task.key === key ? { ...task, status: 'confirmed', source: 'user-edit' } : task,
          ),
        }
      : prev,
  );
};

const handleRefineSetupTask = async () => {
  if (!onboardingDraft || !activeSetupTaskKey) return;
  const task = onboardingDraft.setupTasks.find((entry) => entry.key === activeSetupTaskKey);
  const card = onboardingDraft.cards.find((entry) => entry.id === onboardingDraft.selectedCardId);
  if (!task || !card) return;

  setAssistantLoading(true);
  try {
    const nextSummary = await refineSetupTask({
      taskTitle: task.title,
      currentDraft: task.summary,
      userRequest: assistantInput,
      storyContext: `${card.hook}\n${card.coreConflict}\n${card.starterSeeds.worldSeed}`,
    });
    setOnboardingDraft((prev) =>
      prev
        ? {
            ...prev,
            setupTasks: prev.setupTasks.map((entry) =>
              entry.key === activeSetupTaskKey
                ? { ...entry, summary: nextSummary, status: 'drafted', source: 'ai-refine' }
                : entry,
            ),
          }
        : prev,
    );
    setAssistantInput('');
  } finally {
    setAssistantLoading(false);
  }
};
```

Pass onboarding prop:

```tsx
{currentView === 'world' && selectedNovel && (
  <WorldBibleView
    novel={selectedNovel}
    onboarding={
      onboardingDraft?.selectedCardId
        ? {
            card: onboardingDraft.cards.find((card) => card.id === onboardingDraft.selectedCardId),
            tasks: onboardingDraft.setupTasks,
            acceptedSkillIds: onboardingDraft.acceptedSkillIds,
            onSelectTask: setActiveSetupTaskKey,
            onConfirmTask: handleConfirmSetupTask,
            activeTask: onboardingDraft.setupTasks.find((task) => task.key === activeSetupTaskKey),
            assistantInput,
            onAssistantInputChange: setAssistantInput,
            onAssistantSubmit: handleRefineSetupTask,
            assistantLoading,
            completedCount: onboardingDraft.setupTasks.filter((task) => task.status === 'confirmed').length,
            canEnterEditor: onboardingDraft.setupTasks.filter((task) => task.status === 'confirmed').length >= 3,
            onEnterEditor: () => setCurrentView('editor'),
          }
        : undefined
    }
  />
)}
```

- [ ] **Step 5: 跑类型检查**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

Expected:

```text
Found 0 errors.
```

## Task 5: 在 onboarding shell 顶部接入 3 张 Skill 推荐并一键接受

**Files:**
- Create: `src/components/onboarding/StorySkillRecommendations.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/WorldBibleView.tsx`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: 创建推荐 Skill 组件**

Create `src/components/onboarding/StorySkillRecommendations.tsx`:

```tsx
import type { Skill } from '../../types';

export function StorySkillRecommendations({
  skills,
  acceptedSkillIds,
  onAcceptSkill,
}: {
  skills: Skill[];
  acceptedSkillIds: string[];
  onAcceptSkill: (skillId: string) => void;
}) {
  return (
    <section className="rounded-3xl border border-theme-border bg-white p-5 shadow-sm">
      <div className="mb-3">
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">推荐 Skill</div>
        <h3 className="mt-2 text-xl font-serif font-bold text-theme-text">基于当前故事方案，推荐先挂这 3 张</h3>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {skills.map((skill) => {
          const accepted = acceptedSkillIds.includes(skill.id);
          return (
            <article key={skill.id} className="rounded-2xl border border-theme-border/70 bg-theme-bg/20 p-4">
              <div className="text-sm font-bold text-theme-text">{skill.name}</div>
              <div className="mt-2 text-xs text-theme-muted">{skill.description || skill.style || '用于补强当前故事方向。'}</div>
              <button
                onClick={() => onAcceptSkill(skill.id)}
                className={`mt-4 rounded-full px-3 py-2 text-xs font-bold ${accepted ? 'bg-theme-sidebar text-theme-text' : 'bg-theme-accent text-white'}`}
              >
                {accepted ? '已接受' : '接受推荐'}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 在 `App.tsx` 把推荐结果映射成真实 Skill 并一键写入 `mountedSkillLoadout`**

Add state:

```ts
const [recommendedSkills, setRecommendedSkills] = useState<Skill[]>([]);
```

When selecting card, after `listSkills()`:

```ts
const recommended = recommendSkillsForStoryCard(card, skills);
const recommendedSkillModels = recommended
  .map((entry) => skills.find((skill) => skill.id === entry.skillId))
  .filter((skill): skill is Skill => Boolean(skill));
setRecommendedSkills(recommendedSkillModels);
```

Add accept handler:

```ts
const handleAcceptRecommendedSkill = async (skillId: string) => {
  if (!selectedNovel) return;
  const acceptedIds = Array.from(new Set([...(onboardingDraft?.acceptedSkillIds || []), skillId])).slice(0, 3);
  const nextLoadout = acceptedIds.map((id, slot) => ({
    slot,
    skillId: id,
    weight: 1,
    lockedDimensions: [],
  }));

  await updateNovel(selectedNovel.id, {
    mountedSkillIds: acceptedIds,
    mountedSkillLoadout: nextLoadout,
  });

  setSelectedNovel({
    ...selectedNovel,
    mountedSkillIds: acceptedIds,
    mountedSkillLoadout: nextLoadout,
  });
  setOnboardingDraft((prev) => (prev ? { ...prev, acceptedSkillIds: acceptedIds } : prev));
};
```

- [ ] **Step 3: 在 `WorldBibleView` onboarding header 下渲染推荐组件**

Update onboarding prop shape to include:

```ts
recommendedSkills?: Skill[];
onAcceptSkill?: (skillId: string) => void;
```

Render inside onboarding branch:

```tsx
{onboarding.recommendedSkills && onboarding.recommendedSkills.length > 0 && onboarding.onAcceptSkill && (
  <div className="px-6 pt-6 bg-theme-bg/20">
    <StorySkillRecommendations
      skills={onboarding.recommendedSkills}
      acceptedSkillIds={onboarding.acceptedSkillIds}
      onAcceptSkill={onboarding.onAcceptSkill}
    />
  </div>
)}
```

- [ ] **Step 4: 在 `App.tsx` 传入推荐 Skill**

Pass:

```ts
recommendedSkills,
onAcceptSkill: handleAcceptRecommendedSkill,
```

- [ ] **Step 5: 运行类型检查**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

Expected:

```text
Found 0 errors.
```

## Task 6: 手工回归和收尾验证

**Files:**
- No code required unless defects are found during verification

- [ ] **Step 1: 跑所有相关 node:test**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/onboarding-model.test.ts tests/onboarding-api-shape.test.ts tests/skill-model.test.ts tests/audit-structured.test.ts tests/chapter-polish.test.ts
```

Expected:

```text
# pass ...
```

- [ ] **Step 2: 跑类型检查**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

- [ ] **Step 3: 浏览器手工验证主流程**

Manual script:

1. 打开 `http://localhost:3000/`
2. 进入 `灵感助手`
3. 输入一句碎片化灵感，例如：`雨夜武侠，刀客误拿一块玄铁令。`
4. 点击某条 AI 回答上的 `生成故事方案卡`
5. 确认出现 3 张方案卡，并支持 `继续刷一批`
6. 选中一张卡
7. 确认：
   - 创建了新作品
   - 默认进入 `设定记忆页`
   - 出现 6 张关键设定任务卡
   - 右侧有设定助手
   - 顶部出现 3 张推荐 Skill
8. 接受 1-3 张推荐 Skill
9. 确认 3 个设定项后，点击 `进入创作舞台`
10. 在创作舞台打开 Skill 区，确认已接受的 Skill 已挂载

- [ ] **Step 4: 已知风险补记**

如果实现过程中出现以下情况，不要临时扩 scope：

- `混搭两张卡`
  - 本计划只放占位按钮，不在本轮完整实现
- `继续刷一批` 复用同一 ideaSeed
  - 第一版允许简单重刷，不要求批次历史浏览器
- `设定页实体自动创建过多`
  - 第一版只创建最小主角草稿，不自动铺满人物/地点/道具
- `推荐 Skill 解释文案`
  - 第一版可先用纯规则简短理由，不引入模型重排

## Self-Review Checklist

- [ ] 没有把副驾计划混进 onboarding 实现
- [ ] 没有重复设计 Skill 仓库版本化 / 试驾
- [ ] 所有新增类型都与现有 `Novel / Skill / WorldBibleView` 兼容
- [ ] 所有验证命令都可直接复制执行
- [ ] 所有步骤都是 2-5 分钟粒度，没有 “TODO / TBD / similar to above”
