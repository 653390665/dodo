# Plan 027: 向量 RAG — 语义检索已写章节
> Source: PlotPilot 竞品分析 | Priority: P1 | Effort: M-L

## Why
InkFlow 当前通过 SQL 查询加载所有章节上下文，随章节数增长线性膨胀。PlotPilot 使用 ChromaDB + bge-small-zh-v1.5 本地嵌入实现语义检索，章节生成时自动召回相关历史内容。这解决了"模型失忆"问题。

## Goal
添加本地向量索引层：写入章节后自动切片 + 嵌入，生成时按语义相似度检索 top-k 片段注入上下文。

## Architecture
```
章节写入事件
  → TextSplitter（按段落+对话切分，~500 char/chunk）
    → EmbeddingService（本地 sentence-transformers / OpenAI 兼容）
      → ChromaDB 向量存储（本地，零网络依赖）
        → 生成时：当前场景语义 → top-k 检索 → 注入 prompt
```

## Steps

### Step 1: 添加 ChromaDB + embedding 依赖
- `pnpm add chromadb`（Node.js ChromaDB 客户端）
- 或使用更轻量的 `hnswlib-node` + 自定义嵌入层
- 嵌入层选项：
  - 方案A：调用已有 LLM 的 embedding endpoint（如 DeepSeek embedding）
  - 方案B：`@xenova/transformers` WASM 本地推理 bge-small-zh-v1.5（零外部依赖）
- Verify: `node -e "require('chromadb')"` 正常加载

### Step 2: 创建 `server/vector-store.ts`
- 初始化 ChromaDB 持久化目录（`~/.inkflow/vector-store/`）
- 创建 `chapter_chunks` 集合（元数据：novelId, chapterId, chunkIndex）
- 导出 `addChunk`, `searchSimilar(chunk, novelId, topK)`, `deleteNovel(novelId)`
- 懒加载模式：首次调用时初始化，不阻塞启动
- Verify: `npx tsx -e "import './server/vector-store'"` 初始化成功

### Step 3: 创建 `server/embedding.ts`
- 封装嵌入接口：`embed(text: string): Promise<number[]>` → 384/768 维向量
- 方案B（推荐）：`@xenova/transformers` + `Xenova/bge-small-zh-v1.5`
  - 首次启动下载模型（~130MB），后续缓存
  - WASM 推理，无需 GPU/二进制依赖
- 回退方案A：如果 transform.js 不兼容，使用 HTTP embedding API
- Verify: `npx tsx -e "import { embed } from './server/embedding'; console.log((await embed('test')).length)"` 输出向量维度

### Step 4: 章节写入钩子 — 自动索引
- 在 `ChapterEditorView` 章节保存时（或后端 `/api/chapters` POST），触发后台索引
- 索引流程：获取章节文本 → TextSplitter 切分 → embed → 存入 ChromaDB
- 后台异步执行，不阻塞 UI
- Verify: 保存章节后，`searchSimilar('测试查询')` 返回已索引片段

### Step 5: 章节生成上下文增强 — 注入 RAG 结果
- 在 `buildProductionPlannerContext` / `buildContinuationContext` 中，调用 `searchSimilar(currentScene, novelId, 5)` 获取 top-5 相关历史片段
- 追加到 context prompt 的 `[历史相关片段]` 区段
- 注意上下文窗口限制：retrieved chunks 总长不超过 2000 tokens
- Verify: 生成章节时 prompt 中包含 `[历史相关片段]` 且内容相关

## Done Criteria
- [ ] `npx tsc --noEmit` 零错误
- [ ] 向量索引随章节保存自动更新
- [ ] 章节生成 prompt 包含语义相关历史片段
- [ ] 嵌入 + 检索延迟 <500ms（本地推理）
- [ ] ChromaDB 数据持久化到 `~/.inkflow/vector-store/`

## STOP Conditions
- 如果 `@xenova/transformers` WASM 推理在 Electron 环境下不兼容，停止并报告，回退到 HTTP embedding API
- 如果 ChromaDB Node.js 客户端与 Electron 主进程冲突，停止并用 `hnswlib-node` 替代
- 如果嵌入+检索延迟 >2s，停止并优化为批量预索引

## Maintenance notes
- 模型缓存位置：`~/.inkflow/models/bge-small-zh-v1.5/`
- 向量索引持久化：`~/.inkflow/vector-store/`
- 章节删除/重写时需同步更新向量索引
