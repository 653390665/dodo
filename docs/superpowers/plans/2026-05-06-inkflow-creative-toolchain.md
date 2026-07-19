# InkFlow 创作工具链 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 InkFlow 增加灵感碎片板、伏笔系统、节奏诊断、导出功能四个创作维度，形成「脑洞捕获→展开→写作→诊断→导出」全链路。

**Architecture:** 新增 2 张 SQLite 表、4 个 AI API 端点、4 个 React 组件。所有新组件作为编辑器 AI 侧边栏的新 Tab 集成，不改变现有页面路由结构。导出功能使用纯服务端实现（不依赖第三方 EPUB 库，手动构建 EPUB 文件结构）。

**Tech Stack:** React 19 + TypeScript + Tailwind CSS 4 + Express + better-sqlite3 + GoogleGenAI SDK

---

## 文件结构总览

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/types.ts` | 修改 | 新增 IdeaFragment、Foreshadowing 类型 |
| `src/lib/db.ts` | 修改 | 新增 idea_fragments、foreshadowings 表 + CRUD |
| `src/lib/api.ts` | 修改 | 新增前端 API 调用函数 |
| `server.ts` | 修改 | 新增 /api/expand-fragment、/api/detect-foreshadowing、/api/analyze-pacing、/api/export 端点 |
| `src/components/IdeaFragmentBoard.tsx` | 新建 | 灵感碎片板组件 |
| `src/components/ForeshadowingPanel.tsx` | 新建 | 伏笔管理面板组件 |
| `src/components/PacingDashboard.tsx` | 新建 | 节奏诊断仪表盘组件 |
| `src/components/EditorView.tsx` | 修改 | 新增 agentTab: 'ideas'、'foreshadowing'、'pacing' |

---

### Task 1: 数据层——类型定义与数据库表

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: 添加 IdeaFragment 和 Foreshadowing 类型**

在 `src/types.ts` 末尾、`export type ViewType` 之前添加：

```typescript
export interface IdeaFragment {
  id: string;
  novelId?: string;
  content: string;
  type: 'scene' | 'dialogue' | 'character' | 'plot_hook' | 'world';
  status: 'raw' | 'expanded' | 'converted';
  aiExpansion?: string;
  targetChapterId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Foreshadowing {
  id: string;
  novelId: string;
  title: string;
  description: string;
  status: 'planted' | 'hinted' | 'payoff';
  plantedChapterId?: string;
  payoffChapterId?: string;
  relatedCharacterIds: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PacingData {
  chapterId: string;
  chapterTitle: string;
  order: number;
  wordCount: number;
  tensionScore: number;       // 0-100 张力评分
  payoffCount: number;          // 本章爽点/爆点数量
  emotionLabel: string;         // 情绪标签
}
```

- [ ] **Step 2: 在 db.ts 的 initDb() 中添加新表**

在 `src/lib/db.ts` 的 `initDb()` 函数中，`CREATE TABLE IF NOT EXISTS skills` 之后添加：

```sql
CREATE TABLE IF NOT EXISTS idea_fragments (
  id TEXT PRIMARY KEY,
  novel_id TEXT,
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'scene',
  status TEXT NOT NULL DEFAULT 'raw',
  ai_expansion TEXT,
  target_chapter_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS foreshadowings (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planted',
  planted_chapter_id TEXT,
  payoff_chapter_id TEXT,
  related_character_ids TEXT DEFAULT '[]',
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);
```

- [ ] **Step 3: 添加 Row 映射函数**

在 `src/lib/db.ts` 末尾、`deleteSkill` 之后添加：

```typescript
function rowToIdeaFragment(row: any): IdeaFragment {
  return {
    ...row,
    novelId: row.novel_id,
    aiExpansion: row.ai_expansion,
    targetChapterId: row.target_chapter_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ideaFragmentToRow(f: IdeaFragment): any {
  return {
    id: f.id,
    novel_id: f.novelId || null,
    content: f.content,
    type: f.type,
    status: f.status,
    ai_expansion: f.aiExpansion || null,
    target_chapter_id: f.targetChapterId || null,
    created_at: f.createdAt,
    updated_at: f.updatedAt,
  };
}

function rowToForeshadowing(row: any): Foreshadowing {
  return {
    ...row,
    novelId: row.novel_id,
    plantedChapterId: row.planted_chapter_id,
    payoffChapterId: row.payoff_chapter_id,
    relatedCharacterIds: JSON.parse(row.related_character_ids || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function foreshadowingToRow(f: Foreshadowing): any {
  return {
    id: f.id,
    novel_id: f.novelId,
    title: f.title,
    description: f.description,
    status: f.status,
    planted_chapter_id: f.plantedChapterId || null,
    payoff_chapter_id: f.payoffChapterId || null,
    related_character_ids: JSON.stringify(f.relatedCharacterIds || []),
    notes: f.notes || null,
    created_at: f.createdAt,
    updated_at: f.updatedAt,
  };
}
```

- [ ] **Step 4: 添加 CRUD 函数**

在 `src/lib/db.ts` 末尾添加：

```typescript
// IdeaFragment
export function listIdeaFragments(novelId?: string): IdeaFragment[] {
  if (novelId) {
    return getDb().prepare('SELECT * FROM idea_fragments WHERE novel_id = ? OR novel_id IS NULL ORDER BY created_at DESC').all().map(rowToIdeaFragment);
  }
  return getDb().prepare('SELECT * FROM idea_fragments ORDER BY created_at DESC').all().map(rowToIdeaFragment);
}
export function createIdeaFragment(f: IdeaFragment): void {
  getDb().prepare(`INSERT INTO idea_fragments (id, novel_id, content, type, status, ai_expansion, target_chapter_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(ideaFragmentToRow(f)));
  notify();
}
export function updateIdeaFragment(id: string, data: Partial<IdeaFragment>): void {
  const setClauses: string[] = [];
  const values: any[] = [];
  if (data.content !== undefined) { setClauses.push('content = ?'); values.push(data.content); }
  if (data.type !== undefined) { setClauses.push('type = ?'); values.push(data.type); }
  if (data.status !== undefined) { setClauses.push('status = ?'); values.push(data.status); }
  if (data.aiExpansion !== undefined) { setClauses.push('ai_expansion = ?'); values.push(data.aiExpansion); }
  if (data.targetChapterId !== undefined) { setClauses.push('target_chapter_id = ?'); values.push(data.targetChapterId); }
  if (data.novelId !== undefined) { setClauses.push('novel_id = ?'); values.push(data.novelId); }
  setClauses.push('updated_at = ?'); values.push(Date.now());
  values.push(id);
  getDb().prepare(`UPDATE idea_fragments SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  notify();
}
export function deleteIdeaFragment(id: string): void {
  getDb().prepare('DELETE FROM idea_fragments WHERE id = ?').run(id);
  notify();
}

// Foreshadowing
export function listForeshadowings(novelId: string): Foreshadowing[] {
  return getDb().prepare('SELECT * FROM foreshadowings WHERE novel_id = ? ORDER BY created_at ASC').all(novelId).map(rowToForeshadowing);
}
export function createForeshadowing(f: Foreshadowing): void {
  getDb().prepare(`INSERT INTO foreshadowings (id, novel_id, title, description, status, planted_chapter_id, payoff_chapter_id, related_character_ids, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(foreshadowingToRow(f)));
  notify();
}
export function updateForeshadowing(id: string, data: Partial<Foreshadowing>): void {
  const setClauses: string[] = [];
  const values: any[] = [];
  if (data.title !== undefined) { setClauses.push('title = ?'); values.push(data.title); }
  if (data.description !== undefined) { setClauses.push('description = ?'); values.push(data.description); }
  if (data.status !== undefined) { setClauses.push('status = ?'); values.push(data.status); }
  if (data.plantedChapterId !== undefined) { setClauses.push('planted_chapter_id = ?'); values.push(data.plantedChapterId); }
  if (data.payoffChapterId !== undefined) { setClauses.push('payoff_chapter_id = ?'); values.push(data.payoffChapterId); }
  if (data.relatedCharacterIds !== undefined) { setClauses.push('related_character_ids = ?'); values.push(JSON.stringify(data.relatedCharacterIds)); }
  if (data.notes !== undefined) { setClauses.push('notes = ?'); values.push(data.notes); }
  setClauses.push('updated_at = ?'); values.push(Date.now());
  values.push(id);
  getDb().prepare(`UPDATE foreshadowings SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  notify();
}
export function deleteForeshadowing(id: string): void {
  getDb().prepare('DELETE FROM foreshadowings WHERE id = ?').run(id);
  notify();
}
```

- [ ] **Step 5: 在 api.ts 中添加前端调用函数**

在 `src/lib/api.ts` 末尾 `deleteSkill` 之后添加：

```typescript
// IdeaFragment
export async function listIdeaFragments(novelId?: string): Promise<IdeaFragment[]> { return call('listIdeaFragments', novelId); }
export async function createIdeaFragment(f: IdeaFragment): Promise<void> { return call('createIdeaFragment', f); }
export async function updateIdeaFragment(id: string, data: Partial<IdeaFragment>): Promise<void> { return call('updateIdeaFragment', id, data); }
export async function deleteIdeaFragment(id: string): Promise<void> { return call('deleteIdeaFragment', id); }

// Foreshadowing
export async function listForeshadowings(novelId: string): Promise<Foreshadowing[]> { return call('listForeshadowings', novelId); }
export async function createForeshadowing(f: Foreshadowing): Promise<void> { return call('createForeshadowing', f); }
export async function updateForeshadowing(id: string, data: Partial<Foreshadowing>): Promise<void> { return call('updateForeshadowing', id, data); }
export async function deleteForeshadowing(id: string): Promise<void> { return call('deleteForeshadowing', id); }
```

确保 `api.ts` 顶部 import 包含新类型：

```typescript
import type { Novel, Character, Location, Item, Faction, PowerLevel, TimelineEvent, Chapter, ChapterVersion, Skill, IdeaFragment, Foreshadowing } from '../types';
```

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/lib/db.ts src/lib/api.ts
git commit -m "feat: add IdeaFragment and Foreshadowing data layer"
```

---

### Task 2: 灵感碎片板组件

**Files:**
- Create: `src/components/IdeaFragmentBoard.tsx`
- Modify: `src/components/EditorView.tsx` (add 'ideas' tab)
- Modify: `server.ts` (add /api/expand-fragment)

- [ ] **Step 1: 添加 API 端点 /api/expand-fragment**

在 `server.ts` 中，`/api/config` POST 端点之后添加：

```typescript
app.post('/api/expand-fragment', async (req, res) => {
  try {
    const { content, type } = req.body;
    const config = getConfig();
    const prompts: Record<string, string> = {
      scene: `你是一个小说创意扩展助手。请将以下场景灵感扩展为一段 200-300 字的场景细纲，包含：环境氛围、关键动作、情绪基调。\n灵感：${content}`,
      dialogue: `你是一个小说创意扩展助手。请将以下对话灵感扩展为一段 150-250 字的对话场景草案，包含：说话人、对话内容、对话中的潜台词。\n灵感：${content}`,
      character: `你是一个小说创意扩展助手。请将以下角色灵感扩展为一份 200-300 字的角色小传草案，包含：外貌、性格、核心欲望、背景故事。\n灵感：${content}`,
      plot_hook: `你是一个小说创意扩展助手。请将以下剧情创意扩展为一段 200-300 字的剧情展开方案，包含：起因、发展、高潮雏形、可能的转折。\n灵感：${content}`,
      world: `你是一个小说创意扩展助手。请将以下世界观灵感扩展为一段 200-300 字的设定描述，包含：规则逻辑、视觉特征、对故事的影响。\n灵感：${content}`,
    };
    const prompt = prompts[type] || prompts.scene;

    const response = await getAi().models.generateContent({
      model: config.model,
      contents: prompt,
    });
    res.json({ expansion: response.text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});
```

- [ ] **Step 2: 创建 IdeaFragmentBoard 组件**

创建 `src/components/IdeaFragmentBoard.tsx`：

```typescript
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Lightbulb, MessageSquare, User, Crosshair, Globe, Sparkles, Loader2, ArrowRight } from 'lucide-react';
import { IdeaFragment } from '../types';
import { listIdeaFragments, createIdeaFragment, updateIdeaFragment, deleteIdeaFragment, subscribeToChanges } from '../lib/api';
import { motion } from 'motion/react';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  scene: <Crosshair size={14} />,
  dialogue: <MessageSquare size={14} />,
  character: <User size={14} />,
  plot_hook: <Sparkles size={14} />,
  world: <Globe size={14} />,
};

const TYPE_LABELS: Record<string, string> = {
  scene: '场景',
  dialogue: '对白',
  character: '角色',
  plot_hook: '剧情钩子',
  world: '世界观',
};

interface Props {
  novelId?: string;
  compact?: boolean; // true when embedded in editor sidebar
}

export function IdeaFragmentBoard({ novelId, compact }: Props) {
  const [fragments, setFragments] = useState<IdeaFragment[]>([]);
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState<IdeaFragment['type']>('scene');
  const [expandingId, setExpandingId] = useState<string | null>(null);

  const refresh = async () => {
    setFragments(await listIdeaFragments(novelId));
  };

  useEffect(() => { refresh(); return subscribeToChanges(refresh); }, [novelId]);

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    const f: IdeaFragment = {
      id: Date.now().toString(),
      novelId,
      content: newContent.trim(),
      type: newType,
      status: 'raw',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await createIdeaFragment(f);
    setNewContent('');
    setFragments(prev => [f, ...prev]);
  };

  const handleExpand = async (f: IdeaFragment) => {
    setExpandingId(f.id);
    try {
      const res = await fetch('/api/expand-fragment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: f.content, type: f.type }),
      });
      const data = await res.json();
      await updateIdeaFragment(f.id, { aiExpansion: data.expansion, status: 'expanded' });
      setFragments(prev => prev.map(x => x.id === f.id ? { ...x, aiExpansion: data.expansion, status: 'expanded' as const } : x));
    } catch (e) {
      console.error('Expand failed', e);
    } finally {
      setExpandingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteIdeaFragment(id);
    setFragments(prev => prev.filter(f => f.id !== id));
  };

  return (
    <div className="space-y-4">
      {/* Input area */}
      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm space-y-3">
        <div className="flex gap-2">
          {(['scene', 'dialogue', 'character', 'plot_hook', 'world'] as const).map(t => (
            <button
              key={t}
              onClick={() => setNewType(t)}
              className={`text-[10px] px-2 py-1 rounded-full font-medium transition-all flex items-center gap-1 ${
                newType === t ? 'bg-theme-accent text-white' : 'bg-theme-sidebar text-theme-muted hover:bg-theme-border'
              }`}
            >
              {TYPE_ICONS[t]} {compact ? '' : TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="随手记下一个灵感碎片..."
            className="flex-1 text-sm px-3 py-2 bg-theme-sidebar/30 border border-theme-border rounded-lg outline-none focus:border-theme-accent transition-colors"
          />
          <button onClick={handleAdd} disabled={!newContent.trim()} className="px-4 py-2 bg-theme-accent text-white rounded-lg text-sm font-bold disabled:opacity-50 hover:opacity-90 transition-all">
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Fragment list */}
      <div className="space-y-3">
        {fragments.map(f => (
          <motion.div
            key={f.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
              f.status === 'expanded' ? 'border-theme-accent/30' : 'border-theme-border/40'
            }`}
          >
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-theme-muted">{TYPE_ICONS[f.type]}</span>
                <span className="text-[10px] font-bold text-theme-muted uppercase">{TYPE_LABELS[f.type]}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                  f.status === 'raw' ? 'bg-amber-50 text-amber-700' :
                  f.status === 'expanded' ? 'bg-blue-50 text-blue-700' :
                  'bg-emerald-50 text-emerald-700'
                }`}>
                  {f.status === 'raw' ? '原始' : f.status === 'expanded' ? '已展开' : '已转化'}
                </span>
              </div>
              <p className="text-sm text-theme-text leading-relaxed">{f.content}</p>
              {f.aiExpansion && (
                <div className="mt-3 p-3 bg-theme-sidebar/20 rounded-lg text-xs text-theme-text leading-relaxed whitespace-pre-wrap border-l-2 border-theme-accent">
                  {f.aiExpansion}
                </div>
              )}
            </div>
            <div className="flex border-t border-theme-border/30">
              {f.status === 'raw' && (
                <button
                  onClick={() => handleExpand(f)}
                  disabled={expandingId === f.id}
                  className="flex-1 py-2 text-xs font-bold text-theme-accent hover:bg-theme-accent/5 transition-colors flex items-center justify-center gap-1.5"
                >
                  {expandingId === f.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  AI 展开
                </button>
              )}
              <button
                onClick={() => handleDelete(f.id)}
                className="flex-1 py-2 text-xs text-theme-muted hover:text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5"
              >
                <Trash2 size={12} /> 删除
              </button>
            </div>
          </motion.div>
        ))}
        {fragments.length === 0 && (
          <div className="text-center py-12 text-xs text-theme-muted opacity-50">
            <Lightbulb size={24} className="mx-auto mb-2 opacity-20" />
            暂无灵感碎片，在上方输入框记录你的脑洞
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 在 EditorView 侧边栏中添加 'ideas' Tab**

在 `src/components/EditorView.tsx` 中：

1. import IdeaFragmentBoard:
```typescript
import { IdeaFragmentBoard } from './IdeaFragmentBoard';
```

2. 在 agentTab 类型中添加 'ideas'（约第 67 行）:
```typescript
const [agentTab, setAgentTab] = useState<... | 'ideas'>('outline');
```

3. 在 tabs 按钮区域（约 892-970 行），"故事大纲"按钮之前添加：
```typescript
<button 
  onClick={() => setAgentTab('ideas')}
  className={cn(
    "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
    agentTab === 'ideas' 
      ? "bg-theme-text text-white" 
      : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
  )}
>
  <Lightbulb size={12} /> 灵感
</button>
```

4. 在 content 区域（约 974 行 AnimatePresence 内），'outline' 分支之前添加：
```typescript
{agentTab === 'ideas' && (
  <motion.div key="ideas" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
    <IdeaFragmentBoard novelId={novel.id} compact />
  </motion.div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/IdeaFragmentBoard.tsx src/components/EditorView.tsx server.ts
git commit -m "feat: add inspiration fragment board with AI expansion"
```

---

### Task 3: 伏笔管理面板

**Files:**
- Create: `src/components/ForeshadowingPanel.tsx`
- Modify: `server.ts` (add /api/detect-foreshadowing)
- Modify: `src/components/EditorView.tsx` (add 'foreshadowing' tab)

- [ ] **Step 1: 添加 /api/detect-foreshadowing 端点**

在 `server.ts` 中，`/api/expand-fragment` 之后添加：

```typescript
app.post('/api/detect-foreshadowing', async (req, res) => {
  try {
    const { chapterContent, chapterTitle, existingForeshadowings } = req.body;
    const config = getConfig();
    const prompt = `你是一个小说伏笔分析专家。请阅读以下章节内容，找出其中可能的伏笔埋设点和伏笔回收点。

【已有伏笔列表】：${existingForeshadowings || '无'}

【章节标题】：${chapterTitle}
【章节内容】：
${(chapterContent || '').substring(0, 15000)}

请分析并输出 JSON 数组，每个元素包含：
- title: 伏笔标题（简短）
- description: 伏笔描述
- type: "planted"（新埋设）或 "payoff"（回收已有伏笔）
- relatedTo: 如果 type 是 payoff，填写对应的已有伏笔标题（或留空）

严格只输出 JSON 数组，不要包含 markdown 标记：
[{"title": "...", "description": "...", "type": "planted", "relatedTo": ""}]`;

    const response = await getAi().models.generateContent({
      model: config.model,
      contents: prompt,
    });
    let raw = response.text || '[]';
    raw = raw.replace(/```(json)?/g, '').trim();
    res.json(JSON.parse(raw));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});
```

- [ ] **Step 2: 创建 ForeshadowingPanel 组件**

创建 `src/components/ForeshadowingPanel.tsx`：

```typescript
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Search, Eye, EyeOff, Target, ChevronDown, Loader2, Sparkles } from 'lucide-react';
import { Foreshadowing, Chapter } from '../types';
import { listForeshadowings, createForeshadowing, updateForeshadowing, deleteForeshadowing, listChapters, subscribeToChanges } from '../lib/api';
import { motion } from 'motion/react';

const STATUS_CONFIG = {
  planted: { label: '已埋设', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  hinted: { label: '已暗示', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  payoff: { label: '已回收', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

interface Props {
  novelId: string;
}

export function ForeshadowingPanel({ novelId }: Props) {
  const [items, setItems] = useState<Foreshadowing[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [filter, setFilter] = useState<'all' | 'planted' | 'hinted' | 'payoff'>('all');
  const [detecting, setDetecting] = useState(false);

  const refresh = async () => {
    setItems(await listForeshadowings(novelId));
    setChapters(await listChapters(novelId));
  };
  useEffect(() => { refresh(); return subscribeToChanges(refresh); }, [novelId]);

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    await createForeshadowing({
      id: Date.now().toString(),
      novelId,
      title: newTitle.trim(),
      description: newDesc.trim(),
      status: 'planted',
      relatedCharacterIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setNewTitle(''); setNewDesc(''); setShowAdd(false);
    refresh();
  };

  const handleStatusCycle = async (f: Foreshadowing) => {
    const next: Record<string, Foreshadowing['status']> = { planted: 'hinted', hinted: 'payoff', payoff: 'planted' };
    await updateForeshadowing(f.id, { status: next[f.status] });
    refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteForeshadowing(id);
    refresh();
  };

  const handleDetect = async () => {
    const currentChapter = chapters.find(c => c.content && c.content.trim().length > 0);
    if (!currentChapter) return;
    setDetecting(true);
    try {
      const res = await fetch('/api/detect-foreshadowing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterContent: currentChapter.content,
          chapterTitle: currentChapter.title,
          existingForeshadowings: items.map(i => ({ title: i.title, status: i.status })),
        }),
      });
      const detected = await res.json();
      for (const d of detected) {
        await createForeshadowing({
          id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
          novelId,
          title: d.title,
          description: d.description,
          status: d.type === 'payoff' ? 'payoff' : 'planted',
          plantedChapterId: currentChapter.id,
          payoffChapterId: d.type === 'payoff' ? currentChapter.id : undefined,
          relatedCharacterIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setDetecting(false);
    }
  };

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);
  const stats = { planted: items.filter(i => i.status === 'planted').length, hinted: items.filter(i => i.status === 'hinted').length, payoff: items.filter(i => i.status === 'payoff').length };

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex gap-2">
        {(['all', 'planted', 'hinted', 'payoff'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`text-[10px] px-2.5 py-1 rounded-full font-bold transition-all ${
              filter === s ? 'bg-theme-text text-white' : 'bg-white border border-theme-border text-theme-muted hover:bg-theme-sidebar'
            }`}>
            {s === 'all' ? `全部 ${items.length}` : `${STATUS_CONFIG[s].label} ${stats[s]}`}
          </button>
        ))}
      </div>

      {/* Auto-detect button */}
      <button onClick={handleDetect} disabled={detecting}
        className="w-full py-2 bg-theme-accent/10 text-theme-accent rounded-xl text-xs font-bold hover:bg-theme-accent/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
        {detecting ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        {detecting ? '扫描中...' : 'AI 扫描当前章节伏笔'}
      </button>

      {/* Add button */}
      {!showAdd && (
        <button onClick={() => setShowAdd(true)}
          className="w-full py-2 border-2 border-dashed border-theme-border rounded-xl text-xs text-theme-muted hover:border-theme-accent hover:text-theme-accent transition-colors flex items-center justify-center gap-2">
          <Plus size={14} /> 手动添加伏笔
        </button>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm space-y-3">
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="伏笔标题（如：主角身世之谜）"
            className="w-full text-sm px-3 py-2 bg-theme-sidebar/30 border border-theme-border rounded-lg outline-none focus:border-theme-accent" />
          <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="伏笔描述..."
            className="w-full text-xs px-3 py-2 bg-theme-sidebar/30 border border-theme-border rounded-lg outline-none focus:border-theme-accent resize-none h-20" />
          <div className="flex gap-2">
            <button onClick={handleAdd} className="flex-1 py-2 bg-theme-accent text-white rounded-lg text-xs font-bold">添加</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-theme-border rounded-lg text-xs text-theme-muted">取消</button>
          </div>
        </div>
      )}

      {/* Foreshadowing list */}
      <div className="space-y-2">
        {filtered.map(f => (
          <motion.div key={f.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="bg-white rounded-xl border border-theme-border/40 shadow-sm p-3 group">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-theme-text truncate">{f.title}</span>
                  <button onClick={() => handleStatusCycle(f)}
                    className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium ${STATUS_CONFIG[f.status].color}`}>
                    {STATUS_CONFIG[f.status].label}
                  </button>
                </div>
                {f.description && <p className="text-[10px] text-theme-muted line-clamp-2 leading-relaxed">{f.description}</p>}
              </div>
              <button onClick={() => handleDelete(f.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-600 transition-all shrink-0">
                <Trash2 size={12} />
              </button>
            </div>
          </motion.div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-xs text-theme-muted opacity-50">
            <Eye size={24} className="mx-auto mb-2 opacity-20" />
            {filter === 'all' ? '暂无伏笔记录，手动添加或使用 AI 扫描' : '该状态下无伏笔'}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 在 EditorView 侧边栏添加 'foreshadowing' Tab**

在 `src/components/EditorView.tsx` 中：

1. import:
```typescript
import { ForeshadowingPanel } from './ForeshadowingPanel';
```

2. agentTab 类型添加 'foreshadowing'

3. 在 Tabs 区域（'追踪'按钮之后）添加：
```typescript
<button 
  onClick={() => setAgentTab('foreshadowing')}
  className={cn(
    "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
    agentTab === 'foreshadowing' 
      ? "bg-theme-text text-white" 
      : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
  )}
>
  <Eye size={12} /> 伏笔
</button>
```

4. 在 content 区域添加分支：
```typescript
{agentTab === 'foreshadowing' && (
  <motion.div key="foreshadowing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
    <ForeshadowingPanel novelId={novel.id} />
  </motion.div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ForeshadowingPanel.tsx src/components/EditorView.tsx server.ts
git commit -m "feat: add foreshadowing management panel with AI detection"
```

---

### Task 4: 节奏诊断仪表盘

**Files:**
- Create: `src/components/PacingDashboard.tsx`
- Modify: `server.ts` (add /api/analyze-pacing)
- Modify: `src/components/EditorView.tsx` (add 'pacing' tab)

- [ ] **Step 1: 添加 /api/analyze-pacing 端点**

在 `server.ts` 中 `/api/detect-foreshadowing` 之后添加：

```typescript
app.post('/api/analyze-pacing', async (req, res) => {
  try {
    const { chapters } = req.body;
    const config = getConfig();
    const chapterList = chapters.map((c: any) =>
      `第${c.order}章「${c.title}」(字数:${c.wordCount})：${(c.content || '').substring(0, 500)}...`
    ).join('\n---\n');

    const prompt = `你是一个小说节奏分析专家。请对以下章节列表进行节奏诊断。

${chapterList}

请输出 JSON 数组，每个章节一个对象：
[
  {
    "chapterId": "章节 ID",
    "tensionScore": 0-100 的张力评分（冲突强度、悬念密度），
    "payoffCount": 爽点/爆点数量,
    "emotionLabel": "情绪标签（如：紧张/温馨/压抑/燃/爽/悲）",
    "suggestion": "一句话节奏建议"
  }
]

严格只输出 JSON 数组，不要包含 markdown 标记。`;

    const response = await getAi().models.generateContent({
      model: config.model,
      contents: prompt,
    });
    let raw = response.text || '[]';
    raw = raw.replace(/```(json)?/g, '').trim();
    res.json(JSON.parse(raw));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});
```

- [ ] **Step 2: 创建 PacingDashboard 组件**

创建 `src/components/PacingDashboard.tsx`：

```typescript
import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { Chapter } from '../types';
import { listChapters, subscribeToChanges } from '../lib/api';
import { motion } from 'motion/react';

interface PacingData {
  chapterId: string;
  tensionScore: number;
  payoffCount: number;
  emotionLabel: string;
  suggestion: string;
}

interface Props {
  novelId: string;
}

export function PacingDashboard({ novelId }: Props) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [pacing, setPacing] = useState<PacingData[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => setChapters(await listChapters(novelId));
  useEffect(() => { refresh(); return subscribeToChanges(refresh); }, [novelId]);

  const handleAnalyze = async () => {
    const withContent = chapters.filter(c => c.content && c.content.trim().length > 0);
    if (withContent.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch('/api/analyze-pacing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapters: withContent }),
      });
      const data = await res.json();
      setPacing(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const avgTension = pacing.length > 0 ? Math.round(pacing.reduce((s, p) => s + p.tensionScore, 0) / pacing.length) : 0;
  const totalPayoffs = pacing.reduce((s, p) => s + p.payoffCount, 0);

  return (
    <div className="space-y-4">
      {/* Summary card */}
      {pacing.length > 0 && (
        <div className="bg-theme-text text-white p-4 rounded-2xl shadow-lg">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={16} className="text-theme-accent" />
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">节奏总览</span>
          </div>
          <div className="flex gap-4">
            <div>
              <div className="text-2xl font-black text-theme-accent">{avgTension}</div>
              <div className="text-[9px] opacity-50 uppercase">平均张力</div>
            </div>
            <div className="w-px bg-white/10" />
            <div>
              <div className="text-2xl font-black text-emerald-400">{totalPayoffs}</div>
              <div className="text-[9px] opacity-50 uppercase">总爽点数</div>
            </div>
            <div className="w-px bg-white/10" />
            <div>
              <div className="text-2xl font-black text-blue-400">{pacing.length}</div>
              <div className="text-[9px] opacity-50 uppercase">已诊断章</div>
            </div>
          </div>
        </div>
      )}

      {/* Analyze button */}
      <button onClick={handleAnalyze} disabled={loading}
        className="w-full py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Activity size={16} />}
        {loading ? '分析中...' : pacing.length > 0 ? '重新分析节奏' : 'AI 节奏诊断'}
      </button>

      {/* Tension bar chart */}
      {pacing.length > 0 && (
        <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-4">张力曲线</h3>
          <div className="space-y-2">
            {pacing.map(p => {
              const chapter = chapters.find(c => c.id === p.chapterId);
              return (
                <div key={p.chapterId} className="flex items-center gap-3">
                  <span className="text-[9px] text-theme-muted w-16 truncate text-right">
                    {chapter?.title || '?'}
                  </span>
                  <div className="flex-1 h-5 bg-theme-sidebar/30 rounded-full overflow-hidden relative">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${p.tensionScore}%` }}
                      transition={{ duration: 0.6, delay: 0.1 }}
                      className={`h-full rounded-full ${
                        p.tensionScore >= 70 ? 'bg-red-400' :
                        p.tensionScore >= 40 ? 'bg-amber-400' :
                        'bg-blue-400'
                      }`}
                    />
                  </div>
                  <span className="text-[9px] font-bold w-8 text-right">{p.tensionScore}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Emotion labels */}
      {pacing.length > 0 && (
        <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-3">情绪分布</h3>
          <div className="flex flex-wrap gap-1.5">
            {pacing.map(p => (
              <span key={p.chapterId}
                className="text-[9px] px-2 py-1 bg-theme-sidebar rounded-full text-theme-text font-medium border border-theme-border">
                {p.emotionLabel} ×{p.payoffCount}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {pacing.filter(p => p.suggestion).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider px-1">节奏建议</h3>
          {pacing.filter(p => p.suggestion).map(p => {
            const chapter = chapters.find(c => c.id === p.chapterId);
            return (
              <div key={p.chapterId} className="bg-amber-50/50 p-3 rounded-xl border border-amber-100 text-[10px] text-amber-900 leading-relaxed">
                <span className="font-bold">{chapter?.title}：</span>{p.suggestion}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 在 EditorView 侧边栏添加 'pacing' Tab**

在 `src/components/EditorView.tsx` 中：

1. import:
```typescript
import { PacingDashboard } from './PacingDashboard';
```

2. agentTab 类型添加 'pacing'

3. 在 Tabs 区域（'质量'按钮之后或附近）添加：
```typescript
<button 
  onClick={() => setAgentTab('pacing')}
  className={cn(
    "flex-none whitespace-nowrap py-1.5 px-3 rounded-full text-[11px] font-medium transition-all flex items-center justify-center gap-1.5",
    agentTab === 'pacing' 
      ? "bg-theme-text text-white" 
      : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text"
  )}
>
  <Activity size={12} /> 节奏
</button>
```

4. 在 content 区域添加分支：
```typescript
{agentTab === 'pacing' && (
  <motion.div key="pacing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
    <PacingDashboard novelId={novel.id} />
  </motion.div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/PacingDashboard.tsx src/components/EditorView.tsx server.ts
git commit -m "feat: add pacing diagnostics dashboard with AI analysis"
```

---

### Task 5: 导出功能

**Files:**
- Modify: `server.ts` (add /api/export)
- Modify: `src/components/EditorView.tsx` (add export button)

- [ ] **Step 1: 添加 /api/export 端点**

在 `server.ts` 中 `/api/analyze-pacing` 之后添加：

```typescript
app.post('/api/export', async (req, res) => {
  try {
    const { novelId, format } = req.body;
    const novel = db.getNovel(novelId);
    if (!novel) return res.status(404).json({ error: 'Novel not found' });
    const chapters = db.listChapters(novelId).sort((a, b) => a.order - b.order);

    if (format === 'txt') {
      let txt = `${novel.title}\n\n`;
      txt += `${novel.summary || ''}\n\n`;
      txt += `${'='.repeat(40)}\n\n`;
      for (const ch of chapters) {
        txt += `第${ch.order}章 ${ch.title}\n\n`;
        txt += `${ch.content || ''}\n\n`;
        txt += `${'-'.repeat(30)}\n\n`;
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(novel.title)}.txt"`);
      res.send(txt);
    } else if (format === 'epub') {
      // Minimal EPUB: manually build the ZIP structure
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // mimetype (must be first, uncompressed)
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

      // container.xml
      zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

      // content.opf
      const manifestItems = chapters.map((ch, i) =>
        `<item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`
      ).join('\n');
      const spineItems = chapters.map((_, i) => `<itemref idref="ch${i}"/>`).join('\n');
      const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${novel.title}</dc:title>
    <dc:creator>InkFlow</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="book-id">urn:inkflow:${novelId}</dc:identifier>
  </metadata>
  <manifest>
    ${manifestItems}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`;
      zip.file('OEBPS/content.opf', opf);

      // Navigation
      const navLinks = chapters.map((ch, i) =>
        `<li><a href="ch${i}.xhtml">第${ch.order}章 ${ch.title}</a></li>`
      ).join('\n');
      const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body><nav epub:type="toc"><h2>目录</h2><ol>${navLinks}</ol></nav></body>
</html>`;
      zip.file('OEBPS/nav.xhtml', nav);

      // Chapter files
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        const html = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第${ch.order}章 ${ch.title}</title></head>
<body><h2>第${ch.order}章 ${ch.title}</h2>
${(ch.content || '').split('\n').map(line => `<p>${line || '&nbsp;'}</p>`).join('\n')}
</body>
</html>`;
        zip.file(`OEBPS/ch${i}.xhtml`, html);
      }

      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(novel.title)}.epub"`);
      res.send(buf);
    } else {
      res.status(400).json({ error: 'Unsupported format' });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});
```

对于 EPUB 导出，需要安装 `jszip` 依赖。如果不想引入依赖，TXT 导出已经提供了基础导出能力，EPUB 可标记为可选。

**注意**：如果选择 EPUB 支持，先执行 `npm install jszip`。

- [ ] **Step 2: 安装 jszip（仅 EPUB 需要）**

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow && npm install jszip
```

- [ ] **Step 3: 在 EditorView 底部状态栏添加导出按钮**

在 `src/components/EditorView.tsx` 底部状态栏（"AI 核心已连接"那行）添加导出按钮：

在 `<div className="flex items-center gap-4 text-[10px] text-theme-muted font-medium">` 内部末尾，`</span>` 闭合标签之前添加：

```typescript
<div className="h-3 w-[1px] bg-theme-border/50" />
<button
  onClick={async () => {
    const format = confirm('导出为 EPUB？（确定=EPUB，取消=TXT）') ? 'epub' : 'txt';
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelId: novel.id, format }),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${novel.title}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('导出失败');
    }
  }}
  className="flex items-center gap-1 text-[10px] font-bold text-theme-accent hover:opacity-80 transition-opacity"
>
  <Download size={12} /> 导出
</button>
```

需要在 EditorView.tsx 顶部 import 中添加 `Download` 图标：
```typescript
import { ..., Download } from 'lucide-react';
```

或者使用已有的图标。如果不方便，用纯文本按钮也可以。

- [ ] **Step 4: Commit**

```bash
git add server.ts src/components/EditorView.tsx package.json package-lock.json
git commit -m "feat: add TXT and EPUB export functionality"
```

---

### Task 6: 集成验证

- [ ] **Step 1: 确认所有 import 路径正确**

检查新增组件之间的 import 一致性：
- `IdeaFragmentBoard.tsx` 引入了 `../types` 和 `../lib/api`
- `ForeshadowingPanel.tsx` 引入了 `../types` 和 `../lib/api`
- `PacingDashboard.tsx` 引入了 `../types` 和 `../lib/api`
- `EditorView.tsx` 引入了上述三个组件

- [ ] **Step 2: 类型检查**

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow && npx tsc --noEmit
```

确保零错误。

- [ ] **Step 3: 功能冒烟测试**

启动开发服务器，手动验证：
1. 打开创作舞台 → 选择章节 → AI 侧边栏出现 "灵感"、"伏笔"、"节奏" 三个新 Tab
2. 灵感标签页：输入碎片、切换类型、点击 AI 展开
3. 伏笔标签页：手动添加、点击状态切换、AI 扫描
4. 节奏标签页：点击 AI 节奏诊断、查看张力曲线
5. 底部状态栏出现导出按钮，点击导出 TXT/EPUB

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: integration verification and final cleanup"
```

---
