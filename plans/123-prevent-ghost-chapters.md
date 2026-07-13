# Plan 123：阻止幽灵章节

## 状态

`IN PROGRESS`

## 范围

- 章节创建成功后才加入列表并切换当前章节。
- CRUD update/delete 以 `changes > 0` 返回真实成功状态。
- missing-row 保存保留 pending、禁止成功提示和后续版本副作用。

## 完成条件

创建失败、缺失章节更新、失败后继续输入与版本保护测试及全部门禁通过后标记 `DONE`。
