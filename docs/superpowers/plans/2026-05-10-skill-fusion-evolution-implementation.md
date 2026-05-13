# Skill Fusion Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 为 InkFlow 实现第一阶段 Skill 融合闭环：在创作舞台发现融合机会，在技能仓库中完成 `1 主卡 + 1 辅卡` 的融合、试驾与保存。
**Architecture:** 先在纯函数层补融合候选、融合说明、建议提示条件；再扩展 `Skill` 的 lineage 与融合元数据，并在 `SkillDetailDrawer` 增加融合工坊子视图与候选生成；最后在 `SkillLoadoutBoard` 中接入“建议融合”提示，但不直接在创作舞台执行重操作。
**Tech Stack:** React 19, TypeScript, Express, better-sqlite3, node:test, tsx

## Scope Guard

本计划只覆盖 `Skill 融合第一阶段`。

包含：

- `1 主卡 + 1 辅卡 -> 1 候选 Skill`
- 融合说明
- 先试驾后保存
- 创作舞台中的融合建议提示

不包含：

- 多卡融合
- 自动直接改写 Skill 内容
- 自动批量融合
- 全局 user 偏好写回

## Task 1: 抽离融合纯函数与测试

**Files:**
- Create: `src/lib/skill-fusion.ts`
- Modify: `src/types.ts`
- Test: `tests/skill-fusion.test.ts`

- [ ] **Step 1: 先写失败测试，锁定融合规则和说明结构**

Create `tests/skill-fusion.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFusionDraft,
  explainSkillFusion,
  shouldSuggestFusion,
} from '../src/lib/skill-fusion';
import type { Skill, SkillUsageRecord } from '../src/types';

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
      styleWeight: 0.8,
      characterWeight: 0.2,
      worldWeight: 0.2,
      powerWeight: 0.1,
      plotWeight: 0.4,
      pacingWeight: 0.6,
      conflictTags: [],
      blendHints: [],
    },
    ...partial,
  };
}

test('buildFusionDraft keeps primary dimension from main skill', () => {
  const mainSkill = makeSkill({
    id: 'style-1',
    name: '冷峻刀锋',
    primaryDimension: 'style',
    dimensionTags: ['style', 'plot'],
  });
  const supportSkill = makeSkill({
    id: 'char-1',
    name: '压抑对峙',
    primaryDimension: 'character',
    dimensionTags: ['character', 'plot'],
  });

  const draft = buildFusionDraft(mainSkill, supportSkill);
  assert.equal(draft.primaryDimension, 'style');
  assert.equal(draft.dimensionTags?.includes('character'), true);
  assert.equal(draft.parentSkillId, 'style-1');
});

test('explainSkillFusion describes retained strengths and absorbed benefits', () => {
  const explanation = explainSkillFusion({
    mainSkillName: '冷峻刀锋',
    supportSkillName: '压抑对峙',
    retained: ['冷峻短句', '低解释'],
    absorbed: ['人物对峙张力', '对白前试探动作'],
    risks: ['叠加世界观型 Skill 可能压慢节奏'],
  });

  assert.equal(explanation.retained.length, 2);
  assert.equal(explanation.absorbed[0], '人物对峙张力');
  assert.equal(explanation.risks.length, 1);
});

test('shouldSuggestFusion only returns true for stable and repeated pairings', () => {
  const records: SkillUsageRecord[] = [
    { id: '1', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 84, userAction: 'accepted', createdAt: 1 },
    { id: '2', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 86, userAction: 'accepted', createdAt: 2 },
    { id: '3', novelId: 'n1', mountedSkillIds: ['style-1', 'char-1'], fitScore: 88, userAction: 'accepted', createdAt: 3 },
  ];

  assert.equal(
    shouldSuggestFusion({
      mainSkillId: 'style-1',
      supportSkillId: 'char-1',
      records,
      minimumFitScore: 80,
      minimumAcceptedCount: 3,
    }),
    true,
  );
});
```

- [ ] **Step 2: 运行测试，确认当前缺少模块**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/skill-fusion.test.ts
```

- [ ] **Step 3: 扩展 `src/types.ts`，定义融合元数据**

Add:

```ts
export interface SkillFusionMeta {
  mainSkillId: string;
  supportSkillId: string;
  retainedTraits: string[];
  absorbedTraits: string[];
  risks: string[];
}

export interface SkillFusionExplanation {
  retained: string[];
  absorbed: string[];
  risks: string[];
}
```

Extend `Skill`:

```ts
  fusionMeta?: SkillFusionMeta;
```

- [ ] **Step 4: 实现 `src/lib/skill-fusion.ts`**

Create `src/lib/skill-fusion.ts`:

```ts
import type {
  Skill,
  SkillFusionExplanation,
  SkillUsageRecord,
} from '../types';

export function buildFusionDraft(mainSkill: Skill, supportSkill: Skill): Skill {
  const now = Date.now();
  const nextTags = Array.from(new Set([...(mainSkill.dimensionTags || []), ...(supportSkill.dimensionTags || [])]));

  return {
    ...mainSkill,
    id: `${mainSkill.id}-fusion-${supportSkill.id}-${now}`,
    name: `${mainSkill.name} · ${supportSkill.name} 融合版`,
    description: `${mainSkill.name} 为主，吸收 ${supportSkill.name} 的增强特征。`,
    version: (mainSkill.version || 1) + 1,
    parentSkillId: mainSkill.id,
    lineageRootId: mainSkill.lineageRootId || mainSkill.id,
    primaryDimension: mainSkill.primaryDimension,
    dimensionTags: nextTags,
    fusionMeta: {
      mainSkillId: mainSkill.id,
      supportSkillId: supportSkill.id,
      retainedTraits: [],
      absorbedTraits: [],
      risks: [],
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function explainSkillFusion(input: {
  mainSkillName: string;
  supportSkillName: string;
  retained: string[];
  absorbed: string[];
  risks: string[];
}): SkillFusionExplanation {
  return {
    retained: input.retained,
    absorbed: input.absorbed,
    risks: input.risks,
  };
}

export function shouldSuggestFusion(input: {
  mainSkillId: string;
  supportSkillId: string;
  records: SkillUsageRecord[];
  minimumFitScore: number;
  minimumAcceptedCount: number;
}): boolean {
  const matched = input.records.filter(
    (record) =>
      record.userAction === 'accepted' &&
      record.fitScore >= input.minimumFitScore &&
      record.mountedSkillIds.includes(input.mainSkillId) &&
      record.mountedSkillIds.includes(input.supportSkillId),
  );
  return matched.length >= input.minimumAcceptedCount;
}
```

- [ ] **Step 5: 重新跑测试**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/skill-fusion.test.ts
```

## Task 2: 在技能仓库加入融合工坊

**Files:**
- Create: `src/components/skills/SkillFusionWorkbench.tsx`
- Modify: `src/components/skills/SkillDetailDrawer.tsx`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: 创建融合工坊组件**

Create `src/components/skills/SkillFusionWorkbench.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Skill, SkillFusionExplanation } from '../../types';
import { buildFusionDraft, explainSkillFusion } from '../../lib/skill-fusion';

export function SkillFusionWorkbench({
  baseSkill,
  candidates,
  onPreview,
}: {
  baseSkill: Skill;
  candidates: Skill[];
  onPreview: (draft: Skill) => void;
}) {
  const [supportSkillId, setSupportSkillId] = useState<string>('');
  const supportSkill = useMemo(
    () => candidates.find((skill) => skill.id === supportSkillId) || null,
    [candidates, supportSkillId],
  );

  const explanation: SkillFusionExplanation | null = useMemo(() => {
    if (!supportSkill) return null;
    return explainSkillFusion({
      mainSkillName: baseSkill.name,
      supportSkillName: supportSkill.name,
      retained: [baseSkill.style || '保留主卡的核心文风'],
      absorbed: [supportSkill.characterTraits || supportSkill.plotPattern || '吸收辅卡的增强能力'],
      risks: ['再叠高冲突世界观型 Skill 可能压慢节奏'],
    });
  }, [baseSkill, supportSkill]);

  return (
    <section className="space-y-3">
      <div className="text-xs font-bold text-theme-muted uppercase tracking-wider">融合工坊</div>
      <select
        value={supportSkillId}
        onChange={(event) => setSupportSkillId(event.target.value)}
        className="w-full rounded-xl border border-theme-border px-3 py-3 text-sm bg-white"
      >
        <option value="">选择辅卡</option>
        {candidates
          .filter((skill) => skill.id !== baseSkill.id)
          .map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.name}
            </option>
          ))}
      </select>

      {explanation && (
        <div className="rounded-2xl border border-theme-border bg-theme-sidebar/20 p-4 text-sm space-y-2">
          <div><span className="font-bold">保留：</span>{explanation.retained.join('、')}</div>
          <div><span className="font-bold">吸收：</span>{explanation.absorbed.join('、')}</div>
          <div><span className="font-bold">风险：</span>{explanation.risks.join('、')}</div>
        </div>
      )}

      <button
        type="button"
        disabled={!supportSkill}
        onClick={() => supportSkill && onPreview(buildFusionDraft(baseSkill, supportSkill))}
        className="w-full rounded-2xl bg-theme-accent text-white px-4 py-3 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <Sparkles size={16} />
        生成融合候选
      </button>
    </section>
  );
}
```

- [ ] **Step 2: 在 `SkillDetailDrawer.tsx` 接入融合工坊**

Import:

```ts
import { SkillFusionWorkbench } from './SkillFusionWorkbench';
```

Add state:

```ts
const [fusionPreview, setFusionPreview] = useState<Skill | null>(null);
```

Render before `SkillTestBench`:

```tsx
<section>
  <SkillFusionWorkbench
    baseSkill={draft}
    candidates={versions.length > 0 ? versions : [skill]}
    onPreview={(nextDraft) => setFusionPreview(nextDraft)}
  />
</section>
```

If `fusionPreview` exists, feed it into `SkillTestBench` candidates and allow save-as-new-version from preview.

- [ ] **Step 3: 复用现有保存链路，不新增新 API**

Use existing `createSkill()` for saving fusion candidate as a new version.

- [ ] **Step 4: 跑类型检查**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

## Task 3: 让试驾台支持融合候选对比

**Files:**
- Modify: `src/components/skills/SkillTestBench.tsx`
- Modify: `src/components/skills/SkillDetailDrawer.tsx`

- [ ] **Step 1: 把融合候选注入试驾候选列表**

When `fusionPreview` exists, append it to `SkillTestBench` candidates:

```tsx
<SkillTestBench
  baseSkill={fusionPreview || draft}
  candidates={fusionPreview ? [fusionPreview, ...versions] : versions}
/>
```

- [ ] **Step 2: 在试驾说明中标记“融合候选”**

Update candidate labels inside `SkillTestBench` to show:

```ts
const label = candidate.fusionMeta ? `${candidate.name}（融合候选）` : candidate.name;
```

- [ ] **Step 3: 手工验证**

1. 打开任意 Skill 详情
2. 选择辅卡
3. 生成融合候选
4. 在试驾对比台看到候选
5. 确认候选未自动覆盖原版本

## Task 4: 在创作舞台加入“建议融合”提示

**Files:**
- Create: `src/components/skills/FusionSuggestionBanner.tsx`
- Modify: `src/components/skills/SkillLoadoutBoard.tsx`
- Modify: `src/lib/skill-model.ts`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: 在 `SkillLoadoutBoard.tsx` 计算当前装配对是否值得融合**

Use currently mounted skills and usage data to derive a single suggestion candidate.

Start with a simple heuristic:

- at least 2 mounted skills
- no major conflict between the pair
- current fit score >= 80

- [ ] **Step 2: 创建提示条组件**

Create `src/components/skills/FusionSuggestionBanner.tsx`:

```tsx
import type { Skill } from '../../types';

export function FusionSuggestionBanner({
  mainSkill,
  supportSkill,
}: {
  mainSkill: Skill;
  supportSkill: Skill;
}) {
  return (
    <div className="rounded-2xl border border-theme-accent/30 bg-theme-accent/5 px-4 py-3 text-sm text-theme-text">
      这两张卡长期配合稳定，建议尝试融合：以《{mainSkill.name}》为主卡，吸收《{supportSkill.name}》的增强特征。
    </div>
  );
}
```

- [ ] **Step 3: 在 `SkillLoadoutBoard.tsx` 渲染提示**

Render banner above the deck when suggestion exists.

第一阶段只提示，不在创作舞台直接执行融合。

- [ ] **Step 4: 跑类型检查**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

## Task 5: 手工回归与边界确认

**Files:**
- No code required unless defects are found

- [ ] **Step 1: 跑相关测试**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/skill-fusion.test.ts tests/skill-model.test.ts tests/db-skill-versioning.test.ts
```

Note:

`tests/db-skill-versioning.test.ts` 当前仓库已知存在外键失败问题；如果它仍失败，需在结果中明确区分“既有失败”和“本轮引入失败”。

- [ ] **Step 2: 跑类型检查**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

- [ ] **Step 3: 浏览器手工验证**

1. 打开 `技能仓库`
2. 选择一张 Skill
3. 在融合工坊选择辅卡
4. 点击 `生成融合候选`
5. 确认看到融合说明
6. 确认试驾台能对比当前版与融合候选
7. 保存为新版本
8. 回到创作舞台 Skill 装配区
9. 确认在某些稳定组合下看到 `建议融合` 提示

- [ ] **Step 4: 边界确认**

确认第一阶段没有做这些事：

- 多卡融合
- 自动改 Skill 内容
- 自动覆盖旧版本
- 在创作舞台直接执行重型融合流程

## Self-Review Checklist

- [ ] 计划只覆盖第一阶段显式融合
- [ ] 没有与现有 Skill 版本化/试驾计划重复造轮子
- [ ] 融合默认先试驾后保存
- [ ] 创作舞台只做提示，不做重操作
- [ ] 所有验证命令都可直接复制执行
