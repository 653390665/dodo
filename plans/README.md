# InkFlow 改进计划

> [!NOTE]
> **所有历史和新建计划的状态、执行结果均以本 README.md 主表记录为准**。旧的单独 plan 文件若存在未标注状态，皆为历史存底，不再单独维护。
>
> **账目分工**：本表登记历史轮次（1–29，计划 001–171；其中 172 为无独立计划文件的已收口账面行）与 2026-09-10 起的第 30 轮（计划 173+）。当前「能力卡整合」轮（001–014，2026-09）的历史账目在 `docs/plans/README.md`。**2026-09-28 起（Plan 263 E5）：该文件已冻结为只读存档，本 README 为唯一权威账本**（双账本问题原登记为本轮 191 的 DOCS-3 项，现结案）。
>
> **账本状态（2026-09-28，Plan 263 E5）**：`docs/plans/README.md` 已冻结为只读存档（唯一权威 = 本文件）。

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
| 30 | `0dfbbcf` | 2026-09-10 | improve deep 全仓审计（7 只读子代理：前端正确性/后端正确性+安全/性能/测试覆盖/架构+依赖/UX 交互+按钮+链路/文档+DX+方向；发现全部经主控亲读复核） | 84 条发现 → 23 计划 | 173–195 |

> **审计基准的可解析性（2026-09-28 复核）**：本表第 1–29 轮的基准 hash 全部属于 **2026-08-29 存档重根**之前的历史线——本分支 HEAD 的根提交是 `68c9004`（“salvage: full working-tree snapshot of InkFlow (2026-08-29)”），事件与恢复材料见 `docs/recovery/RECOVERY.md` 与 `origin/salvage/checkpoint-20260829`。
> 其中 `fcb3b9b`（1）/`ca53899`（2–10）/`a90ff4bb`（17–18）/`1a56ccad`（20–21）/`f7473224`（22）仍可从 `origin/*` 旧分支解析（`git branch -a --contains <hash>`）；`dff4445`（26–29）、`f4eac24`（计划 160/162/163/164/166/167/169 的 “Planned at”）、`32a6b40`（计划 170/171 的 “Planned at” 与 Drift check）、`93b9b01`（计划 167 隔离提交）、`11c870d`（计划 171 隔离分支最终提交）在本 clone **不可解析**（`git cat-file -t` = 缺失，来自当时的隔离工作区/其他机器）——这些计划内嵌的 `git diff --stat <hash>..HEAD` 在本 clone 会报 `unknown revision`；引用时请以文件路径 + 符号名为锚，或到 `origin/salvage/*` 与 `docs/recovery/` 查证。

## 执行顺序 & 依赖图

```
轮次 30 (2026-09-10 improve deep 全仓审计：计划 173–195)

P0 先行（互相独立）：173 撤销栈 / 174 删除确认 / 175 驾驶舱入口 / 176 超时治理
177 审稿链路正确性 → 178 编辑器数据流互斥（同文件 useDraftGeneration，先后执行）
186 HTTP/持久层测试安全网 → 189 服务端架构收敛 → 190 依赖升级（**已解除**：Plan 190 Step 1 已把 `@xenova/transformers` 换成 `@huggingface/transformers`，`.github/workflows/build.yml:36-39` 的 `exemptions` 已清空并注明；2026-09-28 复核）
187 E2E/CI 独立；182 全量加载 → 183 SSE 节流（建议顺序，非硬依赖）
185 消毒边界独立；181 UX 一致性依赖 175（全屏文案若 175 已处理则跳过该子步）
191 文档 DX 独立；192/193/194 方向 spike 待产品决策；195 SkillsStudio 分解独立
```

历史依赖图（存底）：

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
| 173 | 修复编辑器撤销栈——只在切换章节时 reset，恢复 Cmd+Z | DONE（提交 30926c5 波次内与 174 同验；全量前端 856/856、tsc 0 错误、新增 3 用例） | — |
| 174 | 破坏性删除统一接入 appConfirm（世界书六类实体/资料包/伏笔/灵感碎片/对话历史） | DONE（提交 30926c5；5 组件接入确认 + 2 个既有测试适配 + 新增 2 用例，全量前端 856/856） | — |
| 175 | 工作台家族导航：驾驶舱可见入口 + 快捷键与命名对齐 | DONE（全量前端绿；审查中还原了误再生 fixtures；SplitWorkspace 类型补键为批准偏差） | — |
| 176 | 长任务超时治理：解析路由白名单 + 审稿轮询上限 | DONE（白名单终稿仅 parse 路由 200s，其余长路由均为 job 模式有据排除；新增 4 用例） | — |
| 177 | 审稿/润色链路三处正确性（409 单次消费/重试保留范围/改写选区防漂移） | DONE（readErrorBodyOnce 单点读体；5 新用例，定向 35 用例绿；三修复合一提交为审查裁量） | 176 |
| 178 | 编辑器数据流与生成互斥收口（旗标互斥/packs 竞态/isLoading 兜底/换书清空/监听器异常） | DONE（6 新用例；死代码解锁行清理与 2 条旧断言更新为批准偏差） | 177 |
| 179 | 后端 LLM 流式与输入卫生（流中重试不重发/UUID 主键/prompt 上限/jobId/哨兵归一） | DONE（7 提交 0beaf45..c52857d；后端 1157/1157；strict 模式 deferredTokenSink 与 isLlmConfigured(config?) 为批准偏差；db.ts:1084 临时文件名 Math.random 为范围外残留） | — |
| 180 | 用户动作失败反馈补全（删章节/建书/刷一批） | DONE（3 新用例；全屏 loading 分支删除；AIAssistantDrawer 透传为批准偏差） | 177 |
| 181 | UX 反馈一致性（弹窗 Esc/导入可取消/失败面板人话/toast 语义/文案清理） | DONE（63b18f8：WelcomeView 三弹窗 Esc、导入遮罩可取消、失败面板枚举映射、toast 分级、Library 文案；含回归测试。本行此前误留 TODO——8bf7455 只改了 182/183 两行，2026-09-11 收尾核对时补正） | 175 |
| 182 | 消灭 O(全量正文) 路径（故事上下文/生产 runs/面板/AppShell） | DONE（守卫测试 30 章断言有界读取；badges/applied 投影；1 轮 REVISE 修 mock 与 disable） | — |
| 183 | SSE 变更广播节流 + chapter_versions 投影 | DONE（500ms 合并 + 6 用例；Step 3 generation 抑制经论证推迟——正确性回归风险，建议随 notify 负载化另立） | 182（建议） |
| 184 | 渲染与数据生命周期性能（消息 memo/事件保留策略/checkpoint 降频/向量缓存上限） | DONE（变异验证 memo 测试；1.3 input 下沉因计划落点误判跳过为批准偏差；启动钩子置路由注册函数） | — |
| 185 | 技能目录消毒边界单源化（渲染层只消费生成副本 + 全量新鲜度守卫；含 014 账 #11 收口） | DONE（2026-09-14 收口：GuardrailPolicyPanel/增强包切副本+新鲜度守卫（早前落地）+ capability-governance 切副本由 210 完成——可选文风集 100% 来自 sanitized 副本，原始目标达成；45 张候选正文重建后特性保留且语义自洽 | — |
| 186 | 测试补强一期：HTTP 契约与持久层危险区（config 空键/deleteChapter/错误映射/EditorView 特征） | DONE（4 新文件+3 改造；后端全量 1170/1170；附带发现 config/sync 疑似无调用方，待另立） | — |
| 187 | 测试补强二期：四大视图 E2E + 真实管线旅程 + CI 去重与覆盖率棘轮 | DONE（6 步全落：4 视图 journey spec 全真实无 stub——world 走 reload 会话恢复、agent 走「生成本章正文」+「确认本次写法」弹窗链、factory 保底萃取同步返回、cockpit 主推荐卡；real-pipeline HTTP 驱动 3/3 稳定；CI 去重 + timeout 25；前端棘轮 40/33/32/42→59/52/55/61（实测 59.27/52.5/55.33/61.64）；后端口径：24 路由 3 个零挂载（capability-recommendations/chapter-completion/legacy-artifact-structuring），node 原生报告以测试文件为分母、换 c8 仅结论不实施；池韧性实测 threads+1worker RSS 495MB 无 OOM，不换 forks，3 个 unhandled rejection 系 mock 缺 export 已修）。附带发现：①默认章长 4000 字下无 Key 保底草稿必挂质量门（模板重复密度）→ run failed，全链路到 review_required 需意图声明低字数；②Plan 183 的 500ms 合并窗口破坏 db-client 同步断言，测试改用 flushPendingNotifications()（本计划修复）；③生产页签同名按钮 aria 态翻转仍是 UI 驱动脆弱点，管线段按计划降级 HTTP 契约 | 186 |
| 188 | 前端传输收敛（统一 request/config-client/组件裸 fetch 入 client/compat shim 清理） | DONE（22 shim 全删；裸 fetch 22→12 白名单 8 文件有据；HttpApiError payload 为批准偏差） | — |
| 189 | 服务端架构收敛（db.ts 职责拆分/SSE 助手统一/continuation job 管理器/边界测试矩阵） | DONE（db.ts 1136→283；flush 契约以 flush:false 保留；边界矩阵 1 处现行违规显式豁免待产品定夺） | 186 |
| 190 | 依赖升级战役（@huggingface/transformers/Express 5/Vite 7/包管理器配置收敛） | DONE（2026-09-14 核销：Step1✓ 5ff0f28、Step2✓ Express 5.2.1 fa4761e、Step4✓ pnpm/allowScripts 清理；Step3 Vite 6→7 已由 196 落地（vite ^7.3.6 三链路绿，196 行注明「190 行 Step3 可勾销」）——本行 PARTIAL 为账面滞后，四步全部收口。附带修复（限流旋钮/429 根因）保留原记录效力 | 186, 187 |
| 191 | 文档与 DX 修复（README 失实宣称/死链/账目双头/pre-commit/format 门/env 清单/根目录归档） | DONE（13 项归档；pre-commit node 直调+prepare；CI format 门已加——全仓 format 已于 728d845 执行转绿（并修正 format 脚本 glob 与 CI check 口径不一致的隐患）；env 实为 11 个 INKFLOW_*） | — |
| 192 | [方向 Spike] 能力卡 Deck 导出导入格式设计 | DONE（设计文档+原型 14 断言；schema 缺口已由 plan 200 落库修复，实施前置已就绪；开放问题见 PRD §6 待产品拍板） | — |
| 193 | [方向 Spike] 拆书工厂接入文档解析管线（docx/长文本） | DONE（设计文档 + 原型 90 断言；开放问题见文档 §7，待产品拍板） | — |
| 194 | [方向 Spike] Cmd+K 语义检索窄切口（相似段落跳转） | DONE（竖切片落地：`/api/search-similar` + `searchSimilar` 投影扩展 chapterId + QuickSearchOverlay + Cmd+K 快捷键（输入豁免前处理）+ editorReturnTarget 跳章；琥珀色诚实降级 unavailable/unindexed 两态；README:238 宣称回填。关键事实：向量索引唯一写入点是生产 apply 且每章 1 chunk，手写正文不入索引——检索面只是「AI 写过的章」；换模型后旧索引被静默排除。开放问题 6 项见 `docs/prd/2026-09-cmdk-semantic-search.md` §6） | 175 |
| 195 | SkillsStudioView 分解一期（lint 抑制清账 + 状态入 store 先行 + Phase 3 评估） | DONE（62 条分类 0 过时；候选簇入 store 1/≤3 块；三切片评估见 notes-195-phase3-assessment） | — |
| 196 | Vite 6→7 升级（190 Step3 遗留） | DONE（vite ^6.4.3→^7.3.6；plugin-react 挪 devDependencies 并留 5.2.0——npm latest 6.x 仅支持 vite 8，按 peer 冲突门保留；vitest 4.1.9 peer 兼容零升级；vite.config 零迁移；三链路绿（build 分包齐/dev 冒烟含模块转换/test:frontend 884/884）+ E2E 21/8 基线 + build-server 冒烟。190 行 Step3 可勾销） | 190 |
| 197 | 185 拍板出路 b：生成侧为 45 张 sanitize-required 候选产消毒副本 + 渲染切副本单源化 | DONE（2026-09-14 收口：Step 3 STOP 门经出路 a 解除——44 张源候选真实正文由 210 写入，复测失效 0/45（原 44/45）；Step 4 渲染切副本由 210 落地：副本入可选文风集、候选退出需解锁、消毒并启用入口对目录候选收口。原出路标注更正：本题实为 185 的出路 b（扩过滤器保特性），出路 a/b 之争止于正文来源，最终 a+b 合流执行 | 185 |
| 198 | 无 Key 全章生产修复：保底草稿句式池多样性改造（默认 4000 字过质量门） | DONE（e72ceee：FNV-1a+mulberry32 确定性洗牌 + 句式池扩容（模板16→40/turn16→40/支持句72/桥8/短拍20）+ 双拍夹持布局；14 intent 全部 findings=[] slop 96-100；确定性逐字节断言保留；4 个钉旧契约的生产测试翻转为新语义；E2E 撤 800 字 workaround；基线与实测见 plans/notes-198-repro.md | — |
| 199 | 陈旧 E2E spec 债清偿：8 个 spec 对照现行契约重写 | DONE（2026-09-14 收口：f44adb2 + Round 32 分批落地——core-flow 2/2、unified-imported、plan150 写法链、mobile×2 重锚；unified-new×2 由 207 解阻塞转绿；导出菜单命中区由 208 portal 化修复；最后两个缓议项（plan150 desktop 场景重排、full-browser 元素不稳定）由 213 重锚至现行契约。全量 E2E 29/29 绿 | — |
| 200 | 技能卡治理字段落库（deck_group_id 等 7 列，192 实施前置；schema additive 已审批载体） | DONE（7 列 ensureColumn additive 落库 + mapper 读写补齐；新增 roundtrip 单测 5 例；原型 P10/P14 断言转真 14 断言全过） | — |
| 201 | Cmd+K 后续：手写正文防抖回填索引 + 代际过期诚实提示（194 §6 #1/#4） | DONE（updateChapter/deleteChapter 挂点 + 60s 防抖回填队列 server/lib/chapter-index.ts + upsertChapterChunk/deleteChapterChunks；search-similar 响应 stale/staleExcluded + overlay 琥珀「建议重建」+ unindexed 文案更新；新增 9 单测全绿 + 回归全绿，见 plans/201 Maintenance notes） | 194 |
| 202 | config/sync 死代码移除（0 生产调用方已实证） | DONE（85764ea：路由删除 + 契约测试改 404 防复活断言；updateCachedApiKey 保留供直调 | — |
| 203 | 195 切片 A：配置会话簇 → skills-configuration-store（自应用豁免窗口语义锁定） | DONE（三 state+databaseGeneration 与五段 effect 全部下沉；豁免窗口 flagAge<5000 逐行等价搬移并单测锁定（含突变验证）；新单测 skills-configuration-session.test.tsx；store 增 resetForRemount 对齐 useState 按挂载生命周期（修跨挂载代际残留竞态）；lint 抑制 15→8；plan158 38/38+全量 885/885+tsc 0+eslint 0） | — |
| 204 | 195 切片 B：增强包/选择簇 → skills-package-store（与 A 可并行） | DONE（本批：五 state 迁 skills-package-store，setter 镜像 useState；提交禁用口径收口 computePackageSubmitDisabledReason 纯函数；会话恢复经 viewBridge 直写包 store + 水合单测；卸载 resetForRemount。plan158+水合 44 用例绿、前端全量 889/889） | — |
| 205 | 195 切片 C：货架数据 hook + CandidateTray/StyleShelf/PackageConfigDialog 拆分 | DONE（本批：useSkillsShelfData+skills-shelf-store；PlazaAssetCard/StyleShelf/CandidateTray/PackageConfigDialog 落 skills/；弹窗自订阅三 store、15 props（受限包自算，onRepreview 收口守卫）；视图 4245→2990 行净减 1255；plan158 文案守卫断言重锚新文件（语义不变）。空载全量 889/889 + mobile E2E 5/5。遗留小项：弹窗 aria-labelledby 固定 id 可串名——已由 209 核销（useId 派生） | 203, 204 |
| 206 | 小额收口：导出临时文件名 randomUUID + SSE notify 负载埋点（183 推迟项供数） | DONE（d0d0600：导出临时名 randomUUID 对齐导入侧先例，server/ Math.random 归零；notify 探针（阈值 120/分钟、5 分钟去重、可注入时钟单测）；E2E 观测窗口未触发阈值——183 generation 抑制暂无立项依据，留生产观测 | — |
| 207 | 完成风暴修复：fact 面板自动补跑限次（needsGate 语义收窄 + once-per-candidate 兜底） | DONE（本批：effect 抽为 useCompletionAutoGate hook（src/lib/hooks/）——needsGate 收窄至「门未评估（undefined/drafting）且手上无本章 completionResult」（已评估门/已持有审阅结果不再补跑，出路在面板确认与风险接受）；attemptKey=章节+候选 runId 同键至多补跑一次，换候选重新武装；新组件回归 6 用例（风暴场景/GET 冲门/换候选/静默条件）；前端全量 895/895 + typecheck 0 + unified-creation ×2 E2E 转绿（completionCalls toBe(1) 探测通过，10 秒 283 次归零）。执行注记：E2E 服务 dist 构建产物——改源码后必须先 npm run build 再跑 E2E，否则测的是旧代码 | 199 |
| 208 | 导出菜单 portal 化：fixed 定位脱离编辑器堆叠命中区（199 归因的 P2 小项） | DONE（本批：菜单 createPortal(document.body) + fixed 定位（打开时按触发按钮 rect 锚定一次；scroll（捕获）/resize 关闭；外点判定同时豁免菜单与触发按钮）；role/aria 与导出 fetch 逻辑不变，零新依赖；新增导出菜单单测 5 用例（portal 挂载点/选中导出/Escape/外点/aria-expanded）；前端全量 900/900 + typecheck 0 + build 绿；core-flow E2E 3 连跑全绿（命中区脆弱性消除） | — |
| 209 | 弹窗 aria id 硬化（useId 配对）+ act() 警告清理（205 遗留小项） | DONE（本批：PackageConfigDialog 2 组 + SkillsStudioView 2 处弹窗 aria 配对 id 改 useId；2 处字面量 id 断言改关系断言（describedby 解析到 dialog 内禁用原因元素）；act 噪音 268 行→约 20 行（-93%）：异步 apply/导入/技法点击包进 await act + 宏任务冲刷、helper（openPackages/openPlaza/settleStudio）act 化、candidates 文件补 toast mock（真 toast 5s 定时器在 cleanup 后触发 DOM 更新的假警告）。按 STOP 条件归因：剩余 5 块「not configured to support act」为 React19 + RTL asyncWrapper（waitFor/findBy 窗口内 act 环境置 false）与 zustand 外部 store 通知交错的库间噪音，非组件缺陷，彻底归零需 RTL 升级或 fake-timers 专项——另立不阻塞。受影响四套件 48/48 绿、前端全量 900/900、typecheck 0 | 203, 204, 205 |
| 210 | 197 出路 a 执行：源目录真实正文重建（44 张）+ 渲染切副本单源化（197 Step 4，185 收口） | DONE（本批：realTemplates 映射为 44 张 sanitize-required 候选写入真实正文（120-300 字编号规则指令式，形态对齐 de-ai-tells-guard；不含署名/联系方式/竞品/水印词，正文零消毒命中），buildRealAssets 改 `realTemplates[p.id] ?? 骨架回退`；重生成后副本复测：仅剩骨架 44→**0**、平均主体 33→125 字、失效数 0≤15 STOP 门通过（notes-197-semantics.md 补记）；渲染切副本：getOptionalStyleAssets 合并 SANITIZED_SKILL_COPIES（45 张副本入可选文风集）、getSanitizeRequiredAssets/isSanitizeRequiredAsset 排除已有副本候选（需解锁分组仅剩 2 张非候选平台锁定卡，消毒并启用按钮对目录候选收口）；plan158 断言过渡：45 锚点/004 重写为副本单源化语义、010 删除（运行时端点 UI 链路随单源化消失，端点保留无自动化覆盖）；plan158 37/37 + 前端全量 899/899 + typecheck 0 + freshness 3/3 + 生成幂等 | 197 |
| 211 | act() 警告彻底归零专项（209 遗留收口：RTL 环境窗与 zustand 通知交错噪音） | PARTIAL→BLOCKED（上游缺口，2026-09-14 研究收口：根因已精确化——React 19 的 isConcurrentActEnvironment 改为「env 假 && 无 actQueue」即在更新时报 not configured，而 RTL 16.3.2/16.3.3 的 asyncWrapper 仍刻意在 waitFor/findBy 窗口内置 env=false（React 18 语义下的静音窗），两库语义错位使窗口内到达的 zustand 通知必然告警。三路实验均证伪：①setup 声明 IS_REACT_ACT_ENVIRONMENT=true——asyncWrapper 进入窗口时无条件覆写，无效；②asyncWrapper 覆写为 act 内执行 waitFor——41/47 用例崩（waitFor 轮询与 act 队列深度冲突），回滚；③升级 RTL 16.3.3（2026-08-27 发布，--no-save 试验）——无修复，回滚。剩余噪音 5 块为纯装饰性 stderr，套件 47/47 绿。出路：盯 RTL 后续 release（需其适配 React 19 窗口语义）或 React 侧回退警告条件，上游修复前接受残余噪音；证据链与本行可复现 | 209 |
| 212 | E2E 自动 build 守卫——消灭「测旧 dist」陷阱（207 执行发现的结构性修复） | DONE（webServer.command 前置 `npm run build &&`（构建 ~7s，timeout 120s 预算充足）；实测：webServer 日志出现 vite build、mobile E2E 5/5 绿；207 行注记的结构性消除 | — |
| 213 | plan199 尾巴终局处置：plan150 desktop 用例 + full-browser hit-target（实测仍红，2026-09-14） | DONE（终局均为**重锚至现行契约**，非归档：①plan150 desktop——生成入口整合后写法确认路由到生产工作台，orchestrate-draft（写法 409 门所在链）现经生产页签「快速模式：跳过审稿，直接生成草稿」触发；409 后按响应 resolution 置回未确认态走弹窗重确认；confirmCalls 3→2；另审计按钮已更名「立即审查」、候选面板随生成落入工作台审稿页签（style 定位器经 strict-mode 收敛为编辑器面板 first()）；②full-browser——「回到刚才章节写作」isVisible 与自动返回写作存在竞态，改 3s 容错点击；「开始 AI 审计」批量更名「立即审查/重新审查」；能力包弹窗循环段为 plan158 之前契约（加入本次配置候选已随启用即应用移除）按 STOP 条件隔离，包旅程重设计登记为遗留。plan150 3 连跑 + full-browser 3 连跑绿；**全量 E2E 29/29 绿（历史首次全绿）** | 212 |
| 214 | 全量跑批饥饿治理——「昨绿今挂」总根因（Round 31 定性） | DONE（2026-09-16：Step1 复现与度量——首轮测量 RUN1/RUN3 失败经归因为测量者并发编辑目录文件的污染（RUN3 唯一失败即 215 守卫中途态），排除；干净三连（同仓已提交态 e2df951、dev server 同开负载）329/338/306s 全绿 0 失败，时长≤基线 1.5 倍；饥饿指纹单点——search-similar 全量负载下挂、单跑 ×5 全绿（符合饥饿假象特征，但串行池下未再复现）。Step3 固化：前端 vitest maxWorkers:1 串行池（既有）加实证注记；后端 --test-concurrency=4 既有显式钉住。结论：串行池下饥饿伪影未复现，参数固化维持现状，复发再开。Done 达成：三连全量 0 失败（前端+后端）+ 参数固化 + 本条落账） | 212 |
| 215 | ready 条目骨架正文补齐（210 同病灶收尾） | DONE（2026-09-16：rawPrivateConfigs ready 骨架 33→0——realTemplates 按 210 口径补 33 条真实正文（小飞鸡长篇工作流 7/续写拆仿 3/风华审稿润色社区 15/平台保底与定制流程 8）；审计增补守卫落地 tests/active-template-honesty.test.ts（active ⇒ 非 [商业定制专属提示词体] 开头，修完全部后豁免清单为空）+ 突变验证过（删一条 realTemplates → 守卫红点名 private-89 → 还原复绿）；freshness 7/7。执行事故与自纠：突变验证误用 git checkout 还原未提交文件，33 条正文一度丢失，全部从会话记录重放，无净损失 | 210 |
| 216 | start-stream 质量拒绝交接修复——不可达分支激活（CORR-01：全失败场景模型草稿被静默丢弃） | DONE（本批：交接块提取为 attemptQualityRejectionHandoff 闭包，内层 catch 新增 DraftQualityRejectionError && !fallbackPersisted 分支复用（原仅外层 sync catch 可达——管线 rejection 因未 await 永远落不进去，方案 a 重抛对外层不可行，用 b 变体闭包消重）；交接失败 fall-through 原 failed+refund 兜底。确定性用例：控制字符经 intent+worldRules 双路污染使两级保底全过不了门，writer 固定短稿 → 管线 DraftQualityRejectionError；断言 review_required/草稿含模型稿/degradation.qualityRejected/版本 1/配额 committed。测试环境要点：NODE_ENV=development + INKFLOW_ENABLE_MONETIZATION=true（配额账本默认随 NODE_ENV=test 开关）。STOP 评估：fallbackPersisted=true 时该错误走「精修失败保底」分支本就正确，两路径可区分，无需停止。定向 5/5 + 后端全量 coverage 绿） | — |
| 217 | @xmldom/xmldom 钉版解阻 CI 审计门（DEPS-01/SEC-01：1 high，push main 必挂） | DONE（本批：相较计划首选 overrides 强钉 ^0.9——上游已发 0.8.15 补丁版（全部公告标注 <=0.8.14 受影响）且在 mammoth 自身 ^0.8.6 范围内，npm update 即达目标，零 breaking change 风险、无需 override；双路径（mammoth、electron-builder→plist）均 0.8.15，npm audit --omit=dev 0 vulnerabilities。docx 回归：后端 continuation-docx-limits/pack/archive-limits 15/15 + E2E continuation-extraction-failure 2/2（真实 dist 走 mammoth→xmldom 0.8.15 链）） | — |
| 218 | start-stream 流收尾 promise 收口——防收尾写失败杀进程（CORR-03） | DONE（本批：终态 .catch 链追加兜底 .catch(logger.error)；catch 处理器内失败标记写与 refundQuota 分别包 try/catch（abort 分支 refund 同样收口）；server.ts unhandledRejection fail-fast 保持不变。新增用例以真实故障注入：管线在途时 closeDb() 打开 DB 关闭窗口（fetch mock 首调挂起保证时序），收尾写与 refund 双双真实抛错；断言流以 error 事件正常收尾、零 unhandledRejection、run 停留 running 证明写确已失败且被接住。定向 6/6 + 后端全量 coverage 绿） | 216 |
| 219 | AGENTS.md 测试命令地图 + test:unit 聚合（DX-01：npm test 跳过全部前端测试） | DONE（本批：package.json 增 test:unit = npm test && npm run test:frontend；AGENTS.md Validation 增五条命令地图（后端/前端/shared 双跑/playwright 自动 build 注明/提交前一键）。地图每条实测：test:unit 全绿（后端全量 + 前端 133 文件 899 用例）、playwright 链路 mobile-layout 5/5 绿） | — |
| 220 | 治理目录投影 memo 化——打字/配置路径广谱重渲源（PERF-02/03） | DONE（本批：capability-governance 的 hasGeneratedSanitizedCopy 改模块级 Set、isSanitizeRequiredAsset O(1)（预计算 id Set，谓词刻意与白名单不同构保持历史行为）、getSanitizeRequiredAssets 收为 2 项预过滤数组；SkillsStudioView 三投影收 useMemo、页签计数 shelfTabCounts 按 selectedCategory 预计算（原每渲染 6 次×多趟 143 条筛选）、护栏两处 JSX 内联提升模块级常量（沿 OPTIONAL_STYLE_SHELF_COUNT 先例）。Step 3 StyleShelf React.memo 记录降级：父级 6 大 handler+3 谓词引用均不稳定，单独 memo 无效，生效需 handler useCallback 化专项（遗留）。typecheck 0 + plan158 42/42 + 前端全量 899/899） | — |
| 221 | 副本单源化不变式入规范 + 同名目录导出澄清（DOCS-01/02；backlog 白标单源化/governance 契约测试的前置） | DONE（本批：新建 docs/specs/capability-sanitize.md（白标泄露失效模式/两条合法渲染路径/实现锚点/守护测试/已知缺口）+ AGENTS.md 不变式第四条；public-skill-catalog 同名导出重命名 PUBLIC_SKILL_GOVERNANCE_CATALOG（生成器 emit 模板+生成产物+6 消费方+3 测试文件同步；源注册表名不动）——同名消除后导错路径 typecheck 直接报错。执行注意：全局替换曾误伤 3 个测试的源注册表侧 import，已逐一修复并加 grep 清扫验证。typecheck 0 + freshness 3/3 + 前后端全量绿） | — |
| 222 | AgentWorkspace 打字路径性能——每键重渲与全文哈希消除（PERF-04） | DONE（本批：实体扫描 effect 抽为 useLocalEntityScan hook（plan207 先例）：selection 事件去状态化——监听只调度 400ms 防抖，定时器内直读 textarea 选区+当时全文做哈希，输入真变化才扫描；删除 selection state 与渲染期全文 join 哈希 memo。STOP 评估：selection 除扫描外零消费方，无需停止。新增 hook 定向测试 3 例（fake timers）：防抖窗口不扫/同光标重复 keyup 不重扫（结果引用稳定）/章节清空清列表。typecheck 0 + 前端全量 902/902） | — |
| 223 | 第二梯队打包：双构建/revokeObjectURL/README×2/env 旋钮入册/导出 fallback 收口/prepare 警告/未用依赖/覆盖率分母（8 项独立 commit） | DONE（8/8 各自 commit：①webServer 去重 build 改 dist 存在性守卫（删 dist 明确报错/重建后 mobile 5/5，启动 35.9s→19.4s）；②product-events/Library 两处 revoke 延迟对齐（download-client 同步 revoke 仅剩失败清理路径保留）；③README 防抖 3 秒→1 秒 + 状态表 2026-09-15 复核 210/215/216 现状；④.env.example 增 6 旋钮小节（排除哨兵串与应用常量两个假阳性，默认值取自各读取点）；⑤导出裸文件 fallback 改 404（STOP 评估：唯一真实消费方 downloadAuthenticatedFile 非 200 走错误路径，依赖裸下发的只有契约测试本身——按 213 先例重锚断言 404+不下发字节；export/backup 6/6 绿）；⑥prepare || true 改显式 stderr 警告；⑦删 autoprefixer/@axe-core/react（build 绿；测试用裸 axe-core 保留）；⑧覆盖率 include src/** + 输出目录 coverage/frontend 分离 + 棘轮按新分母实测重锚 66/59/59/68（实测 66.45/59.43/59.44/68.83，远高于旧失真基线，STOP 不触发）） | — |
| 224 | 回执出口——生成结果渲染能力消费凭证（C1/G1：应用后零回执，价值闭环断在验证环节） | DONE（01300f1：buildCapabilityReceipt 五级解析（精选卡→系列流程→目录→消毒副本→裸 id）；ProductionRunReview 质量节后新增 capability-receipt 节，data-testid 守护。定向 3/3 + 前端全量绿） | — |
| 225 | 货架分区——官方规范/社区配方两层供给 + 签字语义标（A1：内置与开放的边界从未被表达） | DONE（885faa9：capability-governance 增 isOfficialSupplyAsset/isSanitizedCopyAsset/partitionShelfBySupply；optional-style 页官方规范/社区配方双区渲染（计数+注记）；PlazaAssetCard 供给签字徽标 aria-hidden（曾致 plan158 heading 断言 1/42 挂——徽标文本进可访问名，对齐既有授权徽标模式修复）） | — |
| 226 | 症候入口与分数诚实——「这章要解决什么」任务导航 + 适合度理由上架 + 证据分定义（P0-B/A3/B1） | DONE（382bb1b：CAPABILITY_SYMPTOMS 五症候（去AI味/钩子开篇/声线/节奏/平台过签）；STOP 实录——pacing 关键词含「推进」泛命中 73/73（20% 阈值触发），收紧为 节奏/爽点/场面 后 1-30，voice 去「润色」；症候 chips 点选切 optional-style 页并 filterBySymptom；证据分 title 定义（45-98 冷启动提示词质量，不代表生成效果）；StyleShelf 有作品上下文时按适合度降序。断言区间 [1,30] 守护回归） | 225 |
| 227 | 工序签名——卡目录补全「输入料/产出物/方向/工位/套牌」craft 数据模型（228/229 地基） | DONE（6087aea：实现偏差——独立客户端推导模块 src/lib/capability-craft.ts 而非生成器 emit：签名输入收最小结构形状 {id,title,goal?,stage?,primaryCategory?}，货架投影卡与治理目录条目皆可直接传参，顺带消除 GovernedPromptAsset↔CuratedProductSkill 的 TS2352 转型（生成器 emit 方案会放大该类型分叉）；工位按文本语义推导（大纲/拆书/概念/平台检验/正文/护栏，护栏=inspect）；CRAFT_OVERRIDES 显式覆盖表留给 228。CRAFT_OVERRIDES 登记于 228 提交。全目录签名完备/护栏/克苏鲁套牌/prose 互斥 4 例） | — |
| 228 | 重构模式——来料加工管线，人设/大纲重构首两张卡（迁移者入口，候选+diff 安全落地） | DONE（b9062c0：两卡 refine-character-rebuild/refine-outline-rebuild 入 curated-product-skills 源（inputs=characters/chapters-outline 指向既有资料）+ manifest（character 卡复用 characterCardCandidate 契约、outline 卡 outline-candidate；ArtifactCapabilityContract.output 联合增量补 outline-candidate，零消费者受影响）+ 服务端重构 prompt（事实保留+重组指令，immutableFacts 承载事实清单）+ governedBibleKind 扩映射复用角色候选链。后端 e2e：候选落库+原角色零改动（refine-candidate-route 1/1）；卡面来料加工徽标+绑定提示 3 例；craft refine 断言。偏差：generate-outline 链路无配额预留（与既有 bible 卡一致），计划「复用 generateProse 配额语义」条目按现状搁置不硬加） | 227 |
| 229 | 系列套牌——系列实体化 + 套内有序 + 同工位互斥（克苏鲁/宝可梦系列的序性从未被系统表达） | DONE（63f2182：套牌卡面（名称/张数/工位/套牌第N张·工位序号标注/整剂启用/从第N张继续）；发现目录序≠工序序（克苏鲁正文在目录排世界观光之前）→ 套内改工位推进序+工位内标题细分排序，整剂启用按工序序入草稿；handleApplyDeck 批量+一次应用，选用前 detectStationConflicts 阻断并说明（互斥只约束套牌卡，非套牌卡保留自由组合）；groupStyleShelf 套牌识别单源化到 craft 签名（顺带修复：extractSeriesKey 缺品牌前缀规则，克苏鲁/宝可梦无连字符卡此前从未归组）；PlazaAssetCard 套牌归属提示。套牌 5 例 + 前端全量 930/930） | 227 |
| 230 | 新用户保底配置——一键「套用推荐配置」+ 空状态导购（F1：145 张卡对零导购的死状态） | DONE（3c473c6：STARTER_PROFILE_PRESET（小飞机流程+去AI味护栏）+ starter-config-card 一键套用；isStarterEligible 判定） | 225 |
| 231 | 占位文案治理——47 张广场卡真实定位补写或退稿隔离（A2：`发挥广场精品提示词`×47） | DONE（7f23934：squareGoals 47 条真实定位语逐张补写；STOP 评估：空模板是解耦运行时设计（210 真实模板存在）而非占位缺陷，保留并按卡面说明改写 goal；catalog-copy-uniqueness 守护零占位+跨卡唯一） | 225 |
| 232 | 套牌准入白名单 + 品牌双政策统一——空标题卡/括号破损/名实不符/假套牌四症状同修（第二诊·病根 A） | DONE（04c10b5：extractSeriesId 改白名单准入（克苏鲁/宝可梦/锅盖/猫头鹰/一次一章；CONFIRMED_BRACKET_SERIES 预留）；Step 1 枚举核对——【风华出品】25张混装/lwl 13张上传者杂集/【小飞鸡】6张三步与长篇混装均非连贯方子不入册；括号套牌名补全闭括号；getOptionalStyleAssets 过滤渲染剥空标题卡（sanitized-private-186 fire角色定制，过滤判定与渲染路径同源用 public-skill-catalog 版 sanitizer——两份 sanitizer 实现合一为遗留债）；StyleShelf misc:* 显示「其他」。craft 非白名单断言 + plan158 45→44 重锚 + capability-shelf 夹具重锚） | — |
| 233 | 目录准入规则 + 源头文案修复——垃圾标题卡不入册 + `and fallback profile` 改写（第二诊·病根 B） | DONE（f01058d：生成器准入——垃圾标题边界匹配/渲染剥空镜像检查/标准化标题去重（保底过「番茄正文过保底2」），排除计数留痕；45→38 张副本（排除 6 张垃圾 13.3%≤15% STOP 线 + 去重 1 张）；发现候选直接从源目录进前端，前端 SANITIZE_REQUIRED 双谓词同规则准入+同键冗余兜底（private-170 不回落需解锁）；creative-* 定位语改纯中文；freshness 镜像同步重锚 45→38 + catalog-copy-uniqueness 三断言） | — |
| 234 | 消毒副本文案变体——构建期按类别改写，消除「同一句话墙」（第二诊·病根 C） | DONE（8cc2373：商业词正则抽 shared COMMERCIAL_COPY_PATTERN 单源；buildSanitizedCopy 构建期改写——goal 按 primaryCategory 桶轮换变体（卡名入文案），signal 改写为短效果声明，37 处改写后 38/38 goal 互异，「同一句话墙」消除；运行时替换不再触发（保留兜底）；freshness 镜像同步（计数器归零后字节对比）+ 无商业词/同句≤6 两断言） | 233 |
| 235 | 导购前置——无作品态保底可见性 + 零收藏能力卡地图前置（第二诊·缺口 D） | DONE（概览「当前作品」卡无作品时展示 cold-start-guide（保底配置预览+先选作品指引，应用语义不变）；概览新增 skill-map-preview 静态指引卡（零收藏可见，SkillMapPanel 零收藏返回 null 按 STOP 预案降级纯静态）；新节点全 testid additive；组件测试 2 例） | — |

| 236 | 白标清洗器四副本合一 + 失实指针修正（CORR-02 执行；第三轮审查） | DONE（039a058：正典吸收生成版通配剥除（行为并集）；生成文件改 re-export 正典、删内嵌副本（-295 行）；修正 capability-governance.ts 失实注释（原指向未发生的 233）。差异枚举 24 处留档（渲染面影响 8 张【小飞鸡】源卡品牌新剥除 ≤10 STOP 线）。连锁治理：合一后去重键含品牌剥除，5 对换皮重投互为同卡去重 38→33，三处键函数 sanitizer 感知同步；freshness 重锚；后端 6/6 + 前端定向 53/53） | — |
| 237 | 无上下文适合度分数诚实化收尾——无作品不渲染噪声分（第三轮审查） | DONE（StyleShelf 无上下文 fitness=null，噪声分不渲染；chip 与降序在有上下文时不变；测试：无作品零「适合度」/有作品恢复 6 例） | — |
| 238 | 迁移者入口前置——重构卡发现性指引（第三轮审查） | DONE（概览 migrate-guide 指引卡：已有大纲/人设资料的用户一键联动 商店+写作技法+①阶段 直达重构卡；显示条件=未配置任一重构卡；测试 3 例含落位与重构卡渲染） | — |
| 239 | 社区配方分层呈现——原料库默认折叠（第三轮审查） | DONE（StyleShelf filterActive 语义：默认浏览态纯社区散卡组归「原料库（N 张 · 社区散卡）」折叠（含定位说明），官方/套牌不折叠；症候激活全展开；测试镜像两区结构 7 例） | 237 |

| DONE（打标 82 张：featured 25 / standard 36 / suspect-duplicate 21（test-fixture 不打）；curationTier 字段贯通 GovernedPromptAsset/ScorecardMeta/四构造循环/生成文件/前端投影；可审计清单 plans/240-curation-tags.md；零行为变化。全量 936/936） | — |
| DONE（5c1f9b4：执行发现反馈聚合基建整条已存在（skill_usage_records 表→summarize→syncSkillFeedbackScores→feedbackScore），241 真实缺口仅为采集点——new ChapterCapabilityFeedbackBar 挂在章节完成评审面板下方，👍/😐/👎 单击即提交（映射 accepted/revised/rejected + fitScore 85/55/15），提交后立即聚合；幂等走 localStorage（done/dismissed:<chapterId>），服务端保持 append-only。测试：前端 3 例 + 后端聚合链 2 例（rejected 反馈激活 observedPerformance sampleSize=1、feedbackScore 写回、同章重完成 append 语义）。全量 939/939。供给路径四步全部就绪：折叠(239)→打标(240)→埋点(241)→数据驱动淘汰（攒数据后拍板） | 240 |

### Round 36 说明（2026-09-16）

来源：**第二诊**——Round 35 落地后的全面复审（pm-router × 八刀法，六页签实时取证 + 管线源码溯源）。结论：Round 35 修「选择系统」六项全部站住；本轮问题全部在「货」上，归三个病根 + 两个缺口。**病根 A**：品牌词双重政策冲突（craft 套牌分组当身份展示 vs prompt-sanitizer 黑名单当水印抹除）→ 232；**病根 B**：plaza 源无准入（测试卡/`番茄正文过保底2` 直接入册）+ creative-\* 模板中英混排 → 233；**病根 C**：消毒副本商业词 goal 运行时塌缩为 3 句固定文案（约 20 张同句）→ 234；**缺口 D**：保底配置与能力卡地图对零作品/零收藏用户不可见 → 235；**缺口 E**：能力卡地图显示「有使用反馈 0」，适合度分 20 分反馈权重全库无样本。**依赖图**：232/235 独立；233 → 234（同动 generate-public-catalog，串行）。**待拍板项**：处方 5（反馈环第一口数据——写后轻量反馈入口，涉及写作主链路交互）不在本轮，需单独拍板；lwl/【风华出品 等上传者品牌是否进套牌白名单由 232 Step 1 枚举核对后定，边界组判不准即 STOP。

### Round 37 说明（2026-09-16）

来源：**第三轮深度审查**（pm-router × 八刀法 deep 模式；primary source 核实：git 状态/台账全文/代码注释/自动化状态）。结论：16/16 计划 DONE 且真页面复核通过；新增遗留 2 处均为"指针失实"型（capability-governance.ts:4 注释指向未发生的 233 合一；Round 35 定时自动化 runCount 0 静默死亡——已删除）。**依赖图**：236/237/238 独立；239 建议在 237 后（同动 StyleShelf）。**待拍板项维持**：处方 5 反馈环、E1 商业化门禁。**backlog 维持**：第三梯队 13 项 + C2/G2/T1 + StyleShelf memo handler 专项（220 遗留）。

**执行收口（2026-09-16 同日）**：236-239 全部 DONE。执行要点：236 差异枚举先行（24 处 ≤STOP 线），合一暴露换皮重投 5 对连带去重（38→33 副本），CORR-02 核销；239 以 237 先行（同文件 StyleShelf）。

### Round 38 占位（2026-09-16）

用户批准供给路径全案：**241 反馈环（处方 5 正式立项）**为主菜——章节完成时点一次性轻量反馈（👍/😐/👎）→ capability_feedback 事件 → observedPerformance 聚合 → 适合度反馈权重激活 + 能力卡地图计数增长；**240 策展打标**为其先验（三档元数据，零行为变化）。淘汰决策等 241 数据 + 240 先验共同支撑后再拍板。

**Round 38 执行启动（2026-09-16）**：240 DONE。241 反馈环留待独立窗口执行（动章节完成时点主链路，计划已含两条 STOP 预案）。

**Round 38 执行收口（2026-09-16 同日）**：240 DONE（打标 82 张）+ 241 DONE（反馈环采集点上线）。执行要点：241 复用既有 skill_usage_records 聚合基建而非新建事件通道（计划假设的 product-event 落库降级为不需要——usage record 即反馈的存储本体），幂等边界在客户端 localStorage。**供给路径四步全部就绪**，淘汰决策等反馈样本积累后与 240 策展先验共同拍板。

**Round 39 收口（2026-09-16）**：214/215 DONE——台账自 Round 31 以来首次清零 TODO（决策项 E1 与数据等待项「数据驱动淘汰」除外，均非执行任务）。214 实测三连全绿固化串行池；215 骨架清零并带突变验证守卫。执行事故：215 突变验证误用 checkout 回滚未提交正文，已从会话记录全量重放（过程记于台账，作未来执行者之鉴：突变验证前先提交或用临时副本）。

**Round 40 执行报告（2026-09-17）**：
- **242 DONE**（bd58424 + 配套）：`capability-manifest-catalog` 增货架派生 manifest 层——active+optional-style 散卡与 sanitized-* 副本全量覆盖（106/106），CURATED_DEFINITIONS 优先级不变；**浏览器 E2E 实证**：锅盖男频正文直出「应用配置后设为作品默认」首次成功落库（projectTechniqueIds + membership sourceVersion '1'），跨工位叠卡（+克苏鲁诡秘氛围包）成功。
- **243 部分完成**：配置面根因修复（membership sourceVersion 'catalog'→目录真值 63e419c——此前投影占位版本号导致服务端 CAPABILITY_MEMBERSHIP_MISMATCH 400，配置永远停在待应用）；接受写入端到端实证：双卡 5670 字草稿接受成功落库（chapters.content 5670、编辑器字数 5500）、能力回执/章节事实候选正常。**接受写入链路已闭环**。
- **244-1 部分**：241 反馈条触发回退修复——项目级配卡场景本章无技法时回退项目卡，反馈数据不再漏采。
- **遗留**：245 交互收敛（生成入口归一/导航持久化/术语）未动；244 质量门误杀校准未动；LLM 超时降级的用户沟通未动。均记录在案待后续轮次。
- **执行要点**：dev server（tsx 无 watch）需重启才能让服务端 shared 代码变更生效——本轮叠卡 E2E 曾因此误判修复无效；突变验证/还原切勿对未提交文件使用 git checkout（215 执行中丢失 33 条正文后从会话记录重放）。

**Round 40 追加验证（2026-09-17 续）**：服务端重启后重载——生成配置面板已识别双卡（作品技法 2，不再显示"还没有配置"），写法来源含锅盖/克苏鲁。叠卡 A/B 严格对照（同意图无卡 vs 叠卡生成对比文风）因 LLM 全章生成耗时（每轮 5-10 分钟）与长会话限制未在本轮完成，链路已全部打通（配置→落库→编辑器可见→生产面板识别），下轮直接跑第二章生产即可拿到叠卡正文样本。

**Round 43 执行结果（2026-09-18）**：叠卡 A/B 验证完成——《深空尾灯》第二章（7512 字）在双卡配置（锅盖男频正文直出 + 克苏鲁诡秘题材风格氛围增色包）下生成，文风显著区分于无卡基线：克苏鲁氛围词密度明显提升（"像活物受到惊吓时缩成一团""有什么东西在翻板下面唱歌"），男频直出的冲突升级节奏更快（"它醒了。程复说，晚了。"），去AI味效果持续（无排比三连/情绪名词直陈）。**能力卡叠卡注入链路端到端验证通过。** 243-A/B 完成。

**Round 42 收口（2026-09-18）**：246-249 全部 DONE。
- **246** DONE（20f914c）：后端 fallbackContinuity 补 degradation + 前端徽标数据源改 DB 优先
- **247** DONE（e36805c）：critic unknown 不再直接 break，追加 Writer+Critic 重试轮（attempt≥1 终止）；critic-parse-retry 测试重锚
- **248** DONE（e36805c）：PlanningTab 静默 return 加 toast
- **249** DONE（e36805c）：AgentWorkspace 关系图按钮从条件块提升为始终可见
- **244-A** DONE（60d3162）：Beat 检测校准 + 回归测试
- **244-1** DONE（113be8d + e36805c）：反馈条触发回退到项目级卡
- **245 快赢** DONE（60d3162）：术语人话化 + 导航持久化
- **E1** DONE（5771ab2）：选 C 维持现状

**遗留**：245 大项（入口归一到步骤条）、叠卡 A/B 严格对照、知识图谱入口到顶级导航。均已在台账记录。

**叠卡 A/B 严格对照实验（2026-09-18）**：同意图 n=1/组，无卡 37/50 vs 有卡 37/50（均过门禁）——单样本未见总分提升，但文风取向改变可验证（有卡稿长 39%、对白占比 13.3% vs 8.8%、克苏鲁卡痕迹可辨）；回执差异恰好等于被移除的 5 张卡（配置操纵管线层成立）。**限制**：LLM 方差大，n=1 不能下强结论；管线内嵌五维审稿在 DeepSeek 配置下系统性不可用（历史 5 run 全失败，A 组 JSON 契约失败、B 组请求失败）——需单独修复。数据留存 /tmp/ab-*.json。

### Round 34 说明（2026-09-15）

来源：`/improve` 四路并行只读审计（correctness+security 很彻底、perf+arch、coverage+dx、deps+docs+direction 各一，standard 档），主控逐条亲核承重证据后立项。**Now**：216（正确性硬伤——质量拒绝交接死代码）/217（CI 审计门即将变红）/218（收尾写失败杀进程）三个正确性安全项 + 219-223 五项 S 级清账。**backlog**（第三梯队未立项）与 **direction 备忘**见下两节。审计基线：全量 E2E 29/29、前端 899/899、后端 91.4% 行覆盖。未审计面：electron.cjs 主壳（961 行）、docs/prd 内容深度、真实 provider 评测链、移动端 UX。

**执行收口（2026-09-15，同日）**：216-223 八计划全部 DONE（214/215 维持 Round 34 Next 占位）。执行期偏差两处已记入对应行：217 走范围内升级 0.8.15 而非 overrides 强钉 ^0.9（上游补丁版落在 mammoth 自身 semver 内，零 breaking 风险）；220 Step 3 StyleShelf memo 降级为遗留（父级引用不稳定，单独 memo 无效）。前端棘轮基线按新分母重锚 66/59/59/68（222 新增 3 用例后全量 902/902）。

**批后清账（2026-09-15）**：修掉「每次全量后端测试污染 tests/fixtures」的重复陷阱——根因是 provider-quality 测试的确定性/SKIP 评测把报告写回仓库 fixtures（SKIP 单跑还会覆盖已提交报告内容）。修法：`run-chapter-llm-acceptance.ts` 报告目录支持 `options.reportDir` 与 `INKFLOW_PROVIDER_EVAL_REPORT_DIR` 双通道覆盖（默认仍写 fixtures，`eval:provider-quality` 刻意重生成行为不变）；测试一律写临时目录并新增「仓库 fixture 未被动过」断言。实测：套件 22/22 绿且 git status 干净；CLI 重生成路径端到端可用。

### Round 35 说明（2026-09-15）

来源：pm-router × 八刀法四轮产品思考（选择困难 → 能力商店全面诊断 → 供给边界 → 工序与系列），主控亲读代码 + 实时页面取证后立项。主题：**能力商店工序化**——把「收藏卡牌」重铸为「工序算子」：货架分区（签字定责）、症候入口（处方化）、回执出口（价值闭环）、craft 签名（数据地基）、重构模式（迁移者入口）、系列套牌（序性与互斥）、保底配置（成长引导）、文案治理（供给质量）。**依赖图**：224 独立；225 → 226/230/231；227 → 228/229；执行建议 224 → 225 → 226/230/231 并行 → 227 → 228/229 并行。**E1 已拍板（2026-09-17）**：选 C 维持现状——双模式代码保留 + env 开关文档化（.env.example 已补 VITE 前端旋钮），接入支付后再开。**与存量关系**：214/215 维持 Next 占位；诊断维度 C2（遥测唯一读者是设置页 7 天指标）、G2（三种持久化语义混合）、T1（公开目录随编辑器 chunk，ARCH-04；236 重生成后实际 221KB）本轮不立项留 backlog；D1 benchmark 基建被 227（签名可验证性）与 231（文案真实性）引用为验证手段。

### 审计 backlog（第三梯队，未立项，按需取用）

- PERF-01：start-stream 保底草稿「假打字回放」串行推迟模型管线 0.3-1.3s（production.ts:370-385、765；与 ARCH-03 拆分同计划处理）
- CORR-02 + COVERAGE-07：~~白标清洗器 4 份漂移副本~~ 已部分修复（236 合一后仅剩正典+守卫镜像 2 份；竞品词已于 M5 并入正典 sanitizeWhiteLabelText）——核对于 2026-09-18
- ARCH-01：「runtime-ready 卡」判定谓词重复 —— **已单源化（M5②，2026-09-28）**：三元判据收进
  `shared/lib/capability-runtime-readiness.ts`，手抄调用点 14 → 0（唯一定义处 1），守卫
  `tests/capability-runtime-readiness.test.ts`；附加条件（isWhiteLabeled/grade/score/placementTier）剩余面见
  `docs/specs/capability-sanitize.md` 已知缺口。核对于 2026-09-28。
- ARCH-03：start-stream 单 handler 内联 ~1200 行 6 阶段（production.ts:582-1826）
- ARCH-04：331KB 静态治理目录随编辑器 chunk 下发（EditorView.tsx:77 唯一用途是一次标题查找）
- COVERAGE-03：governedGenerateText（LLM 唯一入口）行为分支仅静态正则守卫（governed-llm.ts:22）
- COVERAGE-04：capability-governance 零函数级直接契约（副本选择=付费合规面；221 是前置）
- COVERAGE-05：plan158-frontend-cleanup 378 条源码字符串断言（双向失真）
- COVERAGE-06：EditorStatusBar 22% 覆盖（保存状态诚实展示面未测）
- DX-05：双轨测试 helper 重复（fetch stub ×25、waitFor 双实现）
- DEPS-02：依赖滞后分级——Electron 44 + better-sqlite3 13（用户安全面，M-L，含打包 smoke 全链）；@google/genai 2（M，三处调用点）；hf-transformers 9-30 豁免已因 v3.8.1 零公告而消解（记一行即可）；ts 7/vite 8/vitest 5 记录「现在不做」

### Direction 备忘（决策性，非缺陷）

- D1 能力卡质量证据闭环：benchmark-story-cards.mjs + prompt-quality.ts + score/grade 字段全在库但停在 CLI，确定性评级可做成货架证据徽章（M；真实评分烧 token 留手动触发）
- D2 Electron 壳契约化：961 行主壳 + 5 卫星 cjs 的手写监督系统，dev/electron/packaged 三面验证；characterization test 优先的 spike（M-L）
- D3 提示词资产可分享：210 后「治理元数据随包」已从假设变为现实约束，为 192 拍板补充新证据；导入侧白标消毒收口前不开导出（决策备忘）

### Round 33 说明（2026-09-14）

路线图思路（roadmap-planning 轻量应用）经用户确认：**Now**（Round 33，小而确定清账）= 211 选型收口 + 212 build 守卫 + 213 两个缓议 E2E 终局处置（实测证据：plan150 desktop 用例 draftCalls=0、full-browser「回到刚才章节写作」click 超时，aad58c2 构建后复测）；**Next**（Round 34 占位）= 214 跑批饥饿治理（「昨绿今挂」总根因，杠杆项）+ 215 ready 骨架正文补齐（数据诚实度）；**Later**（触发式，不排期）= 183 generation 抑制（等 notify 探针生产数据越线）、192/193/194 spike 实施（等 PRD 开放问题拍板）。主题化原则：A 测试与验证基建可信度 / B 数据诚实度尾巴 / C 触发式观察——C 不进路线图，留台账被探针与拍板唤醒。

### Round 31 说明（2026-09-12）

来源：Round 30（173-195）执行完毕后的遗留项与执行期发现。四个方向经产品拍板：①185 走「扩过滤器保特性」；②8 个陈旧 E2E spec 全部重写；③195 三切片入批实施；④无 Key 全章生产写修复计划。锚点经当日只读勘察核实（SANITIZE_REQUIRED_CATALOG 为提案名非代码实体，真实机制是 generate-public-catalog.ts:53 的 isPublicRuntimeAsset；capability-governance 在 src/lib/ 非 server/capabilities/；config/sync 0 生产调用方；db.ts:380 为 Math.random 残留现址）。

### Round 32 说明（2026-09-14）

来源：Round 31 收尾时汇报的遗留问题清单，经两项只读子代理勘察核实机制后立项三项（计划文档含完整机制锚点，基于 `95aefc3`）：①207 完成风暴（P1——纯前端 effect 自激循环：factPanelNeedsGate 把已评估门视为待补跑且无 once 标记，10 秒 283 次 POST /complete，落地后解阻塞 unified-new×2）；②208 导出菜单命中区（P2——199 归因项，portal 化修复，仓库零 createPortal 先例故用 React 原生 portal，不加依赖）；③209 弹窗 aria id 硬化 + act() 警告清理（205 遗留小项）。执行顺序 207→208→209（相互独立）。197/185 维持 BLOCKED 待产品拍板（出路 a 补真实正文 / b 砍特性 / c 接受骨架现状），本轮不含；plan150 start-stream 与 full-browser 维持缓议。

### Round 32 补记（2026-09-14）

用户拍板：①197/185 走**出路 a**——补真实正文重新生成源目录，随后完成 197 Step 4（渲染切副本单源化），立项 210 执行；②act 归零专项立项 211（出路选型执行时定案，RTL 升级需审批）；③190 台账核销（Step3 已由 196 落地，PARTIAL 为账面滞后）。

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

### 第 30 轮审计排除（2026-09-10，improve deep）

- **API Key 静态加密密钥由 hostname+username 派生**（`server/lib/config.ts:23-26`）：代码注释已明示弱于 OS keychain 的既定权衡，Electron 模式已迁 safeStorage——设计如此。
- **dev 模式 `INKFLOW_ENABLE_DEV_AUTH_TOKEN`**：`NODE_ENV!=='production'` 门控 + loopback 校验，打包路径（build-server/package-electron）不携带该 flag——非发现。
- **SSE query token**（`auth.ts:118-124`）：访问日志已脱敏、5 分钟 TTL、64 连接上限——已治理。
- **CSRF 面**：Bearer 头 + 无 CORS 中间件 + 仅绑定 127.0.0.1 覆盖——本地单机应用可接受。
- **`express.json` 50mb / 导入 100MB body 上限**：单机本地应用量级可接受。
- **`wrapUserInput` 防注入包裹的全量推广**（5 处裸插值进 prompt）：涉及多 prompt 模板质量回归，输出已有 zod schema 校验兜底——本轮不纳入，列为潜在后续项。
- **LLM baseUrl 的 SSRF 残余面**（`validation.ts:290` 仅校验 scheme）：BYOK 架构既定权衡（用户自持 key、自配网关含 127.0.0.1 本地模型属合法用法）——仅记录，不立计划。
- **sqlite-vec/向量检索索引化**：当前量级（≤数千 chunk）无实证瓶颈；Plan 184 Step 4 仅埋点调查，超阈值另立计划。
- **全量依赖大版本扫荡**（React 19 等已当前；非核心滞后项）：无证据支撑收益，仅处理有硬 deadline 的 @xenova/transformers（Plan 190）。
- **「驾驶舱点击自动执行无确认」类上报**：`docs/specs/cockpit-routing.md` 既定设计，不作为发现。

---

## Round 44（2026-09-20）：第一期完整审查——注入链收口 + 测试守护 + 卫生小件（253–255）

审计基准 `391abf4`。工具：improve (standard) + security 分发（insecure-defaults / secure-code-guardian 视角）+ supply-chain-risk-auditor + 文档对账。三路子代理审计 + 头号发现人工逐行复核；findings 共 22 条，立项 3 包（下表）。与历史 DONE 计划归账：110/111/116/121/128/130/132 各覆盖窄路径，本轮 P1 残留为其分支缝隙，后续修复按「缝隙收口」立项，勿重复审计。**253 即第 30 轮排除项「wrapUserInput 全量推广」的收口执行**——当时暂缓理由（模板质量回归）由计划内重锚机制与 STOP 预案承接，且本轮新增证据（续写包「硬设定」指令框、book-extracted 卡通道）使风险升级为应修。

| 编号 | 标题 | 状态 | 依赖 |
|---|---|---|---|
| 253 | 不可信内容通道注入围栏收口——续写包/技能卡过围栏 + book-extracted 卡落库内容扫描（plans/253-injection-channel-fencing.md） | DONE（5/5，2026-09-20 已全部合并入主干，收口 merge `9e4b72d`。Steps 1-4 见前述；**Step 5 执行中发现 `sanitizationHits` 持久化不透传**（db-mappers envelope 仅收 4 旗标键，落库即丢，门禁会打断核心写作读路径）——裁决扩权：db-mappers 对称透传 + 存量卡按 `createdAt<2026-09-20T00:00Z` 时间豁免（fail-open），fixture 12 处对齐。合并后主干后端 1222/1222。**部署注意**：豁免截止线硬编码，部署前确认无其他合法产卡路径绕过 finalize。遗留候选：~~Skill 接口正名 sanitizationHits~~ **已解决**（`4dd4705`：Skill 加可选字段、manifest 直读、撤 2 处 `as Skill`；typecheck 0 + 后端定向 35/35 + 前端 143 文件全绿）、预清洗先于扫描致微信/竞品词计不进 hits 的口径统一（维持暂缓，随消毒域下次改动搭车） | — |
| 254 | 已知缺陷特征化测试守护——两处固化断言改正 + 五条 P1 盲区补特征测试（plans/254-p1-blindspot-characterization.md） | DONE（2026-09-20 已合并入主干，merge `1a731a6`。审查者独立复核后端 1215/1215 + 前端 143 文件全绿、范围合规 6 测试文件、特征化注释齐全。**机制修正**：原审计指认 production.ts:1087 早退分支不可达——:1083 已向 pipeline 传 abort signal，断连后走 `.catch` 终态化 failed；真实可达同族缺陷在 :1102/:1156 preModelWriteHook 窗口（run 停 running + 模型结果不落库 + 配额已 commit），测试已按可达路径登记。另：consumeCapabilityLaunch 消费即清 store，「二次消费回调」不可达，以「残留 launch 重投递 2 次」探针替代） | — |
| 255 | 日志卫生与仓库账实对齐——logger.error 脱敏 + ID 字符集 + 启动日志 0600 + dev 漏洞清零 + 过时账目销账（plans/255-log-repo-hygiene.md） | DONE（2026-09-20 已合并入主干，merge `524cec6`；收尾 commit `0fb8561` 完成 vitest --force 升级，npm audit 归零。审查者复核 typecheck 0 + 后端 1213/1213 + 主仓 node_modules 完好。audit 5→3（仅剩 vitest 链 3 moderate，--force 升级待操作者批准）；85 截图 untrack 磁盘保留；electron 启动日志 0600 + 存量 chmod 修复。**MEMORY.md 销账由审查者直接应用于主仓**（该文件在基准分支实为已追踪，1160fc6 入库，与「不入库」声明矛盾已登记待决）。validation.ts:578 的 parseDocSchema.novelId 为独立 schema 有意不动） | — |

三者无文件交集，可并行；建议顺序 253 → 254 → 255（安全优先）。

### 本轮未立项（防重复审计）

> **2026-09-20 补充（用户上报「我的能力卡」残留【小飞鸡】品牌）**：根因是货架克隆路径（SkillsStudioView `cloneAssetToSkill`）把未消毒的广场原始标题直接落库，且旧克隆卡缺 `deconstructionCardType` 本就无法过产品级 update 门禁。已修（commit `fix(capabilities) 清除能力卡品牌残留`）：克隆函数接入 sanitizeWhiteLabelText 防新增；`scripts/reclean-skill-brands.ts` 存量重洗（幂等，重写 2 张）；db/skills.ts 增维护专用 `updateSkillRowForMaintenance`（跳过门禁直写，清洗工具用）；renderer-db-boundary 守卫精确化（禁 optimizeDeps include/exclude、放行 entries 入口限定）。`lwl-` 前缀不在词表维持原样（扩词表需同步重锚公开目录，另行决策）；`锅盖` 为 Plan 232 白名单套牌保留。
>
> **2026-09-20 补充②（用户上报「原料库 86 张太多」）**：诊断=现关键词分桶四成挤在「正文润色与文风」兜底桶，而治理标 `primaryCategory`/`curationTier` 元数据已存在但 UI 未用。用户裁决：原料库内按用途二级分组 + 疑似重复先标记不并入（符合 Plan 241 反馈门槛，当前样本仅 1 条）。已落地（`b178f74`）：StyleShelf 原料库按 primaryCategory 二级分组（创作流程 17/成套配方/实用工具/文风参考/质量护栏/平台标准/其他，按规模排序），suspect-duplicate 单列置底标灰；补守恒+置底+计数镜像回归测试；前端 944/944。

---

## Round 45（2026-09-20）：配置容量扩容与已生效总览（256）

用户实证痛点：能力卡库存多但「作品卡组」恒 3/3 满；套牌/链路卡整剂启用走 `projectTechniqueIds`（无上限数组）不占格——同为"作品默认配置"，容量语义与 UI 呈现割裂。真实模型为四条泳道：卡组 deck（1 主+≤2 辅，仅拆书卡，服务端硬校验）/ 作品默认技法（无上限）/ 收藏（回退）/ 护栏+章级 overlay。用户裁决：辅卡 2→4 + 含已生效总览。

| 编号 | 标题 | 状态 | 依赖 |
|---|---|---|---|
| 256 | 拆书卡组容量扩容（辅卡 2→4，常量 `PROJECT_DECK_MAX_SUPPORT_CARDS` 单源：服务端双校验点+UI 槽位+文案共用）+ 已生效配置总览（卡组/技法/护栏按工位分组，占格与容量语义如实标注）（plans/256-deck-capacity-overview.md） | DONE（已合并 `85a44c8`；主干后端 1225/1225 + 前端 144 文件全绿；执行中获批扩展范围：`skills-studio-governance.addCardToProjectDeck` 加卡闸同步常量化，否则扩容对加卡链路不生效） | — |

### Round 45 遗留与联动（防重复审计）

- **book-factory 第三处容量闸未收编**：`src/components/book-factory/useBookFactory.ts` 的 `PROJECT_DECK_SUPPORT_LIMIT`（3 辅卡 throw、文案"辅卡不超过 2 张"）——拆书工作台独立选择流，需单独计划收编到 `PROJECT_DECK_MAX_SUPPORT_CARDS`。
- **生成侧联动闸**：`TOO_MANY_EFFECTIVE_SKILL_CARDS` 仍限"卡组+本章卡 ≤ 6"——1 主 + 4 辅后本章 overlay 余量仅 1 张，超出将 400。属 prompt 预算语义，改动需单独评估，勿当作 bug 上报。
- Round 44 遗留维持：预清洗计数口径暂缓；`lwl-` 扩词表需重锚公开目录。
- **260 技法优先度系统 DONE（2026-09-21 第四轮，已合并）**：技法装配引入角色（base/accent/seasonal）与排序——`techniquePriorities` 字段（归一化：去重/role 白名单/order 填充，向后兼容逐字节）；生成侧按角色桶序注入并带【基调/强化/季节】标注；SkillsStudioView 总览增角色徽标与设为基调/上移/下移控件；`skills-studio-governance` 白名单透传（必要超范围，防静默丢数据）。合并后主干后端 1251/1251 + 前端 146 文件全绿。遗留：拖拽 UI 另立；题材付费卡的季节启停走同一字段。
- **private-175 白标接入 DONE（2026-09-20 第五轮，已合并）**：用户产品规则追加——「完整系列=付费，散单卡=内置；调用能力卡时优先启用流程卡」。长篇商业连载流程的大纲方法论卡 private-175（小飞鸡·长篇通用大纲-万字版，88 分，user-authorized 白标资产）接入大纲生成通道：私表模板 + manifest 层 technique 条目（planner/project/outline-source→outline-candidate）。配套 `OUTLINE_MAX_TOKENS` 8192→32768（万字级技法完整输出需要，16k 仍截断）。产出候选两版存入大纲治理待用户裁决：100 章/18 万精修版（`4e10c5b7`，重构器）与 60 章/18 万架构方案（`de0234c0`，百万字大纲法）；380 章细纲库主纲维持 active 未动。
- ** licensed 语义修正**：`licensed` = 自有付费版块内容（非外部授权）；宝可梦套牌=用户自选题材（商标风险用户自担，维持套牌定位）。
- **257 全部收口（2026-09-20 第二轮）**：Step 3 新书默认流程落地——`/api/db` 建档漏斗 `preflightNovelEntity` create 分支注入 `activeFlowId: 'generic-novel-flow'`（仅新建且无 v3 档案；显式清除/服务端内部直建不注入，6 用例锁定语义），合并后主干后端 1232/1232。
- **258 散卡层治理 DONE（2026-09-20 第三轮，已合并）**：占位空壳评分封顶 60（47 张，占位卡 ≥70 分归零）+ featured 守卫（featured 25→14，占位/残缺清零，平均分 76）+ 幂等与守恒验证（总数 127、licensed/白标层零变化）。执行者基于证据否决计划建议的 120 字阈值（会误伤 9 张真实卡），校准为副本级 80 字 + 源级标记判定。合并后主干后端 1243/1243。
- **259 功能类单卡内置扩容 DONE（2026-09-20 第四轮，已合并）**：用户产品规则「题材/渠道类=付费，构架/审查/评估/写作质量类单卡=内置」。3 张双层翻转：bible-world-builder 96（构架·设定，付费旗舰按规则免费化）、opening-novelty-hook 92（评估·开篇质检）、de-ai-rhythm-restorer 92（写作质量·去AI）。迁移脚本扩至 7 源 id 并放宽 licensed→built-in 谓词（存量 bible 克隆为 licensed 期产物），生产库迁移 1 行幂等。官方组 11→14。付费版块新叙事：题材包（克苏鲁/古言）+ 平台包（番茄/海外/老福特）+ 完整链路管线。合并后主干 1243/1243 + 前端 145 文件全绿。

- **S7 dev-token 生产 bundle localhost 启发式**（main.tsx:15）：服务端双重 opt-in + loopback 绑定已兜底，防御纵深改进，暂缓。
- **S8 SSE token 走 query string**（db-transport.ts:170）：同第 30 轮排除结论（已治理口径），EventSource 平台限制，暂缓。
- **S9 JSON 抽取无尺寸/危险键防护 + catalog freshness 守卫为脚本手工镜像**：本机单用户风险低；守卫镜像随 236 遗留债（两份 sanitizer 合一）一并观察。
- **T4 db-transport 重连零直测 / T5 shared/lib 六库零直测 / T6 job 测试真 sleep flaky / T7 components.test.tsx 巨型杂烩**：测试建设 backlog，随触碰对应模块时补。
- **D2 npm 12 与 Node 22.22 版本错配告警**：环境项，已随 255 在 MEMORY.md 登记。
- **查证干净、勿再作为发现上报**：渲染层 XSS 面（ReactMarkdown 安全默认/无 dangerouslySetInnerHTML）、Electron 四开关 + IPC sender 校验、SQL 全参数化、db 导入校验链、认证 fail-closed、zip/docx 预检、dev-token 服务端双重 opt-in、16 个 INKFLOW_* env 无 fail-open、生产运行时依赖零漏洞（5 条通告均在 dev 工具链）。

---

## Round 46（2026-09-28）：能力卡 / 链路 / 图谱收口 —— P0 剩余 + 链路真实化 + 长尾（262）

来源：会话「诊断审查项目进度与遗留问题」取证（`scratch/auditA-fields.py`、`auditB-prod.py`、`auditC-chains.py`、`auditD-dead.py`、`auditE-effect.ts`、`capB-chain.ts`、`capD-sanitize.ts`、`g2-guard-probe.ts`）+ 规格 `docs/specs/capability-flow-graph-consolidation.md` 各节「残余」汇总。前置：Plan 261 知识谱系、四批次收敛 `7e0efc7`。

| 编号 | 标题 | 状态 | 依赖 |
|---|---|---|---|
| 262 | 能力卡 / 链路 / 图谱收口（plans/262-capability-flow-graph-closeout.md）：批次 A 在制品收口（提交 P0-① 单元 + creation-entry 规格状态回填）；批次 B P0 剩余（B1 护栏假控制语义、B2 评分口径显性化、B3 清洗滞留清账）；批次 C 链路真实化（C1 cardRef 挂真实步骤、C2 旧 qualityGate 收敛、C3 人物/道具/副本维度补卡、C4 死字段与半接线清理、C5 步骤引用图谱能力卡）；批次 D 长尾（14 步仅引导、伏笔面板入口、章节回滚 stale、记忆健康度补完、长篇基线补完、三字段 UI 写入口）；批次 E 需拍板（push 凭证、M6 打包模型路径、M7 Node/npm 版本、M2 会话隔离、双账本 DOCS-3、真实数据缺口、架构图集漂移） | ✅ 已完成（2026-09-28；E1 push 需用户、E6 复测待真实样本） | 261、7e0efc7 |
| 263 | 收口与真实化（plans/263-closeout-and-truth-up.md）：P0 E6 门禁+提交 / E1 push（需用户）；P1 账本对账（262 批次 A 行回填、「需解锁」契约面结案、诊断文档时效标注）；P2 批 D 长尾 D1+D3–D6；P3 批 E 拍板 E2–E5+E7 | ◐ 待收尾（P0 E6 ✅ / P1 对账 ✅ #2#3#4；E2 ✅ / E3–E5 ✅ / D1+D3–D6 ✅ / E7 ✅） | E1 需用户 `gh auth login` 后 push（唯一残留） |

### Round 46 关键事实（防重复审计）

- P0-① 已交付：装配三字段（`projectCards`/`chapterCards`/`singleRunCard`）运行时接线，`tests/capability-assembly-runtime.test.ts` 8/8、装配单测 11/11、后端全量 1396/1396、快照六场景逐项不变（规格 §4.2.3）。残余：三字段无界面写入口。
- B1 已交付（2026-09-28）：护栏“净增语义”单源 `shared/lib/guardrail-scope.ts`（判据 + 审计）＋面板「已声明但未产生净增（N）」回执＋`SkillsStudioView` 计数只认真实生效的增强护栏；实测 `core-slop-shield`/`square-13`（引用壳）配置后 stagePrompts 逐字节不变，`de-ai-tells-guard` writer 541→948、`private-162` writer 541→710；`tests/guardrail-scope.test.ts` 5/5、`src/tests/guardrail-policy-panel.test.tsx` 4/4、后端全量 1401/1401、前端全量 157 files/1007 tests、快照六场景逐项不变（规格 §5.12）。残余：写路径仍宽松（存量兼容）；附带发现 `src/lib/capability-governance.ts:1` 引用源目录模板（疑似绕过模板剥离面）已登记待拍板。
- B2 已交付（2026-09-28）：评分口径单源 `shared/lib/prompt-score-policy.ts`（分档 A≥90/B≥80/C≥70/D≥60/F<60；门槛 ≥70 可装配 / 60–69 仅候选 / <60 不可用）接线 5 处（sanitizer / 治理目录出口归一 / 生成管线 / 渲染层 4 处假兜底 / QualityTab 口径行+徽标）；修正 7 张漂移卡（`private-197/195/161/106` 56 分 D→F、`opening-templates-library`/`knowledge-extract` 78 分与 `foreshadow-settle` 76 分 B→C），公开目录重生成 51 行全为 grade 行；`tests/prompt-score-policy.test.ts` 6/6、`src/tests/quality-tab-score-policy.test.tsx` 1/1、后端定向 58/58、前端定向 43/43、快照六场景逐项不变（规格 §5.13）。
- B3 已交付（2026-09-28）：目录滞留清账单源 `scripts/lib/catalog-disposition.ts` + 可复跑报告 `scripts/report-catalog-hygiene.ts`；179 张 = public 132 + sanitized-copy 33 + duplicate-absorbed 6 + declared-internal 8（垃圾标题 6 / 渲染空标题 1 / 测试夹具 1）+ unclassified 0；41 张「通过准入未上架」= 33 副本 + 6 换皮 + 2 夹具，13 张「needs-sanitization 无副本」= 6 换皮被吸收 + 7 明确不公开；`tests/catalog-disposition.test.ts` 6/6、后端全量 1413/1413（+6）、快照六场景逐项不变（规格 §5.14）。（目录随后因 C3 维度补卡扩至 182 = public 135 + 33 + 6 + 8，见 C3 行）
- C1 已交付（2026-09-28）：5 条平台链路各 ≥1 步挂 `cardRef`（共 6 步，planner 4 / writer 1 / critic 1）；卡片正文进声明阶段 prompt，assetId 回退保留；`tests/flow-step-card-mounts.test.ts` 8/8；快照仅 `flow-square` planner 由 `5dde5c7b(68)` 变为 `47eae3c5(240)`，其余五场景逐项不变；后端全量 1421/1421（+8）（规格 §5.15）。
- C2 已交付（2026-09-28）：双门合一 —— `FlowStepGate` 增 `advisory` 文本门 + `note`，删除旧 `qualityGate` 字段；30 步文案迁入 `gate.note`（28 advisory / step5 mechanical / step6 critic 80），提示词与 UI 走 `flowStepGatePromptText` / `flowStepGateDisplay` 单源出口；脱敏改为按路径 `gate.note`；`tests/flow-step-gate-migration.test.ts` 5/5、前端门用例 7/7、生成物 diff 116/32 全为 gate 行、快照六场景逐项不变、后端全量 1426/1426（+5）（规格 §5.16）。
- C3 已交付（2026-09-28）：维度补卡 —— 新增三张自撰内置卡 `character-arc-dossier`（人物弧光档案 84）、`relic-system-designer`（道具与遗物体系设计器 82）、`arc-instance-designer`（副本（事件单元）设计器 80）；人物维度改用小飞鸡 step3 换资产（`square-183` → 新卡并删 `guidanceOnly`），道具/副本以**追加**步骤落在天马 step5/step6（不动既有编号与 id）；新输出 `artifact-list` / `arc-units` 登记为 planning 类；读数 32 步 / 可运行 19（59.4%）/ 仅引导 13、人物·道具·副本各 1 步且均可运行、被引用资产 24/182；去向分布随之变为 182 = public 135 + sanitized-copy 33 + duplicate-absorbed 6 + declared-internal 8；后端全量 1426/1426、前端全量 158 files/1008 tests、快照六场景逐项不变（规格 §5.17）。
- C4 已交付（2026-09-28）：死字段与半接线清理 —— ① `foreshadowingTasks` / `payoffNote` 接线进 critic checklist（逐条伏笔任务 + 回收安排）；② 删 `ExecutionSnapshot.sessionCards`（同值拷贝、零非测试读方）；③ `techniques` / `skillStack` 接线：`ProductionExecutionReceipt` 增可选两字段（卡组主卡/作品卡/章节卡 id + 三阶段技法 id）、`ProductionRunReview` 新增「卡组装配」「技法」两行、`production.ts:1004-1019` 阶段收据 `itemCount` 补 `techniqueCount`；`tests/plan262-c4-deadwiring.test.ts` 4/4、`src/tests/production-run-review.test.tsx` 17/17、后端定向 16 文件 158/158、tsc 0 / eslint 0（规格 §5.18）；后端全量 **1430/1430**（+4）、前端全量 **158 files / 1009 tests**（+1）、快照六场景逐项不变（规格 §5.18）。残余：快照 `techniques`/`skillStack` 字段仍无运行时读方（消费的是局部变量）。
- C5 已交付（2026-09-28）：步骤引用图谱能力卡 —— 新增能力引用解析面 `shared/lib/flow-step-capability-ref.ts`（六类诊断码，判定与执行内核同源）；`SkillSeriesFlowStep` / `ExecutionFlowStep` 增只读 `capabilityRef`（+ `capabilityWarning`），`buildFlowStep` 暴露元数据且**能力步骤不再拼接工具卡正文**（`assetPrompt` 只留步骤合同）；目录落两步：拆书 `step3` 知识谱系抽取（`knowledge-extract`，planner）、小飞鸡 `step9` 伏笔回收诊断（`foreshadow-settle`，critic），均 advisory 门 + `navigateTo: bible`；`PlanningTab` 增「可执行能力」运行入口（`runKnowledgeCapability` + `summarizeKnowledgeCapabilityResult`）；读数 34 步 / 可运行 21（61.8%）/ 仅引导 13、引用资产 26/182；`tests/flow-step-capability-ref.test.ts` 6/6、`src/tests/planning-tab-step-capability.test.tsx` 4/4、`src/tests/planning-tab-step-progression.test.tsx` 23/23、后端定向 8 文件 89/89、tsc 0 / eslint 0（规格 §5.19）；后端全量 **1436/1436（+6）**、前端全量 **159 files / 1014 tests（+1 文件 / +5 用例）**、快照六场景逐项不变。残余：只支持作品级同步动作（服务端 run 路由仅两张卡，`_NO_KERNEL` 为硬边界）；运行结果不落库；`capabilityRef` 尚无回执 / 审计消费方。
- 消毒缺口收口（2026-09-28）：渲染层目录边界 —— `src/lib/capability-governance.ts` 不再 import 源治理目录
  （含 `template` 全文），改消费生成产物 `PUBLIC_SHELL_CATALOG`（`shared/lib/public-skill-catalog.ts`：全量源资产、
  模板物理清空、生成期固化 `isShellBody` 承载模板派生语义）；`RUNTIME_STYLE_CATALOG = [...PUBLIC_SHELL_CATALOG, ...SANITIZED_SKILL_COPIES]`；
  生成管线 `scripts/lib/public-catalog-pipeline.ts` 增 `shellCatalog`（去重顺序源目录优先）。守护 `tests/renderer-catalog-shell.test.ts` 7/7
  （静态边界 / 无正文 / id 覆盖 / 字段零漂移 / 壳标记与「引用壳」分类两侧一致），守卫组 24/24、前端定向 12/12；
  规格 `docs/specs/capability-sanitize.md` 新增不变式 3。附带发现：「需解锁」白名单实测 0 条 = **恒为 0 的正确契约**（Plan 263 #3 结案，2026-09-28）：空分组不渲染，契约见 `src/tests/skills-studio-plan158.test.tsx:1856`。
- D2 已交付（2026-09-28）：伏笔面板图谱维护入口 —— `ForeshadowingPanel` 折叠条「图谱维护：资料包知识谱系」，
  展开按需挂载 `KnowledgeMaintenancePanel`（未展开零请求）、`onCompleted` 重跑后刷新伏笔列表；
  `src/tests/foreshadowing-graph-entry.test.tsx` 4/4、受影响面 3 文件 9/9。
- E6 复测工具已就绪（2026-09-28）：激活漏斗离线报告 —— `server/lib/db/product-events.ts` 抽纯函数
  `buildProductEventMetrics`（与 `/api/product-events/metrics` 同源）、CLI `scripts/report-activation-funnel.ts`
  （读导出 JSON，不碰数据库）、runbook `docs/research/activation-funnel-runbook.md`；`tests/activation-funnel-report.test.ts` 4/4。
  E6 仍未关闭：样本是操作者狗粮，待真实用户数据。
- 263 立项（2026-09-28）：Plan 262 剩余批次 + 遗留拍板的收口计划。P0 在飞 = E6 门禁+提交（工作区 6 项未提交：`server/lib/db/product-events.ts` / `scripts/report-activation-funnel.ts` / `tests/activation-funnel-report.test.ts` / `docs/research/activation-funnel-runbook.md` / `plans/262-capability-flow-graph-closeout.md` / `plans/README.md`）；P1 账本对账 = 262 批次 A1/A2 行仍显示 IN PROGRESS/TODO（实为已交付 `9a2c234`，规格 `docs/specs/creation-entry-convergence.md:4` 已标已交付）+ 「需解锁」白名单实测 0 条（恒为 0 契约面，已结案）+ `docs/architecture/remediation-plan.md` M1/M5-1 与 `architecture-review.md` 时效标注。
- E3/E4/E5 交付（2026-09-28，Plan 263）：版本声明单源 —— pin `.nvmrc`/`.node-version` = `22.22.3`、`engines` = `>=22.22.3 <23`、CI 四处 `node-version-file: .nvmrc`，守卫 `tests/node-version-declaration.test.ts` 2/2（本地 Node 22.22.0 < floor，需 `fnm install 22.22.3`）；「单 checkout 串行写入 + 每单元提交」两条硬规则并入 `docs/specs/multi-agent-workflow.md`；`docs/plans/README.md` 冻结为只读存档（唯一权威 = 根账本）。
- D3 已交付（2026-09-28，Plan 263）：章节版本指纹（stale 打标）—— `chapter_versions` 增 `content_hash`（建表 + `ensureColumn` 迁移），`hashChapterContent` 为 sha256 原文口径（不归一化），两条写入路径（CRUD `insertColumns` + accept 前置快照 raw INSERT）补列，`listChapterVersionMetas` 增 `contentHash` / `matchesCurrentContent`（NULL → 旧快照），时光机卡片徽标「＝ 当前正文 / ≠ 与当前正文不同 / 来源未知（旧快照）」；`tests/chapter-version-content-hash.test.ts` 5/5、`src/tests/agent-workspace-versions-panel.test.tsx` 3/3、tsc 0 / eslint 0。附带修正：`AGENTS.md:26` 定向后端测试命令补 `NODE_ENV=test` + `--import ./tests/helpers/test-db-preload.ts`（漏掉会关闭配额门禁路径造成假失败）。
- D1 已交付（2026-09-28，Plan 263）：仅引导步骤补正文 —— 为 7 个「无 cardRef 的仅引导步骤」（番茄 step4/5、风华 step2/3/5、天马 step1/2）新增 7 张自撰内置卡并改指 `assetId`（删 `guidanceOnly`，不改任何转投壳）；读数 34 步 / **可运行 28（82.4%）** / 仅引导 6（番茄 2 / 天马 1 / 风华 1 / 小飞鸡 1 / 拆书 1）；目录 189 = public 142 + sanitized-copy 33 + duplicate-absorbed 6 + declared-internal 8（built-in 20→27）；引用资产 28/189；残余 = 余 6 步为已挂 cardRef 的步骤（卡正文已进提示词但 assetId 仍为壳）；`tests/flow-step-guidance.test.ts` 76/76、后端全量 **1456/1456**、前端全量 **161 files / 1022 tests**、快照六场景不变、tsc 0 / eslint 0（规格 §5.21）。
- E7 已交付（2026-09-28，Plan 263）：架构图集补章 —— `docs/architecture/inkflow.architecture-understanding.md` 新增「十一、知识谱系」（续写资料包 → `foreshadowings`/`entity_relationships`（幂等、提案制）→ `loadForeshadowingContext` 接 planner/writer/critic 与 `buildStoryStateLedger` 接章节合同 → 知识能力执行端点 → 记忆健康度五项含欠账阈值 12）与「十二、能力链路」（6 条技能序列流 / 34 步 → 三通道：资产正文 / `cardRef` / `capabilityRef`（不注入提示词）→ `buildFlowStep`+`flowStepPromptFor` 装配 → 门三类 → 读数 28/34（82.4%）/ 仅引导 6）；两节明标取证日 2026-09-28 / `4b68c24`，文件顶部与 `docs/architecture/README.md` 加复核行；修正「未安装 Graphviz」旧述。
- D5/D6 已交付（2026-09-28，Plan 263）：D5 长篇记忆基线**降级为技术债**（只登记：合成长书样本 / 回声口径「token 是否进请求」/ planner·critic 未纳入 / 未接 CI；触发条件 = 真实长篇样本到手后重跑 `scripts/long-memory-baseline.ts`）；D6 装配三字段（`projectCards`/`chapterCards`/`singleRunCard`）**标为内部**（只经 profile 写入，不做 UI 写入口）并移除 UI 固定额度文案 —— `src/components/Library.tsx:265` `能力卡 N/3` → `能力卡 N`（`/3` 不对应任何强制上限）；规格 §4.2.4 + §5.22 + §5.10 拍板行；`src/tests/library-refresh.test.tsx` 断言同步。
- D4 已交付（2026-09-28，Plan 263）：记忆健康度告警阈值 —— 阈值单源 `MAX_ARREARS_IN_PROMPT = 12`（`shared/lib/knowledge-capabilities.ts`，原为 `server/helpers/knowledge-lineage-enrich.ts:175` 的本地常量，两个消费者同源）；面板扩为**五项**指标（新增「伏笔欠账」，与 `buildForeshadowSettlementChecklist().arrears` 同源）；越线置 `severity:'warn'` + 阈值说明「超过核对清单注入预算（> 12 条）」，面板用琥珀 `text-amber-700`（与「未知」的 `text-amber-800` 可区分）；其余指标只显示数值 + 未知降级，整体阈值口径挂 E6 真实数据；后端 6/6、前端 5/5 + 2/2、tsc 0 / eslint 0。
- 效果矩阵实测：只有「卡组主卡 / 作品技法 / 切换链路」真正改变三阶段 prompt；`projectCards`/`chapterCards`/`singleRunCard` only 场景 Δ 全 0（接线前）；`guardrailIds` 配 core-default 卡 Δ0（假控制）。
- 护栏通道：12 张 core-default 无条件注入（基线 writer 已含 7 个护栏块）；唯一 `stage=review` 护栏 `review-schema-v2` 是壳卡被过滤 → critic 永无护栏。
- 链路面：30 步可运行 16/仅引导 14；引用资产 22/179（runtime-ready 133 张中 111 张从未被引用）；cardRef 实例 0；旧 `qualityGate` 30 处仍进提示词 vs 新 `gate` 2 处（诊断时读数；C1–C5 后：34 步 / 可运行 21（61.8%）/ 仅引导 13、引用资产 26/182、cardRef 6 步、能力引用 2 步、`qualityGate` 已删；见各 C 行）
- 清洗面：179→132 公开；拒 6 张；41 张通过准入却不在公开目录；46 张 needs-sanitization 中 33 张产副本、13 张永不产副本。
- 新登记残余（2026-09-28 复核，非 262/263 范围）：适合度分的「使用反馈」通道仍未接线 —— Plan 241 已交付反馈聚合与采集点（`ChapterCapabilityFeedbackBar` → `skill_usage_records` → `syncSkillFeedbackScores` → `feedbackScore`），但唯一生产调用点 `src/components/skills/StyleShelf.tsx:172` 只传 `{ novelGenreTokens, novelPlatform }`，`src/lib/capability-shelf.ts:263-271` 在无样本时改走权重重分配（题材 +12 / 平台 +8）→ 公式里的 20 分反馈项在生产路径上永不生效；接不接属产品决策（若接入，须同时满足 Plan 150 的展示约束：冷启动分与使用反馈分两通道分开展示，不得显示成统一质量分）。证据：全仓 `computeCardFitness(` 调用点仅 1 处生产代码。
- 审计修正（2026-09-28）：账本落后提交计数（115/134 → 147）、`plans/263` 执行记录 8 行补提交 hash + 3 行收尾提交登记、`plans/262` 批次 E 三行与 `plans/263` P2/P3 表格列数修正（审计发现，详见本行下方 E2 条目之后）
- E2 已交付（2026-09-28，Plan 263）：打包态嵌入模型路径 —— 拍板①随包附权重。单源 `scripts/lib/embedding-weights.mjs`（模型 id / 4 文件清单 / ≥20 MB 判据）+ `scripts/fetch-embedding-model.mjs`（来源：本地 `INKFLOW_MODEL_SOURCE_DIR` → `node_modules/@huggingface/transformers/.cache` → HF Hub；`SKIP_EMBEDDING_MODEL_FETCH=true` 跳过）；`package.json` `model:fetch` + `package` 链插取权重 + `build.extraResources` → `resources/embedding-model/`；`server/embedding.ts` `resolveEmbeddingAssetPaths`（齐备 → `localModelPath` + 关远程；不全 → 只设 `cacheDir`）+ 就绪日志打印 `{ localModelPath, cacheDir, allowRemoteModels }`；`electron.cjs` 打包态注入 `INKFLOW_EMBEDDING_MODEL_DIR` 与 `INKFLOW_MODEL_CACHE_DIR`（userData/models-cache，dev 不注入）；`scripts/check-package-artifacts.mjs` 增权重断言。读数：取权重 4 文件 23.3 MB 全部来自本地缓存、tsc/lint 0、`tests/embedding-model-assets.test.ts` 9/9、受影响面 23/23。残余：打包态真机验证需联网（`npm run package` 拉 Electron 头）。
- 审计（2026-09-28，用户指令「审查已完成和未完成的任务清单并对已完成项评估遗漏和错误」）：全量后端 `1465/1465`（35 suites，275,783 ms）、全量前端 `161 files / 1022 tests` 全绿；静态 52 项检查 0 FAIL；发现并处置 12 类偏差（账本计数 115/134→147、hash 缺失、表格列数、前置引用不准、A1/A2 重复 ✅→ `a8e5956`；诊断文档 M2/M6/M7 与「仍开放」表→ `d20093f`）；结构性发现：**2026-08-29 存档重根**（根提交 `68c9004`，见 `docs/recovery/RECOVERY.md`）导致第 1–29 轮基准 hash 不可解析（不可解析：`dff4445` / `f4eac24` / `32a6b40` / `93b9b01` / `11c870d`）→ `plans/README.md` 已登记「审计基准的可解析性」说明；关闭 4 项（前端 2 失败用例 / 性能结论 / F5 三 handler 均为权威写入 / F7 `Scene` 死模型），F6（读层无内容级消毒）与 F9（缺生产分布）维持开放。本轮未入库（沿用规格声明）：核心读数脚本（`scratch/capB-chain.ts` / `scratch/stageprompts-snapshot.ts` / `scratch/flow-audit.ts` / `scratch/card-role-coverage.ts`）仍在 `.gitignore:44` 覆盖下（规格§1192 已声明，非新发现）；E6 已示范正确做法（`scripts/report-activation-funnel.ts` 入库 + runbook）
