# Plan 136：世界观关系图谱闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 让用户能在世界观"关系图谱"页手工新增、编辑、删除实体关系，修复导航和空态，完善图谱展示。
**Architecture:** 后端 CRUD 已就绪（`db/world.ts` + RPC 白名单），仅需新增前端 CRUD UI + 修复导航 + 修复空态 + 补测试。不改数据库 schema，不加依赖。
**Tech Stack:** React + TypeScript，现有 `world-client.ts` API，纯 SVG 图谱。

---

## 任务总览

| Task | 描述 | 预估 |
|------|------|------|
| T1 | 后端关系校验加固 | 15min |
| T2 | 关系 CRUD 对话框组件 | 40min |
| T3 | WorldBibleView 图谱 Tab 集成 CRUD | 20min |
| T4 | 导航修正 + 空态分流 | 20min |
| T5 | 图谱展示增强（边标签、名称解析、高亮过滤纯函数） | 20min |
| T6 | 测试 | 30min |

---

## T1：后端关系数据安全校验

### 目标
在 `server/lib/db/world.ts` 的 `createEntityRelationship` 和 `updateEntityRelationship` 中加入安全校验。

### 文件
- **修改**: `server/lib/db/world.ts`

### 步骤

- [ ] **1.1** 在 `createEntityRelationship` 入口添加校验：
  - 限定 `sourceType` / `targetType` ∈ `['character', 'location', 'item', 'faction']`
  - 查找两端实体，任一不存在则 throw
  - `sourceType === targetType && sourceId === targetId`（自关联）则 throw
  - 同作品内完全重复（`novelId + sourceType + sourceId + targetType + targetId` 唯一）则 throw

```typescript
const VALID_ENTITY_TYPES = new Set(['character', 'location', 'item', 'faction']);

function validateRelationship(rel: EntityRelationship): void {
  if (!VALID_ENTITY_TYPES.has(rel.sourceType) || !VALID_ENTITY_TYPES.has(rel.targetType)) {
    throw new Error(`Invalid entity type: source=${rel.sourceType}, target=${rel.targetType}`);
  }
  if (rel.sourceType === rel.targetType && rel.sourceId === rel.targetId) {
    throw new Error('Self-relationship is not allowed');
  }
  // Check both entities exist
  const db = getDb();
  const sourceTable = rel.sourceType === 'character' ? 'characters' : rel.sourceType + 's';
  const targetTable = rel.targetType === 'character' ? 'characters' : rel.targetType + 's';
  const sourceExists = db.prepare(`SELECT 1 FROM ${sourceTable} WHERE id = ? AND novelId = ?`).get(rel.sourceId, rel.novelId);
  const targetExists = db.prepare(`SELECT 1 FROM ${targetTable} WHERE id = ? AND novelId = ?`).get(rel.targetId, rel.novelId);
  if (!sourceExists) throw new Error(`Source entity not found: ${rel.sourceType}:${rel.sourceId}`);
  if (!targetExists) throw new Error(`Target entity not found: ${rel.targetType}:${rel.targetId}`);
  // Check duplicate
  const existing = db.prepare(`SELECT 1 FROM entity_relationships WHERE novelId = ? AND sourceType = ? AND sourceId = ? AND targetType = ? AND targetId = ?`).get(rel.novelId, rel.sourceType, rel.sourceId, rel.targetType, rel.targetId);
  if (existing) throw new Error('Duplicate relationship');
}
```

- [ ] **1.2** 在 `updateEntityRelationship` 中：若更新了 sourceType/sourceId/targetType/targetId，重新执行 `validateRelationship`（排除自身 id）。
- [ ] **1.3** `createEntityRelationship` 返回 `boolean`（成功 true，重复 false 不 throw，便于 UI 友好提示）；`updateEntityRelationship` / `deleteEntityRelationship` 已返回 boolean。
- [ ] **1.4** 验证：`npm run typecheck`

---

## T2：关系维护 UI — RelationshipFormDialog 组件

### 目标
新建 `src/components/world-bible/RelationshipFormDialog.tsx`，包含新增/编辑/删除关系的完整表单。

### 文件
- **新建**: `src/components/world-bible/RelationshipFormDialog.tsx`

### 步骤

- [ ] **2.1** 定义 props 接口：

```typescript
interface RelationshipFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit' | 'delete';
  novelId: string;
  characters: Character[];
  locations: Location[];
  items: Item[];
  factions: Faction[];
  existingRelationship?: EntityRelationship | null;  // edit/delete 时传入
  onClose: () => void;
  onSaved: (rel: EntityRelationship) => void;  // create/update 成功
  onDeleted: (id: string) => void;              // delete 成功
}
```

- [ ] **2.2** 实现表单状态：
  - `sourceType`, `sourceId`, `targetType`, `targetId` — 两端实体选择
  - `relationshipType` — 预设下拉 + 自定义输入
  - `description` — 文本域
  - 预设关系类型：`盟友`、`敌对`、`师徒`、`恋人`、`亲属`、`同门`、`上司`、`下属`、`对手`、`自定义`

- [ ] **2.3** 实现 `useMemo` 计算可选实体列表：按 `sourceType` 筛选对应数组作为来源选项；按 `targetType` 筛选作为目标选项。来源和目标可选不同类型。

- [ ] **2.4** 实现 `handleSubmit`：
  - `mode === 'create'`：构造 `EntityRelationship`（含 `crypto.randomUUID()`），调用 `createEntityRelationshipClient(rel)`
  - `mode === 'edit'`：调用 `updateEntityRelationshipClient(id, data)`
  - `mode === 'delete'`：调用 `deleteEntityRelationshipClient(id)`
  - 捕获错误时显示错误消息（不乐观）
  - 成功时调用 `onSaved` / `onDeleted`，关闭对话框

- [ ] **2.5** 实现 JSX：
  - Modal overlay，居中卡片
  - 来源实体：类型下拉 + 实体名下拉（联动）
  - 目标实体：同上
  - 关系类型：预设下拉 + 切换"自定义"时显示文本输入
  - 描述：textarea
  - 删除模式：显示确认文字 + 实体名，仅确认/取消按钮
  - 按钮：取消 / 确认（创建/编辑）或 确认删除

- [ ] **2.6** 验证：`npm run typecheck`

---

## T3：WorldBibleView 图谱 Tab 集成 CRUD

### 目标
在 `WorldBibleView.tsx` 的 `graph` tab 中增加"新增关系"按钮 + 关系列表 + 编辑/删除入口，调用 `RelationshipFormDialog`。

### 文件
- **修改**: `src/components/WorldBibleView.tsx`

### 步骤

- [ ] **3.1** 添加状态：
```typescript
const [relDialogOpen, setRelDialogOpen] = useState(false);
const [relDialogMode, setRelDialogMode] = useState<'create' | 'edit' | 'delete'>('create');
const [editingRel, setEditingRel] = useState<EntityRelationship | null>(null);
```

- [ ] **3.2** 在 `graph` tab 渲染区域（`activeTab === 'graph'`），图谱上方增加工具栏：
  - "新增关系"按钮（Plus icon）→ `setRelDialogMode('create'); setEditingRel(null); setRelDialogOpen(true)`
  - 实体数量 < 2 时按钮 disabled + tooltip "请先添加至少两个实体"

- [ ] **3.3** 图谱下方增加"已有关系列表"：
  - 每行显示：来源实体名 → 关系类型 → 目标实体名 + 描述截断
  - 行尾：编辑按钮（Pen icon）→ `setRelDialogMode('edit'); setEditingRel(rel); setRelDialogOpen(true)`
  - 行尾：删除按钮（Trash2 icon）→ `setRelDialogMode('delete'); setEditingRel(rel); setRelDialogOpen(true)`
  - 空列表时显示"暂无关系，点击上方按钮添加"

- [ ] **3.4** 渲染 `RelationshipFormDialog`：
```tsx
<RelationshipFormDialog
  open={relDialogOpen}
  mode={relDialogMode}
  novelId={novel.id}
  characters={characters}
  locations={locations}
  items={items}
  factions={factions}
  existingRelationship={editingRel}
  onClose={() => setRelDialogOpen(false)}
  onSaved={(rel) => {
    setRelationships(prev => {
      const idx = prev.findIndex(r => r.id === rel.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = rel; return next; }
      return [...prev, rel];
    });
  }}
  onDeleted={(id) => {
    setRelationships(prev => prev.filter(r => r.id !== id));
  }}
/>
```

- [ ] **3.5** 更新冷启动空状态：当 `totalEntities >= 2` 且 `relationships.length === 0` 时，"建立第一条关系"按钮直接 `setActiveTab('graph')` 而非跳转 characters。
- [ ] **3.6** 验证：`npm run typecheck`

---

## T4：导航修正 + 空态分流

### 目标
1. AgentWorkspace 中"去世界观补充关系"直接打开 WorldBible 的 graph tab。
2. RelationshipGraph 区分两种空态：全局无关系 vs 当前片段未匹配。

### 文件
- **修改**: `src/components/AgentWorkspace.tsx`
- **修改**: `src/components/RelationshipGraph.tsx`

### 步骤

- [ ] **4.1** AgentWorkspace 传递 `onGoToWorldBible` 给 `RelationshipGraph`：
```typescript
onGoToWorldBible={() => {
  // 需要通知父组件切换到 bible 的 graph tab
  // 检查 AgentWorkspace 是否已有此回调
}}
```
  检查 `AgentWorkspace` 的 props/上下文是否能切换 WorldBible 的 activeTab。若不能，改为通过 `setAgentTab('bible')` + 传递 `initialTab='graph'` 或在 WorldBibleView 中检查 URL hash。

  **简化方案**：`onGoToWorldBible` → `setAgentTab('bible')`，并在 WorldBibleView 中通过 prop 或 context 接收 `initialTab`，默认 `'graph'`。

- [ ] **4.2** RelationshipGraph 空态分流：
  - Props 新增 `hasGlobalRelationships: boolean`（区分全局是否有关系）
  - 当 `hasGlobalRelationships === false`（全局无关系）：显示"暂无关系数据，请先创建实体和关系" + "去世界观补充关系"按钮
  - 当 `hasGlobalRelationships === true`（有关系但当前片段未匹配）：显示"当前正文未提及已设定的实体关系" + "查看全局关系图"按钮（不误报数据缺失）
  - 删除"支持拖拽节点与双击节点"的虚假描述文案

- [ ] **4.3** WorldBibleView 图谱 tab 中渲染 `RelationshipGraph` 时传入 `hasGlobalRelationships={relationships.length > 0}`（全局上下文始终有全部关系，但编辑器侧边栏才需要分流）

- [ ] **4.4** 验证：`npm run typecheck`

---

## T5：图谱展示增强

### 目标
边显示关系类型标签，节点名称正确解析，点击节点跳转正确分类，高亮过滤逻辑提取为纯函数。

### 文件
- **修改**: `src/components/RelationshipGraph.tsx`

### 步骤

- [ ] **5.1** 边标签：在每条 `<line>` 中间位置添加 `<text>` 显示 `edge.type`（关系类型），字号 9px，颜色 theme-muted。

- [ ] **5.2** `getEntityName` 保持不变（已正确实现）。

- [ ] **5.3** 提取高亮过滤为纯函数 `filterRelationshipsByActiveEntities`，导出供 `AgentWorkspace` 和 `RelationshipGraph` 共用：
```typescript
export function filterRelationshipsByActiveEntities(
  relationships: EntityRelationship[],
  activeEntityNames: string[],
  characters: Character[],
  locations: Location[],
  items: Item[],
  factions: Faction[],
): EntityRelationship[] {
  // 同 AgentWorkspace L231-254 逻辑
}
```

- [ ] **5.4** AgentWorkspace 改为调用 `filterRelationshipsByActiveEntities` 替代内联 useMemo。

- [ ] **5.5** 验证：`npm run typecheck`

---

## T6：测试

### 目标
覆盖 CRUD 校验、前端操作、图谱渲染、空态、导航。

### 文件
- **新建**: `src/tests/relationship-crud.test.ts`（后端校验逻辑单元测试）
- **新建**: `src/tests/relationship-form-dialog.test.tsx`（表单组件测试）
- **新建**: `src/tests/relationship-graph.test.tsx`（图谱渲染 + 空态 + 高亮测试）

### 步骤

- [ ] **6.1** `relationship-crud.test.ts`：
  - 自关联被拒绝
  - 跨作品关联被拒绝
  - 重复关系被拒绝
  - 实体不存在被拒绝
  - 非法 entity type 被拒绝
  - 正常创建成功
  - 更新返回 boolean
  - 删除返回 boolean
  - missing-row 删除返回 false

- [ ] **6.2** `relationship-form-dialog.test.tsx`：
  - create 模式：选择来源/目标，填写类型，提交调用 API
  - edit 模式：预填数据，修改后提交
  - delete 模式：显示确认，确认后调用 API
  - 失败时不乐观：API 抛错后对话框保持打开
  - 实体不足 2 时提示

- [ ] **6.3** `relationship-graph.test.tsx`：
  - 无关系时显示空态文案
  - 有关系时渲染节点和边
  - 节点名称按类型正确解析
  - 点击节点调用 onSelectEntity
  - 边标签显示关系类型
  - hasGlobalRelationships=false 时显示"暂无关系数据"
  - hasGlobalRelationships=true 时显示"当前正文未提及"

- [ ] **6.4** 验证：`npm run test:frontend -- --run`

---

## 执行顺序

```
T1 (后端校验) → T2 (CRUD 组件) → T3 (集成) → T4 (导航+空态) → T5 (展示增强) → T6 (测试)
```

每个 Task 完成后运行 `npm run typecheck`，T6 完成后运行全量验证：
```bash
npm run typecheck && npm run lint && npm run test:frontend -- --run
```
