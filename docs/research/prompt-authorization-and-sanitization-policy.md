# Prompt Authorization And Sanitization Policy

日期：2026-07-03

## 核心结论

用户已确认这批定制提示词具备购买授权。因此后续评估不再把 `private` 或 `has_access=false` 视为授权阻断。

新的处理原则是：

1. **内部保留来源和授权记录**：用于追溯、版本管理、质量复评和风险定位。
2. **用户可见层白标化**：删除作者名、联系方式、个人协议、私有身份话术和不可产品化的自我保护语。
3. **运行时只使用清洗版**：不直接把原始 prompt 原文暴露给用户或前端。
4. **按质量决定放置**：授权确认后，资产能不能上产品只看质量、稳定性、适配度、污染风险和可维护性。
5. **按工作流包装**：不按单条提示词售卖，按流程包、平台包、诊断包、精修包包装。

## 状态调整

旧规则：

- `has_access=false` -> 默认 `research-only`
- 未授权私有资产 -> 不进入用户可见产品
- 定制资产只抽结构

新规则：

- `has_access=false` -> 解释为原平台访问字段，不再代表 InkFlow 无权使用
- 已购买授权定制资产 -> `authorized-custom`
- 含作者名/联系方式/个人协议 -> `sanitize-required`
- 清洗后质量稳定 -> 可进入 `direct-use-test`、`flow-default`、`premium-enhancement`
- 清洗后质量一般 -> `fuse` 或 `extract-structure`
- 清洗后仍不可控/污染高/质量低 -> `reject` 或内部研究

## 白标清洗范围

必须移除或改写：

- 作者名、团队名、昵称、联系方式。
- “某某出品”“专用”“私密内测”等来源暴露词。
- 面向单个购买者的身份设定。
- 自我保护、禁止扩散、反破解、反套取等非产品执行规则。
- 与 InkFlow 产品定位冲突的销售话术。
- 会让用户感觉在调用外部作者 prompt 的包装。

可以保留并产品化：

- 工序。
- 输入变量。
- 输出结构。
- 质量门槛。
- 检查项。
- 题材/平台/篇幅适配规则。
- 文风、节奏、对白、动作链等可迁移能力。

## 内部字段建议

新增或重解释字段：

- `licenseStatus`: `user-authorized | public | built-in | unknown`
- `sanitizationStatus`: `raw | needs-sanitization | sanitized | runtime-ready`
- `provenanceVisibility`: `internal-only | user-visible`
- `runtimeStatus`: `candidate | direct-use-test | active | deprecated | rejected`
- `commercialStatus`: `free-base | free-square | premium-pack | private-user-library`

## 产品表达

用户不应看到：

- 原作者名。
- 原始 prompt 名称。
- 原始提示词全文。
- “来自某某定制”的暗示。

用户应看到：

- InkFlow 统一命名的能力。
- 使用场景。
- 适合题材/平台/篇幅。
- 风险提示。
- 推荐下一步。

示例：

| 原资产名 | 用户可见名称 |
| --- | --- |
| 某作者长篇细纲 | 长篇十章细纲引擎 |
| 某作者正文去 AI 高频词 | 终稿人味精修 |
| 某作者老福特正文 | CP 圈层短篇正文流 |
| 某作者金牌主编审稿 | 发布前主编诊断 |

## 对已有评估文档的影响

- 所有“未授权导致 research-only”的判断作废。
- `research-only` 只保留给质量不可控、污染高、不可验证、或许可证仍未知的外部来源。
- 定制资产优先级上调：同类能力里，清洗后的高质量定制资产可以替代广场资产成为主版本。
- 原始来源仍保留在内部台账，不进入用户可见包装。

