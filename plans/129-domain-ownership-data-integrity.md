# Plan 129：Domain Ownership & Data Integrity

## 状态

`IN PROGRESS`

## 范围

- ProductionRun 创建与应用时验证 Chapter、ContinuationPack 及连续性补丁实体均属于同一 Novel。
- 应用生产结果的归属复核与正文、版本、状态账本写入处于同一 SQLite 事务。
- Reflexion 在写回时重新读取最新项目画像，仅增量合并 notes，并避免重复分析相同章节内容。
- 数据库导入拒绝非 InkFlow 白名单中的 Trigger、View、虚拟表及其他可执行 schema 对象。
- 通用 DB 代理禁止修改核心实体的 id、novelId 与 createdAt，ContinuationPack 不得经代理改绑作品。
- 数据库导入失败回滚后重绑定活动 reservation 的 generation，确保退款仍落回原库。
- 所有会自动落库的异步 AI 结果绑定启动时 database generation；World/Audit/设定抽取后台任务的轮询与取消携带 generation，正文、Rewrite、人物小传和灵感扩写的直接 SSE 通过响应头传递 generation，最终正文、版本、设定和使用记录统一使用 guarded DB 写入。

## 完成条件

- 跨作品 Chapter、Character、Item、Foreshadowing、ContinuationPack 均被拒绝且零写入。
- 恶意 Trigger 数据库无法导入，合法旧备份仍可迁移。
- Reflexion 不覆盖模型调用期间产生的新项目配置。
- Generic DB 更新和 Outline 资料包均不能跨作品改绑或读取。
- 数据库导入后，旧后台任务和旧 SSE 即使迟到完成也不能写入新库。
- 全量门禁和打包生命周期测试通过。
