# InkFlow 改进计划

> [!NOTE]
> **所有历史和新建计划的状态、执行结果均以本 README.md 主表记录为准**。旧的单独 plan 文件若存在未标注状态，皆为历史存底，不再单独维护。

## 审计历史

| 轮次 | 审计基准 | 审计时间 | 工具 | 发现 | 计划 |
|------|----------|----------|------|------|------|
| 1 | `fcb3b9b` | 2026-06-18 | shadcn/improve (standard) | 25 | 001–005 |
| 2 | `ca53899` | 2026-06-29 | improve + shadcn 审查 | 18 | 006–010 |
| 3 | `ca53899` | 2026-06-29 | webnovel-writer 互补分析 | 3 | 011–013 |
| 4 | `ca53899` | 2026-06-29 | 竞品优势吸收（Morpheus/Writer's Loop 等 6 项目） | 2 | 014–015 |
| 5 | `ca53899` | 2026-06-29 | PlotPilot 竞品分析 | 2 | 027–028 |
| 6 | `ca53899` | 2026-06-29 | 8 项目扫尾（autonovel 等） | 3 | 029–031 |
| 7 | `ca53899` | 2026-06-29 | 产品策略 + UX + IA 综合审计 | 10 | 042–052 |
| 8 | `ca53899` | 2026-06-29 | 积压审计发现转计划 | 7 | 053–059 |
| 9 | `ca53899` | 2026-06-30 | /shadcn-improve 深度审计 | 5 | 064–068 |
| 10 | `ca53899` | 2026-07-01 | /improve 深度安全与规范审计 | 4 | 077–080 |
| 11 | `current` | 2026-07-04 | shadcn-improve 状态审计 | 1 | 081 |


## 执行顺序 & 依赖图

```
轮次 1（基础安全/质量）
001 (CI 门禁)  ←  最先落地
  ↓
004 (删除死代码)  ←  无风险清理
  ↓
005 (ID 生成)  ←  独立修复
  ↓
002 (认证 + 绑定)  ←  安全基础
  ↓
003 (输入验证)  ←  依赖 002

轮次 2（架构/功能/UI）
006 (辅助函数提取)  ←  解锁 007
  ↓
007 (server.ts 拆分)  ←  解锁 008
  ↓
008 (AI 生产管道)

009 (暗色模式修复)  ←  独立，可并行
010 (仓库清理)      ←  独立，可并行

轮次 3（webnovel-writer 互补）
011 (题材模板)  ←  独立，最先做
  ↓
013 (合同体系)  ←  依赖 011（合同引用题材规则）
012 (审查增强)  ←  独立，可并行

轮次 4（竞品优势吸收）
014 (Prompt 链)  ←  独立
015 (偏好学习)  ←  独立，可并行

轮次 5（PlotPilot 移植）
017 (动态裁剪)  ←  Context Pruning（见 065）
  ↓
027 (向量 RAG)  ←  RAG 注入已就绪
028 (张力心电图)

轮次 6（8 项目扫尾）
029 (机械评分器)  ←  独立
030 (别透露性别)  ←  独立，可并行
031 (事件矩阵)    ←  独立，可并行

轮次 9（自适应进化与上下文优化）
064 (清理 pnpm)   ←  依赖管理规范化（无依赖，可并行）
065 (上下文剪枝)  ←  提升长篇生成精度（可并行）
066 (环境文档)    ←  Electron 与 Gemini 调试（无依赖，可并行）
067 (文风萃取升级)←  深度文风分析（可并行）
068 (Reflexion)   ←  语义 Diff 自适应进化（依赖 015 偏好记录）

轮次 10（API 安全与 CI 门禁收紧）
077 (修复 API 鉴权) ← 运行时 401 阻断项修复（最先执行）
  ├── 078 (CI 引入冒烟) ← 依赖 077（冒烟脚本需带 token 运行）
  ├── 080 (路由输入限制) ← 依赖 077（保障各个新路由验证拦截）
079 (收紧 Lint 门禁)  ← 独立但建议在 078 后做（清理存量警告）
```

**注意**：轮次 1 和轮次 2 可并行推进。006 和 004 都修改 `server.ts`——建议先完成 004（删死代码）再执行 006（提取函数），减少行号漂移。轮次 3 和 4 独立于轮次 1-2，四线可并行。

## 状态表

> [!NOTE]
> **执行摘要**：077-080 已完成；V4 报告中的 TODO 状态为旧报告残留。

| Plan | Title | Status | Depends on |
|------|-------|--------|------------|
| 001 | CI 质量门禁 | DONE | 已独立完成：build.yml 含 check job + needs |
| 002 | 服务器认证 + 绑定修复 | DONE | 已独立完成：authMiddleware + 127.0.0.1 绑定 |
| 003 | API 输入验证 | DONE | 已独立完成：validation.ts + validate() 应用于 3 路由 |
| 004 | 删除 500 行死代码 | REJECTED | `ca53899` refactoring 已独立清除目标死代码 |
| 005 | 修复 ID 生成 (Date.now→UUID) | DONE | 已独立完成：server/id.ts generateId() + 零处 Date.now().toString() |
| 006 | 提取 server.ts 辅助函数 | DONE | — |
| 007 | 拆分 server.ts 路由 | DONE | 006 |
| 008 | 构建 AI 生产管道 (Planner→Writer→Critic) | DONE | 007 |
| 009 | 修复暗色模式 (bg-white→语义 token) | DONE | — |
| 010 | 仓库清理 (tmp-server.cjs + 空目录) | DONE | — |
| 011 | 题材模板移植 — 37 网文题材入库 | DONE | — |
| 012 | 审查维度增强 — 追读力 + Strand Weave | DONE | — |
| 013 | 故事合同体系 — 写作约束卡片 | DONE | 011 |
| 014 | Prompt 模块化路由 — 3 链管道 | DONE | — |
| 015 | 决策驱动偏好学习 — Writer's Loop 模式 | DONE | — |
| 016 | WelcomeView 新手模式简化 | DONE | CSS hidden 方案已完成 |
| 017 | AgentWorkspace 核心标签精简 | DONE | — |
| 018 | Sidebar 探索工具可收起 | DONE | — |
| 019 | Pipeline 静默 catch 块修复 | DONE | — |
| 020 | 路由输入验证补全 | DONE | — |
| 021 | pnpm test 命令 | DONE | — |
| 022 | 知识图谱 — 实体关系 MVP | DONE | — |
| 023 | API 密钥加密 | DONE | AES-256-GCM, 机器派生密钥 |
| 024 | LLM 端点速率限制 | DONE | 6 路由：editor-agent/inspiration/orchestrate/story-cards/extract-skill/audit |
| 025 | Prompt 注入保护 | DONE | wrapUserInput + XML delimiters + system guard |
| 026 | 前端异步 try/catch 补齐 | DONE | App.tsx + EditorView + WorldBible + WelcomeView 已 guard |
| 027 | 向量 RAG — 语义检索已写章节 | DONE | WASM bge-small-zh-v1.5 + JSON store + chapter auto-index + RAG injection |
| 028 | 张力心电图 — 评分 + 曲线 + 诊断 | DONE | 4-dim tension derivation + SVG chart + low-tension auto-diagnosis |
| 029 | 机械文笔评分器 — 零 API 消耗 | DONE | slop-scorer.ts 4 类检测 + 接入 audit |
| 030 | "别透露性别"角色选项 | DONE | concealGender + prompt 约束 + writer context 注入 |
| 031 | 事件冷却矩阵 — 杜绝单调模式 | DONE | 5 类事件 + 冷却规则 + planner 注入 + auto-classify |
| 039 | 拆分 db.ts — 提取 mappers + schema + CRUD | DONE | db.ts: 1,294→631 (-51%) + db-mappers/init/instance |
| 040 | 场景级实体 — chapters × scenes 层级 | DONE | Scene type + DB + CRUD + whitelist + UI |
| 041 | 通用 CRUD 辅助函数 — 消除 13× 重复 | DONE | db-crud.ts (95) + db.ts: 955→574 (-40%) |
| 053 | 拆分 types.ts — novel/world/skills 领域模块 | REJECTED | 类型图依赖过复杂 |
| 054 | 分离服务器/客户端导入路径 → shared/ | DONE | shared/ + server/lib/ + src/ client-only, 270/270 tests |
| 055 | Helmet 安全头部 | DONE | CSP + X-Content-Type-Options + etc |
| 056 | 服务器日志用户内容脱敏 | DONE | server/logger.ts + 13 route files |
| 057 | 选择性 SSE 缓存失效 | DONE | subscribeToChanges entity-type filter |
| 058 | rowTo* 函数 any → 类型安全行映射器 | REJECTED | any necessary for SQLite rows |
| 059 | 题材接入引导流程 | DONE | WelcomeView genre selector active |
| 060 | LLM embedding fallback — use dedicated API | DONE | generateEmbedding helper implemented |
| 061 | Preserve error stack traces in logger | DONE | logger.ts err.stack preserved |
| 062 | Wire validate(dbSchema) into /api/db | DONE | dbSchema middleware applied to /api/db |
| 063 | Rate-limit chapter production endpoints | DONE | rateLimit on /start + /start-stream + /apply |
| 064 | 清理 pnpm 冗余冲突配置文件 | DONE | pnpm lock and workspace files deleted |
| 065 | 对接 Context Pruning 至章节生成后端 | DONE | activeEntityNames parameter wired and used to filter entities |
| 066 | 补充桌面端 Electron 启动与调试文档及 Gemini 指南 | DONE | README.md updated with electron:dev and Gemini setup |
| 067 | 升级文风萃取支持全文本采样与语义聚类 | DONE | processModelSkillExtraction upgraded to sample up to 6 segments evenly |
| 068 | 落地基于 Diff 追踪的自适应 Reflexion 进化引擎 | DONE | runEvolutionReflexion compares AI draft and final text, extracting style rules |
| 069 | 引入类型安全且并发安全的事务管理器 | DONE | runInTransaction helper introduced using better-sqlite3 transaction |
| 070 | 消除实体关系更新中的 SQL 注入漏洞 | DONE | Column whitelist check added to updateEntityRelationship |
| 071 | 向量检索存储迁移至 SQLite | DONE | Vector store migrated to SQLite vector_chunks table with indexing |
| 072 | 极致前端美学与排版节奏优化 | DONE | OKLCH colors introduced and writing surface constrained to 72ch |
| 073 | 落地连续性报告的历史状态自动更新 | DONE | characterUpdates, itemUpdates, and foreshadowingUpdates applied on apply |
| 074 | 落地进程级异常容错与崩溃守护 | DONE | process-level error handlers added to server.ts |
| 075 | 前端样式、暗色模式与无障碍清理 | DONE | app.tsx/Sidebar/AIAssistant 样式与 SettingsModal a11y 清理 |
| 076 | TypeScript 严格模式 | DONE | tsconfig strict:true 启用与 14 文件类型清理 |
| 077 | 修复 API 运行期 401 鉴权 | DONE | 075, 076 |
| 078 | 将单元测试与运行期冒烟测试纳入 CI | DONE | 077 |
| 079 | 收紧 ESLint 门禁与警告清理 | DONE | 078 |
| 080 | 补全与收紧 API 输入验证防线 | DONE | 077 |
| 081 | 修复商业化与配额卡控的 TypeScript 编译错误 | DONE | 081-fix-typescript-compilation-errors.md |



## 考虑后排除的发现

### 轮次 1（2026-06-18）

| Finding | Reason |
|---------|--------|
| PERF-01 (listChapters 重复调用) | 本地 SQLite 亚毫秒，不值得优化 |
| PERF-05 (8ms SSE 延迟) | 用户体验需要，客户端渲染节流 |
| TEST-01 (前端单元测试) | L 量级，需单独规划，不在本轮 |
| DIR-02 (db.ts 拆分) | L 量级，server.ts 拆分优先级更高 |
| DOC-02 (PRD 脱节) | 文档更新，非代码修复 |

### 轮次 2（2026-06-29）

| Finding | Reason |
|---------|--------|
| Phase B — 追踪台后端 `/api/sniff-entities` | **幽灵发现**：`/api/extract-entities` 已存在并接通（`useEntitySniffing.ts:103`），前端链路完整，无需新建端点 |
| UI-02 — `space-y-*` → `flex + gap`（80+ 处） | M 量级；纯样式惯例统一，非功能性修复；可随后续组件改动逐步替换 |
| UI-01 — raw 颜色值泛滥（30+ 文件） | L 量级；需定义新的语义 token（`--theme-error`、`--theme-warning` 等）并全局替换，超出本轮范围 |
| UI-03 — aria-label 缺失（~10 处） | S 量级但分散；应作为可访问性专项而非单独计划 |
| UI-06 — `w-* h-*` → `size-*`（~10 处） | 纯风格偏好，零功能影响 |
| UI-07 — App.tsx 空状态去重 | 与 009 冲突风险：009 修改同级文件，合并到 009 或单独立项 |
| UI-08 — Suspense 粒度 | M 量级，需设计 per-view skeleton；单独规划 |
| UI-09 — BookFactoryView 1022 行上帝组件 | M 量级，需工厂视图重构规划，不在本轮 |
| 060 | LLM embedding fallback — use dedicated API | DONE | generateEmbedding helper implemented |
| 061 | Preserve error stack traces in logger | DONE | logger.ts err.stack preserved |
| 062 | Wire validate(dbSchema) into /api/db | DONE | dbSchema middleware applied to /api/db |
| 063 | Rate-limit chapter production endpoints | DONE | rateLimit on /start + /start-stream + /apply |

## Phase 2-6 Status (from final code-health plan)
| Phase | Status | Reason |
|-------|--------|--------|
| Phase 2: types.ts split | DEFERRED | Barrel conflicts — needs worktree isolation |
| Phase 3: Big component split | DEFERRED | 561-763 line components need dedicated sessions |
| Phase 4: Hook/route split | DEFERRED | useEditorGenerationFlow (531L) + production.ts (608L) |
| Phase 5: Test organization | ATTEMPTED | describe() broke 6 tests — reverted. Cosmetic, not worth risk. |
| Phase 6: Final report | DONE | types.ts 825, any 8→8, limit 25→9 updated in report |
