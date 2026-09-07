# 009 — 收尾批次：005-S4、文案收敛与挂起项清零

> 生成：2026-09-07。来源：批次复核后的任务盘点（独立复核见 `docs/research/2026-09-07-batch-verification.md`）。
> 前置事实：001~006 与 007 的 T1/T2/T3/T5 已完成并有验证背书；本计划只收剩余。

## 任务盘点（三类）

### A. 修复类小项
| # | 项 | 出处 |
|---|---|---|
| A1 | git push 备份未完成：github.com:443 不可达（无代理配置）；已用 `git bundle` 做本地备份 `../inkflow-backup-20260907.bundle` | 网络环境 |
| A2 | ~~词表接入~~ ✅（2026-09-07）：AiCandidateReview（到工作台处理）与 WritingSurface（primaryAction 9 动作映射收编为 getWorkflowPrimaryActionLabel）已接；EditorGuideBanners 的动作横幅此前已删，ProductionTab:233 是内容标签非动作词——T4 可关 | 007 T4 |
| A3 | ✅ 实测术语收敛已完成：职责卡/偏好技法/技能系列/流程卡 在组件层均为 0 命中（plan158-frontend-cleanup 的禁词表长期强制）；glossary.ts 保持规范性文档定位 | 006 |
| A4 | 状态条 quick 模式 quickWritten 瞬态未跟踪（接受后候选横幅消失、状态条随之消失，观感可接受） | 006/008 |
| A5 | 测试下界断言 ≥45/≥73 偏弱（有意为之，防脆弱；记录不修） | 评审 P2 |
| A6 | EditorView 2 处 console.error 系 2026-08-29 既有日志（非本批，不修） | 复核扫描 |
| A7 | 004 `resolveSlotForCard` 未抽纯函数（落位语义由 addCardToProjectDeck 承担，已声明，不修） | 004 |

### B. 未完成（计划内主力）
| # | 项 | 说明 |
|---|---|---|
| B1 | 005-S4 writingStyle 域入 store | ✅ 展示态完成（resolution/candidates/error 入 store、三层透传拆除、死 prop 清理）；hooks 参数收窄按计划边界后置 | 005 |
| B2 | 005 profiler 手工取证：React DevTools 确认击键不重渲染 AgentWorkspace | 005 |
| B3 | 006 术语渐进替换（按 glossary 高频旧词逐面收敛）+ 空状态 CTR（"暂无智能建议"→可点击） | 006 |
| B4 | EditorView props 87→≤60：依赖 B1（writingStyle -4）+ outline/beats 域迁移（视余量另立） | 005 完成标准 |

### C. 待决策 / 待批准（不排期，需用户拍板）
| 项 | 卡点 |
|---|---|
| react-window 虚拟化（生产历史/章节导航） | 新依赖需批准 |
| Google/OpenAI 超时重试策略统一 | 运行语义变更 |
| writerModel 设置 UI | 等埋点证明失败主因 |
| 草稿机整体退役 | 先定三个暂存流（待替换候选/拆书卡落位/编辑器保留草稿）归宿 |
| 驾驶舱与工作台合并 | 建议不动（launchState 已打通） |
| 能力包 vs 单卡合并 | 等埋点（包展开率 vs 直接启用） |

## 实施顺序（建议）

```
A1 补推（网络恢复即做，1 分钟）
 ↓
B1 writingStyle 域入 store（独立一批，先读留存化调用链）
 ↓
A2+B3 文案收敛批（词表接入 + 术语替换，一次性过完所有高频面）
 ↓
B2 profiler 取证 + B4 props 复核（若 B1 后仍未达标，另立 outline 域批）
```

## 验证基线（每批后）

`npx tsc --noEmit` 0；`npx eslint 改动文件` 0；前端 vitest 全绿（当前 839）；后端 npm test 全绿（当前 1153）；git push（网络恢复后）。

## 边界

- 不动写法确认留存化（resolveWritingStyleRequest）与服务端 API 语义
- 不引入新依赖（react-window 另批审批）
- B1 动手前必须先输出 writingStyle 调用链清单（哪些消费 fingerprint/confirmed）
