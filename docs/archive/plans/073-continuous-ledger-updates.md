# 实施计划: 落地连续性报告的历史状态自动更新 (073)

本计划旨在打通 AI 章节生成中的“连续性审计反馈”与“世界设定数据库”的闭环，实现产品层面的状态自动演进。

## 发现的产品功能缺陷
在 AI 生成章节后，`Planner/Critic` 会产出一份“连续性报告” (`continuityReport`)，其中包含了以下非常有价值的增量更新提议：
- **角色档案追加 (`characterUpdates`)**：例如在本章中，某角色“境界提升”或“身受重伤”，AI 会提议追加至人设卡片。
- **道具状态追加 (`itemUpdates`)**：例如某法宝被“消耗”或“损毁”，AI 会提议更新道具状态。
- **伏笔状态更新 (`foreshadowingUpdates`)**：例如本章收回了之前埋下的伏笔，AI 会提议将该伏笔状态改为 `payoff`。

然而，在后端的 `/apply` 接口中，**这些更新提议被完全忽略了**。只有新建伏笔和新建时间线事件被执行，导致用户的角色档案和伏笔状态永远无法自动演进，构成了严重的产品体验断层。

## 解决方案
- 在 `/apply` 路由的事务块中，正式加入对 `characterUpdates`、`itemUpdates` 和 `foreshadowingUpdates` 的解析与应用。
- 自动读取当前实体的历史内容，以换行符分隔追加新的增量描述，并更新时间戳。
- 若伏笔更新为 `payoff`（已收回），自动填充 `payoffChapterId` 为当前章节 ID。

## 变更文件

### [server/routes/production.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/production.ts)
- 在 `db.runInTransaction` 中实现了上述三种更新提议的批量执行逻辑。

## 验证计划
- 运行 `npx tsc --noEmit` 确保无编译类型错误。
- 运行 `npm run test` 确保无回归错误。
