# Plan 194 Spike — Cmd/Ctrl+K 语义检索（相似段落跳转）设计文档

> 状态：竖切片原型已落地（服务端端点 + 面板 + 快捷键），本文档记录设计取舍、
> 诚实边界与开放问题。这不是完整功能交付；扩展为命令面板需另立计划。

## 1. 竖切片范围（已实现）

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 检索端点 | `server/routes/search.ts` → `POST /api/search-similar` | zod 校验 `{novelId, query≤500, limit≤20}`；返回 `{available, embeddingStatus, indexed, hits[]}` |
| 命中携带章节 | `server/vector-store.ts` `searchSimilar` | 返回值新增 `chapterId`（表里本来就有，纯投影扩展；`story-context.ts` 的既有消费点不受影响） |
| 快捷键 | `src/lib/keyboard-shortcuts.ts` `search` | `Cmd/Ctrl+K`；AppShell 在**输入框豁免之前**处理（命令面板语义：输入焦点下也能唤起） |
| 检索面板 | `src/components/QuickSearchOverlay.tsx` | 300ms 防抖 + AbortController；↑↓ 选择、Enter 跳转、Esc 关闭；点结果跳章 |
| 跳章通道 | `AppShell.jumpToSearchHit` | 复用 `editorReturnTarget`（`initialChapterId`）机制，与驾驶舱跳章同一条通道 |
| README 回填 | `README.md` 键盘快捷键行 | Plan 191 摘除的「Cmd+K」宣称现在真实存在 |

## 2. 检索范围与诚实降级

**检索面**：仅本书正文 chunks（`vector_chunks.novel_id` 过滤）。不做设定库双源（见开放问题 #2）。

**诚实降级契约**（沿用 `docs/specs/llm-status-honesty.md` 的琥珀色语义，不假装空结果）：

| 服务端状态 | 响应 | 面板呈现 |
| --- | --- | --- |
| embedding `initializing`/`unavailable` | `available:false` + 状态值 | 琥珀色提示「语义索引当前不可用（状态：…）」 |
| `available:true` 但 `getChunkCount()==0` | `indexed:false` | 琥珀色提示「本书还没有可检索的索引」+ 说明索引覆盖范围 |
| 正常 | `hits[]`（可能为空） | 结果列表；空结果会提示「模型或索引代际不一致时旧索引会被排除」 |

**索引覆盖范围（spike 发现的关键事实）**：`addChunk` 的唯一调用点在
`server/routes/production.ts:1269` —— 只有「生产 run 被接受写入」时按章写一条 chunk
（每章 1 chunk，全文）。**编辑器手写、自动保存、助手改写均不入索引**。
因此本功能目前的检索面是「AI 生产写过的章」，对手写百万字作者的诉求只算部分满足
（开放问题 #1）。

## 3. 模型治理现状（STOP 条件核查结论）

`searchSimilar` 用 `stored.modelId === queryModelId && stored.dimensions === queryEmbedding.length`
做兼容过滤，本地模型固定 `local:Xenova/bge-small-zh-v1.5`，query 与 chunk 走同一个
`embedWithMetadata` —— 同模型检索成立。旧格式 chunk（`legacy:unknown`）与换模型后的
旧索引会被**静默排除**：结果可能比预期少但不串模型。代价是「换模型后索引静默失效」
用户不可感知（开放问题 #4）。

## 4. 与既有机制的共存

- **快捷键**：`Cmd+K` 在输入框豁免之前处理；`Cmd+1~5`/撤销重做路径不变。
- **Library 过滤框**：书库是跨书 substring 过滤（选书前）；Cmd+K 是书内语义检索
  （选书后）。二者入口正交，无路由冲突。面板仅在 `selectedNovel` 存在时挂载。
- **视图路由**：跳章走 `editorReturnTarget`，与驾驶舱/continuation 的 launchState
  机制同源，不会与 cockpit 静默执行路由（`docs/specs/cockpit-routing.md`）打架。

## 5. 手工冒烟步骤（dev 环境）

1. `npm run dev`，选书进入编辑器，通过生产流程接受写入至少一章（建索引）。
2. 任意位置（包括输入框内）按 `Cmd/Ctrl+K` → 面板弹出。
3. 输入已写正文的同义表述（如情节描述，非精确字串）→ 300ms 后出结果，含章节名、片段、相似度。
4. ↑↓ 选择 + Enter（或点击）→ 关闭面板并打开编辑器对应章。
5. 无 Key + 断网（embedding unavailable）时按 Cmd+K 搜索 → 琥珀色降级提示，非空结果伪装。
6. 新书（未接受过任何生产写入）搜索 → 「还没有可检索的索引」提示。

## 6. 开放问题（产品拍板后另立计划）

1. **手写正文不入索引**：自动保存/助手改写是否建索引？成本：每章 1 次 embedding
   （本地模型 CPU 几百毫秒）+ 写放大；建议防抖批量回填 + 只在章节完成态建。
2. **设定库双源检索**：characters/worldRules/伏笔等结构化文本是否入向量库；
   命中后跳设定视图的路由语义需产品定义。
3. **每章仅 1 chunk**：长章全文单 chunk 会稀释相似度信号；分块策略（按场景/字数）
   与 `chunk_index` 字段已预留，需定分块粒度与重建脚本。
4. **索引代际静默失效**：换 embedding 模型/导入旧库后旧索引被静默排除；
   应在面板呈现「索引已过期，建议重建」提示，需代际标记 UI。
5. **命令面板化路径**：当前是纯检索面板；若扩展命令（设置项/动作/视图跳转），
   建议引入 cmdk 类分组渲染，检索结果作为其中一个 section，快捷键注册复用
   `keyboard-shortcuts.ts`。
6. **排名调优**：余弦原始分直接展示为百分比，未做标题/章节位置加权；跨书搜索
   未做（入口语义依赖选书）。
