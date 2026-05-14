# Five-Principle Prompt Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 用从 25+ GitHub 项目提炼的五条原则（短约束、硬阻断、检查清单、输入锚定、字段独立）强化 InkFlow 全部 6 个核心 prompt，每改一个 prompt 对应一个 contract test。
**Architecture:** 所有改动局限在 `src/config/prompt-templates.ts` 的 prompt 文本和 `server.ts` 的解析逻辑。不改 DB schema、不改 UI、不改模型配置。每个 prompt 改完后跑原测试套件确保不引入回归。
**Tech Stack:** TypeScript, Node.js, `node:test`, `extractJsonPayload`.

## Reference Design

`docs/superpowers/specs/2026-05-14-five-principle-prompt-hardening-design.md`

---

## Batch A: storyCards + manualAudit

### Task A1: 强化 storyCards 输入锚定

**Files:**
- Modify: `src/config/prompt-templates.ts`
- Create: `tests/story-cards-anchoring-contract.test.ts`

**Steps:**

- [ ] 1. 在 storyCards prompt 的 hook 字段约束中加入锚定规则。

Replace:
```
"hook": "一句话卖点（必须包含用户输入核心词）",
```
With:
```
"hook": "≤30字，必须包含输入原文中至少1个名词",
```

- [ ] 2. 写 contract test。

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../src/config/prompt-templates';

test('storyCards prompt enforces input anchoring in hook', () => {
  const prompt = mergePromptTemplates().storyCards;
  assert.match(prompt, /输入原文|用户输入/);
  assert.match(prompt, /包含.*名词/);
});

test('storyCards prompt enforces field length caps', () => {
  const prompt = mergePromptTemplates().storyCards;
  assert.match(prompt, /≤ ?\d+ ?字/);
});

test('storyCards prompt forbids markdown and thinking', () => {
  const prompt = mergePromptTemplates().storyCards;
  assert.match(prompt, /不输出.*markdown|不输出.*思考|只输出.*JSON/);
});
```

- [ ] 3. 运行验证。

```bash
node --import tsx --test tests/story-cards-anchoring-contract.test.ts
```

Expected: `# pass 3`

- [ ] 4. 运行现有测试套件确认不引入回归。

```bash
node --import tsx --test tests/*.test.ts
```

### Task A2: 重构 manualAudit 为 5 维评分 + PASS/FAIL

**Files:**
- Modify: `src/config/prompt-templates.ts`
- Modify: `server.ts`（audit 端点解析逻辑）
- Create: `tests/audit-five-dimension-contract.test.ts`

**Steps:**

- [ ] 1. 替换 manualAudit prompt 的 JSON schema。

Replace current audit output structure with:

```ts
manualAudit: `
金���总编·结构化审计。逐维评分，不输出笼统评价。

【世界观】{{contextStr}}
【Skill约束】{{skillsInfo}}
【分镜】{{sceneBeats}}
【正文】{{draftContent}}

逐维评分（每维0-10分，必须写≤50字原因）：

{
  "scores": {
    "可读性": {"score": 0-10, "reason": "≤50字"},
    "分镜执行度": {"score": 0-10, "reason": "≤50字"},
    "冲突推进度": {"score": 0-10, "reason": "≤50字"},
    "风格契合度": {"score": 0-10, "reason": "≤50字"},
    "网文章节感": {"score": 0-10, "reason": "≤50字"}
  },
  "totalScore": 0-50,
  "pass": true或false,
  "failReason": "totalScore<30或任一维度<4时必填，≤80字",
  "fatalIssues": [
    {"dimension": "对应维度名", "snippet": "≤30字原文摘录", "fix": "≤30字修复建议"}
  ],
  "surgerySuggestions": ["≤50字/条", "≤50字/条"]
}

硬阻断规则：
- 任一维度 < 4 → pass=false
- totalScore < 30 → pass=false
- pass=false时必须填failReason
- fatalIssues最多3条，只报最严重的
`.trim(),
```

- [ ] 2. 更新 `server.ts` 的 audit 端点解析，处理新字段。

在 audit 端点（`app.post('/api/audit'`）中，替换现有的 `parseStructuredAuditResponse` 逻辑：

```ts
const auditData = JSON.parse(rawFeedback);
const pass = auditData.pass ?? (auditData.totalScore >= 30);
const failReason = auditData.failReason || '';
const scores = auditData.scores || {};
const fatalIssues = Array.isArray(auditData.fatalIssues) ? auditData.fatalIssues.slice(0, 3) : [];
const surgerySuggestions = Array.isArray(auditData.surgerySuggestions) ? auditData.surgerySuggestions : [];

res.json({
  feedback: renderStructuredAuditMarkdown({ scores, totalScore: auditData.totalScore, pass, failReason, fatalIssues, surgerySuggestions }),
  score: auditData.totalScore,
  pass,
  failReason,
  scores,
  fatalIssues,
  surgerySuggestions,
});
```

- [ ] 3. 更新 `src/lib/audit-structured.ts` 的 `renderStructuredAuditMarkdown` 支持新结构。

```ts
export function renderStructuredAuditMarkdown(audit: {
  scores: Record<string, { score: number; reason: string }>;
  totalScore: number;
  pass: boolean;
  failReason?: string;
  fatalIssues?: Array<{ dimension: string; snippet: string; fix: string }>;
  surgerySuggestions?: string[];
}): string {
  const lines: string[] = [];

  lines.push(audit.pass ? '## PASS' : '## FAIL');
  if (!audit.pass && audit.failReason) lines.push(`**失败原因**: ${audit.failReason}`);
  lines.push('');
  lines.push('| 维度 | 评分 | 原因 |');
  lines.push('|------|------|------|');
  for (const [dim, { score, reason }] of Object.entries(audit.scores)) {
    lines.push(`| ${dim} | ${score}/10 | ${reason} |`);
  }
  lines.push(`| **总分** | **${audit.totalScore}/50** | |`);

  if (audit.fatalIssues && audit.fatalIssues.length > 0) {
    lines.push('');
    lines.push('### 严重问题');
    for (const issue of audit.fatalIssues) {
      lines.push(`- **[${issue.dimension}]** \`${issue.snippet}\` → ${issue.fix}`);
    }
  }

  if (audit.surgerySuggestions && audit.surgerySuggestions.length > 0) {
    lines.push('');
    lines.push('### 重写建议');
    for (const s of audit.surgerySuggestions) {
      lines.push(`- ${s}`);
    }
  }

  return lines.join('\n');
}
```

- [ ] 4. 写 contract test。

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../src/config/prompt-templates';

test('manualAudit prompt requires 5-dimension scoring', () => {
  const prompt = mergePromptTemplates().manualAudit;
  assert.match(prompt, /可读性/);
  assert.match(prompt, /分镜执行/);
  assert.match(prompt, /冲突推进/);
  assert.match(prompt, /风格契合/);
  assert.match(prompt, /网文章节感/);
});

test('manualAudit prompt enforces PASS/FAIL gate', () => {
  const prompt = mergePromptTemplates().manualAudit;
  assert.match(prompt, /pass.*true.*false|硬阻断/);
  assert.match(prompt, /failReason/);
});

test('manualAudit prompt enforces field length caps', () => {
  const prompt = mergePromptTemplates().manualAudit;
  assert.match(prompt, /≤ ?\d+ ?字/);
});
```

- [ ] 5. 运行验证。

```bash
node --import tsx --test tests/audit-five-dimension-contract.test.ts
node --import tsx --test tests/audit-structured.test.ts
node --import tsx --test tests/*.test.ts
```

Expected: 全部 pass。

---

## Batch B: editorAgent + orchestrateWriter

### Task B1: editorAgent 加场景检查清单

**Files:**
- Modify: `src/config/prompt-templates.ts`
- Create: `tests/editor-agent-checklist-contract.test.ts`

**Steps:**

- [ ] 1. 在 editorAgent prompt 中为每个场景块加字段约束。

在现有场景结构（出场人物/入场钩子/核心冲突/关键动作链/关键道具/情绪转折/退场钩子/连接上一场景）的每个字段后加 `（≤X字）`：

```
**出场人物**（≤20字）：列出本场景涉及的已知角色名
**入场钩子**（≤30字）：一句话说明场景从什么时刻/动作/画面开始
**核心冲突**（≤40字）：谁和谁因为什么产生张力
**关键动作链**（≤60字）：2-3个必须在本场景发生的动作/事件
**关键道具/信息**（≤30字）：本场景必须出现或传递的物件、线索
**情绪转折**（≤20字）：开始情绪→结束情绪
**退场钩子**（≤30字）：场景由什么动作/画面/声音结束
**连接上一场景**（≤20字）：如何承接上一个场景的结果
```

- [ ] 2. 在硬约束末尾加：

```
6. 每个场景必须覆盖分镜要求的至少2个关键动作，未覆盖视为FAIL
```

- [ ] 3. 写 contract test。

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../src/config/prompt-templates';

test('editorAgent prompt enforces field length caps per scene', () => {
  const prompt = mergePromptTemplates().editorAgent;
  assert.match(prompt, /≤\d+字/);
});

test('editorAgent prompt enforces scene beat coverage', () => {
  const prompt = mergePromptTemplates().editorAgent;
  assert.match(prompt, /关键动作|未覆盖.*FAIL|至少.*2/);
});
```

### Task B2: orchestrateWriter 加强制自检清单

**Files:**
- Modify: `src/config/prompt-templates.ts`
- Create: `tests/orchestrate-writer-checklist-contract.test.ts`

**Steps:**

- [ ] 1. 在 orchestrateWriter prompt 末尾加自检清单。

```
输出正文前，逐条自检（必须全部满足，否则重写）：
□ 首句含声音/动作/碰撞/异动（非天气播报）
□ 正文未出现"主角"二字
□ 分镜要求的道具已在正文出现至少1次
□ 关键对话前有观察/停顿/试探作前因
□ 场景结束时用动作/声音/环境异变收束
□ 无残句、病句、主谓不明
```

- [ ] 2. 写 contract test。

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../src/config/prompt-templates';

test('orchestrateWriter prompt includes self-check checklist', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  assert.match(prompt, /自检|逐条|□.*首句|□.*主角/);
});
```

---

## Batch C: setupTaskRefine + extractSkill

### Task C1: setupTaskRefine 结构化输出 + 字段约束

**Files:**
- Modify: `src/config/prompt-templates.ts`
- Create: `tests/setup-task-refine-contract.test.ts`

**Steps:**

- [ ] 1. 将输出从自由文本改为 JSON。

```ts
setupTaskRefine: `
小说设定协作助手。针对单个设定项给出更稳的改写。

输入：{{taskTitle}} | 草稿：{{currentDraft}} | 上下文：{{storyContext}} | 方向：{{userRequest}}

输出严格JSON：
{
  "result": "≤150字改写结果",
  "changedFields": ["补足的维度名1", "补足的维度名2"],
  "reason": "≤50字说明为什么这样改"
}

规则：不输出问答/大纲/符号列表，优先补动机+限制+后果。
`.trim(),
```

- [ ] 2. 更新 `server.ts` 中 setup-task-refine 端点，解析 JSON 输出。

```ts
try {
  const parsed = JSON.parse(text);
  res.json({ text: parsed.result || text, changedFields: parsed.changedFields, reason: parsed.reason });
} catch {
  res.json({ text });
}
```

- [ ] 3. 写 contract test。

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../src/config/prompt-templates';

test('setupTaskRefine requires JSON output with field caps', () => {
  const prompt = mergePromptTemplates().setupTaskRefine;
  assert.match(prompt, /JSON|json/);
  assert.match(prompt, /≤\d+字/);
  assert.match(prompt, /changedFields/);
});
```

### Task C2: extractSkill 维度拆分

**Files:**
- Modify: `src/config/prompt-templates.ts`
- Create: `tests/extract-skill-dimension-contract.test.ts`

**Steps:**

- [ ] 1. 将 `style` 字段拆为子对象。

```
"style": {"笔调": "≤20字", "句法": "≤20字", "意象": "≤20字"},
```

- [ ] 2. 加所有文本字段长度上限。

- [ ] 3. 写 contract test。

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../src/config/prompt-templates';

test('extractSkill splits style into sub-dimensions', () => {
  const prompt = mergePromptTemplates().extractSkill;
  assert.match(prompt, /笔调|句法|意象/);
});

test('extractSkill enforces field length caps', () => {
  const prompt = mergePromptTemplates().extractSkill;
  assert.match(prompt, /≤\d+字/);
});
```

---

## Task D: 最终验证

**Steps:**

- [ ] 1. 跑全量测试。

```bash
node --import tsx --test tests/*.test.ts
```

Expected: 118+ tests pass（新增 6 个 contract test）。

- [ ] 2. 类型检查 + 构建 + 冒烟。

```bash
npm run lint
npm run build
npm run smoke:runtime
```

- [ ] 3. 启动 dev server 手动测一下 storyCards 和 audit。

```bash
curl -s --max-time 15 -X POST http://localhost:3000/api/story-cards \
  -H 'Content-Type: application/json' \
  -d '{"ideaSeed":"一个乞丐捡到玉玺的故事","chatContext":"","planning":{},"surface":"welcome"}'
```

## Commit Plan

```bash
# Batch A
git add src/config/prompt-templates.ts server.ts src/lib/audit-structured.ts \
        tests/story-cards-anchoring-contract.test.ts \
        tests/audit-five-dimension-contract.test.ts
git commit -m "feat: harden storyCards anchoring and manualAudit 5-dim scoring"

# Batch B
git add src/config/prompt-templates.ts \
        tests/editor-agent-checklist-contract.test.ts \
        tests/orchestrate-writer-checklist-contract.test.ts
git commit -m "feat: add field caps to editorAgent, self-check to orchestrateWriter"

# Batch C
git add src/config/prompt-templates.ts server.ts \
        tests/setup-task-refine-contract.test.ts \
        tests/extract-skill-dimension-contract.test.ts
git commit -m "feat: structured JSON output for setupTaskRefine, dimension split for extractSkill"
```

## Self-Review

- 6 个 prompt 全部覆盖五原则
- 每改动对应一个 contract test
- 不改 DB schema、UI、模型配置
- 无 TBD / placeholder
- Batch A 优先（用户入口 + 质量核心）
