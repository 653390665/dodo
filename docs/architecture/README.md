# InkFlow 架构图集

当前状态（as-is）架构模型 ＋ 风险诊断。取证日期 **2026-09-18**，HEAD `84fb175`。
风险诊断期间 HEAD 被另一会话移到 `20f914c`：结构类断言仍按 `84fb175` 读，
凡涉及工作树状态的结论见 `architecture-review.md` 的 R4 / R10。

## 从哪开始

- 想理解系统 → 先读 [`inkflow.architecture-understanding.md`](./inkflow.architecture-understanding.md)（业务语言优先，其余文件是它的图与证据）
- 想知道该修什么 → 读 [`architecture-review.md`](./architecture-review.md)，处置排序在 [`remediation-plan.md`](./remediation-plan.md)

## 文件清单

| 文件 | 回答什么问题 | 视图层级 | 生产者 |
|---|---|---|---|
| `inkflow.architecture-understanding.md` | 这是什么系统，边界、机制、牵连点、未知项 | L1–L3 叙述 | system-modeler + flow-visualizer + business-application-fitness |
| `inkflow.evidence.md` | 每条断言的证据、置信度、结构 vs 行为之分 | 证据索引 | 同上 |
| `inkflow.structurizr.dsl` | 谁在用、越过哪条边界、由哪些可部署单元组成 | L1 上下文 + L2 容器 | c4model |
| `module-map.dot` | 分层与依赖方向（含被禁止的方向） | L3 模块 | system-modeler + graphviz |
| `flow-chapter-candidate.dot` | 创作意图如何变成落库正文（作者视角） | 业务流程 | flow-visualizer + graphviz |
| `candidate-store-model.dot` | 四类候选、四套存储、四条确认端点 | 技术下钻 | flow-visualizer + graphviz |
| `lifecycle-states.dot` | 哪些状态机真的在迁移，哪些只是类型声明 | 状态 | flow-visualizer + graphviz |
| `runtime-topology.dot` | 三种启动形态下的进程/端口/文件/网络 | 运行时 | deployment-topology-analyzer |
| `architecture-review.md` | 哪些地方正在伤到产品承诺，各值多少优先级 | 风险 / 质量属性 | risk-quality-reviewer |
| `risk-map.dot` | 11 项风险如何牵连到 7 项能力 | 风险网络 | risk-quality-reviewer + graphviz |
| `remediation-plan.md` | 按什么顺序修，每条怎么算修完 | 处置 | risk-quality-reviewer |

## 怎么打开

- `.structurizr.dsl` → Qoder **Structurizr DSL 预览器**
- `.dot` → Qoder **DOT 格式预览器**

本仓库未安装 Graphviz，因此未产出 SVG。若要渲染：

```bash
brew install graphviz
dot -Tsvg runtime-topology.dot -o runtime-topology.svg
# DSL 渲染需 Structurizr CLI：https://docs.structurizr.com/cli
```

## 判读约定（所有图共用）

| 视觉 | 含义 |
|---|---|
| 实线箭头 | 有行为证据：路由 / 写函数 / SQL UPDATE / 测试断言 |
| 虚线 dashed | 失败、降级、异步分支 |
| dotted + `note` 框 | **仅声明未接线**，或已证实的缺口；不得当作既有业务环节 |
| `risk-map.dot` 节点填充色 | 处置优先级（红 P0 / 橙 P1 / 紫 P2 / 灰 P3），**不是严重度** |
| `risk-map.dot` 边的粗细虚实 | 粗=零容差项直接生效；实=直接牵连；虚=间接或条件性 |
| 红色区 | 被测试断言禁止的依赖方向 |
| 绿框 | 本机持久化，数据不出机 |

核心区分：**结构证据 ≠ 行为证据**。字段、枚举、外键存在，只证明模型容得下这个概念，
不证明有代码执行它。`lifecycle-states.dot` 的第 ③ 区专门收纳这类「声明但未接线」。

## 维护

- **`.dsl` 与 `.dot` 是事实源**。SVG/PNG 是派生物，不要手改导出来修正模型事实 —— 改源文件。
- 代码演进后需重检的高频位置：
  - `server/routes/index.ts` 的 register 列表（路由面）
  - `server/routes/db.ts` 的 `DB_WHITELIST` 计数（RPC 面）
  - `server/lib/db-init.ts` 的建表段（表数与 ensureColumn 加列）
  - `docs/specs/*.md` 四条技术不变式
  - `tests/architecture-boundaries.test.ts` 的例外白名单
- 以下变动会让图失效：新增第五类候选存储、消毒投影路径从两条变三条、引入版本化迁移框架、
  把版本回退从「前端组装的一次普通保存」改成服务端 restore 端点（或回退前补写快照）。
- 复核方式：重跑 `system-modeler` + `flow-visualizer`，对比 `inkflow.evidence.md` 的行号锚点是否仍解析。
  行号会漂移，函数名与文件路径更稳定 —— 优先按后者定位。

## 尚未覆盖的架构视角

本图集刻意**不包含**以下内容，需要时另起对应工作流：

- 目标态、ADR、迁移切片与顺序 → `evolution-planner`
- 变更爆炸半径（针对具体 PR / 分支） → `dependency-impact-analyzer`
- 图的新鲜度与可追溯性校验 → `architecture-health`
- 面向特定受众（管理层 / 新成员 / 外部）的讲述版本 → `architecture-communicator`

风险登记与技术债**已覆盖一次**（`architecture-review.md`，2026-09-18）。它是快照，不是常驻看板：
其中每条 P0/P1 的验收条件写在 `remediation-plan.md`，处置完成后应回写 `inkflow.evidence.md` 对应行，
而不是让 review 与代码长期背离 —— 本项目自己的台账已有先例（`plans/README.md` 的 ARCH-01 / CORR-02，见 R9）。
