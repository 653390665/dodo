# Plan 136 收口：真实导航 + 空态可操作 + 回归测试

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 修复 CTA 假导航，让空图谱根据实体数量显示可操作引导，补回归测试。
**Architecture:** AgentWorkspace 增加 `onNavigate` prop 传入真实导航回调；RelationshipGraph 空态按实体数量分流；补 3 个测试覆盖。
**Tech Stack:** React + TypeScript，现有 Zustand store + AppShell handleNavigate。

---

## 导航架构现状

```
AppShell.handleNavigate(view) → setCurrentView(view)
  ├── currentView === 'editor' → EditorView
  └── currentView === 'world'  → WorldBibleView（完整页面）

EditorView
  ├── onNavigate → handleNavigate（已存在）
  ├── WritingSurface → onNavigate（已传入）
  └── AgentWorkspace → 无 onNavigate，仅 agentTab/setAgentTab
```

**问题**：AgentWorkspace 的 `onGoToWorldBible` 调用 `setAgentTab('bible')` 只切换侧边栏内部 tab，不跳转到真正的 WorldBibleView。

---

## T1：修复真实导航

### 目标
AgentWorkspace 的"去世界观补充关系" CTA 真正导航到 WorldBibleView 的关系图谱标签。

### 文件
- **修改**: `src/components/AgentWorkspace.tsx`
- **修改**: `src/components/EditorView.tsx`

### 步骤

- [ ] **1.1** AgentWorkspace.tsx Props 接口增加 `onNavigate`：
```typescript
interface AgentWorkspaceProps {
  // ...existing props...
  onNavigate?: (view: ViewType) => void;  // ADD
}
```
需从 `shared/types` 导入 `ViewType`（检查是否已导入）。

- [ ] **1.2** AgentWorkspace 解构 props 增加 `onNavigate`。

- [ ] **1.3** 修改 `onGoToWorldBible` 回调（当前在 RelationshipGraph 传参处）：
```typescript
onGoToWorldBible={() => {
  try { localStorage.setItem('inkflow-world-bible-active-tab', 'graph'); } catch {}
  if (onNavigate) {
    onNavigate('world');
  } else {
    setAgentTab('bible');
  }
}}
```
逻辑：有 `onNavigate` 时调用真实导航；无回调时降级为原有行为。

- [ ] **1.4** AgentWorkspace 空态中（`filteredRelationships.length === 0` 且有 `onGoToWorldBible` 按钮的地方），同步修改按钮行为。

- [ ] **1.5** EditorView.tsx 传入 `onNavigate` 给 AgentWorkspace：
```typescript
<AgentWorkspace
  // ...existing props...
  onNavigate={onNavigate}
/>
```
检查 EditorView 是否已有 `onNavigate` prop（应有，来自 AppShell）。若无则需从 AppShell 传入。

- [ ] **1.6** 验证：`npm run typecheck`

---

## T2：让空图谱可操作

### 目标
RelationshipGraph 空态按实体总数分流，提供可操作引导。

### 文件
- **修改**: `src/components/RelationshipGraph.tsx`
- **修改**: `src/components/WorldBibleView.tsx`（如需传递 totalEntities）

### 步骤

- [ ] **2.1** RelationshipGraph Props 增加 `totalEntities?: number`：
```typescript
interface RelationshipGraphProps {
  // ...existing props...
  totalEntities?: number;  // ADD: 总实体数（人物+地点+道具+势力）
}
```

- [ ] **2.2** 修改空态逻辑（当前 `relationships.length === 0` 分支）：
```typescript
if (relationships.length === 0) {
  const entityCount = totalEntities ?? 0;
  let message: string;
  let buttonText: string;
  let buttonAction: (() => void) | undefined = onGoToWorldBible;

  if (entityCount === 0) {
    message = '尚未创建任何设定实体，请先添加人物或地点。';
    buttonText = '去添加人物';
  } else if (entityCount === 1) {
    message = '还需要至少一个实体才能建立关系。';
    buttonText = '去添加更多实体';
  } else {
    message = hasGlobalRelationships
      ? '当前正文未提及已设定的实体关系'
      : '已有实体，暂无关系数据';
    buttonText = hasGlobalRelationships ? '查看全局关系图' : '去世界观补充关系';
  }

  return (
    <div className="flex flex-col items-center justify-center h-64 text-center p-5 border border-dashed border-theme-border/40 rounded-xl space-y-3 bg-theme-sidebar/10">
      <span className="text-[11px] text-theme-muted/80 leading-relaxed max-w-[220px]">
        {message}
      </span>
      {buttonAction && (
        <button
          onClick={buttonAction}
          className="px-3 py-1.5 rounded-xl bg-theme-accent text-white text-[10px] font-bold shadow-sm hover:opacity-90 transition-opacity active:scale-[0.98]"
        >
          {buttonText}
        </button>
      )}
    </div>
  );
}
```

- [ ] **2.3** WorldBibleView 图谱 Tab 传入 `totalEntities`：
```typescript
<RelationshipGraph
  // ...existing props...
  totalEntities={characters.length + locations.length + items.length + factions.length}
/>
```

- [ ] **2.4** AgentWorkspace 传入 `totalEntities`：
```typescript
<RelationshipGraph
  // ...existing props...
  totalEntities={characters.length + locations.length + items.length + factions.length}
/>
```

- [ ] **2.5** 验证：`npm run typecheck`

---

## T3：回归测试

### 目标
覆盖 CTA 导航、空态分流、新增关系后图谱更新。

### 文件
- **新建**: `src/tests/relationship-graph-closeout.test.tsx`

### 步骤

- [ ] **3.1** 创建测试文件，mock `world-client`：
```typescript
vi.mock('../lib/world-client', () => ({
  createEntityRelationshipClient: vi.fn().mockResolvedValue(undefined),
  updateEntityRelationshipClient: vi.fn().mockResolvedValue(true),
  deleteEntityRelationshipClient: vi.fn().mockResolvedValue(true),
  listEntityRelationshipsClient: vi.fn().mockResolvedValue([]),
}));
```

- [ ] **3.2** 测试用例：

**测试 1：0 实体显示"添加人物"引导**
- 渲染 `RelationshipGraph` with `totalEntities=0`, `relationships=[]`
- 期望文案："尚未创建任何设定实体"
- 期望按钮："去添加人物"

**测试 2：1 实体显示"添加更多实体"引导**
- 渲染 `RelationshipGraph` with `totalEntities=1`, `relationships=[]`
- 期望文案："还需要至少一个实体"
- 期望按钮："去添加更多实体"

**测试 3：2+ 实体无关系显示"新增关系"引导**
- 渲染 `RelationshipGraph` with `totalEntities=2`, `relationships=[]`
- 期望文案："已有实体，暂无关系数据"
- 期望按钮："去世界观补充关系"

**测试 4：有全局关系但未匹配显示"查看全局关系图"**
- 渲染 with `totalEntities=3`, `relationships=[]`, `hasGlobalRelationships=true`
- 期望文案："当前正文未提及已设定的实体关系"
- 期望按钮："查看全局关系图"

**测试 5：onNavigate 被调用时导航到 world**
- 渲染 `AgentWorkspace` with `onNavigate` mock
- 点击 CTA 按钮
- 期望 `onNavigate('world')` 被调用

**测试 6：无 onNavigate 时降级为 setAgentTab**
- 渲染 `AgentWorkspace` without `onNavigate`
- 点击 CTA 按钮
- 期望 `setAgentTab('bible')` 被调用

- [ ] **3.3** 验证：`npm run test:frontend -- --run`

---

## 执行顺序

```
T1 (真实导航) → T2 (空态可操作) → T3 (回归测试)
```

每个 Task 完成后运行 `npm run typecheck`，T3 完成后运行全量验证：
```bash
npm run typecheck && npm run lint && npm run test:frontend -- --run
```
