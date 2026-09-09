# Plan 174: 为破坏性删除统一接入 appConfirm——世界书实体、资料包、伏笔、灵感碎片、对话历史

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- src/components/WorldBibleView.tsx src/components/ContinuationPackView.tsx src/components/ForeshadowingPanel.tsx src/components/IdeaFragmentBoard.tsx src/components/WorldBibleAssistant.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug（数据丢失防护）
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

世界书六类实体（角色/地点/物品/势力/力量体系/时间线）、续写资料包（含付费 LLM 解析产物）、伏笔、灵感碎片、助手对话历史 currently 全部**单击即物理删除、无确认、无撤销**；而删书、删章、删技能卡反而都有确认——保护强度与数据价值倒挂。误触 hover 垃圾桶按钮即永久丢失数小时的世界观维护成果。本计划在这些删除路径上统一接入仓库现成的 `appConfirm`，与既有删除确认行为对齐。

## Current state

相关文件与角色：

- `src/components/ui/app-confirm.tsx` — 仓库统一的 Promise 化确认框（挂载于 App 根部的 `AppDialogHost`）
- `src/components/WorldBibleView.tsx:493` — `deleteEntity` 是六类实体删除的单点汇聚
- `src/components/world-bible/CharactersTab.tsx:66-72` — hover 垃圾桶直接调 `deleteEntity`（其余 5 个 Tab 同模式）
- `src/components/ContinuationPackView.tsx:177` — `handleDeletePack`
- `src/components/ForeshadowingPanel.tsx:71` — `handleDelete`
- `src/components/IdeaFragmentBoard.tsx:137` — `handleDelete`
- `src/components/WorldBibleAssistant.tsx:570` — 清空对话历史按钮

现状摘录：

```tsx
// src/components/world-bible/CharactersTab.tsx:66-72（六个 Tab 均同模式）
<button
  onClick={() => deleteEntity('character', char.id)}
  className="absolute top-4 right-4 ... opacity-0 group-hover:opacity-100 ..."
  aria-label="删除角色"
>
  <Trash2 size={16} />
</button>
```

```tsx
// src/components/WorldBibleView.tsx:493-497 — 无任何确认，直接调删除 API
const deleteEntity = async (type: 'character' | 'location' | 'item' | 'timeline' | 'faction' | 'powerLevel', id: string) => {
  try {
    const generation = requireAcceptedGeneration();
    let deleted = false;
    if (type === 'character') deleted = await deleteCharacter(id, generation);
```

```tsx
// src/components/ContinuationPackView.tsx:177-185
const handleDeletePack = async (packId: string) => {
  if (!await deleteContinuationPack(packId)) {
    setError({ message: '资料包已不存在，删除未生效。' });
    return;
  }
```

```tsx
// src/components/WorldBibleAssistant.tsx:570（清空对话历史，onClick 内联）
onClick={() => { cancelActiveRequest(); store.clearSession(novel.id, 'bible'); store.setMessages(novel.id, 'bible', [welcome]); }}
```

仓库既有确认先例（照此风格写）：

```tsx
// src/components/book-factory/PlanningTab.tsx:201-202
if (!(await appConfirm('重置流程进度？', '所有创作步骤的完成标记将被清空并回到第 1 步，不影响已创作的内容。', { confirmLabel: '重置' }))) return;
```

`appConfirm` 签名（`src/components/ui/app-confirm.tsx:30-34`）：`appConfirm(title, description?, options?: { confirmLabel?, cancelLabel? }): Promise<boolean>`。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 前端全量测试 | `npm run test:frontend` | 全绿 |
| Lint 改动文件 | `node node_modules/eslint/bin/eslint.js <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**：

- `src/components/WorldBibleView.tsx`（仅 `deleteEntity` 函数体头部）
- `src/components/ContinuationPackView.tsx`（仅 `handleDeletePack` 头部）
- `src/components/ForeshadowingPanel.tsx`（仅 `handleDelete` 头部）
- `src/components/IdeaFragmentBoard.tsx`（仅 `handleDelete` 头部）
- `src/components/WorldBibleAssistant.tsx`（仅清空对话历史的 onClick）
- 对应测试文件（新建或扩展，见 Test plan）

**Out of scope**：

- 六个 world-bible Tab 组件（`CharactersTab.tsx` 等）——确认加在 `WorldBibleView.deleteEntity` 单点，Tab 不动
- 删除章节/书稿/技能卡的既有确认流程——已达标，不要改
- `src/components/ui/app-confirm.tsx` 本身

## Git workflow

小步提交，消息如 `fix(ux): require confirmation before destructive entity/pack/fragment deletion`；完成即提交，不 push。

## Steps

### Step 1: WorldBibleView.deleteEntity 接入确认

在 `deleteEntity` 函数体第一行（`try` 之前）加：

```tsx
const ENTITY_TYPE_LABELS = { character: '角色', location: '地点', item: '物品', timeline: '时间线事件', faction: '势力', powerLevel: '力量体系' } as const;
// deleteEntity 内：
if (!(await appConfirm(
  `删除该${ENTITY_TYPE_LABELS[type]}条目？`,
  '该条目将被永久删除（含其参与的关系数据），不可撤销。',
  { confirmLabel: '删除' },
))) return;
```

在文件头部 import `appConfirm`（路径 `./ui/app-confirm`）。若文件已有同名 import 则复用。

**Verify**: `node node_modules/typescript/bin/tsc --noEmit` → 0 错误

### Step 2: 其余四处删除路径接入确认

- `ContinuationPackView.handleDeletePack`：首行加 `if (!(await appConfirm('删除该资料包？', '将永久删除资料包及其全部提取实体与矛盾清单；删除后需重新上传并解析。', { confirmLabel: '删除' }))) return;`
- `ForeshadowingPanel.handleDelete`：首行加 `if (!(await appConfirm('删除该伏笔？', '删除后不可撤销。', { confirmLabel: '删除' }))) return;`
- `IdeaFragmentBoard.handleDelete`：首行加 `if (!(await appConfirm('删除该灵感碎片？', '删除后不可撤销。', { confirmLabel: '删除' }))) return;`（注意保留其后既有的 expansion abort 清理逻辑顺序不变）
- `WorldBibleAssistant.tsx:570` 清空按钮：把 onClick 改为 `onClick={() => { void (async () => { if (!(await appConfirm('清空对话历史？', '当前设定助手的全部对话将被清空，不可撤销。', { confirmLabel: '清空' }))) return; cancelActiveRequest(); store.clearSession(novel.id, 'bible'); store.setMessages(novel.id, 'bible', [welcome]); })(); }}`

各文件头部补 `appConfirm` import。

**Verify**: `node node_modules/typescript/bin/tsc --noEmit` → 0 错误；`grep -rn "deleteEntity('character', char.id)" src/components/world-bible/ | wc -l` → 1（调用点未被改动）

### Step 3: 回归测试

新建 `src/tests/destructive-delete-confirm.test.tsx`。用 `vi.mock` 把 `../components/ui/app-confirm`（按各被测文件的相对引用路径）mock 为 `appConfirm: vi.fn()`：

1. mock 返回 `false`：渲染 `ForeshadowingPanel`（props 参考 `src/components/ForeshadowingPanel.tsx:25-31` 的 `novelId/currentChapterId`），点击删除按钮（`aria-label="删除伏笔"`）→ 断言 `deleteForeshadowing` 的 client 未被调用（mock `../lib/db-transport` 或对应 client 模块，仿照 `src/tests/components.test.tsx` 里既有的 client mock 方式）。
2. mock 返回 `true`：同一操作 → 断言删除 client 被调用了一次。
3. 对 `WorldBibleView.deleteEntity` 走查由既有测试覆盖（如有 `world-bible` 相关测试文件跑全量回归即可；不强制为其新写挂载测试）。

**Verify**: `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/destructive-delete-confirm.test.tsx` → 全过

## Test plan

见 Step 3；结构仿照 `src/tests/components.test.tsx`（本仓库组件级行为测试的既有范式，含 toast/client mock 模式）。

**Verify**: `npm run test:frontend` → 全绿

## Done criteria

- [ ] `npm run typecheck` exit 0
- [ ] `npm run test:frontend` 全绿
- [ ] `grep -n "appConfirm" src/components/WorldBibleView.tsx src/components/ContinuationPackView.tsx src/components/ForeshadowingPanel.tsx src/components/IdeaFragmentBoard.tsx src/components/WorldBibleAssistant.tsx` 每个文件至少 1 处命中
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 任一「Current state」摘录与实际代码不符。
- `WorldBibleView.deleteEntity` 的函数签名已变（新增了 name 参数等）——报告差异，不要自行重写文案逻辑。
- 测试里 mock `appConfirm` 后组件仍直接调用了删除 client（说明存在绕过 `handleDelete` 的第二删除路径）——报告该路径位置。

## Maintenance notes

- 未来新增世界书实体类型时，`deleteEntity` 单点确认自动覆盖；若新 Tab 绕过 `deleteEntity` 直连 client，评审必须拦下。
- 若后续引入撤销 toast（toast.ts 已支持 action 按钮），可在确认之外叠加「已删除·撤销」条；本计划不做。
