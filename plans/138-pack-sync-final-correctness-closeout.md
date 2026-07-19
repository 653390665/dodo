# Plan 138：资料包同步最终正确性收口

状态：`IN PROGRESS`

## 目标

修复资料包同步中的旧快照覆盖与关系静默丢失，并恢复可信门禁；完成前不推送当前分支。

## T1：同步读取与写入使用同一原子边界（P1）

- 将 pack、novel、现有实体、现有关系的读取，以及去重集合和 typed-name map 的构建，全部移入 `runInSerializedWriteForGeneration()` 内的同一 SQLite transaction。
- transaction 内再次校验 pack 存在、approved、novel 归属和 generation。
- `globalOutline` / `worldRules` 只根据 transaction 内最新 novel 判断是否写入，禁止队列外旧快照覆盖较新的用户保存。
- 测试：FIFO 被占用时，先排队用户保存再同步；最终保留用户新值。并发同步不得生成重复实体或关系。

## T2：关系必须与当前选中实体一致（P1）

- 关系可用实体集合改为“数据库已有实体 + 当前勾选的提取实体”，不得包含已取消勾选的实体。
- 取消关系依赖实体后，相关关系立即变为待处理并禁用确认；只有重新勾选、重新映射或显式跳过后才可提交。
- “先跳过、后重新映射”时自动清除 skip 状态；UI 显示已解析的关系必须实际进入请求。
- 服务端若仍跳过关系，前端展示 `skipped.relationships` 结果，不得直接清空预览并伪装全部成功。
- 测试：取消 B 后 A→B 被阻塞；显式跳过后放行；skip→resolve 后关系真实写入。

## T3：修正验收测试与门禁（P1/P2）

- 回滚测试必须在 transaction 已写入首项后制造后续 SQL 失败，验证 novel 字段、六类实体及 relationships 全部不变。
- “提取预览零写入”使用非空 LLM 提取结果，并完整快照 `global_outline`、`world_rules`、实体表、时间线和关系表。
- 新增 `ContinuationPackView` A/B deferred 响应测试，验证切包、取消、卸载后的迟到响应不能覆盖当前预览。
- 清理 `src/tests/pack-sync.test.tsx` 的两条 ESLint warning 和 Plan 137 文档尾随空白。

## T4：恢复可审查的 Git 基线后再推送

- 当前分支相对 `main` 累计 12 个提交，包含 Plan 133–137；先确认 PR 是否接受该完整范围。
- 网络恢复后从 `origin` 修复/重建干净仓库，消除缺失 Git objects 与失效 refs；重新生成并审查 `origin/main...HEAD` 完整差异。
- 不复用当前无法完整 diff 的本地对象库作为最终发布依据。

## 验收

```bash
npm run typecheck
npm run lint -- --max-warnings=0
npm test
npm run test:frontend
npx playwright test
git diff --check origin/main...HEAD
git fsck --full
```

全部退出码为 0、两个 P1 回归测试通过、远端差异范围确认后，方可提交修复并推送。
