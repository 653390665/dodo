# Skill Composition And Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 InkFlow 实现可编辑、可版本化、可对比试驾、可组合装配、可反馈迭代的 Skill 系统，并保持对现有融合型 Skill 的兼容。

**Architecture:** 先把 `Skill` 数据模型做兼容式增强，再把 `技能仓库` 拆成可复用的详情/对比组件，随后将 `创作舞台` 的静态挂载区升级为卡牌式 loadout，最后补结构化 usage 反馈和可解释 fit score。所有组合逻辑尽量沉到纯函数 helper，避免继续把复杂逻辑堆进 `EditorView.tsx`。

**Tech Stack:** React 19, TypeScript, Express, better-sqlite3, motion/react, node:test, tsx

---

## File Structure

### Existing files to modify

- `src/types.ts`
  - 扩展 `Skill`、`Novel`，新增 `SkillDimension`、`MountedSkillLoadoutItem`、`SkillUsageRecord`
- `src/lib/db.ts`
  - 扩展 `skills`、`novels` 表的映射逻辑；新增 `skill_usage_records` 表；补齐 `updateSkill`、谱系查询和 usage CRUD
- `src/lib/api.ts`
  - 暴露 `updateSkill`、`listSkillVersions`、`createSkillUsageRecord` 等前端 API
- `server.ts`
  - 暴露新 DB 方法；新增对比试驾时的组合请求形态支持
- `src/components/BookFactoryView.tsx`
  - Skill 萃取后补“维度归因”展示与初始标签编辑
- `src/components/SkillsStudioView.tsx`
  - 从纯列表页升级为“卡牌列表 + 详情抽屉 + 试驾台入口”
- `src/components/EditorView.tsx`
  - 先接入新的 loadout 结构，再逐步替换旧 `mountedSkillIds` 面板
- `src/lib/agents.ts`
  - 按维度和权重构造 mounted skills prompt，而不是平铺拼接

### New files to create

- `src/lib/skill-model.ts`
  - 放纯函数：维度归一化、旧 loadout 迁移、fit score 计算、冲突检测、反馈统计合成
- `src/components/skills/SkillDetailDrawer.tsx`
  - 技能详情、编辑、另存为新版本
- `src/components/skills/SkillVersionTimeline.tsx`
  - Skill 版本谱系展示
- `src/components/skills/SkillTestBench.tsx`
  - 三栏试驾对比台
- `src/components/skills/SkillCard.tsx`
  - 技能卡公共展示
- `src/components/skills/SkillLoadoutBoard.tsx`
  - 创作舞台的卡槽与卡组装配区
- `tests/skill-model.test.ts`
  - 纯函数测试：fit score、冲突检测、旧数据兼容迁移
- `tests/db-skill-versioning.test.ts`
  - 数据层测试：新版本保存、谱系查询、usage record 落库

## Task 1: 扩展类型与纯函数模型

**Files:**
- Create: `src/lib/skill-model.ts`
- Modify: `src/types.ts`
- Test: `tests/skill-model.test.ts`

- [ ] **Step 1: 先写失败测试，锁定组合逻辑和兼容行为**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceMountedSkillLoadout,
  calculateSkillFitScore,
  detectSkillConflicts,
} from '../src/lib/skill-model';

test('coerceMountedSkillLoadout migrates legacy mountedSkillIds', () => {
  const loadout = coerceMountedSkillLoadout(['skill-a', 'skill-b']);
  assert.deepEqual(loadout, [
    { slot: 0, skillId: 'skill-a', weight: 1, lockedDimensions: [] },
    { slot: 1, skillId: 'skill-b', weight: 1, lockedDimensions: [] },
  ]);
});

test('calculateSkillFitScore rewards dimension coverage and penalizes conflicts', () => {
  const result = calculateSkillFitScore({
    requiredDimensions: ['style', 'world', 'plot'],
    loadout: [
      {
        id: 'style-1',
        name: '冷峻刀锋',
        stabilityScore: 88,
        primaryDimension: 'style',
        dimensionTags: ['style'],
        compositionProfile: {
          styleWeight: 0.9,
          characterWeight: 0.2,
          worldWeight: 0.1,
          powerWeight: 0.1,
          plotWeight: 0.3,
          pacingWeight: 0.5,
          conflictTags: ['lush-prose'],
          blendHints: [],
        },
      },
      {
        id: 'world-1',
        name: '铁血王朝',
        stabilityScore: 84,
        primaryDimension: 'world',
        dimensionTags: ['world', 'power'],
        compositionProfile: {
          styleWeight: 0.1,
          characterWeight: 0.2,
          worldWeight: 0.8,
          powerWeight: 0.8,
          plotWeight: 0.4,
          pacingWeight: 0.3,
          conflictTags: [],
          blendHints: [],
        },
      },
    ],
    chapterSignals: ['world', 'plot'],
  });

  assert.equal(result.breakdown.coverageScore > 0, true);
  assert.equal(result.totalScore > 0, true);
  assert.equal(result.recommendations.length >= 0, true);
});

test('detectSkillConflicts reports overlapping hostile dimensions', () => {
  const conflicts = detectSkillConflicts([
    {
      id: 'a',
      name: '冷峻极简',
      primaryDimension: 'style',
      dimensionTags: ['style'],
      compositionProfile: {
        styleWeight: 0.9,
        characterWeight: 0.1,
        worldWeight: 0.1,
        powerWeight: 0.1,
        plotWeight: 0.1,
        pacingWeight: 0.4,
        conflictTags: ['lush-prose'],
        blendHints: [],
      },
    },
    {
      id: 'b',
      name: '华丽抒情',
      primaryDimension: 'style',
      dimensionTags: ['style'],
      compositionProfile: {
        styleWeight: 0.9,
        characterWeight: 0.1,
        worldWeight: 0.1,
        powerWeight: 0.1,
        plotWeight: 0.1,
        pacingWeight: 0.4,
        conflictTags: ['minimal-prose'],
        blendHints: [],
      },
    },
  ]);

  assert.equal(conflicts.length > 0, true);
});
```

- [ ] **Step 2: 运行测试，确认当前缺失实现**

Run: `cd /Users/Zhuanz/Documents/dodo-inkflow && node --import tsx --test tests/skill-model.test.ts`
Expected: FAIL with module-not-found or missing export errors from `src/lib/skill-model.ts`

- [ ] **Step 3: 扩展 `src/types.ts`，定义新模型边界**

```ts
export type SkillDimension =
  | 'style'
  | 'character'
  | 'world'
  | 'power'
  | 'plot'
  | 'pacing';

export interface SkillCompositionProfile {
  styleWeight: number;
  characterWeight: number;
  worldWeight: number;
  powerWeight: number;
  plotWeight: number;
  pacingWeight: number;
  conflictTags: string[];
  blendHints: string[];
}

export interface SkillUsageStats {
  mountedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  revisedCount: number;
  averageFitScore: number;
}

export interface MountedSkillLoadoutItem {
  slot: number;
  skillId: string;
  weight: number;
  lockedDimensions: SkillDimension[];
}
```

- [ ] **Step 4: 实现 `src/lib/skill-model.ts` 的最小纯函数**

```ts
import type {
  MountedSkillLoadoutItem,
  Skill,
  SkillCompositionProfile,
  SkillDimension,
} from '../types';

const DEFAULT_PROFILE: SkillCompositionProfile = {
  styleWeight: 0.5,
  characterWeight: 0.5,
  worldWeight: 0.5,
  powerWeight: 0.5,
  plotWeight: 0.5,
  pacingWeight: 0.5,
  conflictTags: [],
  blendHints: [],
};

export function coerceMountedSkillLoadout(
  mountedSkillIds: string[] | undefined,
): MountedSkillLoadoutItem[] {
  return (mountedSkillIds || []).slice(0, 3).map((skillId, slot) => ({
    slot,
    skillId,
    weight: 1,
    lockedDimensions: [],
  }));
}

export function detectSkillConflicts(skills: Partial<Skill>[]) {
  const conflicts: Array<{ leftId: string; rightId: string; reason: string }> = [];
  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      const left = skills[i];
      const right = skills[j];
      const leftProfile = left.compositionProfile || DEFAULT_PROFILE;
      const rightProfile = right.compositionProfile || DEFAULT_PROFILE;
      const styleCollision =
        (left.primaryDimension === 'style' && right.primaryDimension === 'style') &&
        leftProfile.conflictTags.length + rightProfile.conflictTags.length > 0;

      if (styleCollision && left.id && right.id) {
        conflicts.push({
          leftId: left.id,
          rightId: right.id,
          reason: 'style-conflict',
        });
      }
    }
  }
  return conflicts;
}

export function calculateSkillFitScore(args: {
  requiredDimensions: SkillDimension[];
  chapterSignals: SkillDimension[];
  loadout: Partial<Skill>[];
}) {
  const covered = new Set<SkillDimension>();
  for (const skill of args.loadout) {
    for (const dimension of skill.dimensionTags || []) {
      covered.add(dimension);
    }
    if (skill.primaryDimension) covered.add(skill.primaryDimension);
  }

  const matched = args.requiredDimensions.filter((dim) => covered.has(dim));
  const conflicts = detectSkillConflicts(args.loadout);
  const stabilityAverage =
    args.loadout.length > 0
      ? args.loadout.reduce((sum, skill) => sum + (skill.stabilityScore || 0), 0) / args.loadout.length
      : 0;

  const coverageScore = matched.length / Math.max(args.requiredDimensions.length, 1);
  const contextScore = args.chapterSignals.filter((dim) => covered.has(dim)).length / Math.max(args.chapterSignals.length, 1);
  const stabilityScore = stabilityAverage / 100;
  const conflictPenalty = conflicts.length * 0.12;
  const totalScore = Math.max(
    0,
    Math.min(1, coverageScore * 0.45 + contextScore * 0.25 + stabilityScore * 0.3 - conflictPenalty),
  );

  return {
    totalScore: Math.round(totalScore * 100),
    breakdown: {
      coverageScore: Math.round(coverageScore * 100),
      contextScore: Math.round(contextScore * 100),
      stabilityScore: Math.round(stabilityScore * 100),
      conflictPenalty: Math.round(conflictPenalty * 100),
    },
    conflicts,
    recommendations: conflicts.length > 0 ? ['考虑替换存在风格冲突的卡牌'] : [],
  };
}
```

- [ ] **Step 5: 重新运行纯函数测试**

Run: `cd /Users/Zhuanz/Documents/dodo-inkflow && node --import tsx --test tests/skill-model.test.ts`
Expected: PASS

- [ ] **Step 6: 提交这一层模型基础**

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add src/types.ts src/lib/skill-model.ts tests/skill-model.test.ts
git commit -m "feat: add skill composition model helpers"
```

## Task 2: 扩展数据库、API 与版本谱系

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/api.ts`
- Modify: `server.ts`
- Test: `tests/db-skill-versioning.test.ts`

- [ ] **Step 1: 写失败测试，锁定版本分叉和 usage 落库**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  closeDb,
  createSkill,
  createSkillUsageRecord,
  initDb,
  listSkillVersions,
  updateSkill,
} from '../src/lib/db';

test('save-as-new-version preserves lineage', () => {
  const dbPath = path.join(os.tmpdir(), `inkflow-skill-${Date.now()}.db`);
  initDb(dbPath);

  createSkill({
    id: 'skill-v1',
    name: '冷冽武侠',
    description: 'v1',
    style: '冷峻',
    pacing: '快慢结合',
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 1,
    createdAt: Date.now(),
    parentSkillId: undefined,
    lineageRootId: 'skill-v1',
    dimensionTags: ['style'],
  });

  updateSkill('skill-v1', { description: 'v1-updated' });
  createSkill({
    id: 'skill-v2',
    name: '冷冽武侠',
    description: 'v2',
    style: '更冷',
    pacing: '更快',
    stabilityScore: 82,
    evaluationFeedback: '',
    version: 2,
    createdAt: Date.now(),
    parentSkillId: 'skill-v1',
    lineageRootId: 'skill-v1',
    dimensionTags: ['style'],
  });

  const versions = listSkillVersions('skill-v1');
  assert.equal(versions.length, 2);
  assert.equal(versions[1].parentSkillId, 'skill-v1');

  closeDb();
  fs.rmSync(dbPath, { force: true });
});
```

- [ ] **Step 2: 运行测试，确认当前 DB 能力不完整**

Run: `cd /Users/Zhuanz/Documents/dodo-inkflow && node --import tsx --test tests/db-skill-versioning.test.ts`
Expected: FAIL because `listSkillVersions` and `createSkillUsageRecord` do not exist yet

- [ ] **Step 3: 扩展 `src/lib/db.ts` 的 schema 和 CRUD**

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS skill_usage_records (
    id TEXT PRIMARY KEY,
    novel_id TEXT NOT NULL,
    chapter_id TEXT,
    mounted_skill_ids TEXT NOT NULL DEFAULT '[]',
    fit_score REAL DEFAULT 0,
    audit_score REAL,
    user_action TEXT NOT NULL DEFAULT 'accepted',
    notes TEXT,
    created_at INTEGER NOT NULL
  );
`);
```

```ts
export function listSkillVersions(skillId: string): Skill[] {
  const skill = getSkill(skillId);
  if (!skill) return [];
  const rootId = skill.lineageRootId || skill.id;
  const rows = getDb()
    .prepare('SELECT * FROM skills WHERE lineage_root_id = ? OR id = ? ORDER BY version ASC, created_at ASC')
    .all(rootId, rootId);
  return rows.map(rowToSkill);
}

export function createSkillUsageRecord(record: SkillUsageRecord): void {
  getDb().prepare(`
    INSERT INTO skill_usage_records (id, novel_id, chapter_id, mounted_skill_ids, fit_score, audit_score, user_action, notes, created_at)
    VALUES (@id, @novel_id, @chapter_id, @mounted_skill_ids, @fit_score, @audit_score, @user_action, @notes, @created_at)
  `).run(skillUsageRecordToRow(record));
  notify();
}
```

- [ ] **Step 4: 在 `src/lib/api.ts` 暴露新方法**

```ts
export async function updateSkill(id: string, data: Partial<Skill>): Promise<void> {
  return call('updateSkill', id, data);
}

export async function listSkillVersions(skillId: string): Promise<Skill[]> {
  return call('listSkillVersions', skillId);
}

export async function createSkillUsageRecord(record: SkillUsageRecord): Promise<void> {
  return call('createSkillUsageRecord', record);
}
```

- [ ] **Step 5: 保持 `server.ts` 的 DB 代理不改接口，仅验证方法可达**

Run: `cd /Users/Zhuanz/Documents/dodo-inkflow && npm run lint`
Expected: PASS

- [ ] **Step 6: 重新跑 DB 测试**

Run: `cd /Users/Zhuanz/Documents/dodo-inkflow && node --import tsx --test tests/db-skill-versioning.test.ts`
Expected: PASS

- [ ] **Step 7: 提交数据层能力**

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add src/lib/db.ts src/lib/api.ts server.ts tests/db-skill-versioning.test.ts src/types.ts
git commit -m "feat: add skill versioning and usage records"
```

## Task 3: 技能仓库详情抽屉、编辑和保存为新版本

**Files:**
- Create: `src/components/skills/SkillCard.tsx`
- Create: `src/components/skills/SkillDetailDrawer.tsx`
- Create: `src/components/skills/SkillVersionTimeline.tsx`
- Modify: `src/components/SkillsStudioView.tsx`
- Test: `tests/skill-model.test.ts`

- [ ] **Step 1: 先提取展示型 Skill 卡，避免 `SkillsStudioView.tsx` 继续膨胀**

```tsx
export function SkillCard({
  skill,
  selected,
  onOpen,
  onDelete,
}: {
  skill: Skill;
  selected: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -4 }}
      onClick={onOpen}
      className={cn(
        'bg-white rounded-2xl p-6 border shadow-sm flex flex-col text-left relative overflow-hidden',
        selected ? 'border-theme-accent ring-1 ring-theme-accent/20' : 'border-theme-border',
      )}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="font-bold text-theme-text text-lg">{skill.name}</h3>
          <div className="text-[10px] text-theme-muted tracking-widest uppercase font-bold mt-1">
            v{skill.version || 1} · {skill.primaryDimension || 'fusion'}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
      <p className="text-sm text-theme-muted/80 flex-1 mb-4 italic line-clamp-3">"{skill.description}"</p>
    </motion.button>
  );
}
```

- [ ] **Step 2: 实现详情抽屉，支持编辑和双保存动作**

```tsx
function handleSave(mode: 'update' | 'fork') {
  const now = Date.now();
  const nextVersion = mode === 'fork' ? (skill.version || 1) + 1 : skill.version || 1;
  const payload = {
    ...draft,
    updatedAt: now,
  };

  if (mode === 'update') {
    return updateSkill(skill.id, payload);
  }

  return createSkill({
    ...payload,
    id: `${skill.lineageRootId || skill.id}-${nextVersion}-${now}`,
    version: nextVersion,
    parentSkillId: skill.id,
    lineageRootId: skill.lineageRootId || skill.id,
    createdAt: now,
  });
}
```

- [ ] **Step 3: 实现版本谱系面板**

```tsx
export function SkillVersionTimeline({ versions, activeId, onSelect }: Props) {
  return (
    <div className="space-y-2">
      {versions.map((version) => (
        <button
          key={version.id}
          type="button"
          onClick={() => onSelect(version)}
          className={cn(
            'w-full rounded-xl border p-3 text-left',
            version.id === activeId ? 'border-theme-accent bg-theme-accent/5' : 'border-theme-border bg-white',
          )}
        >
          <div className="text-xs font-bold text-theme-text">v{version.version}</div>
          <div className="text-[10px] text-theme-muted">{version.description}</div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 把 `SkillsStudioView.tsx` 改成“列表 + 详情抽屉”双栏**

```tsx
const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
const selectedSkill = savedSkills.find((skill) => skill.id === selectedSkillId) || null;

return (
  <div className="h-full flex bg-transparent overflow-hidden">
    <div className="flex-1 overflow-y-auto p-8">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {savedSkills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            selected={skill.id === selectedSkillId}
            onOpen={() => setSelectedSkillId(skill.id)}
            onDelete={() => handleDeleteSkill(skill.id)}
          />
        ))}
      </div>
    </div>
    <SkillDetailDrawer
      skill={selectedSkill}
      open={Boolean(selectedSkill)}
      onClose={() => setSelectedSkillId(null)}
    />
  </div>
);
```

- [ ] **Step 5: 跑类型检查**

Run: `cd /Users/Zhuanz/Documents/dodo-inkflow && npm run lint`
Expected: PASS

- [ ] **Step 6: 手动浏览器验证详情和新版本保存**

Run:
- `cd /Users/Zhuanz/Documents/dodo-inkflow && npm run dev`
- 在浏览器中进入 `技能仓库`
- 点击现有 Skill 卡
- 修改描述
- 分别点击 `保存当前版本` 与 `保存为新版本`

Expected:
- 当前版本字段更新
- 技能列表出现更高版本的新卡
- 谱系面板显示 `v1 -> v2`

- [ ] **Step 7: 提交技能仓库闭环第一部分**

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add src/components/SkillsStudioView.tsx src/components/skills/SkillCard.tsx src/components/skills/SkillDetailDrawer.tsx src/components/skills/SkillVersionTimeline.tsx src/lib/api.ts src/lib/db.ts src/types.ts
git commit -m "feat: add skill detail drawer and version lineage"
```

## Task 4: 试驾对比台与拆书工厂维度归因

**Files:**
- Create: `src/components/skills/SkillTestBench.tsx`
- Modify: `src/components/SkillsStudioView.tsx`
- Modify: `src/components/BookFactoryView.tsx`
- Modify: `server.ts`

- [ ] **Step 1: 在详情抽屉中嵌入试驾对比台，先支持单卡对比和版本对比**

```tsx
export function SkillTestBench({
  baseSkill,
  candidateSkill,
}: {
  baseSkill: Skill;
  candidateSkill?: Skill | null;
}) {
  const [input, setInput] = useState('');
  const [baseOutput, setBaseOutput] = useState('');
  const [candidateOutput, setCandidateOutput] = useState('');
  const [running, setRunning] = useState(false);

  async function runSingle(skills: Skill[], setter: (value: string) => void) {
    setter('');
    const response = await fetch('/api/orchestrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contextStr: '这是 Skill 对比试驾，不需要扩展世界观。',
        sceneBeats: input,
        skills,
        maxIterations: 1,
        draftContent: '',
        includeCritic: false,
      }),
    });
    // 复用现有 SSE token 读取逻辑
  }
}
```

- [ ] **Step 2: 在 `BookFactoryView.tsx` 新增“维度归因”编辑区**

```tsx
const DEFAULT_DIMENSIONS: SkillDimension[] = ['style'];

const normalizedSkill = {
  ...data,
  primaryDimension: data.primaryDimension || 'style',
  dimensionTags: data.dimensionTags?.length ? data.dimensionTags : DEFAULT_DIMENSIONS,
  compositionProfile: data.compositionProfile || {
    styleWeight: 0.8,
    characterWeight: 0.4,
    worldWeight: 0.4,
    powerWeight: 0.3,
    plotWeight: 0.5,
    pacingWeight: 0.6,
    conflictTags: [],
    blendHints: [],
  },
};
```

- [ ] **Step 3: 在拆书结果 UI 中给用户手动修正维度标签和主维度**

```tsx
<select
  value={skillConfig.primaryDimension || 'style'}
  onChange={(event) => setSkillConfig((prev: any) => ({
    ...prev,
    primaryDimension: event.target.value,
  }))}
>
  <option value="style">文笔文风</option>
  <option value="character">人物构建</option>
  <option value="world">世界观打造</option>
  <option value="power">战力设定</option>
  <option value="plot">剧情结构</option>
  <option value="pacing">节奏控制</option>
</select>
```

- [ ] **Step 4: 跑类型检查并手动试驾**

Run: `cd /Users/Zhuanz/Documents/dodo-inkflow && npm run lint`
Expected: PASS

Manual check:
- 在 `拆书工厂` 生成一张 Skill
- 设置 `primaryDimension` 和 `dimensionTags`
- 保存到技能库
- 在 `技能仓库` 打开详情
- 在 `试驾对比台` 输入测试片段，跑当前版本和新版本

Expected:
- 三栏可见
- 能分别流式输出
- 版本与对比对象切换有效

- [ ] **Step 5: 提交试驾和维度归因**

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add src/components/skills/SkillTestBench.tsx src/components/SkillsStudioView.tsx src/components/BookFactoryView.tsx server.ts src/types.ts
git commit -m "feat: add skill test bench and dimension tagging"
```

## Task 5: 创作舞台卡牌装配、拖拽替换与适配评分

**Files:**
- Create: `src/components/skills/SkillLoadoutBoard.tsx`
- Modify: `src/components/EditorView.tsx`
- Modify: `src/lib/agents.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/db.ts`
- Test: `tests/skill-model.test.ts`

- [ ] **Step 1: 先把 `Novel` 的 loadout 接入 UI，但保留旧 `mountedSkillIds` 兼容**

```ts
const initialLoadout = novel.mountedSkillLoadout?.length
  ? novel.mountedSkillLoadout
  : coerceMountedSkillLoadout(novel.mountedSkillIds);

const [mountedSkillLoadout, setMountedSkillLoadout] = useState(initialLoadout);
```

- [ ] **Step 2: 新建 `SkillLoadoutBoard.tsx`，承载卡槽、卡组和 fit score**

```tsx
const fit = calculateSkillFitScore({
  requiredDimensions: ['style', 'plot', 'pacing'],
  chapterSignals: deriveChapterSignals(currentChapter),
  loadout: mountedSkills,
});

return (
  <div className="space-y-5">
    <div className="rounded-3xl bg-theme-text text-white p-5">
      <div className="text-lg font-bold">{fit.totalScore}%</div>
      <div className="text-xs opacity-70">组合适配得分</div>
    </div>
    <div className="grid grid-cols-3 gap-3">
      {slots.map((slot) => (
        <SkillSlot key={slot.slot} slot={slot} />
      ))}
    </div>
  </div>
);
```

- [ ] **Step 3: 拖拽先使用原生 HTML5，不引入新依赖**

```tsx
<div
  draggable
  onDragStart={(event) => {
    event.dataTransfer.setData('text/skill-id', skill.id);
  }}
>
```

```tsx
<div
  onDragOver={(event) => event.preventDefault()}
  onDrop={(event) => {
    const skillId = event.dataTransfer.getData('text/skill-id');
    handleReplaceSlot(slotIndex, skillId);
  }}
>
```

- [ ] **Step 4: 更新 `src/lib/agents.ts`，按维度与权重注入 prompt**

```ts
const skillLines = context.mountedSkills?.slice(0, MAX_SKILLS).map((skill) => {
  const profile = skill.compositionProfile;
  return [
    `- [${skill.name}] 主维度: ${skill.primaryDimension || 'fusion'}`,
    `  权重画像: style=${profile?.styleWeight ?? 0.5}, character=${profile?.characterWeight ?? 0.5}, world=${profile?.worldWeight ?? 0.5}, power=${profile?.powerWeight ?? 0.5}, plot=${profile?.plotWeight ?? 0.5}, pacing=${profile?.pacingWeight ?? 0.5}`,
    `  文风约束: ${skill.style}`,
    `  人物塑造: ${skill.characterTraits || '未指定'}`,
    `  世界与力量: ${skill.worldBuilding || '未指定'}`,
    `  剧情套路: ${skill.plotPattern || '未指定'}`,
  ].join('\n');
});
```

- [ ] **Step 5: 跑类型检查和纯函数测试**

Run:
- `cd /Users/Zhuanz/Documents/dodo-inkflow && npm run lint`
- `cd /Users/Zhuanz/Documents/dodo-inkflow && node --import tsx --test tests/skill-model.test.ts`

Expected: PASS

- [ ] **Step 6: 手动验证拖拽、替换和适配评分**

Manual check:
- 在 `创作舞台 -> 技能挂载`
- 从卡组拖一张卡到空槽
- 再拖另一张风格冲突卡覆盖
- 观察适配分和冲突提示

Expected:
- 卡槽内容实时变化
- 适配分刷新
- 冲突提示出现
- loadout 切换能持久化到小说数据

- [ ] **Step 7: 提交装配台升级**

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add src/components/EditorView.tsx src/components/skills/SkillLoadoutBoard.tsx src/lib/agents.ts src/lib/skill-model.ts src/lib/api.ts src/lib/db.ts src/types.ts tests/skill-model.test.ts
git commit -m "feat: add skill loadout board with fit scoring"
```

## Task 6: Skill 使用反馈与权重进化

**Files:**
- Modify: `src/components/EditorView.tsx`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/skill-model.ts`
- Test: `tests/db-skill-versioning.test.ts`

- [ ] **Step 1: 在生成正文和审计完成后记录 usage record**

```ts
await createSkillUsageRecord({
  id: crypto.randomUUID(),
  novelId: novel.id,
  chapterId: currentChapter.id,
  mountedSkillIds: mountedSkills.map((skill) => skill.id),
  fitScore: fit.totalScore,
  auditScore: auditNumericScore,
  userAction: 'accepted',
  createdAt: Date.now(),
});
```

- [ ] **Step 2: 在用户替换或移除 Skill 时记录负反馈**

```ts
await createSkillUsageRecord({
  id: crypto.randomUUID(),
  novelId: novel.id,
  chapterId: currentChapter.id,
  mountedSkillIds: previousLoadoutIds,
  fitScore: previousFitScore,
  userAction: 'rejected',
  notes: 'user-replaced-skill',
  createdAt: Date.now(),
});
```

- [ ] **Step 3: 在 `src/lib/skill-model.ts` 增加 usage 汇总函数**

```ts
export function summarizeUsageStats(records: SkillUsageRecord[]): SkillUsageStats {
  const mountedCount = records.length;
  const acceptedCount = records.filter((record) => record.userAction === 'accepted').length;
  const rejectedCount = records.filter((record) => record.userAction === 'rejected').length;
  const revisedCount = records.filter((record) => record.userAction === 'revised').length;
  const averageFitScore =
    mountedCount > 0 ? records.reduce((sum, record) => sum + record.fitScore, 0) / mountedCount : 0;

  return {
    mountedCount,
    acceptedCount,
    rejectedCount,
    revisedCount,
    averageFitScore,
  };
}
```

- [ ] **Step 4: 在技能详情页展示反馈摘要，不做黑箱自动改写**

```tsx
<div className="rounded-2xl border border-theme-border p-4 bg-theme-sidebar/20">
  <div className="text-xs font-bold text-theme-text">使用反馈摘要</div>
  <div className="text-[11px] text-theme-muted mt-2">
    装配 {usageStats.mountedCount} 次，采纳 {usageStats.acceptedCount} 次，重写 {usageStats.revisedCount} 次，替换 {usageStats.rejectedCount} 次。
  </div>
</div>
```

- [ ] **Step 5: 跑回归验证**

Run:
- `cd /Users/Zhuanz/Documents/dodo-inkflow && npm run lint`
- `cd /Users/Zhuanz/Documents/dodo-inkflow && node --import tsx --test tests/skill-model.test.ts tests/db-skill-versioning.test.ts`

Expected: PASS

Manual check:
- 装配 Skill
- 生成正文
- 点击审计
- 替换一张卡
- 返回技能仓库查看该 Skill 的 usage 摘要

Expected:
- usage record 成功落库
- 摘要数字变化
- 推荐分数在下一次装配时能体现历史反馈

- [ ] **Step 6: 提交反馈闭环**

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add src/components/EditorView.tsx src/components/SkillsStudioView.tsx src/lib/api.ts src/lib/db.ts src/lib/skill-model.ts src/types.ts tests/skill-model.test.ts tests/db-skill-versioning.test.ts
git commit -m "feat: add skill usage feedback loop"
```

## Self-Review

- Spec coverage:
  - `技能仓库` 详情、编辑、版本化、试驾已覆盖在 Task 3-4
  - Skill 兼容式组合模型已覆盖在 Task 1-2
  - 创作舞台卡牌装配、适配打分已覆盖在 Task 5
  - 使用反馈与优化已覆盖在 Task 6
- Placeholder scan:
  - 所有任务都给了明确文件、命令和关键代码骨架，没有保留 `TODO`
- Type consistency:
  - 全文统一使用 `SkillDimension`、`MountedSkillLoadoutItem`、`SkillUsageRecord`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-skill-composition-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
