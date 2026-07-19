# 实施计划: 消除实体关系更新中的 SQL 注入漏洞 (070)

本计划旨在修复在手写 SQL 更新辅助函数中存在的直接字符串拼接漏洞，实现 100% 的 SQL 注入免疫。

## 发现的漏洞
在 `server/lib/db.ts` 的 `updateEntityRelationship(id, data)` 函数中：
- 遍历 `Object.entries(data)` 时，直接将属性键名 `k` 拼接进 SQL 语句中：`sets.push(k + ' = ?')`。
- 如果恶意客户端传入包含 SQL 注入负载的键名（例如 `"description = ?; DROP TABLE novels; --"`），在执行 `db.prepare` 时会执行任意 SQL 语句，造成严重的数据泄露或毁坏。

## 解决方案
- 引入静态列名白名单 `ENTITY_RELATIONSHIP_COLUMNS`。
- 在遍历 `data` 键名时，强制校验键名是否存在于白名单中。若不匹配，直接抛出异常，拒绝执行。
- 确保所有拼接的键名都是经过白名单过滤的合法列名，彻底封堵注入通道。

## 变更文件

### [server/lib/db.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/lib/db.ts)
- 添加了 `ENTITY_RELATIONSHIP_COLUMNS` 常量白名单。
- 在 `updateEntityRelationship` 中加入白名单校验拦截逻辑。

## 验证计划
- 运行 `npx tsc --noEmit` 确保编译通过。
- 运行 `npm run test` 确保所有数据库单元测试无误。
