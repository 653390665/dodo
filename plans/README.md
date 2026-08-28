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
| 25 | `当前` | 2026-07-21 | 资料包实体提取超时、JSON 与失败恢复闭环 | 3 | 141–143 |
| 26 | `dff4445 + local changes` | 2026-08-08 | improve + PM 助手空响应深度审查 | 6 | 145–147 |
| 27 | `dff4445 + local changes` | 2026-08-09 | improve + 产品经理 + 八刀法：Plan 150 后剩余任务重排 | 4 | 151–154 |
| 28 | `dff4445 + local changes` | 2026-08-10 | improve reconcile + 多 Agent 复核：151–154 剩余任务再规划 | 4 | 152–155 |
| 29 | `dff4445 + local changes` | 2026-08-10 | improve + 产品经理 + 八刀法：能力商店连续配置、技法与拆书卡生命周期复核 | 1 | 158 |

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

轮次 25 (资料包实体提取失败闭环)

141 (实体提取超时闭环) ← 依赖 138、140
  └── 142 (JSON 可靠性收口) ← 依赖 141
      └── 143 (失败恢复与诊断闭环) ← 依赖 141、142

轮次 26 (助手空响应可信度与恢复闭环)

145 (空响应诊断契约) ← P0，先建立真实错误原因
  └── 146 (设定助手 SSE 完成与恢复) ← P0，统一完成状态机
      └── 147 (失败体验与本地漏斗) ← P1，验证是否真正恢复主线
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
| 107 | 依赖大版本升级安全评估与规划（Express/Vite/TS/Electron） | REJECTED | 当前生产 audit 为 0；由 151 的证据触发门禁替代 |
| 108 | 前端日志治理：后续统一 error reporting | DONE | — |
| 109 | InkFlow V3 创作管线与极致美学重构 | REJECTED | 只保留入口收敛，拆为 152；不执行大规模视觉重构 |
| 110 | InkFlow 核心接口异步化改写与前后端不兼容缺陷治理 | DONE | — |
| 111 | 原子化配额 check-then-consume 防止免费用户超额 | DONE | — |
| 112 | 修复 handleDeleteChapter 闭包过期导致选中错误章节 | DONE | — |
| 113 | db-mappers JSON.parse 安全防护防止脏数据崩溃整条读取链 | DONE | — |
| 114 | 启用 CSP 并为 config/sync 添加输入验证 | DONE | — |
| 115 | Library 页面用 Metadata 替代全量章节加载消除 N+1 性能瓶颈 | DONE | — |
| 116 | Audit/Rewrite 路由改用原子化 checkAndConsumeQuota | DONE | — |
| 117 | Export 路由添加 Zod 输入校验 | DONE | — |
| 118 | Library 批量 Metadata 加载消除 N+1 | REJECTED | 先按 153 测量与修复刷新竞态，未达阈值则不增加批量 endpoint |
| 119 | db-mappers DbRow any → 类型安全行接口 | REJECTED | 按 154 表级 characterization 渐进迁移，禁止全量重写 |
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
| 138 | 资料包同步最终正确性收口 | DONE | 137 |
| 140 | 导入大纲直接采用与生成失败闭环 | DONE | 135 |
| 141 | 资料包实体提取超时闭环 | DONE | 138, 140 |
| 142 | 实体提取 JSON 可靠性收口 | DONE | 141 |
| 143 | 资料包实体提取失败闭环 | DONE | 141, 142 |
| 144 | 测试稳定性与导出数据安全覆盖 | DONE | — |
| 145 | 助手空响应诊断契约 | DONE | — |
| 146 | 设定助手 SSE 完成与恢复 | DONE | 145 |
| 147 | 助手失败体验与本地漏斗 | DONE | 145, 146 |
| 150 | 创作能力统一治理与阶段执行合同 | DONE | 145–147 |
| 151 | 发布真实性与依赖漂移门禁 | DONE | — |
| 152 | 创作入口与能力选择收敛 | DONE | 150, 151 |
| 153 | 书库刷新竞态与 Metadata 批量化证据门槛 | DONE | — |
| 154 | Skill Row 类型迁移 characterization 收口 | DONE | — |
| 155 | 151–154 总装与创作旅程验收 | DONE | 151–154 |
| 158 | 完成能力商店、技法与拆书技能卡生命周期治理 | DONE | 156 |
| 160 | 真实 Provider 正文质量门禁与 Smoke | DONE | — |
| 161 | 正文文学质量合同与阶段上下文收敛 | DONE | 160 |
| 163 | 收口正文质量门禁的 Lint 回归 | DONE | 161 |
| 164 | 阻断不可信结构化审稿结果 | DONE | 162 |
| 165 | 阻断正文上下文泄漏、机械重复与未审阅误接受 | DONE | 161, 163 |
| 162 | 真实 Provider 文学质量评测与指标闭环 | DONE | 160, 161, 163 |
| 167 | 修复词级质量规则的数字单位误报 | DONE | — |
| 166 | 去 AI 腔结构诊断与上下文重写闭环 | DONE | 167, 165, 162, 161 |
| 168 | 能力工具结构精修候选消费闭环 | DONE | 166 |
| 169 | 审稿 Provider 结构化输出稳定性收口 | DONE（已合并到 `codex/plan169-checkpoint`；真实 Provider 质量仍需独立跟进） | 162, 164, 166, 168 |
| 170 | 统一评测端审稿 JSON 解析，消除中文引号误判 | DONE（定向门禁通过；live-only 真实失败保持可见） | 169 |
| 171 | 收口 Critic 严格合同、fallback 接受边界与章节完成审阅 | DONE（隔离分支 `codex/plan171-executor`，最终提交 `11c870d`；后端 1112/1112、前端 13/13、typecheck/lint/diff check 通过） | 170 |
| 172 | 正文文学质量硬门禁与去 AI 腔闭环 | DONE（后端 1128/1128、前端 827/827、Playwright 24/24、deterministic 评测通过；live `quality_mismatch` 保持失败可见，后续需单独优化 Provider/Prompt） | 165, 166, 169–171 |

### Plan 166 复核（2026-08-23）

Plan 166 的结构信号、数字单位误报边界、审稿局部上下文窗口和机械预览诚实状态已通过复核；定向 Node 49/49、frontend 825/825、typecheck、lint、build、目标 Chromium 1/1、桌面/移动 E2E 12/12、diff check 均通过。真实 Provider 仍保持 `audit_response_unparseable` 失败，不计为文学质量通过。

Plan 168 已补齐能力工具响应类型和编辑器消费：`contextRewrite.required` 会通过现有 `/api/rewrite` surgical-patch 链路生成内存候选，复用代次、SSE、质量和接受门禁；选区结构信号会加回选区起点，避免局部坐标错位。定向前端 12/12、目标 Chromium 1/1、typecheck、lint、diff check 通过。正文只有在明确接受候选后才写入。

### 全量收口复核（2026-08-23）

- 隔离串行后端：`1095/1095`，0 failed、0 cancelled；标准并发 `npm test` 同样 `1095/1095`。
- 前端：`120` 个文件、`826/826` 通过；`npm run typecheck`、`npm run lint`、`npm run build`（2122 modules）和 `git diff --check` 通过。
- Playwright：桌面与 Pixel 5 共 `24/24` 通过；主创作链路正文 `4122` 字，能力卡 → 世界观/角色 → 黄金三章 → 大纲 → 正文 → 审稿 → 去 AI 腔 → 精修 → 明确接受写入全流程通过。
- 真实 Provider 仍诚实记录为运行时风险：三样本 `LIVE audit_response_unparseable`，无 fallback 伪通过、无候选接受指标；不把确定性 fallback 或 E2E 通过解释为真实模型文学质量通过。
- 本轮未修改生产数据库、`.env`、API Key、数据库 schema 或依赖；当前工作区其他历史改动保持不变。

### Plan 167 复核（2026-08-23）

隔离分支 `codex/plan167-slop-boundary` 的提交 `93b9b01` 已通过主控复核：仅修改 `shared/lib/slop-scorer.ts` 与 `tests/chapter-polish.test.ts`；`node --import tsx --test tests/chapter-polish.test.ts` 为 20/20，`npm run typecheck`、`npm run lint`、`git diff --check` 均通过。Vitest 计划命令因现有配置只收录 `src/tests` 不适用于 `tests/`，未伪装为通过；该配置缺口不阻断本计划的等价 Node 回归，但仍是后续测试治理项。

### Plan 161 复核（2026-08-23）

确定性正文质量合同、阶段上下文隔离和候选接受边界已完成。隔离复核证据：后端质量/生产/候选测试 43/43、前端候选/生命周期/质量旅程 9/9，typecheck、lint、diff check 均通过。真实 Provider 三样本矩阵已经完整运行，但全部为 `LIVE audit_response_unparseable`，无候选/接受结果；该运行时风险已由 Plan 162 形成诚实评测闭环，但不作为文学质量通过证明。

### Plan 165 复核（2026-08-23）

计划实现已在工作树，隔离复核未发现需要新增或扩大 Scope 的问题。质量/生产定向 Node 43/43、管线 sentinel 2/2、前端审阅流程 9/9、全量 backend 1095/1095、frontend 826/826，typecheck、lint、diff check 均通过。低质量模型/fallback 在正文 token、展示、持久化前被 `DRAFT_QUALITY_GATE_FAILED` 阻断；未审阅接受需要当前正文与计划哈希确认。完整 build/Playwright 已在全量收口复核中通过。

### Plan 162 复核（2026-08-23）

评测脚本、固定样本、错误映射和报告契约已完成。隔离门禁：Provider/合同定向测试 30/30、backend 1095/1095、frontend 826/826、typecheck、lint、build、目标 Chromium 1/1、diff check 均通过。真实配置下三样本矩阵完整运行但全部 `LIVE audit_response_unparseable`，退出码 1、无 fallback/候选/接受，四项指标按分母输出 `null` 或 0；这证明失败被诚实暴露，不证明 Provider 文学质量合格。Plan 166/168 已完成并继续保留该运行时风险。

### Plans 145–147 复核（2026-08-08）

| Plan | 复核结论 | 当前证据与未完成项 |
|------|----------|--------------------|
| 145 | DONE | 三类安全原因、确定性单次请求、reasoning 过滤和结构化终态已完成。 |
| 146 | DONE | 普通/同步路径复用共享 SSE reader；失败删除占位、保留输入并提供显式恢复动作。 |
| 147 | DONE | session failure、严格本地事件 schema、成功/空响应/重试恢复指标及隐私边界已完成。 |

最终复核基线：Node **712/712**、Vitest **383/383**、Playwright **10/10**；typecheck、lint、build、Electron package、packaged lifecycle smoke 与生产依赖 audit 均通过。

### Plan 150 复核（2026-08-09）

| 范围 | 结论 | 证据与剩余项 |
|------|------|-------------|
| P0 执行合同 | DONE | Planner/Writer/Critic 使用冻结快照和独立阶段上下文；生产管线 sentinel 验证实际 Provider 入参；`npm test` 798/798。 |
| P1 拆书卡与评分 | DONE | 可信 governed Overlay、保存/装配/本次试用动作分离、最多 6 张、trial/restore 事件和前端可信边界测试已落地。 |
| P2 大纲与 Canon Patch | DONE | 大纲治理提供报告候选显式过滤且只读；Canon stale 有基线提示、刷新和拒绝动作；Chromium E2E 覆盖主纲单选、卷/章范围、Patch 接受/拒绝、报告过滤和 stale 拒绝。 |
| P3 商店与发布治理 | DONE | 五类主视图与阶段次筛选已实现；写法来源变化后 409、正文保留、重新确认和单次恢复有桌面 Chromium 与 Pixel 5 E2E。 |

本轮新鲜门禁：`npm run typecheck`、`npm run lint`、`npm test`（798/798）、`npm run test:frontend`（475/475）、`npm run build`、Plan150 Chromium（5/5）、Pixel 5 mobile（4/4）、`npm audit --omit=dev`（0 vulnerabilities）、`git diff --check` 均通过。测试使用隔离数据库；Chromium 与 mobile E2E 按端口和数据库串行运行。

## 2026-08-10 剩余任务再规划

推荐执行顺序：

```text
151 发布真实性与依赖漂移门禁（DONE）
  │
  ├── Wave A / Frontend：152 创作入口与能力选择收敛
  ├── Wave A / Correctness：153 Library 竞态证据与批量化决策
  └── Wave A / Typing：154 Skill Row characterization 收口
                    │
                    └── Wave B：主控逐 diff 审查
                              │
                              └── Wave C：155 隔离总装门禁
```

- **151 已完成**：不重做；其门禁证据会在 155 中因后续源码变化而 fresh 重跑。
- **152 是主任务**：先清理 Welcome 剩余虚假承诺，再建立显式阶段启动上下文，最后补驾驶舱/onboarding 推荐摘要和请求边界测试。
- **153 只补证据**：现有序号保护保留；真正模拟旧 metadata 晚返回、缓存保留和卸载。jsdom 时间不作为性能结论，批量 API 必须跨过明确阈值才另立计划。
- **154 到此只做 Skill 表**：修正真实 nullability 和误导测试；不把 Novel/Chapter/SkillUsageRecord 迁移偷渡进本轮。
- **155 负责总装**：三项实现经主控验收后，静态、单测、E2E Gatekeeper 使用独立数据库和端口并发运行，再由主控核验全部退出码与 diff。

### 八刀法收束

1. **历史**：旧计划从“性能/类型/视觉都要升级”逐步堆积；Plan 150 已把能力执行合同收口，剩余问题转为入口、证据和债务治理。
2. **辩证**：更多功能不能抵消用户找不到入口、看见不真实承诺和旧响应覆盖新作品的损失；下一轮价值来自减少判断成本。
3. **现象**：用户打开书库、选作品、看能力商店、点击离线生成，必须能知道当前阶段、下一步和失败后的可恢复动作。
4. **边界**：Flow/Role Skill/Overlay/Utility/Guardrail 是运行时分类；拆书卡是可治理来源，不等于独立阶段或付费等级。
5. **结构**：发布可信度 → 主线入口 → 可测性能 → 渐进类型安全；前一层没有证据，后一层不应扩大范围。
6. **前提**：当前 audit=0、隔离测试可重复、Plan150 冻结快照稳定；这些前提变化时必须重新排序。
7. **美感**：好的流程像章节大纲：主线只有一条，辅助卡在需要时出现，不让作者离开正文去逛货架。
8. **元反思**：我们过去把“有功能”当成“可发现、可理解、可验证”；新计划把三者分开验收。

**一句话顿悟**：剩余任务不是加能力，而是让已有能力在正确时刻被看见并被证明。

**核心意象公式**：产品信任 = 真实承诺 + 主线入口 + 可复现证据。

```text
发布证据
  ├─ 文档/CI/依赖事实
  └─ 通过后才允许扩大产品入口
创作主线
  ├─ 当前阶段推荐
  ├─ 写法确认
  └─ 保存/装配/试用分离
工程债务
  ├─ Library 先测量再批量化
  └─ mapper 先一表一测再迁移
```

### 2026-08-10 执行检查点

| Stage | Initiative | Outcome | Evidence / Gate |
|------|------------|---------|-----------------|
| Now | Plans 152-155 已收口 | 已有能力在真实桌面/移动旅程中可发现、可理解、可验证 | Chromium 9/9、mobile 5/5、全量静态/单测/build/audit 通过 |
| Next | 运行期观察 | 只收集真实失败率与恢复证据 | 不因门禁通过继续扩功能或重分类 |
| Later | 证据触发的后续治理 | 避免无数据扩张 | Library batch 维持 NO-GO；Novel/Chapter mapper 需另立单表计划 |

当前归档：Plan 152 定向 Vitest 29/29，独立规格与质量复审均 APPROVE；Plan 153 定向 Vitest 8/8；Plan 154 mapper 10/10。最终 Plan 155：Node 803/803、Vitest 491/491、Chromium 9/9、mobile-chromium 5/5；typecheck、lint、lint:any、build、diff check 和生产依赖 audit 均通过。测试数据库与运行中的 `data.db` 物理隔离，临时 DB/config 已清理。

## 本轮明确不继续的历史方向

- **Plan 107 大版本升级**：当前生产依赖 audit 为 0，且 Electron/native ABI 风险高；只保留 151 的触发式评估。
- **Plan 109 全面 V3 美学重构**：未证明视觉重构能解决主线阻断；只执行 152 的入口收敛，雷达/大规模布局重做另需产品证据。
- **Plan 118 直接新增批量 endpoint**：在 153 测量未达到 100+ 作品或实测 jank 前不做。
- **Plan 119 全量 DbRow 重写**：当前接口和 spread 造成级联风险，改由 154 表级迁移。

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

### 第 26 轮审计排除
- 自动无限重试：会重复消耗模型请求，且对 reasoning-only/长度耗尽等确定性失败无效。
- 将 reasoning/thinking 直接展示为答案：会泄露模型内部推理，且不能保证是可用最终输出。
- 直接增加所有助手的 token 上限：空响应原因尚未分类，先扩预算会增加成本并掩盖兼容性问题。
- 当轮不升级 `body-parser`、`sharp`、`postcss` 等依赖：当时告警与助手故障无关；相关锁文件治理已完成，2026-08-09 生产 audit 为 0。
