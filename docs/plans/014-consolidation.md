# 014 — 全量收尾计划：能力卡体系整合（001~013 遗留 + PM 诊断落地）

> 生成：2026-09-09。来源：001~013 批次执行后全部遗留项 + PM 诊断（012）落地 + 并发会话推进。
> 前提：001~013 已完成并推远端，本地 ahead 2（fixture 修正 + 014 计划），851/851 前端 + 1153/1153 后端全绿。

## 当前态势

| 维度 | 状态 |
|---|---|
| EditorView → AgentWorkspace props | **62**（目标 ≤60，差 2） |
| 状态后端 | 6 个 store（production / writing-style / editor-generation / continuation-pack / outline-content / editor-data） |
| 生成旗标 | isGenerating* 四旗标 + isAcceptingAiCandidate 已入 store |
| 测试 | 前端 851 / 后端 1153，零失败 |
| 链路分块 | 6 链路 401 用例全绿 |
| 接缝矩阵 | J1-J7 全覆盖 |
| PM 诊断 | 012 已落档 |

## 已完成（001~013 全部关闭）

| 计划 | 状态 | 关键提交 |
|---|---|---|
| 001 单动词 | ✅ | c3f17d2 |
| 002 审稿三合一 | ✅ | d0ae4e5 |
| 003 护栏面板化 | ✅ | e71af0a |
| 004 消毒管线 | ✅ | 0008828 |
| 005 stores | ✅ Phase 1-4 | b508b22→8dcafb8 |
| 006 状态条+词汇表 | ✅ | ad852af |
| 007 T1-T6 | ✅ 关账 | 22b1406/2daa54d + c18328c |
| 008 接受断点引导 | ✅ | 9a4af0d |
| 009 接缝测试 | ✅ | 多批 |
| 010 接缝测试 | ✅ | f73b798 |
| 011 内容域键控 | ✅ Phase 1-4 | 605628a |
| 012 PM 诊断 | ◐ P1 二级分组 + P2 消重 + P3 适合度 chip 已落地 | 1160fc6 |
| 013 普查 | ✅ | bf3bb63 |
| 014 本计划 | 进行中 | — |

## 剩余任务全量清单

### 代码类（可自动化执行）

| # | 任务 | 优先级 | 来源 | 改动量 |
|---|---|---|---|---|
| 1 | 能力包去勾选化（默认全选可用步骤，用户取消不需要的） | P1 | 012 P0 | 小——但需拆分付费/stale 场景测试 |
| 2 | 写法确认失效透明化 toast（启用本章卡时附带提示） | P1 | 012 | 极小 |
| 3 | props 62→≤60：generationStatus + outlineError 迁 editor-generation-store | P2 | 005 | 中 |
| 4 | mountedSkillLoadout（@deprecated）确认下游无消费后删 | P2 | 005 | 极小 |
| 5 | pendingSkillIds / setPendingSkillIds 下放 | P2 | 005 | 小 |
| 6 | userIntent / setUserIntent 入 store（launchState 预填写入时机） | P2 | 005 | 中 |
| 7 | stepEvidence 派生下放 | P2 | 005 | 小 |
| 8 | 007 T4 词表渐进（AgentWorkspace 区 + QualityTab 区） | P3 | 007 | 小 |
| 9 | 006 glossary 渐进采用（代码消费，如 copy-conformance 测试） | P3 | 006 | 小 |
| 10 | 冲突面：双重注入验证（19 张双重身份卡） | P2 | 013 | 中 |
| 11 | 冲突面：getAssetEnhancementPackage 陈旧桥接修复 | P2 | 013 | 中 |
| 12 | 冲突面：opening-gold-three ≡ plaza-golden-three 合并 | P3 | 013 | 中 |

### 人工/外部

| # | 任务 | 卡点 |
|---|---|---|
| 13 | B2 profiler 取证（React DevTools 确认击键不重渲染） | 人工 |
| 14 | 运行时冒烟（011 状态后端迁移 + 013 货架改造） | 人工 |
| 15 | A1 补推 | 网络 |

### Phase 5b — 结构性重构（另立评估）

handler 归组 / EditorView 拆分（41 handler → ~28，props 62→~52）

### 待决策

草稿机退役 / react-window / 超时重试 / writerModel UI / 驾驶舱合并 / 能力包合并

## 本轮可执行项（按序）

1. 能力包默认全选（安全版：仅选 active 步骤，跳过 stale/restricted）
2. 写法确认失效透明化 toast
3. props 62→≤60（generationStatus + outlineError 迁 store）

完成后 props 估 ≈ 59-60，达标。
