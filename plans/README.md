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
| 12 | `current` | 2026-07-04 | shadcn-improve 深度性能与数据落盘审计 | 2 | 095–096 |
| 13 | `current` | 2026-07-04 | shadcn-improve 深度全类别审计 | 13 | 097–102 |
| 14 | `current` | 2026-07-04 | V4 非阻塞 Backlog (代码健康深度治理) | 6 | 103–108 |
| 15 | `current` | 2026-07-08 | /pua 多角色及 PM 联合刺穿审计 | 4 | 109 |
| 16 | `current` | 2026-07-09 | SSE流式与异步Job前后端重构治理超时故障 | 3 | 110 |
| 17 | `a90ff4bb` | 2026-07-10 | improve standard 审计 (correctness+security+perf+tests+dx) | 5 | 111–115 |
| 18 | `a90ff4bb` | 2026-07-10 | improve standard 深度审计 (correctness+security+perf+tech-debt) | 6 | 116–120 |
| 19 | `current` | 2026-07-12 | 全仓流式断连时序、配额与资源清理治理 | 1 | 121 |
| 20 | `1a56ccad` | 2026-07-12 | 写作数据安全闭环 | 4 | 122–125 |
| 21 | `1a56ccad` | 2026-07-13 | 发布数据安全复核收口 | 1 | 126 |
| 22 | `f7473224 + local Plans 129–131` | 2026-07-14 | 生产流断连与 Electron 单服务复核 | 2 | 132 |
| 23 | `当前` | 2026-07-14 | 模型自动发现与可搜索选择 | 1 | 133 |
| 24 | `当前` | 2026-07-16 | 创作向导、导入流程、关系图谱、资料包同步 | 5 | 134–138 |

## 执行顺序 & 依赖图

```
轮次 12 & 13 (深度性能与安全架构全面筑防)

095 (修复角色状态落盘)  ←  DONE (已成功合并，保证角色状态属性穿透)
096 (解耦大文本输入)    ←  DONE (已成功合并，移除打字重绘开销)

097 (P0 服务端健壮与安全) ← 依赖 095/096（API 根底置信度，高优先级）
  ├── 101 (P2 API校验与Ref副作用) ← 依赖 097（引入 Zod 写入校验与 React 19 Ref 渲染脏写保护）
  └── 102 (P2 事务管理器与测试隔离) ← 依赖 101（支持 bulk 更新批量事务与测试数据库隔离）

099 (P1 Metadata 浅查询懒加载) ← 独立架构，解耦正文 eager 全文本加载
  └── 098 (P1 写作防抖与侧栏虚拟化) ← 依赖 099（提升大长篇前端输入与树列表渲染性能）
  └── 100 (P1 向量 RAG 与 SQLite 调优) ← 依赖 099（下沉 RAG 相似度至 SQLite 索引计算）

轮次 15 (自适应管线 V3 现代化战役)

109 (V3 创作管线与极致美学重构) ← 独立交互层优化（雷达 + 图谱 + 卡片内化 + Gap清洗）

轮次 16 (SSE流式与异步Job前后端重构治理超时故障战役)

110 (核心接口异步化改写与前后端不兼容缺陷治理) ← 封杀 120s 超时故障与 payload 不匹配缺陷

轮次 24 (创作向导、导入流程、关系图谱、资料包同步)

134 (创作向导步骤进阶与导航路由) ← 独立 UI 优化
135 (导入流程与全局大纲展示) ← 独立 UI 优化
136 (关系图谱与实体管理) ← 依赖 135
137 (资料包同步跳过重试 UX) ← 依赖 136
138 (资料包同步最终正确性收口) ← 依赖 137
```

## 状态表

| Plan | Title | Status | Depends on |
|------|-------|--------|------------|
| 001 | CI 质量门禁 | DONE | — |
| 002 | 服务器认证 + 绑定修复 | DONE | — |
| 003 | API 输入验证 | DONE | 002 |
| 004 | 删除 500 行死代码 | REJECTED | 已清理 |
| 005 | 修复 ID 生成 (Date.now→UUID) | DONE | — |
| 006 | 提取 server.ts 辅助函数 | DONE | — |
| 007 | 拆分 server.ts 路由 | DONE | 006 |
| 008 | 构建 AI 生产管道 (Planner→Writer→Critic) | DONE | 007 |
| 009 | 修复暗色模式 | DONE | — |
| 010 | 仓库清理 (tmp-server.cjs + 空目录) | DONE | — |
| 011 | 题材模板移植 — 37 网文题材入库 | DONE | — |
| 012 | 审查维度增强 — 追读力 + Strand Weave | DONE | — |
| 013 | 故事合同体系 — 写作约束卡片 | DONE | 011 |
| 014 | Prompt 模块化路由 — 3 链管道 | DONE | — |
| 015 | 决策驱动偏好学习 — Writer's Loop 模式 | DONE | — |
| 016 | WelcomeView 新手模式简化 | DONE | — |
| 017 | AgentWorkspace 核心标签精简 | DONE | — |
| 018 | Sidebar 探索工具可收起 | DONE | — |
| 019 | Pipeline 静默 catch 块修复 | DONE | — |
| 020 | 路由输入验证补全 | DONE | — |
| 021 | pnpm test 命令 | DONE | — |
| 022 | 知识图谱 — 实体关系 MVP | DONE | — |
| 023 | API 密钥加密 | DONE | — |
| 024 | LLM 端点速率限制 | DONE | — |
| 025 | Prompt 注入保护 | DONE | — |
| 026 | 前端异步 try/catch 补齐 | DONE | — |
| 027 | 向量 RAG — 语义检索已写章节 | DONE | — |
| 028 | 张力心电图 — 评分 + 曲线 + 诊断 | DONE | — |
| 029 | 机械文笔评分器 — 零 API 消耗 | DONE | — |
| 030 | "别透露性别"角色选项 | DONE | — |
| 031 | 事件冷却矩阵 — 杜绝单调模式 | DONE | — |
| 039 | 拆分 db.ts — 提取 mappers + schema + CRUD | DONE | — |
| 040 | 场景级实体 — chapters × scenes 层级 | DONE | — |
| 041 | 通用 CRUD 辅助函数 — 消除 13× 重复 | DONE | — |
| 053 | 拆分 types.ts — novel/world/skills 领域模块 | REJECTED | — |
| 054 | 分离服务器/客户端导入路径 → shared/ | DONE | — |
| 055 | Helmet 安全头部 | DONE | — |
| 056 | 服务器日志用户内容脱敏 | DONE | — |
| 057 | 选择性 SSE 缓存失效 | DONE | — |
| 058 | rowTo* 函数 any → 类型安全行映射器 | REJECTED | — |
| 059 | 题材接入引导流程 | DONE | — |
| 060 | LLM embedding fallback | DONE | — |
| 061 | Preserve error stack traces in logger | DONE | — |
| 062 | Wire validate(dbSchema) into /api/db | DONE | — |
| 063 | Rate-limit chapter production endpoints | DONE | — |
| 064 | 清理 pnpm 冗余冲突配置文件 | DONE | — |
| 065 | 对接 Context Pruning 至章节生成后端 | DONE | — |
| 066 | 补充桌面端 Electron 启动与调试文档及 Gemini 指南 | DONE | — |
| 067 | 升级文风萃取支持全文本采样与语义聚类 | DONE | — |
| 068 | 落地基于 Diff 追踪的自适应 Reflexion 进化引擎 | DONE | — |
| 069 | 引入类型安全且并发安全的事务管理器 | DONE | — |
| 070 | 消除实体关系更新中的 SQL 注入漏洞 | DONE | — |
| 071 | 向量检索存储迁移至 SQLite | DONE | — |
| 072 | 极致前端美学与排版节奏优化 | DONE | — |
| 073 | 落地连续性报告的历史状态自动更新 | DONE | — |
| 074 | 落地进程级异常容错与崩溃守护 | DONE | — |
| 075 | 前端样式、暗色模式与无障碍清理 | DONE | — |
| 076 | TypeScript 严格模式 | DONE | — |
| 077 | 修复 API 运行期 401 鉴权 | DONE | — |
| 078 | 将单元测试与运行期冒烟测试纳入 CI | DONE | — |
| 079 | 收紧 ESLint 门禁与警告清理 | DONE | — |
| 080 | 补全与收紧 API 输入验证防线 | DONE | — |
| 081 | 修复商业化与配额卡控的 TypeScript 编译错误 | DONE | — |
| 095 | 修复角色状态自动更新落盘 | DONE | — |
| 096 | 解耦世界观大文本输入状态 | DONE | — |
| 097 | P0 服务端安全、日志、SSE 挂起与 Prompt 注入 | DONE | 095, 096 |
| 098 | P1 写作区输入性能与章节树长列表虚拟化 | DONE | 099 |
| 099 | P1 大长篇 Metadata 列表浅查询与懒加载 | DONE | — |
| 100 | P1 SQLite 索引优化与本地 RAG 相似度计算下沉 | DONE | 099 |
| 101 | P2 写入路由 Zod 校验与 React 19 Ref 渲染安全 | DONE | 097 |
| 102 | P2 显式事务批量更新与并发测试隔离环境 | DONE | 101 |
| 103 | 拆分 prompt-governance-catalog.ts 抽出增强包、精选技能与净化函数 | DONE | — |
| 104 | 拆分 EditorView.tsx 抽出局部 UI 元素 | DONE | — |
| 105 | 收敛 as unknown as 类型转换（补充 SQLite Row 类型） | DONE | — |
| 106 | 清理测试配置：删除或说明 vitest.config.ts | DONE | — |
| 107 | 依赖大版本升级安全评估与规划（Express/Vite/TS/Electron） | BACKLOG | — |
| 108 | 前端日志治理：后续统一 error reporting | DONE | — |
| 109 | InkFlow V3 创作管线与极致美学重构 | PLANNING | — |
| 110 | InkFlow 核心接口异步化改写与前后端不兼容缺陷治理 | DONE | — |
| 111 | 原子化配额 check-then-consume 防止免费用户超额 | DONE | — |
| 112 | 修复 handleDeleteChapter 闭包过期导致选中错误章节 | DONE | — |
| 113 | db-mappers JSON.parse 安全防护防止脏数据崩溃整条读取链 | DONE | — |
| 114 | 启用 CSP 并为 config/sync 添加输入验证 | DONE | — |
| 115 | Library 页面用 Metadata 替代全量章节加载消除 N+1 性能瓶颈 | DONE | — |
| 116 | Audit/Rewrite 路由改用原子化 checkAndConsumeQuota | DONE | — |
| 117 | Export 路由添加 Zod 输入校验 | DONE | — |
| 118 | Library 批量 Metadata 加载消除 N+1 | DEFERRED | — |
| 119 | db-mappers DbRow any → 类型安全行接口 | STOPPED | 需改 mapper 实现去 ...row spread，工作量超预期 |
| 120 | 补全静默空 catch 块的日志记录 | DONE | — |
| 121 | 全仓流式断连治理 | DONE | 110 |
| 122 | 建立可等待的编辑器保存边界 | DONE | 121 |
| 123 | 阻止幽灵章节 | DONE | 122 |
| 124 | 人物小传流式预览只落盘一次 | DONE | 121 |
| 125 | 导入前验证 SQLite 完整性与 schema | DONE | 121 |
| 126 | 发布数据安全复核收口 | DONE | 122–125 |
| 127 | 发布正确性收口 | DONE | 126 |
| 128 | 深度数据完整性收口 | DONE | 127 |
| 129 | Domain Ownership & Data Integrity | DONE | 128 |
| 130 | LLM Cancellation & Cost Governance | DONE | 129 |
| 131 | Electron Recovery & Release Trust | DONE | 129–130 |
| 132 | 生产流断连与 Electron 单服务收口 | DONE | 129–131 |
| 133 | 模型自动发现与可搜索选择 | DONE | — |
| 134 | 创作向导步骤进阶与导航路由 | DONE | — |
| 135 | 导入流程与全局大纲展示 | DONE | — |
| 136 | 关系图谱与实体管理 | DONE | — |
| 137 | 资料包同步跳过重试 UX | DONE | — |
| 138 | 资料包同步最终正确性收口 | IN PROGRESS | 137 |

## 考虑后排除的发现

（此处历史排除发现略，详见历史记录）

### 第 17 轮审计排除
- AppShell 713 行 God Component: 与 BACKLOG 计划 104 (拆分 EditorView.tsx) 同类，由后续拆分计划统一处理
- 13 处 as unknown as Chapter 类型逃逸: 已有 BACKLOG 计划 105 覆盖
- 17 处 console.warn/error 残留: 与 BACKLOG 计划 108 (前端日志治理) 重叠
- ESLint 忽略 tests/ 目录: 与 BACKLOG 计划 106 重叠
- WriteQueue 静默吞错 (db-instance.ts:49): 设计意图 — 队列需要继续执行后续任务，改掉会改变队列语义
- AbortSignal listener 泄漏 (server-llm.ts:369): LOW risk，每请求泄漏 1 个 listener，进程级回收

### 第 18 轮审计排除
- AgentWorkspace 670 行 God Component: 与 BACKLOG 计划 104 同类，由后续拆分计划统一处理
- EditorView 806 行 God Component: 与 BACKLOG 计划 104 同类，由后续拆分计划统一处理
- 前端 console.warn/error 残留: 与 BACKLOG 计划 108 (前端日志治理) 重叠
- db-mappers.ts 已有 safeJsonParse 日志: 不需要额外处理
- WriteQueue 静默吞错 (db-instance.ts:49): 设计意图，已在第 17 轮排除
