# 链路分块测试报告（2026-09-08）

> 方法：pua-loop 门控协议（手动执行）——每块链路的验证命令原样跑、数字原样记录，先自证再落档；improve 纪律——本轮只测与诊断，不修改源码。
> 范围：6 条业务链路、30 个测试文件、前后端共 **401 个用例**，全部 fresh 实跑。

## 分块结果

| 块 | 链路 | 覆盖文件 | 结果（oracle） |
|---|---|---|---|
| A | 生成 + 大纲（生成流生命周期/动作状态/状态条/草稿安全/OutlineTab 行为/资料包状态/批准包 ID/章节导航/续写自动启动） | 9 文件 | ✅ **69/69** |
| B | 能力 + 消毒 + 授权（商店治理/信任/启动状态/配置会话/客户端/授权边界；后端：消毒 API、契约、授权边界） | 10 前端 + 4 后端 | ✅ **103/103 + 5/5** |
| C | 写法确认（客户端/控件；后端：门禁/解析器/校验/服务） | 2 前端 + 4 后端 | ✅ **6/6 + 48/48** |
| D | 审稿 + 完成（生产报告/质量问题单旅程/引导布局；后端：章节完成门禁） | 3 前端 + 1 后端 | ✅ **52/52 + 13/13** |
| E | 候选 + 助手（候选接受/助手会话/项目助手/批量缺口/会话存储/动作计划/缺口动作×2） | 8 文件 | ✅ **40/40** |
| F | 续写 + 生产持久（续写包×6 后端链路、章节生产、生产 run 持久化；前端导入视图/AB 迟到包） | 2 前端 + 8 后端 | ✅ **23/23 + 42/42** |

**合计：401 用例，0 失败。**

## 未覆盖（如实声明）

- 309 个测试文件中本轮只块跑 30 个；db-client、world/agents 生成、settings、idea、legacy 等链路外单元未在本轮分块内（但前后端全量套件昨日均实测全绿：839/839、1153/1153）。
- 运行时人工冒烟（浏览器实际点击）仍不在自动化覆盖内。
- 两项既有观察：`continuation-pack-job-recovery` 的"auto-syncs"用例在全量并发下出现过一次时序抖动（单跑/复跑均过）；EditorView 两处 console.error 为 2026-08-29 既有日志。

## 结论

六条核心业务链路（生成、能力、写法确认、审稿、候选助手、续写持久化）在本轮分块测试中**全部通过，未发现回归或缺陷**。链路级健康度与全量套件结论一致。

## 链路联动（接缝）测试与覆盖矩阵（同日追加）

**联动块实跑**（跨域联合测试，oracle 数字）：后端 `chapter-completion` + `capability-recommendation` + `workflow-state` = **17/17**；前端 `editor-completion-flow` + `book-factory-equip-sync` + `workflow-state` + `capability-client-boundary` + `agent-workspace-knowledge-panel` = **40/40**。合计 **57/57，0 失败**。

### 接缝覆盖矩阵

| 接缝 | 联动内容 | 背书测试 | 判定 |
|---|---|---|---|
| J1 能力启用 → 生产注入 | 启用写 profile（卡组/技法/护栏）→ 三阶段消费 | plan158（apply 断言）+ writing-style-service（后端注入侧 48 例） | ✅ 有背书 |
| J2 写法确认 → 生产流 | fingerprint 进 run/audit 载荷；确认要求 → 候选横幅 → 确认后 retry | continuation-autostart + writing-style-gates（后端）+ useAuditPolishActions 指纹路径 | ✅ 有背书 |
| J3 生产 → 完成审查 → 门禁 → 精修回写 | complete → gate → risk → issue 修复 → reviewState 重算 | chapter-completion(13) + workflow-state + quality-review-journey + editor-completion-flow(9) | ✅ 有背书 |
| J4 候选接受 → 质量门 → 写入 → **自动触发完成审查** | 接受链有门有测试；"接受成功后自动跑一次完成审查"这一跳无直接断言 | editor-candidate-acceptance（接受与门）+ editor-completion-flow（审查与门）各测半段 | ⚠️ 半覆盖 |
| J5 续写包 → 缺口 → 助手 → 设定候选 | continuation-gap-assistant-bridge + app-shell-batch-gap-assistant + db-continuation-pack | ✅ 有背书 |
| J6 消毒/授权 → 商店 → 启用落库 | 消毒端点+落库（后端 5 例）、启用→apply（plan158）；**"消毒后卡在商店可见并成功启用"的端到端一跳**无测试 | ⚠️ 半覆盖 |
| J7 状态条/各域 store 联动 | GenerationStatusBar 读 store + 各域写 store 的跨面传播 | generation-status-bar（组件级） | ⚠️ 仅组件级 |

### 联动缺口（建议立 010：三条接缝测试）

1. J4：候选接受成功 → 断言完成审查被调度/运行一次；
2. J6：消毒成功 → savedSkills 刷新 → 卡移出需解锁 → 走启用链路落库断言；
3. J7：production-store 写入 → GenerationStatusBar 四段在多组件间同步的传播断言。

