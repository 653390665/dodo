# InkFlow Provider 文学质量评测报告

- 模式：`deterministic`
- 总体状态：`FALLBACK`
- 模型配置：`missing`
- 生成时间：`2026-08-27T21:09:38.201Z`

## 样本

| 样本 | 状态 | 错误码 | 质量 finding codes | 检出缺陷 | 生成候选 | 可接受 |
|---|---|---|---|---|---|---|
| slop-heavy | FALLBACK | - | - | yes | yes | yes |
| action-weak | FALLBACK | - | - | yes | yes | yes |
| mature | FALLBACK | - | - | no | no | no |

## 指标

| 指标 | 结果 |
|---|---|
| P0 escape rate | 0.0% (0/1) |
| P1 miss rate | 0.0% (0/2) |
| polish acceptance rate | 100.0% (2/2) |
| harmful rewrite rate | 0.0% (0/2) |

分母为 0 时结果为 `null`，不将无样本伪装成 0% 或 100%。FALLBACK 仅验证本地合同，不代表真实 Provider 质量。

## 调用明细

| 样本 | 阶段 | 状态 | 错误码 | 解析模式 | 契约问题 | 诊断码 | 诊断摘要 | 问题类别 | 响应形状 | 含审稿键 | 规范化问题数 | 耗时 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| slop-heavy | audit | FALLBACK | - | structured | - | - | - | style-slop, ai-cliche, exposition-dump, tell-dont-show | json-object | yes | 3 | 0 |
| slop-heavy | rewrite | FALLBACK | - | - | - | - | - | - | - | no | - | 0 |
| slop-heavy | rewrite | FALLBACK | - | - | - | - | - | - | - | no | - | 0 |
| slop-heavy | rewrite | FALLBACK | - | - | - | - | - | - | - | no | - | 0 |
| slop-heavy | re-audit | FALLBACK | - | structured | - | - | - | - | json-object | yes | 0 | 0 |
| action-weak | audit | FALLBACK | - | structured | - | - | - | action-chain, dialogue-without-beat, weak-action-chain | json-object | yes | 2 | 0 |
| action-weak | rewrite | FALLBACK | - | - | - | - | - | - | - | no | - | 0 |
| action-weak | rewrite | FALLBACK | - | - | - | - | - | - | - | no | - | 0 |
| action-weak | re-audit | FALLBACK | - | structured | - | - | - | - | json-object | yes | 0 | 0 |
| mature | audit | FALLBACK | - | structured | - | - | - | - | json-object | yes | 0 | 0 |
