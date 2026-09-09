# Plan 184: 渲染与数据生命周期性能——助手消息 memo、product_events 保留策略、checkpoint 增量、向量缓存上限

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- src/components/AppShell.tsx src/components/AIAssistant.tsx src/components/AIAssistantDrawer.tsx server/lib/db/product-events.ts server/routes/continuation.ts server/vector-store.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED（保留策略涉及数据删除，需保守默认）
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

四个独立的性能/增长缺陷：

1. **助手消息全量重渲染**：`assistantInput` useState 在 AppShell 顶层（1225 行组件），每键入一字符整树重渲染；每条 assistant 消息的 `ReactMarkdown` 无 memo——消息越多打字越卡。
2. **product_events 无保留策略**：每次编辑器进入/审计/生成都写事件，无任何自动清理；指标函数把窗口内全表载入内存做 ~15 次线性过滤，导出全表 JSON.stringify。
3. **实体抽取 checkpoint O(n²) 序列化**：每 batch 都 `JSON.stringify` 累计结果 `job.result`，大批次时主事件循环周期性尖峰。
4. **向量内存缓存无界 + 全表扫检索**（LOW，调查项）：`embeddingCache` 模块级 Map 无上限；`searchSimilar` 全量载入线性算余弦。

## Current state

相关文件与角色：

- `src/components/AppShell.tsx:213` — `const [assistantInput, setAssistantInput] = useState('');`
- `src/components/AIAssistant.tsx:43` — `useAssistantSessionStore()` 无 selector 订阅整个 store；`:503` 每条消息 `ReactMarkdown`
- `server/lib/db/product-events.ts:96,112-142` — INSERT 无清理；metrics 全表内存过滤
- `server/routes/product-events.ts:26-30` — export 全表一次性序列化
- `server/routes/continuation.ts:500-524` — `touchEntityExtractionJob` 每次全量序列化 checkpoint+result
- `server/vector-store.ts:21,75-99` — `embeddingCache` 无界 Map；`searchSimilar` 全量扫描

现状摘录：

```tsx
// AppShell.tsx:211-215
const [user] = useState(LOCAL_USER);
const [loading, setLoading] = useState(false);
const [assistantInput, setAssistantInput] = useState('');
```

```tsx
// AIAssistant.tsx:43-51
const sessionState = useAssistantSessionStore();
const session = sessionState.getSession(sessionKey, 'general');
...
const messages: Message[] = session.messages.map((message) => ({ ... }));
...
// AIAssistant.tsx:503
<ReactMarkdown>{msg.content}</ReactMarkdown>
```

```ts
// product-events.ts:112-116 — 全窗口载入 + 线性过滤
const events = (getDb().prepare('SELECT * FROM product_events WHERE created_at >= ? ORDER BY created_at ASC').all(cutoff) as ProductEventRow[]).map(toEvent);
const unique = (name, result?) => new Set(events.filter(e => ...).map(e => e.objectId)).size;
```

```ts
// continuation.ts:506-509 — 每 batch 全量重序列化
checkpointJson = JSON.stringify(checkpoint);
resultJson = job.result ? JSON.stringify(job.result) : undefined;
```

```ts
// vector-store.ts:21
const embeddingCache = new Map<string, StoredEmbedding>();
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| 后端全量 | `npm test` | 全绿 |
| 定向 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/product-events*.test.ts tests/pack-sync-integration.test.ts` | 全过 |

## Scope

**In scope**：

- `src/components/AppShell.tsx`（assistantInput 状态下沉）
- `src/components/AIAssistant.tsx`（selector 订阅 + 消息行 memo 组件）
- `src/components/AIAssistantDrawer.tsx`（如需透传）
- `server/lib/db/product-events.ts` + `server/routes/product-events.ts`（保留策略 + 流式导出）
- `server/routes/continuation.ts`（checkpoint 频率/增量）
- `server/vector-store.ts`（缓存上限；检索优化仅做调查记录）
- 相关测试

**Out of scope**：

- `useAssistantSessionStore` 的会话数据结构（改 selector 即可，不重构 store）
- sqlite-vec 扩展引入（调查项结论另立计划）
- Plan 183 的 SSE 分发层

## Git workflow

每个独立项一次提交；消息如 `perf(assistant): memoize message rows and sink input state`；完成即提交，不 push。

## Steps

### Step 1: 助手消息渲染优化

1. `AIAssistant.tsx` 内新建 memo 消息行组件 `AssistantMessageRow`（同文件内定义即可）：props 为 `(msg: Message, 稳定回调集)`；把每条消息的 JSX（含 `ReactMarkdown` 与操作按钮行）移入；`export default React.memo(AssistantMessageRow)`。回调若引用可变 state，用 `useCallback` + ref 模式稳定。
2. store 订阅收窄：`const sessionState = useAssistantSessionStore();` 改为 `useAssistantSessionStore(useShallow((s) => ({ session: s.getSession(sessionKey, 'general'), ...实际用到的action })))`（zustand v5 的 `useShallow` 从 `zustand/react/shallow` import；注意 `getSession` 若每次返回新对象需先在 store 层保证同引用，或改为订阅 `s.sessions[sessionKey]` 原始切片——以 store 实现为准，`sed -n '1,40p' src/stores/assistant-session-store.ts` 核对）。
3. `assistantInput` 下沉：AppShell.tsx:213 的 state 移入 AIAssistantDrawer（或 AIAssistant）内部；AppShell 中仅 `handleAssistant*` 真正需要输入值的地方改为经 ref/事件回传（`grep -n "assistantInput" src/components/AppShell.tsx` 列出全部消费点逐一迁移；drawer 未打开时不渲染 AppShell 顶层输入相关 UI 的话更简单）。

**Verify**: typecheck 0 错误；`grep -n "assistantInput" src/components/AppShell.tsx` 消费点归零或仅剩透传

### Step 2: product_events 保留策略 + 导出瘦身

1. `product-events.ts` 新增：

```ts
/** Delete events older than the retention window. Returns removed row count. */
export function pruneProductEvents(olderThanMs = 90 * 86400000): number {
  return getDb().prepare('DELETE FROM product_events WHERE created_at < ?').run(Date.now() - olderThanMs).changes;
}
```

2. 在服务启动时调用：定位 db 初始化后的启动钩子（`grep -n "markRunningInterrupted\|pruneStale" server.ts server/lib/db-init.ts`，插在同一区域），`pruneProductEvents()` 包 try/catch（失败仅日志，不阻断启动）。
3. `/api/product-events/export`（product-events.ts:26-30）：加 `?days=90` 查询参数（zod 校验，默认 90），查询加 `WHERE created_at >= ?`；保持 JSON 响应格式（体量已受窗口约束，不强制流式）。
4. metrics 函数不动（窗口查询已存在，保留策略保证了分母有界）。

**Verify**: `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/product-events*.test.ts` 全过（新增一条：插入 created_at 100 天前的事件 → prune 后计数减少）

### Step 3: 抽取 checkpoint 降频

`server/routes/continuation.ts:1721-1726` 循环内两次 `touchEntityExtractionJob` 改为：`batch-start` 仅更新内存 job 字段不落盘（新增参数 `touchEntityExtractionJob(job, 'batch-start', { persist: false })`）；`batch-completed` 保持落盘。`touchEntityExtractionJob` 签名加第三参 options，`persist: false` 时跳过 DB 写但仍刷新 `lastActivityAt`。恢复语义不受影响：断点粒度从 batch-start 收窄为 batch-completed（完成向量 `completedChunkIndexes` 仍是每 batch 落盘），`tests/pack-sync-integration.test.ts` 与恢复相关测试守护。

**Verify**: `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/pack-sync-integration.test.ts` 全过；`npm test` 全绿

### Step 4: 向量缓存上限（机械部分）

`server/vector-store.ts:21` 的 `embeddingCache` 加容量上限：

```ts
const EMBEDDING_CACHE_MAX_ENTRIES = 5_000;
// set 后：if (embeddingCache.size > EMBEDDING_CACHE_MAX_ENTRIES) {
//   删除最早的 entry（Map 迭代序即插入序）：embeddingCache.delete(embeddingCache.keys().next().value)
// }
```

检索全表扫为调查项：本步只在 `searchSimilar` 处加一行 `logger.debug` 记录 chunk 数量（已有 logger 模块），数据积累后另立计划决定是否引入 sqlite-vec/分块。**不做**算法替换。

**Verify**: typecheck 0 错误；`tests/` 中 vector-store 相关测试全过（`grep -rln "vector-store\|searchSimilar" tests/`）

### Step 5: 回归测试

1. `src/tests/` 新增 `assistant-message-memo.test.tsx`：渲染 3 条消息的助手面板 → 重渲染（改无关 prop）→ 断言 ReactMarkdown 渲染次数不增（用 `vi.spyOn` 或在 mock 中计数）。若 store selector 改造导致取值路径复杂，至少保留「输入键入不触发消息行重渲染」断言（fireEvent.input 后计数）。
2. 既有助手相关测试（`grep -rln "AIAssistant" src/tests/`）全绿。

**Verify**: `npm run test:frontend` 全绿

## Test plan

见 Step 2/3/5。重点既有守卫：`pack-sync-integration.test.ts`（checkpoint 恢复）、`product-events*`、`export-route.test.ts`。

## Done criteria

- [ ] typecheck 0 错误；`npm test`、`npm run test:frontend` 全绿
- [ ] `grep -n "pruneProductEvents" server/lib/db/product-events.ts` ≥1 且启动钩子处有调用
- [ ] `grep -n "persist: false" server/routes/continuation.ts` 命中（batch-start 不落盘）
- [ ] `grep -n "EMBEDDING_CACHE_MAX_ENTRIES" server/vector-store.ts` 命中
- [ ] memo 消息行组件存在且测试通过
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- `getSession` 每次返回新对象且 store 无法以稳定切片暴露——selector 改造会引发无限重渲染风险，STOP 报告 store 结构。
- checkpoint `persist:false` 导致任何恢复/中断测试失败（143 计划语义被破坏）——回退该步，仅保留 Step 1/2/4。
- product_events 的 metrics 消费方依赖全历史窗口（`grep -rn "getProductEventMetrics" server/ src/` 出现 >365 天请求）——保留策略会改变其数字，报告消费方。

## Maintenance notes

- 评审关注点：缓存淘汰用 Map 插入序近似 LRU（get 不提升位次）——够用且零依赖；未来真实 LRU 再换。
- 90 天保留是保守默认；若 PM 需要更长漏斗窗口，改常量即可，导出端点 days 参数同步上限。
- Plan 183 完成后再评估编辑器实际卡顿是否需要进一步拆 EditorView（014 Phase 5b 范畴）。
