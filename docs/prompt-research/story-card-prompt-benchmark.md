# Story Cards Prompt Benchmark

> 目标：优化 `/api/story-cards` 的 prompt，使其在 MiniMax M2.7 上 30s 内稳定返回 3 张可用的故事方案卡。

## 当前状态

### Prompt 结构

```
你是一个资深网文策划编辑。请根据用户的灵感种子和上下文，生成 3 张差异明确、可继续写的故事方案卡。

【灵感种子】
{{ideaSeed}}

【对话上下文】
{{chatContext}}

【创作规划】
- 预计总字数：{{expectedWordCount}} 字
- 当前更重：{{storyFocus}}
- 推进节奏：{{pacingPreference}}

请严格输出 JSON：
{
  "cards": [
    {
      "id": "card-1",
      "hook": "一句话卖点",
      "protagonist": "主角设定摘要",
      "coreConflict": "核心冲突",
      "tone": "故事气质 / 文风",
      "whyItWorks": "为什么值得写",
      "starterSeeds": { ... },
      "planningFit": { ... },
      "riskNote": "最容易写崩的点",
      "mixTags": ["标签"],
      "signals": { ... }
    }
  ]
}
```

### 实测数据（MiniMax M2.7，2026-05-14）

| 指标 | 值 |
|------|-----|
| Prompt 长度 | 1085 字符 |
| 8s 超时 | 失败 |
| 30s 超时 | 失败 |
| 60s 返回 | 57.1s，3256 字符 |
| maxTokens=1800 | JSON 不完整，解析失败 |
| maxTokens=4096 | 待测 |

### 问题诊断

1. **Prompt 太长**：1085 字符 + JSON schema 细节 → 模型生成大量 thinking token
2. **JSON 要求过细**：每张卡 10+ 个字段 → 输出 token 多，截断风险高
3. **无长度约束**：没告诉模型"每字段最多 XX 字"→ 模型写小作文

## 优化方向

### A. 压缩 Prompt（目标 < 500 字符）

精简掉冗余描述，保留核心约束：

```
你是网文策划编辑。根据用户输入生成 3 张故事方案卡，方向必须不同。

输入：{{ideaSeed}}
字数：{{expectedWordCount}} 重：{{storyFocus}} 节奏：{{pacingPreference}}

每张卡 ≤ 200 字，含：hook(一句话)、主角(30字)、冲突(50字)、气质(10字)、风险(30字)、标签(3个)

严格输出 JSON：{"cards":[{...}]}
```

### B. 减少 JSON 字段（10+ → 6 核心字段）

去掉 `starterSeeds`、`planningFit`、`signals` 等前端暂时不用的字段，只保留：
- hook, protagonist, coreConflict, tone, whyItWorks, riskNote, mixTags

### C. 加字段长度上限

每个文本字段加 `< 50字` 限制，防止模型展开成小作文。

### D. 用 extractJsonPayload 容错

已做。即使 JSON 不完整，也能提取有效部分。

## 基准测试计划

测试 4 个 prompt 变体，每个跑 5 次取中位数：

| 版本 | 描述 | 预期速度 | 预期完成率 |
|------|------|---------|-----------|
| v0 | 当前 prompt（1085 字符，10+ 字段） | 60s | 20% |
| v1 | 压缩到 500 字符，10+ 字段 | 40s | 40% |
| v2 | 压缩到 500 字符，6 核心字段 | 25s | 60% |
| v3 | 压缩 + 字段长度上限 + 6 字段 | 20s | 80% |

## 参考来源

- **AHA1GE/novel_prompter**：参数化填空式 prompt 结构。学习：用模板变量替代大段描述性指令。
- **xxsang/writers-loop**："Ask" 阶段的 prompt 设计。学习：用"方向必须不同"这个约束替代冗长的差异化说明。
- **NousResearch/autonovel**：Seed → Concept 阶段。学习：开书阶段不需要完整 world building，给情绪和冲突方向就够了。

## 下一步

1. 写 v1/v2/v3 prompt 文本
2. 本地跑 benchmark 脚本测速
3. 选出最优版本替换当前 prompt
4. 更新 `DEFAULT_PROMPT_TEMPLATES` 中的 `storyCards`
