# Copilot Stage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 把创作舞台里的“智能写作管家”从 tab 工具抽屉重构为“协作副驾”，默认先给出当前唯一主建议，再允许用户深入到具体工具。
**Architecture:** 先抽一层纯函数建议引擎，基于章节状态、设定完整度和当前用户上下文输出 `stage + suggestion + actions + reasons`，并用 `node:test` 锁定行为。然后在 `EditorView` 上新增轻量状态条和 `copilot-home` 首页，保留现有工具 tab 作为深层工具层，不推翻已有功能。
**Tech Stack:** React 19, TypeScript, Express-backed local API, node:test, tsx, motion/react, lucide-react

## Scope Guard

本计划只覆盖 `创作舞台协作副驾重构`。

不包含：

- 灵感对话 -> 故事方案卡 -> 设定记忆新手引导流
- 新作品入口改造
- Skill 自动推荐联动

这些应在独立计划中实现，避免把“创作舞台副驾”与“新手 onboarding”混成一次大改。

## Task 1: 抽离可测试的协作副驾建议引擎

**Files:**
- Create: `src/lib/copilot-stage.ts`
- Modify: `src/types.ts`
- Test: `tests/copilot-stage.test.ts`

- [ ] **Step 1: 新增失败测试，锁定 6 类主状态和动作优先级**

Create `tests/copilot-stage.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCopilotStage,
  buildCopilotSuggestion,
  type CopilotInput,
} from '../src/lib/copilot-stage';

function baseInput(overrides: Partial<CopilotInput> = {}): CopilotInput {
  return {
    hasCurrentChapter: true,
    hasSummary: true,
    hasGlobalOutline: true,
    hasWorldRules: true,
    hasSceneBeats: true,
    hasChapterContent: false,
    hasCritique: false,
    hasSniffedNewEntities: false,
    mountedSkillCount: 2,
    fitScore: 82,
    lastFocusArea: 'editor',
    ...overrides,
  };
}

test('deriveCopilotStage returns missing-setup when core story frame is absent', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasSummary: false,
      hasGlobalOutline: false,
      hasWorldRules: false,
    }),
  );
  assert.equal(stage, 'missing-setup');
});

test('deriveCopilotStage returns missing-beats when chapter exists but has no scene beats', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasSceneBeats: false,
      hasChapterContent: false,
    }),
  );
  assert.equal(stage, 'missing-beats');
});

test('deriveCopilotStage returns ready-to-draft when beats exist but正文为空', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasSceneBeats: true,
      hasChapterContent: false,
    }),
  );
  assert.equal(stage, 'ready-to-draft');
});

test('deriveCopilotStage returns pending-audit when正文已生成但尚未审计', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasChapterContent: true,
      hasCritique: false,
    }),
  );
  assert.equal(stage, 'pending-audit');
});

test('deriveCopilotStage returns pending-polish when已有审计结果', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasChapterContent: true,
      hasCritique: true,
    }),
  );
  assert.equal(stage, 'pending-polish');
});

test('deriveCopilotStage prioritizes syncing memory before quality improvements', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasChapterContent: true,
      hasCritique: false,
      hasSniffedNewEntities: true,
    }),
  );
  assert.equal(stage, 'needs-memory-sync');
});

test('buildCopilotSuggestion returns one primary action and reason summary', () => {
  const suggestion = buildCopilotSuggestion(
    baseInput({
      hasSceneBeats: false,
      hasChapterContent: false,
      lastFocusArea: 'planning',
    }),
  );

  assert.equal(suggestion.stage, 'missing-beats');
  assert.equal(suggestion.primaryAction.key, 'generate-beats');
  assert.equal(suggestion.secondaryActions.length <= 2, true);
  assert.equal(suggestion.reasons.missing.includes('scene beats'), true);
});
```

- [ ] **Step 2: 运行测试，确认当前缺少模块**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/copilot-stage.test.ts
```

Expected:

```text
not ok ... ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: 在 `src/types.ts` 中添加副驾类型**

Append near other editor-facing types:

```ts
export type CopilotStage =
  | 'missing-setup'
  | 'missing-beats'
  | 'ready-to-draft'
  | 'pending-audit'
  | 'pending-polish'
  | 'needs-memory-sync';

export type CopilotActionKey =
  | 'fill-setup'
  | 'generate-beats'
  | 'generate-draft'
  | 'run-audit'
  | 'run-polish'
  | 'sync-memory'
  | 'open-skills'
  | 'open-bible'
  | 'open-quality'
  | 'open-planning';

export interface CopilotAction {
  key: CopilotActionKey;
  label: string;
}

export interface CopilotReasons {
  ready: string[];
  missing: string[];
  risks: string[];
}

export interface CopilotSuggestion {
  stage: CopilotStage;
  stageLabel: string;
  title: string;
  summary: string;
  primaryAction: CopilotAction;
  secondaryActions: CopilotAction[];
  reasons: CopilotReasons;
}
```

- [ ] **Step 4: 实现 `src/lib/copilot-stage.ts`**

Create `src/lib/copilot-stage.ts`:

```ts
import type { CopilotReasons, CopilotStage, CopilotSuggestion } from '../types';

export interface CopilotInput {
  hasCurrentChapter: boolean;
  hasSummary: boolean;
  hasGlobalOutline: boolean;
  hasWorldRules: boolean;
  hasSceneBeats: boolean;
  hasChapterContent: boolean;
  hasCritique: boolean;
  hasSniffedNewEntities: boolean;
  mountedSkillCount: number;
  fitScore: number;
  lastFocusArea:
    | 'editor'
    | 'planning'
    | 'quality'
    | 'trace'
    | 'bible'
    | 'skills'
    | 'versions'
    | 'ideas'
    | 'foreshadowing'
    | 'pacing';
}

export function deriveCopilotStage(input: CopilotInput): CopilotStage {
  if (!input.hasSummary || !input.hasGlobalOutline || !input.hasWorldRules) {
    return 'missing-setup';
  }
  if (input.hasSniffedNewEntities) {
    return 'needs-memory-sync';
  }
  if (!input.hasCurrentChapter || !input.hasSceneBeats) {
    return 'missing-beats';
  }
  if (!input.hasChapterContent) {
    return 'ready-to-draft';
  }
  if (!input.hasCritique) {
    return 'pending-audit';
  }
  return 'pending-polish';
}

function buildReasons(input: CopilotInput, stage: CopilotStage): CopilotReasons {
  const ready: string[] = [];
  const missing: string[] = [];
  const risks: string[] = [];

  if (input.hasSummary) ready.push('summary');
  if (input.hasGlobalOutline) ready.push('global outline');
  if (input.hasWorldRules) ready.push('world rules');
  if (input.hasSceneBeats) ready.push('scene beats');
  if (input.hasChapterContent) ready.push('chapter draft');
  if (input.hasCritique) ready.push('audit critique');
  if (input.mountedSkillCount > 0) ready.push(`${input.mountedSkillCount} mounted skills`);

  if (!input.hasSummary) missing.push('summary');
  if (!input.hasGlobalOutline) missing.push('global outline');
  if (!input.hasWorldRules) missing.push('world rules');
  if (!input.hasSceneBeats) missing.push('scene beats');
  if (!input.hasChapterContent) missing.push('chapter draft');
  if (!input.hasCritique && input.hasChapterContent) missing.push('audit critique');

  if (input.hasSniffedNewEntities) risks.push('untracked entities may drift from canon');
  if (input.mountedSkillCount === 0) risks.push('no mounted skills are shaping the current draft');
  if (input.fitScore > 0 && input.fitScore < 60) risks.push('mounted skill fit is currently weak');
  if (stage === 'ready-to-draft') risks.push('drafting without reviewing beats may cause drift');

  return { ready, missing, risks };
}

export function buildCopilotSuggestion(input: CopilotInput): CopilotSuggestion {
  const stage = deriveCopilotStage(input);
  const reasons = buildReasons(input, stage);

  switch (stage) {
    case 'missing-setup':
      return {
        stage,
        stageLabel: '设定骨架未完成',
        title: '先补全故事骨架',
        summary: '主线摘要、大纲或世界规则仍然缺失，直接推进正文容易跑偏。',
        primaryAction: { key: 'open-bible', label: '先补设定' },
        secondaryActions: [{ key: 'fill-setup', label: '查看缺失项' }],
        reasons,
      };
    case 'needs-memory-sync':
      return {
        stage,
        stageLabel: '发现野生设定',
        title: '先同步设定记忆',
        summary: '当前章节出现了未入库实体，先补到记忆库更稳。',
        primaryAction: { key: 'sync-memory', label: '同步设定' },
        secondaryActions: [{ key: 'open-bible', label: '查看记忆库' }],
        reasons,
      };
    case 'missing-beats':
      return {
        stage,
        stageLabel: '章节待规划',
        title: '先生成这一章的场景分镜',
        summary: '当前章节还没有稳定 beats，直接扩写容易发散。',
        primaryAction: { key: 'generate-beats', label: '生成分镜' },
        secondaryActions: [{ key: 'open-planning', label: '手动补分镜' }],
        reasons,
      };
    case 'ready-to-draft':
      return {
        stage,
        stageLabel: '可进入正文',
        title: '现在最值当的动作是生成正文',
        summary: '设定和分镜已经具备，适合让 Writer 先起一版可编辑草稿。',
        primaryAction: { key: 'generate-draft', label: '扩写正文' },
        secondaryActions: [
          { key: 'open-planning', label: '再看一眼分镜' },
          { key: 'open-skills', label: '检查技能挂载' },
        ],
        reasons,
      };
    case 'pending-audit':
      return {
        stage,
        stageLabel: '正文待审计',
        title: '先做 AI 审计，不建议继续盲写',
        summary: '当前章节已有正文，但还没经过一致性与节奏检查。',
        primaryAction: { key: 'run-audit', label: '开始审计' },
        secondaryActions: [{ key: 'open-quality', label: '查看质量面板' }],
        reasons,
      };
    case 'pending-polish':
    default:
      return {
        stage: 'pending-polish',
        stageLabel: '审计后待精修',
        title: '按审计结果精修正文',
        summary: '当前章节已经有审计结果，先收敛问题再继续扩写更稳。',
        primaryAction: { key: 'run-polish', label: '按审计精修' },
        secondaryActions: [
          { key: 'open-quality', label: '查看审计原因' },
          { key: 'open-planning', label: '回看分镜' },
        ],
        reasons,
      };
  }
}
```

- [ ] **Step 5: 再跑测试，确认建议引擎通过**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/copilot-stage.test.ts
```

Expected:

```text
# tests 7
# pass 7
# fail 0
```

## Task 2: 抽离副驾首页组件与轻量状态条

**Files:**
- Create: `src/components/copilot/CopilotStatusBar.tsx`
- Create: `src/components/copilot/CopilotHomePanel.tsx`
- Modify: `src/components/EditorView.tsx`

- [ ] **Step 1: 新建轻量状态条组件**

Create `src/components/copilot/CopilotStatusBar.tsx`:

```tsx
import type { CopilotSuggestion } from '../../types';
import { ChevronRight, Sparkles } from 'lucide-react';

interface CopilotStatusBarProps {
  suggestion: CopilotSuggestion;
  onOpen: () => void;
}

export function CopilotStatusBar({ suggestion, onOpen }: CopilotStatusBarProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-theme-border bg-white px-4 py-3 text-left shadow-sm hover:border-theme-accent/40 transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-bold text-theme-accent">
            <Sparkles size={12} />
            <span>{suggestion.stageLabel}</span>
          </div>
          <div className="mt-1 text-sm font-bold text-theme-text">{suggestion.title}</div>
          <div className="mt-1 text-xs text-theme-muted line-clamp-2">{suggestion.summary}</div>
        </div>
        <div className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-theme-text px-3 py-2 text-[11px] font-bold text-white">
          查看建议
          <ChevronRight size={12} />
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: 新建副驾首页组件**

Create `src/components/copilot/CopilotHomePanel.tsx`:

```tsx
import type { CopilotAction, CopilotSuggestion } from '../../types';
import { AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';

interface CopilotHomePanelProps {
  suggestion: CopilotSuggestion;
  onAction: (action: CopilotAction) => void;
}

export function CopilotHomePanel({ suggestion, onAction }: CopilotHomePanelProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-theme-border bg-theme-sidebar/20 p-4">
        <div className="text-[11px] font-bold text-theme-accent">{suggestion.stageLabel}</div>
        <div className="mt-2 text-base font-bold text-theme-text">{suggestion.title}</div>
        <div className="mt-2 text-sm leading-relaxed text-theme-muted">{suggestion.summary}</div>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => onAction(suggestion.primaryAction)}
          className="w-full rounded-xl bg-theme-accent px-4 py-3 text-sm font-bold text-white hover:bg-theme-accent/90"
        >
          {suggestion.primaryAction.label}
        </button>
        {suggestion.secondaryActions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={() => onAction(action)}
            className="w-full rounded-xl border border-theme-border bg-white px-4 py-3 text-sm font-bold text-theme-text hover:bg-theme-sidebar/30"
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-theme-border bg-white p-4 text-xs text-theme-muted space-y-3">
        <div className="flex items-center gap-2 text-theme-text font-bold">
          <CheckCircle2 size={14} className="text-emerald-500" />
          已具备
        </div>
        <div>{suggestion.reasons.ready.join(' / ') || '暂未形成稳定基础'}</div>
        <div className="flex items-center gap-2 text-theme-text font-bold">
          <AlertCircle size={14} className="text-amber-500" />
          当前缺失
        </div>
        <div>{suggestion.reasons.missing.join(' / ') || '当前关键项已具备'}</div>
        <div className="flex items-center gap-2 text-theme-text font-bold">
          <Sparkles size={14} className="text-theme-accent" />
          潜在风险
        </div>
        <div>{suggestion.reasons.risks.join(' / ') || '当前没有明显风险'}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 在 `EditorView.tsx` 里接入新组件 import**

Add imports:

```tsx
import { CopilotStatusBar } from './copilot/CopilotStatusBar';
import { CopilotHomePanel } from './copilot/CopilotHomePanel';
import {
  buildCopilotSuggestion,
  type CopilotInput,
} from '../lib/copilot-stage';
import type { CopilotAction } from '../types';
```

## Task 3: 在 EditorView 中接入副驾判断与首页

**Files:**
- Modify: `src/components/EditorView.tsx`

- [ ] **Step 1: 把 `agentTab` 默认值改成 `copilot`，并扩展类型**

Replace:

```tsx
const [agentTab, setAgentTab] = useState<'outline' | 'planning' | 'quality' | 'trace' | 'bible' | 'skills' | 'versions' | 'ideas' | 'foreshadowing' | 'pacing'>('outline');
```

With:

```tsx
const [agentTab, setAgentTab] = useState<
  'copilot' | 'outline' | 'planning' | 'quality' | 'trace' | 'bible' | 'skills' | 'versions' | 'ideas' | 'foreshadowing' | 'pacing'
>('copilot');
```

- [ ] **Step 2: 基于现有状态拼装 `CopilotInput` 并生成建议**

Add near other derived state:

```tsx
const copilotInput: CopilotInput = {
  hasCurrentChapter: Boolean(currentChapter),
  hasSummary: Boolean(novel.summary?.trim()),
  hasGlobalOutline: Boolean(globalOutline?.trim()),
  hasWorldRules: Boolean(novel.worldRules?.trim()),
  hasSceneBeats: Boolean(currentChapter?.sceneBeats?.trim()),
  hasChapterContent: Boolean(currentChapter?.content?.trim()),
  hasCritique: Boolean(currentChapter?.critique?.trim()),
  hasSniffedNewEntities: Boolean(sniffedEntities?.newEntities?.length),
  mountedSkillCount: mountedSkills.length,
  fitScore: getCurrentFitScore(mountedSkills).totalScore,
  lastFocusArea: agentTab === 'copilot' ? 'editor' : agentTab,
};

const copilotSuggestion = React.useMemo(
  () => buildCopilotSuggestion(copilotInput),
  [
    currentChapter,
    globalOutline,
    novel.summary,
    novel.worldRules,
    sniffedEntities,
    mountedSkills,
    agentTab,
  ],
);
```

- [ ] **Step 3: 增加统一动作分发器，复用现有 handler**

Add:

```tsx
const handleCopilotAction = async (action: CopilotAction) => {
  switch (action.key) {
    case 'generate-beats':
      setAgentTab('planning');
      await handleGenerateBeats();
      return;
    case 'generate-draft':
      setAgentTab('planning');
      await handleGenerateContent();
      return;
    case 'run-audit':
      setAgentTab('quality');
      await handleRunAudit();
      return;
    case 'run-polish':
      setAgentTab('quality');
      await handlePolishChapterFromAudit();
      return;
    case 'sync-memory':
      setAgentTab('trace');
      await handleSniffEntities();
      return;
    case 'open-bible':
      setAgentTab('bible');
      return;
    case 'open-skills':
      setAgentTab('skills');
      return;
    case 'open-quality':
      setAgentTab('quality');
      return;
    case 'open-planning':
      setAgentTab('planning');
      return;
    case 'fill-setup':
    default:
      setAgentTab('bible');
  }
};
```

- [ ] **Step 4: 在正文主舞台区域前置轻量状态条**

Insert above the main chapter editor card:

```tsx
<div className="mb-4">
  <CopilotStatusBar
    suggestion={copilotSuggestion}
    onOpen={() => {
      setIsAgentSidebarOpen(true);
      setAgentTab('copilot');
    }}
  />
</div>
```

- [ ] **Step 5: 在抽屉首页加入 `copilot-home`，并把原工具 tab 变成深层入口**

Insert at top of tab strip:

```tsx
<button
  onClick={() => setAgentTab('copilot')}
  className={cn(
    'flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium flex items-center justify-center gap-1.5',
    agentTab === 'copilot'
      ? 'bg-theme-text text-white'
      : 'text-theme-muted hover:bg-theme-sidebar hover:text-theme-text',
  )}
>
  <Bot size={12} /> 副驾
</button>
```

Render homepage first:

```tsx
{agentTab === 'copilot' && (
  <motion.div key="copilot" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
    <CopilotHomePanel suggestion={copilotSuggestion} onAction={handleCopilotAction} />
  </motion.div>
)}
```

- [ ] **Step 6: 把现有静态“推荐使用流程”替换成副驾说明文案**

Replace the old block with:

```tsx
<div className="mb-4 rounded-2xl border border-theme-border bg-theme-sidebar/25 px-4 py-3 text-[11px] text-theme-muted leading-relaxed">
  <div className="text-xs font-bold text-theme-text mb-2">协作副驾</div>
  <div>副驾会根据当前章节状态、设定完整度和最近操作，推荐现在最值得做的一步。</div>
  <div className="mt-2">需要深入时，再进入分镜、质量、追踪、技能等具体工具。</div>
</div>
```

## Task 4: 下沉工具层，不删除现有能力

**Files:**
- Modify: `src/components/EditorView.tsx`

- [ ] **Step 1: 给工具 tab 区加一个分组标题，明确“更多工具”角色**

Insert above tabs:

```tsx
<div className="px-3 pt-3 text-[10px] font-bold uppercase tracking-wider text-theme-muted">
  更多工具
</div>
```

- [ ] **Step 2: 调整 tab 顺序，让高频工具靠前，增强工具靠后**

Recommended order after `copilot`:

```text
planning -> quality -> trace -> bible -> skills -> ideas -> foreshadowing -> pacing -> versions -> outline
```

Rationale:

- `planning / quality / trace` 是最常触发的协作闭环
- `bible / skills` 是纠偏和增强
- `ideas / foreshadowing / pacing / versions / outline` 更像深层工具

- [ ] **Step 3: 保持所有旧工具逻辑不删，只调整默认入口**

Do **not** remove:

- `IdeaFragmentBoard`
- `ForeshadowingPanel`
- `PacingDashboard`
- `SkillLoadoutBoard`
- `trace` sniffing block
- `versions` block

This task is successful only if:

- old tools still render
- `copilot` becomes the default first screen
- user can still manually jump anywhere

## Task 5: 验证与收尾

**Files:**
- Test: `tests/copilot-stage.test.ts`
- Modify if needed: `src/components/EditorView.tsx`

- [ ] **Step 1: 跑纯逻辑测试**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/copilot-stage.test.ts
```

Expected:

```text
# pass 7
# fail 0
```

- [ ] **Step 2: 跑类型检查**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
PATH=/Users/Zhuanz/.local/share/fnm/node-versions/v22.22.1/installation/bin:$PATH npm run lint
```

Expected:

```text
tsc --noEmit
```

- [ ] **Step 3: 手工验证创作舞台副驾行为**

Run the dev app, then verify in browser:

1. 打开任一作品进入创作舞台
2. 正文区域顶部能看到轻量状态条
3. 点击状态条会打开智能管家，并默认停在 `副驾`
4. 不同章节状态下，首页主建议会变化：
   - 无分镜 -> 推荐生成分镜
   - 有分镜无正文 -> 推荐扩写正文
   - 有正文无审计 -> 推荐开始审计
   - 有审计 -> 推荐按审计精修
5. 点击主动作后，会跳到对应工具页并触发已有动作
6. 现有 tab 工具仍可手动访问

- [ ] **Step 4: 如果建议判断和真实体验冲突，先调规则，不先加更多 UI**

Allowed fix scope:

- `src/lib/copilot-stage.ts`
- 文案
- tab 顺序

Do **not** expand first-phase scope into:

- onboarding flow
- scheme cards
- skill recommendation
- new persistence schema

## Self-Review Checklist

- [ ] 计划只覆盖“创作舞台协作副驾重构”，没有混入 onboarding 需求
- [ ] 所有任务都包含明确文件路径
- [ ] 先有纯逻辑测试，再接 UI
- [ ] 没有使用占位语句或“参考别处实现”
- [ ] 手工验证步骤和通过标准已写清楚

## Execution Handoff

执行建议有两种：

1. `Subagent-Driven`（推荐）
   - 先做 Task 1 的纯逻辑建议引擎与测试
   - 再做 Task 2-4 的 UI 集成
   - 最后独立做 Task 5 验证与回归

2. `Inline Execution`
   - 在当前会话中按 Task 1 -> Task 5 顺序推进
   - 每完成一个任务就停一下，给你同步一次状态与风险
