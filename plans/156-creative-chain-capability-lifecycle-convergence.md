# Plan 156 - 创作主链与能力生命周期统一治理

## 状态

- 当前状态：DONE
- 执行顺序：P0 执行正确性 -> P1 前端收敛 -> P2 大纲与评分治理 -> P3 验证与发布复核
- 历史依据：Plan 150 / 152 / 155 仅作为既有实现证据，不代表本计划验收通过

## 目标主链

```text
立项摘要
-> Canon / 主大纲
-> 唯一 Flow
-> Planner / Writer / Critic
-> 卷章细纲与分镜
-> 本章 Overlay
-> 写法确认
-> 正文
-> 审稿与精修预览
-> 版本接受 / 下一章
```

手写、保存、切章、导出与版本恢复不得被 AI、Flow、技能、资料包或写法确认阻断。

## P0 - 关闭错误副作用

- 建立唯一能力 Manifest，明确 `flow / role-skill / overlay / utility / guardrail` 的阶段、动作、持久性和副作用。
- Flow 每部作品仅一个 active；Role Skill 只进入显式允许的 Planner / Writer / Critic 槽；Overlay 只进入本章会话。
- 移除平台诊断到 `cockpit-polish` 的错误映射。
- Utility 诊断只返回报告；转换只返回预览和正文基线哈希，不直接写正文。
- Overlay 从能力页直达 Editor，启动状态只消费一次；作品或章节不匹配时拒绝执行且保留正文。
- 写法来源或模式变化立即 stale，重新 resolve / confirm 后才能生成。
- 开书确认单只提交勾选项，持久化成功后才能显示成功。
- 修复 SkillCard 嵌套交互控件和键盘语义。

## P1 - 前端旅程收敛

- 权威入口统一为“写法与能力”，展示 Flow、三角色槽、本章临时参考卡、系统护栏执行凭证。
- 能力页负责浏览和管理，驾驶舱负责下一步，Editor 负责执行，智能管家负责阶段详情。
- 统一工作流展示 registry，禁止向用户显示内部枚举。
- 助手产品名统一为“智能管家”。
- 资料包同时显示审核状态与本章接入状态；动作统一为“接入本章上下文”。
- 首次开书收敛为“立项摘要”；Beta 能力只展示来源、授权和 Beta，不展示未实现的购买或会员承诺。

## P2 - 大纲、拆书卡与评分治理

- 大纲中心采用一个主输入和最多五份参考；报告不得作为主纲；AI 结果先保存为 candidate，显式确认后才成为 active master。
- 大纲技能读取 active master，输出 candidate 细纲或 Canon Patch。
- 拆书 Deck 保留组关系，按卡片真实阶段装载；节奏/平台卡由用户选择 Planner 或 Writer。
- 评分拆为治理门禁、冷启动证据、真实使用反馈和场景适配；Flow 使用完成率和质量门，不与卡牌共用总分。

## P3 - 验证与发布复核

- 验收覆盖动作后的状态、请求、副作用、返回与恢复，不再只验证按钮可见。
- 测试数据库使用 `:memory:` 或独立临时 SQLite，禁止访问运行中的 `data.db`。
- 产品事件不得记录 Prompt、正文或资料包原文。
- 最终门禁：typecheck、lint、后端/前端测试、build、桌面/移动 Playwright、audit、diff check。

## 多 Agent 边界

- Backend：Manifest、Utility 预览、阶段与大纲源校验、后端测试。
- Frontend Capability：写法与能力页面、角色槽、Overlay 意图、写法 stale、可访问性。
- Frontend Journey：立项摘要、阶段文案、资料包双状态、大纲中心。
- Coordinator：共享导出、AppShell / EditorView / AgentWorkspace 交叉接线、差异审查和最终验收。

## 验收门禁

```bash
npm run typecheck
npm run lint
npm test
npm run test:frontend
npm run build
npx playwright test --project=chromium
npx playwright test --project=mobile-chromium
npm audit --omit=dev
git diff --check
```
