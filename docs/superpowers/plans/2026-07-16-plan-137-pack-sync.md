# Plan 137：资料包同步到设定分类

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 将 approved 续写资料包中的结构化内容同步为 World Bible 实体和关系。
**Architecture:** LLM 从 sourceDocuments[].text 提取符合 World Bible schema 的实体 JSON → 前端预览面板展示候选/跳过/待确认 → 用户确认后服务端单事务写入 → 前端即时刷新。
**Tech Stack:** React + TypeScript，现有 LLM 调用管线，better-sqlite3 事务。

---

## T1：服务端提取端点

### 目标
新建 `POST /api/continuation-packs/extract-entities`，将 approved 资料包的原始文本发送给 LLM，输出符合 World Bible schema 的实体候选。

### 文件
- **修改**: `server/routes/continuation.ts`
- **新建**: `shared/lib/sync-extract-prompt.ts`

### 步骤

- [ ] **1.1** 在 `shared/lib/sync-extract-prompt.ts` 中构建 LLM prompt：

```typescript
export interface SyncExtractionResult {
  characters: Array<{ name: string; role: string; summary: string; bio: string; traits: string[] }>;
  locations: Array<{ name: string; region: string; description: string }>;
  items: Array<{ name: string; type: string; description: string }>;
  factions: Array<{ name: string; leader: string; territory: string; description: string }>;
  powerLevels: Array<{ name: string; tier: number; characteristics: string; description: string }>;
  timelineEvents: Array<{ title: string; timestamp: string; description: string; order: number }>;
  relationships: Array<{ sourceName: string; sourceType: string; targetName: string; targetType: string; relationshipType: string; description: string }>;
  globalOutline: string;
  worldRules: string;
}

export function buildSyncExtractionPrompt(sourceTexts: string[]): { system: string; user: string }
```

Prompt 指令：从多段文本中提取所有世界观实体，返回严格 JSON。关系中的 sourceName/targetName 是实体名称（非 ID），sourceType/targetType 是 character/location/item/faction。

- [ ] **1.2** 在 `server/routes/continuation.ts` 中新增端点：

```typescript
app.post('/api/continuation-packs/extract-entities', async (req, res) => {
  const { packId } = req.body;
  // 1. 获取 pack，校验 status === 'approved' 且 novelId 属于当前作品
  // 2. 收集 sourceDocuments[].text
  // 3. 调用 LLM（buildSyncExtractionPrompt）
  // 4. 返回 SyncExtractionResult
});
```

- [ ] **1.3** 在 `src/lib/continuation-client.ts` 中新增客户端函数：

```typescript
export async function extractPackEntities(packId: string): Promise<SyncExtractionResult> {
  return call('/api/continuation-packs/extract-entities', { packId });
}
```

- [ ] **1.4** 验证：`npm run typecheck`

---

## T2：服务端同步写入端点

### 目标
新建 `POST /api/continuation-packs/sync-to-world`，接收用户确认的实体候选，单事务写入数据库。

### 文件
- **修改**: `server/routes/continuation.ts`

### 步骤

- [ ] **2.1** 定义请求体类型：

```typescript
interface SyncToWorldRequest {
  packId: string;
  novelId: string;
  characters: Array<{ name: string; role: string; summary: string; bio: string; traits: string[] }>;
  locations: Array<{ name: string; region: string; description: string }>;
  items: Array<{ name: string; type: string; description: string }>;
  factions: Array<{ name: string; leader: string; territory: string; description: string }>;
  powerLevels: Array<{ name: string; tier: number; characteristics: string; description: string }>;
  timelineEvents: Array<{ title: string; timestamp: string; description: string; order: number }>;
  relationships: Array<{ sourceName: string; sourceType: string; targetName: string; targetType: string; relationshipType: string; description: string }>;
  globalOutline?: string;
  worldRules?: string;
}
```

- [ ] **2.2** 实现写入逻辑：

```typescript
app.post('/api/continuation-packs/sync-to-world', async (req, res) => {
  const { packId, novelId, characters, locations, items, factions, powerLevels, timelineEvents, relationships, globalOutline, worldRules } = req.body;

  // 1. 校验 pack 存在、approved、novelId 匹配
  // 2. 校验 novel 存在
  // 3. 在 db.runInTransaction() 中：
  //    a. 如果 globalOutline/worldRules 非空且 novel 对应字段为空，填充
  //    b. 同名跳过：查询已有实体，按 name 匹配，跳过已存在的
  //    c. 创建新实体，收集 name→id 映射
  //    d. 用映射解析关系中的 sourceName/targetName → sourceId/targetId
  //    e. 校验关系：同作品、非自关联、两端实体存在
  //    f. 创建关系（复用 createEntityRelationship 的校验）
  // 4. 返回 { created: { characters, locations, ... }, skipped: { ... }, relationshipsCreated }
});
```

- [ ] **2.3** 名称规范化函数：

```typescript
function normalizeName(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}
```

匹配时用 normalizeName 比较，但存储原始名称。

- [ ] **2.4** 在 `src/lib/continuation-client.ts` 中新增客户端函数：

```typescript
export async function syncPackToWorld(data: SyncToWorldRequest): Promise<SyncResult> {
  return call('/api/continuation-packs/sync-to-world', data);
}
```

- [ ] **2.5** 验证：`npm run typecheck`

---

## T3：前端提取 + 预览面板

### 目标
在 ContinuationPackView 的已批准资料包卡片中增加"同步到设定"按钮，点击后调用提取端点，显示预览面板。

### 文件
- **修改**: `src/components/ContinuationPackView.tsx`
- **新建**: `src/components/world-bible/SyncPreviewPanel.tsx`

### 步骤

- [ ] **3.1** 新建 `SyncPreviewPanel.tsx`：

Props:
```typescript
interface SyncPreviewPanelProps {
  novelId: string;
  packId: string;
  extraction: SyncExtractionResult;
  existingCharacters: Character[];
  existingLocations: Location[];
  existingItems: Item[];
  existingFactions: Faction[];
  onConfirm: (selections: SyncSelections) => void;
  onCancel: () => void;
  isSyncing: boolean;
}
```

功能：
- 按分类（人物/地点/道具/势力/力量体系/时间线/关系）分 Tab 或分节显示
- 每项显示：名称、摘要、来源证据（截取前 100 字符）
- 同名已有数据标记"跳过"，默认不勾选
- 新增项默认勾选
- 关系端点不匹配任何实体时标记"待确认"，显示下拉选择器
- 底部统计：新增 X 项、跳过 Y 项、待确认 Z 项
- 确认/取消按钮

- [ ] **3.2** 在 ContinuationPackView 的 active pack review 区域（approve 按钮附近），approved 状态时增加"同步到设定"按钮：

```tsx
{activePack.status === 'approved' && (
  <button
    onClick={() => handleSyncEntities(activePack)}
    disabled={isExtracting}
    className="px-4 py-2 rounded-xl bg-theme-accent text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2"
  >
    <RefreshCw size={14} /> 同步到设定
  </button>
)}
```

- [ ] **3.3** 实现 `handleSyncEntities`：

```typescript
const [syncExtraction, setSyncExtraction] = useState<SyncExtractionResult | null>(null);
const [isExtracting, setIsExtracting] = useState(false);

const handleSyncEntities = async (pack: ContinuationPack) => {
  setIsExtracting(true);
  try {
    const result = await extractPackEntities(pack.id);
    setSyncExtraction(result);
  } catch (e) {
    setError('提取失败：' + (e instanceof Error ? e.message : '未知错误'));
  } finally {
    setIsExtracting(false);
  }
};
```

- [ ] **3.4** 当 `syncExtraction` 非 null 时渲染 `<SyncPreviewPanel>`。

- [ ] **3.5** 验证：`npm run typecheck`

---

## T4：确认写入 + 即时刷新

### 目标
用户确认后调用 sync-to-world 端点，成功后刷新 WorldBibleView 数据。

### 文件
- **修改**: `src/components/ContinuationPackView.tsx`
- **修改**: `src/components/WorldBibleView.tsx`

### 步骤

- [ ] **4.1** ContinuationPackView 增加 onSyncComplete 回调 prop：

```typescript
interface ContinuationPackViewProps {
  novel: Novel;
  initialActivePackId?: string | null;
  onSyncComplete?: () => void;  // ADD
}
```

- [ ] **4.2** 实现 handleSyncConfirm：

```typescript
const [isSyncing, setIsSyncing] = useState(false);

const handleSyncConfirm = async (selections: SyncSelections) => {
  if (!syncExtraction || !activePack) return;
  setIsSyncing(true);
  try {
    await syncPackToWorld({
      packId: activePack.id,
      novelId: novel.id,
      ...buildSyncPayload(syncExtraction, selections),
    });
    setSyncExtraction(null);
    onSyncComplete?.();
  } catch (e) {
    setError('同步失败：' + (e instanceof Error ? e.message : '未知错误'));
    // 保留预览，允许重试
  } finally {
    setIsSyncing(false);
  }
};
```

- [ ] **4.3** WorldBibleView 传入 onSyncComplete：

```tsx
<ContinuationPackView
  novel={novel}
  initialActivePackId={requestedReviewPackId}
  onSyncComplete={() => fetchAll()}  // 重新加载所有数据
/>
```

`fetchAll` 已存在于 WorldBibleView，负责加载 characters/locations/items/factions/relationships 等。

- [ ] **4.4** 验证：`npm run typecheck`

---

## T5：测试

### 目标
覆盖提取零写入、拒绝非法请求、同名跳过、事务回滚、幂等同步。

### 文件
- **新建**: `src/tests/pack-sync.test.ts`

### 步骤

- [ ] **5.1** 测试用例：

1. **提取零写入**：mock LLM 返回实体，验证数据库无变化
2. **Draft pack 被拒绝**：调用 extract-entities 传 draft packId，返回 400
3. **跨作品 pack 被拒绝**：pack.novelId ≠ 请求 novelId，返回 403
4. **同名跳过**：已有"张三"，同步包含"张三"，结果 skipped +1
5. **唯一名称创建**：新名称，结果 created +1
6. **关系消歧**：关系端点名称匹配已创建实体，正确关联 ID
7. **重复同步幂等**：同一 pack 同步两次，第二次不创建新数据
8. **事务回滚**：模拟创建实体中途失败，验证无部分写入

- [ ] **5.2** 验证：`npm run test:frontend -- --run`

---

## 执行顺序

```
T1 (提取端点) → T2 (写入端点) → T3 (预览面板) → T4 (确认+刷新) → T5 (测试)
```

每个 Task 完成后运行 `npm run typecheck`，T5 完成后运行全量验证：
```bash
npm run typecheck && npm run lint && npm run test:frontend -- --run
```
