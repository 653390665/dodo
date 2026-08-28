# Plan 067: 升级文风萃取支持全文本采样与语义聚类

## Goal
目前 `/api/extract-skill` 仅分析上传文本的前两个分块，其余均以本地静态规则填充，导致提炼出的文风倾向千篇一律。本计划旨在重构文风萃取逻辑，在全书范围内进行均匀采样并利用 LLM 提炼更精准的词汇和句法特征。

## Proposed Changes

### [MODIFY] [skills.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/skills.ts)
- 修改 `processModelSkillExtraction` 异步任务：
  - 不再仅分析前两个 Chunk。
  - 在上传的所有分块（Chunks）中，进行均匀分布采样（例如提取前、中、后共 6-10 个代表性 Chunk）。
  - 将采样到的分块合并，并调用大模型在三个维度（宏观结构、信息密度、微观句式）进行语义特征提取。
  - 合并大模型的提取结果，并输出定制化的文风 Skill JSON。

## Verification Plan
1. 上传一本较长的小说样本，触发文风萃取。
2. 轮询提取任务至成功，并检查生成的 Skill 配置文件。
3. 验证词汇倾向（`vocabulary`）与高频句式（`sentenceStructure`）是否包含了该小说独有的特征，而非保底模板。
