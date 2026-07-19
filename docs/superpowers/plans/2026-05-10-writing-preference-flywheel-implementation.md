# Writing Preference Flywheel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 为 InkFlow 增加“写法偏好飞轮”的第一阶段实现：让 Skill 装配区能解释“为什么这次更适合当前项目”，并沉淀轻量项目偏好画像与 3 个纠偏动作。
**Architecture:** 先在纯函数层补项目偏好画像、评分解释和纠偏动作归因逻辑；再扩展 `Novel` 或等价项目级存储结构，记录项目偏好画像；最后在 Skill 装配区接入即时反馈面板和轻量项目画像，不修改 `user.md` 自动写回链路。
**Tech Stack:** React 19, TypeScript, Express, better-sqlite3, node:test, tsx

## Scope Guard

本计划只覆盖 `写法偏好飞轮第一阶段`。

包含：

- 项目层偏好画像结构
- Skill 装配区即时反馈解释
- `这更像我 / 这不是我想要的 / 仅限本项目` 三个轻动作
- 项目内偏好累计与展示

不包含：

- 全局 `user.md` 自动写回
- 多项目统计分析后台
- 趋势图表
- 拆书工厂结果页改造
- 新手 onboarding 与协作副驾重构

## Task 1: 抽离项目偏好画像和评分解释纯函数

**Files:**
- Create: `src/lib/preference-flywheel.ts`
- Modify: `src/types.ts`
- Test: `tests/preference-flywheel.test.ts`

- [ ] **Step 1: 写失败测试，锁定项目偏好画像与解释输出**

Create `tests/preference-flywheel.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectPreferenceSnapshot,
  explainFitScoreDelta,
  applyPreferenceFeedback,
} from '../src/lib/preference-flywheel';
import type { Skill, ProjectPreferenceProfile } from '../src/types';

function makeSkill(id: string, name: string, primaryDimension: Skill['primaryDimension']): Skill {
  return {
    id,
    name,
    description: '',
    style: '',
    pacing: '',
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 1,
    createdAt: 1,
    primaryDimension,
    dimensionTags: primaryDimension ? [primaryDimension] : [],
    compositionProfile: {
      styleWeight: primaryDimension === 'style' ? 0.9 : 0.2,
      characterWeight: primaryDimension === 'character' ? 0.9 : 0.2,
      worldWeight: primaryDimension === 'world' ? 0.9 : 0.2,
      powerWeight: 0.2,
      plotWeight: primaryDimension === 'plot' ? 0.9 : 0.2,
      pacingWeight: primaryDimension === 'pacing' ? 0.9 : 0.2,
      conflictTags: [],
      blendHints: [],
    },
    updatedAt: 1,
  };
}

test('buildProjectPreferenceSnapshot summarizes tags and weights', () => {
  const profile = buildProjectPreferenceSnapshot({
    acceptedSkills: [makeSkill('s1', '冷峻刀锋', 'style'), makeSkill('s2', '压抑对峙', 'character')],
    rejectedSkills: [makeSkill('s3', '散文化慢节奏', 'pacing')],
  });

  assert.equal(profile.tags.length > 0, true);
  assert.equal(profile.weights.styleWeight > 0, true);
  assert.equal(profile.rejectedDimensions.includes('pacing'), true);
});

test('explainFitScoreDelta returns readable reasons for score changes', () => {
  const message = explainFitScoreDelta({
    previousScore: 72,
    nextScore: 86,
    matchedTraits: ['冷峻', '强冲突', '紧推进'],
    resolvedConflicts: ['节奏冲突减少'],
    remainingRisks: ['世界铺陈偏重'],
  });

  assert.equal(message.summary.includes('更贴近'), true);
  assert.equal(message.highlights.length >= 2, true);
});

test('applyPreferenceFeedback updates project profile without touching global layer', () => {
  const profile: ProjectPreferenceProfile = {
    tags: ['冷峻', '强冲突'],
    weights: {
      styleWeight: 0.7,
      characterWeight: 0.6,
      worldWeight: 0.3,
      plotWeight: 0.8,
      pacingWeight: 0.7,
    },
    acceptedDimensions: ['style'],
    rejectedDimensions: [],
    notes: ['更接受短句压迫感'],
    evidenceCount: 2,
  };

  const next = applyPreferenceFeedback(profile, {
    action: 'not-for-me',
    dimension: 'world',
    note: '世界设定不要压过人物冲突',
  });

  assert.equal(next.rejectedDimensions.includes('world'), true);
  assert.equal(next.notes.at(-1), '世界设定不要压过人物冲突');
});
```

- [ ] **Step 2: 运行测试确认缺少模块**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/preference-flywheel.test.ts
```

- [ ] **Step 3: 扩展 `src/types.ts` 新增项目偏好画像类型**

Add:

```ts
export interface ProjectPreferenceWeights {
  styleWeight: number;
  characterWeight: number;
  worldWeight: number;
  plotWeight: number;
  pacingWeight: number;
}

export interface ProjectPreferenceProfile {
  tags: string[];
  weights: ProjectPreferenceWeights;
  acceptedDimensions: SkillDimension[];
  rejectedDimensions: SkillDimension[];
  notes: string[];
  evidenceCount: number;
}

export interface FitScoreExplanation {
  summary: string;
  highlights: string[];
  risks: string[];
}

export type PreferenceFeedbackAction = 'more-like-me' | 'not-for-me' | 'project-only';
```

- [ ] **Step 4: 在 `src/lib/preference-flywheel.ts` 实现最小纯函数**

Create `src/lib/preference-flywheel.ts` with:

```ts
import type {
  FitScoreExplanation,
  PreferenceFeedbackAction,
  ProjectPreferenceProfile,
  Skill,
  SkillDimension,
} from '../types';

const DEFAULT_WEIGHTS = {
  styleWeight: 0.5,
  characterWeight: 0.5,
  worldWeight: 0.5,
  plotWeight: 0.5,
  pacingWeight: 0.5,
};

export function buildProjectPreferenceSnapshot({
  acceptedSkills,
  rejectedSkills,
}: {
  acceptedSkills: Skill[];
  rejectedSkills: Skill[];
}): ProjectPreferenceProfile {
  const acceptedDimensions = Array.from(new Set(acceptedSkills.flatMap((skill) => skill.dimensionTags || [])));
  const rejectedDimensions = Array.from(new Set(rejectedSkills.flatMap((skill) => skill.dimensionTags || [])));

  return {
    tags: [
      acceptedDimensions.includes('style') ? '更重文风统一' : '',
      acceptedDimensions.includes('character') ? '更重人物张力' : '',
      acceptedDimensions.includes('plot') ? '更重冲突推进' : '',
      rejectedDimensions.includes('pacing') ? '不偏慢铺陈' : '',
    ].filter(Boolean),
    weights: {
      styleWeight: acceptedDimensions.includes('style') ? 0.8 : DEFAULT_WEIGHTS.styleWeight,
      characterWeight: acceptedDimensions.includes('character') ? 0.8 : DEFAULT_WEIGHTS.characterWeight,
      worldWeight: rejectedDimensions.includes('world') ? 0.3 : DEFAULT_WEIGHTS.worldWeight,
      plotWeight: acceptedDimensions.includes('plot') ? 0.8 : DEFAULT_WEIGHTS.plotWeight,
      pacingWeight: rejectedDimensions.includes('pacing') ? 0.3 : DEFAULT_WEIGHTS.pacingWeight,
    },
    acceptedDimensions,
    rejectedDimensions,
    notes: [],
    evidenceCount: acceptedSkills.length + rejectedSkills.length,
  };
}

export function explainFitScoreDelta(input: {
  previousScore: number;
  nextScore: number;
  matchedTraits: string[];
  resolvedConflicts: string[];
  remainingRisks: string[];
}): FitScoreExplanation {
  const delta = input.nextScore - input.previousScore;
  return {
    summary:
      delta >= 0
        ? `这次组合比上次更贴近当前项目偏好，适配分从 ${input.previousScore} 提升到 ${input.nextScore}。`
        : `这次组合与当前项目偏好更远，适配分从 ${input.previousScore} 降到 ${input.nextScore}。`,
    highlights: [
      input.matchedTraits.length ? `更贴近：${input.matchedTraits.join('、')}` : '',
      input.resolvedConflicts.length ? `改善点：${input.resolvedConflicts.join('、')}` : '',
    ].filter(Boolean),
    risks: input.remainingRisks,
  };
}

export function applyPreferenceFeedback(
  profile: ProjectPreferenceProfile,
  input: {
    action: PreferenceFeedbackAction;
    dimension?: SkillDimension;
    note?: string;
  },
): ProjectPreferenceProfile {
  const next = { ...profile, notes: [...profile.notes] };
  if (input.action === 'more-like-me' && input.dimension && !next.acceptedDimensions.includes(input.dimension)) {
    next.acceptedDimensions = [...next.acceptedDimensions, input.dimension];
  }
  if (input.action === 'not-for-me' && input.dimension && !next.rejectedDimensions.includes(input.dimension)) {
    next.rejectedDimensions = [...next.rejectedDimensions, input.dimension];
  }
  if (input.note) next.notes.push(input.note);
  next.evidenceCount += 1;
  return next;
}
```

- [ ] **Step 5: 重新跑测试**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/preference-flywheel.test.ts
```

## Task 2: 为项目层画像增加本地存储和 API

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/api.ts`
- Test: `tests/db-project-preference.test.ts`

- [ ] **Step 1: 写失败测试，锁定画像存取**

Create `tests/db-project-preference.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, createNovel, getNovel, updateNovel } from '../src/lib/db';

test('project preference profile persists on novel record', () => {
  initDb();
  const now = Date.now();
  createNovel({
    id: 'novel-pref-1',
    title: '偏好测试',
    authorId: 'local-user',
    summary: '',
    status: 'ongoing',
    createdAt: now,
    updatedAt: now,
  });

  updateNovel('novel-pref-1', {
    projectPreferenceProfile: {
      tags: ['更重冲突推进'],
      weights: {
        styleWeight: 0.7,
        characterWeight: 0.6,
        worldWeight: 0.3,
        plotWeight: 0.8,
        pacingWeight: 0.7,
      },
      acceptedDimensions: ['plot'],
      rejectedDimensions: ['world'],
      notes: ['世界设定不要压过人物冲突'],
      evidenceCount: 3,
    },
  });

  const novel = getNovel('novel-pref-1');
  assert.equal(novel?.projectPreferenceProfile?.acceptedDimensions.includes('plot'), true);
});
```

- [ ] **Step 2: 在 `Novel` 上新增 `projectPreferenceProfile`**

Add to `Novel`:

```ts
  projectPreferenceProfile?: ProjectPreferenceProfile;
```

- [ ] **Step 3: 扩展 `src/lib/db.ts` 的读写映射**

Add column mapping support for `project_preference_profile` in novel serialization/deserialization:

```ts
projectPreferenceProfile: JSON.parse(row.project_preference_profile || 'null') || undefined,
```

and

```ts
project_preference_profile: JSON.stringify(novel.projectPreferenceProfile || null),
```

- [ ] **Step 4: 确保 `src/lib/api.ts` 的 `updateNovel` 可透传该字段**

No new route needed; verify existing `updateNovel` path carries `projectPreferenceProfile`.

- [ ] **Step 5: 跑测试**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/db-project-preference.test.ts
```

## Task 3: 在 Skill 装配区加入即时反馈解释

**Files:**
- Create: `src/components/skills/PreferenceFeedbackPanel.tsx`
- Modify: `src/components/EditorView.tsx`
- Modify: `src/lib/skill-model.ts`

- [ ] **Step 1: 在 `src/lib/skill-model.ts` 暴露当前组合摘要数据**

Add a helper returning:

```ts
export interface SkillFitSnapshot {
  totalScore: number;
  matchedDimensions: SkillDimension[];
  conflictReasons: string[];
}
```

and a function:

```ts
export function buildSkillFitSnapshot(...) { ... }
```

- [ ] **Step 2: 创建即时反馈面板组件**

Create `src/components/skills/PreferenceFeedbackPanel.tsx`:

```tsx
import type { FitScoreExplanation } from '../../types';

export function PreferenceFeedbackPanel({
  score,
  explanation,
}: {
  score: number;
  explanation: FitScoreExplanation;
}) {
  return (
    <section className="rounded-3xl border border-theme-border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">更适合当前项目</div>
          <div className="mt-2 text-sm text-theme-text">{explanation.summary}</div>
        </div>
        <div className="text-2xl font-bold text-theme-accent">{score}</div>
      </div>
      <ul className="mt-4 space-y-2 text-sm text-theme-muted">
        {explanation.highlights.map((item) => (
          <li key={item}>- {item}</li>
        ))}
        {explanation.risks.map((item) => (
          <li key={item}>- 风险：{item}</li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: 在 `EditorView.tsx` 的 Skill 装配区接入解释面板**

Use current loadout change points to compute:

- previous fit snapshot
- current fit snapshot
- project preference profile
- explanation from `explainFitScoreDelta`

Render `PreferenceFeedbackPanel` above or beside existing loadout board.

- [ ] **Step 4: 跑类型检查**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

## Task 4: 增加 3 个轻量纠偏动作

**Files:**
- Modify: `src/components/skills/PreferenceFeedbackPanel.tsx`
- Modify: `src/components/EditorView.tsx`
- Modify: `src/lib/preference-flywheel.ts`

- [ ] **Step 1: 在反馈面板增加 3 个动作按钮**

Add buttons:

```tsx
<div className="mt-4 flex gap-2">
  <button>这更像我</button>
  <button>这不是我想要的</button>
  <button>仅限本项目</button>
</div>
```

- [ ] **Step 2: 在 `EditorView.tsx` 绑定动作到画像更新**

When user clicks:

- `这更像我`
  - 增强当前装配主维度的接受信号
- `这不是我想要的`
  - 记录当前主冲突维度为排斥信号
- `仅限本项目`
  - 只写 `projectPreferenceProfile.notes`

Persist through `updateNovel`.

- [ ] **Step 3: 最小回归检查**

Manual:

1. 打开一部已有 Skill 的作品
2. 替换一张 Skill
3. 确认出现解释面板
4. 点击 `这更像我`
5. 刷新页面
6. 确认项目偏好没有丢失

## Task 5: 增加轻量项目画像面板

**Files:**
- Create: `src/components/skills/ProjectPreferencePanel.tsx`
- Modify: `src/components/EditorView.tsx`

- [ ] **Step 1: 创建轻量项目画像面板**

Create `src/components/skills/ProjectPreferencePanel.tsx`:

```tsx
import type { ProjectPreferenceProfile } from '../../types';

export function ProjectPreferencePanel({ profile }: { profile?: ProjectPreferenceProfile }) {
  if (!profile || profile.evidenceCount < 3) return null;
  return (
    <section className="rounded-3xl border border-theme-border bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-[0.16em] text-theme-muted">项目写法画像</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {profile.tags.map((tag) => (
          <span key={tag} className="rounded-full border border-theme-border px-3 py-1 text-xs font-bold text-theme-text">
            {tag}
          </span>
        ))}
      </div>
      <ul className="mt-4 space-y-2 text-sm text-theme-muted">
        {profile.notes.slice(-3).map((note) => (
          <li key={note}>- {note}</li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: 在 `EditorView.tsx` 的 Skill 区接入面板**

Render `ProjectPreferencePanel` under `PreferenceFeedbackPanel`.

- [ ] **Step 3: 跑类型检查和相关测试**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/preference-flywheel.test.ts tests/skill-model.test.ts
npm run lint
```

## Task 6: 手工验证与边界检查

**Files:**
- No code required unless defects are found

- [ ] **Step 1: 手工验证“更适合我”的主流程**

1. 打开一部已有 Skill 的作品
2. 记录当前 fit score
3. 替换为另一组 Skill
4. 确认出现：
   - 分数变化
   - 更贴近哪些偏好的解释
   - 哪些冲突减少

- [ ] **Step 2: 验证纠偏动作**

1. 点击 `这更像我`
2. 再切换一次 Skill
3. 确认解释文案开始偏向刚才接受的维度
4. 点击 `这不是我想要的`
5. 确认相关维度不再被系统当作正向信号

- [ ] **Step 3: 边界确认**

确认第一阶段没有做这些事：

- 自动改写 `user.md`
- 生成复杂趋势图
- 做多项目全局统计面板
- 侵入 onboarding 或 copilot 计划范围

## Self-Review Checklist

- [ ] 计划只覆盖项目层飞轮第一阶段
- [ ] 没有把全局作者画像自动写回混入当前任务
- [ ] 所有新增类型与现有 `Novel / Skill / SkillLoadout` 兼容
- [ ] 验证命令都能直接复制执行
