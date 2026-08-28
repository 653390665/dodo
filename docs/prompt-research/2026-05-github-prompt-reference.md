# GitHub Prompt 参考库

> 目的：拆结构不抄文本，学约束不搬表达，学评测不迷信 prompt。

## 项目索引

### Tier 1 — 直接可借鉴

| 项目 | 核心价值 | 对应 InkFlow 模块 |
|------|---------|------------------|
| [NousResearch/autonovel](https://github.com/NousResearch/autonovel) | Pipeline 分阶段、评分循环、反 AI 味修订 | Chapter Production, Critic |
| [Tomsawyerhu/Chinese-WebNovel-Skill](https://github.com/Tomsawyerhu/Chinese-WebNovel-Skill) | "Distill structure, not style"、网文结构萃取 | Skill Extraction |
| [leenbj/novel-creator-skill](https://github.com/leenbj/novel-creator-skill) | 去 AI 味 7 类检测、事件 cooldown、Iron Law | Audit, Critic |
| [xxsang/writers-loop](https://github.com/xxsang/writers-loop) | Frame→Ask→Plan→Draft→Critique→Revise→Learn | Orchestrate |

### Tier 2 — 架构参考

| 项目 | 核心价值 | 对应 InkFlow 模块 |
|------|---------|------------------|
| [lgz-star/novel-pro](https://github.com/lgz-star/novel-pro) | Truth System、上下文膨胀控制 | Story State Ledger |
| [KazKozDev/NovelGenerator](https://github.com/KazKozDev/NovelGenerator) | 多 agent 协作、最终一致性 pass | Chapter Production |
| [wordflowlab/novel-writer](https://github.com/wordflowlab/novel-writer) | Spec-driven methodology | Task Router |

### Tier 3 — 细分参考

| 项目 | 核心价值 | 对应 InkFlow 模块 |
|------|---------|------------------|
| [AHA1GE/novel_prompter](https://github.com/AHA1GE/novel_prompter) | 结构化 prompt 模板（世界观/角色/大纲/场景） | Story Cards, World Bible |
| [AI-Novel-Writing-Assistant](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant) | 开书定盘、卷级规划、自动导演 | Onboarding |
| [KoboldAI](https://github.com/Kinsmir/KoboldAI) | Memory/Author's Note/World Info 注入 | Context Injection |
| [abilzerian/LLM-Prompt-Library](https://github.com/abilzerian/LLM-Prompt-Library) | Creative Writing + Meta Prompts | Prompt 工程方法论 |

## 通用原则

- **拆结构，不抄文本**：学的是他们怎么组织 prompt 的逻辑，不是复制他们的表达
- **学约束，不搬表达**：学的是他们设了什么硬规则、怎么防止模型跑偏
- **学评测，不迷信 prompt**：学的是他们怎么衡量 prompt 好不好，不是迷信某个"神 prompt"

## 评测维度

每个 prompt 迭代时记录：

| 维度 | 指标 | 目标 |
|------|------|------|
| 速度 | 平均响应时间（P50/P95） | < 30s P50 |
| 稳定性 | JSON 解析成功率 | > 95% |
| 完整性 | 必填字段覆盖率 | > 90% |
| 可用性 | 字段内容是否可直接使用 | > 80% |
| 贴合度 | 输出是否贴合用户输入 | > 85% |
