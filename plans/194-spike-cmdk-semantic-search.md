# Plan 194: [方向 Spike] Cmd/Ctrl+K 语义检索窄切口——相似段落跳转

> **Executor instructions**: 这是设计/调研型计划。产出是设计文档 + 一个可运行的竖切片原型（真实调 `searchSimilar`，UI 走最小命令面板）；不完整交付功能。产出写入 `docs/prd/2026-09-cmdk-semantic-search.md`；完成后更新 `plans/README.md` 状态行。

## Status

- **Priority**: P3（方向类）
- **Effort**: L（粗估，含 UI 竖切片）
- **Risk**: MED（搜索 UX 需避免与现有视图路由打架）
- **Depends on**: Plan 175（快捷键体系与 SettingsModal 快捷键列表已就位）
- **Category**: direction（design/spike）
- **Planned at**: commit `0dfbbcf`, 2026-09-10
- **Executed**: 2026-09-11，DONE（spike 竖切片落地 + 设计文档）。服务端 searchSimilar 仅做 chapterId 投影扩展（story-context 消费点不受影响，vector-store 测试补断言）。关键事实与开放问题见 docs/prd/2026-09-cmdk-semantic-search.md。验证：tsc 0 错误；eslint 0 警告；前端全量 884/884；vector-store 3/3。

## Why this matters

语义检索的全部固定成本已经付出——向量库、分块、本地 embedding 模型随安装包分发（onnxruntime 在打包清单）——但唯一消费点是生产管线的上下文注入（`story-context.ts:103`）。用户侧检索面全是字符串匹配：书库只有 substring 过滤框（`Library.tsx:245`）。而 `README.md:238` 已把「全局 Cmd/Ctrl+K 搜索」写进门面（Plan 191 将临时摘除该失实宣称）。百万字长篇作者「我写到过 XX 的那段在哪」无处可查——把 `searchSimilar` 接到一个全局搜索面是边际成本最低的高价值补全。

## Grounding evidence

- `server/embedding.ts`、`server/vector-store.ts`、`server/routes/config.ts:40`（embedding retry）基建齐备
- `server/helpers/story-context.ts:103-110` — `searchSimilar(values, novelId, modelId, 2)` 唯一消费点
- `README.md:238` — 已宣传 Cmd/Ctrl+K
- `keyboard-shortcuts.ts` — 快捷键注册表无搜索项

## Scope

**In scope**：设计文档 + 最小竖切片：全局 Cmd+K 监听 → 简易面板 → 输入 query → 调用服务端相似检索端点 → 结果列表（章节标题+片段）→ 点击跳转编辑器对应章。embedding 未就绪时诚实降级提示（沿用 llm-status-honesty 的琥珀色语义）。

**Out of scope**：命令面板的命令化扩展（设置项/动作搜索）、设定库双源检索（列为开放问题）、索引重建 UI。

## Steps

### Step 1: 服务端检索端点

`server/routes/` 新增 `POST /api/search-similar`：zod 校验（novelId、query、limit≤20）→ `embedWithMetadata(query)` + `searchSimilar` → 返回 `[{ chapterId?, chunkText, score }]`。复用 `story-context.ts:103` 的既有调用模式；embedding 未 ready 时返回结构化 `unavailable` 响应（不假装空结果）。

### Step 2: 前端竖切片

`src/components/QuickSearchOverlay.tsx`（最小面板）：`keyboard-shortcuts.ts` 注册 `search: { key: 'k', mod: true }` → AppShell 全局监听打开面板 → 防抖 fetch → 结果列表 → 点击 `handleNavigate('editor')` 并选中对应章（复用 launchState 机制，`grep -n "initialChapterId" src/components/AppShell.tsx` 找选中通道）。样式沿用主题令牌。

### Step 3: 设计文档

`docs/prd/2026-09-cmdk-semantic-search.md`：检索范围（仅正文 chunks vs 设定库双源）、与 Library 过滤框的关系、索引冷启动/换库失效处理（`vector-store.ts` 的代际守卫已有）、开放问题（结果排名调优、跨书搜索、命令面板化路径）。

**Verify**: typecheck 0 错误；`npm run test:frontend` 全绿；手工冒烟步骤写入文档（dev 环境选书 → Cmd+K → 搜已写内容 → 跳转）

## Done criteria

- [ ] 端点 + 面板竖切片可用；embedding 不可用时琥珀色降级提示
- [ ] 设计文档含开放问题清单
- [ ] `plans/README.md` 状态行更新

## STOP conditions

- `searchSimilar` 对用户 query 的 embedding 路径与章节 chunk 的 modelId 不一致（跨模型检索失效）——报告模型治理现状。
- 面板与既有快捷键/输入框焦点规则冲突（AppShell 的 input 焦点豁免逻辑）无法无损共存。

## Maintenance notes

落地后：回填 README:238 宣称 + SettingsModal 快捷键列表（Plan 175 Step 7）；若产品认可，扩展为命令面板另立计划。
