# Five-Principle Prompt Hardening Design

## Context

从 25+ GitHub 小说/Agent/Prompt 项目中提炼出"好提示词"的五条核心原则，应用到 InkFlow 全部 6 个核心 prompt。不改架构，只改 prompt 文本和后端解析逻辑。

## Five Principles

| # | 原则 | 含义 | 来源 |
|---|------|------|------|
| 1 | 短约束 | 每字段 `≤N字`，禁止展开 | Poppet, novel_prompter, writers-loop |
| 2 | 硬阻断 | PASS/FAIL 门槛写进 prompt，不做软建议 | Novel-OS, autonovel 免疫系统 |
| 3 | 检查清单 | 多维独立评分，每项必须写原因 | Poppet CoT 10 维, Novel-OS 6 道门禁 |
| 4 | 输入锚定 | hook/conflict 必须包含用户输入核心词 | Chinese-WebNovel-Skill |
| 5 | 字段独立 | 禁止合并维度成一段，保持 JSON 结构 | TheatreLM, AI-Prompts-for-Worldbuilding |

## Scope

6 个核心 prompt，分 3 批：

| 批次 | Prompt | 改动要点 |
|------|--------|---------|
| A | `storyCards` | 强化锚定约束，字段≤50字 |
| A | `manualAudit` | 5 维评分 + PASS/FAIL 硬阻断 |
| B | `editorAgent` | 加场景块检查清单 + 出场人物/冲突类型约束 |
| B | `orchestrateWriter` | 加硬规则列表 + 分镜兑现检查 |
| C | `setupTaskRefine` | 字段≤60字 + 输出结构约束 |
| C | `extractSkill` | 维度独立拆分 + 字段上限 |

## Per-Prompt Design

### storyCards
- 当前：751 字符，每字段 ≤50 字 ✓
- 强化：hook 必须包含用户输入核心词（原则 4）

### manualAudit（最大改动）
- 当前：5 项优先级检查，输出 `fatalIssues[]` + `surgerySuggestions[]`
- 改为：5 维独立评分（可读性/分镜执行/冲突推进/风格契合/章节感），每维 0-10 分 + 原因
- 新增 `pass: boolean`（总分 < 40 或任一维度 < 4 → FAIL）
- 新增 `failReason`: string（FAIL 时必须填写）

### editorAgent
- 当前：输出 3-5 个场景分镜，每场景 9 个子字段
- 强化：每个场景加"是否兑现上次审计的修复建议"字段（原则 2 反馈闭环）
- 每个场景字段加 ≤X 字约束（原则 1）

### orchestrateWriter
- 当前：16 条硬规则，无字段约束
- 强化：输出前自检——"请逐条确认以下 5 条关键规则是否满足，不满足则重写"
- 加：禁止词列表直接写进 prompt（原则 2）

### setupTaskRefine
- 当前：输出 120-220 字改写结果
- 强化：改为 JSON 输出 `{ result, changedFields[], reason }`

### extractSkill
- 当前：输出单张 Skill Card JSON
- 强化：维度拆分——`style` 从单字段拆为 `{笔调, 句法, 意象}`（原则 5）

## Success Criteria

- 6 个 prompt 全部加字段约束
- manualAudit 5 维评分生效
- 每个改动对应一个 contract test
- benchmark 跑过（storyCards 8s 内成功或正确 fallback）
