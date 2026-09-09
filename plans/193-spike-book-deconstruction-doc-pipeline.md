# Plan 193: [方向 Spike] 拆书工厂接入文档解析管线（docx/长文本）

> **Executor instructions**: 这是设计/调研型计划。产出是设计文档 + 一条「docx → 拆书输入」的最小链路验证；不完整交付功能。产出写入 `docs/prd/2026-09-deconstruction-doc-pipeline.md`；完成后更新 `plans/README.md` 状态行。

## Status

- **Priority**: P3（方向类）
- **Effort**: M（粗估）
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction（design/spike）
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

拆书是 README 主推的差异化工作流，但输入只吃 `.txt/.md` 复制粘贴（`BookFactoryInput.tsx:29` `accept=".txt,.md"`；`server/validation.ts:308-314` 仅 `text` 字符串 ≤15 万字）。想拆整本参考小说或 Word 稿的作者只能手工预处理。而文档解析的最重工程已为「资料续写」全部建成：`/api/parse-doc` 已支持 .docx（mammoth，`continuation.ts:947`）、zip 队列与前端去重已存在。接入是纯复用。

## Grounding evidence

- `server/validation.ts:308-314` — extractSkillSchema 仅 text ≤150000 字
- `src/components/book-factory/BookFactoryInput.tsx:29` — accept=".txt,.md"
- `server/routes/continuation.ts:947` — /api/parse-doc（mammoth）既有
- `README.md:177-179` — 资料续写已支持拖文件夹/zip 导入与去重

## Scope

**In scope**：设计文档 + 命令行级链路验证（docx → parse-doc 管线 → 满足 extractSkillSchema 输入）。

**Out of scope**：前端 accept 扩展与上传 UI、分章拆解的完整方案、卡组合并算法。

## Steps

### Step 1: 管线差异盘点

对照 `/api/parse-doc`（continuation.ts）与 extract-skill（skills.ts）的输入处理：文件类型集、大小上限、编码处理、分段策略。15 万字上限对整本书不够——设计「超限输入的分章拆解策略」草案（按卷/章切分 → 多次 extract → 卡组合并语义），这是本 spike 的核心设计题。

### Step 2: 设计文档

`docs/prd/2026-09-deconstruction-doc-pipeline.md`：共享「文档→文本」管线的模块边界（从 continuation 抽 `server/helpers/doc-text-extraction.ts` 的可行性）、schema 改动（extractSkillSchema 接受 documents 数组或复用 parse-doc 的 job 模式）、开放问题（合并去重、单卡质量阈值、超长文本的 token 成本提示）。

### Step 3: 最小链路验证

`scripts/deconstruct-docx-prototype.mjs`：mammoth 解析一个测试 docx → 切分 → 调用 buildContinuationPackPrompt 同级的输入组装（不真调 LLM）→ 断言每段满足 extractSkillSchema 的 text 约束。

**Verify**: `node --import tsx scripts/deconstruct-docx-prototype.mjs` exit 0

## Done criteria

- [ ] 设计文档含分章拆解策略草案与开放问题
- [ ] 原型脚本通过
- [ ] `plans/README.md` 状态行更新

## STOP conditions

- mammoth 管线与 skills 路由的执行上下文不兼容（quota/FIFO 语义冲突）。
- 分章切分无法稳定对齐章节边界（无通用规则且启发式误差不可接受）——降级方案（整本压缩拆解）记入开放问题。

## Maintenance notes

拍板后另立实施计划（预期 M：schema 扩展 + parse-doc 复用 + 前端 accept/UI）。
