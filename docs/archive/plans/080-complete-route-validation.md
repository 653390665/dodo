# 实施计划: 补全与收紧 API 输入验证防线 (080)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development

**Goal:** 补全项目中尚未被覆盖的 API 端点输入验证（如 `orchestrate`, `continuation-import` 等），并对现有 Schema 增加精细化的长度、类型与边界限制，构筑坚固的 API 输入安全门禁。
**Architecture:**1. **精细化长文本截断与校验**：在 Zod 中利用 `.max()` 限制输入字段的字数上限，防止恶意发送超长请求导致大语言模型 API 资费飙升或服务器内存溢出（OOM）。
2. **新增核心端点安全门**：为 `orchestrate` 编排端点、`continuation-import` 导入端点以及 onboarding 端点编写 Zod 强校验 Schema。
3. **中间件挂载**：在 `server/routes/` 下的 Express 路由中全面引入并挂载 `validate()` 中间件。
**Tech Stack:** Zod, Express, TypeScript

---

## 任务分解 (Tasks)

### Task 1: 升级与收紧 Zod 校验 Schema
**Files:**
- [MODIFY] [validation.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/validation.ts)

**步骤：**
- [ ] 1. 收紧已有 Schema，限制字数上限：
  - `extractSkillSchema`: 对 `text` 字段限制最大长度为 150,000 字（`.max(150000, '文本字数超出 15 万字上限')`）。
  - `storyCardsSchema`: 对 `ideaSeed` 限制最大长度为 5,000 字。
  - `chapterProductionSchema`: 对 `userIntent` 限制最大长度为 2,000 字。
- [ ] 2. 补全编写并导出以下新增端点 Schema：
  - **`orchestrateSchema`**（章节编排端点）：
    ```typescript
    export const orchestrateSchema = z.object({
      draftingSurface: z.string().min(1),
      reviewSurface: z.string().min(1),
      contextStr: z.string().max(10000).optional(),
      sceneBeats: z.string().min(1).max(5000, '分镜字数不能超过 5000 字'),
      skills: z.array(z.unknown()).max(3, '最多只能挂载 3 个技能卡'),
      maxIterations: z.number().int().min(1).max(3).default(1),
      draftContent: z.string().max(50000).optional().default(''),
      includeCritic: z.boolean().optional().default(false),
    });
    ```
  - **`continuationImportSchema`**（资料续写导入端点）：
    ```typescript
    export const continuationImportSchema = z.object({
      rawText: z.string().min(1).max(100000, '导入文本不能超过 10 万字'),
      novelId: z.string().min(1),
    });
    ```

---

### Task 2: 在后端路由中挂载校验中间件
**Files:**
- [MODIFY] [orchestrate.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/orchestrate.ts)
- [MODIFY] [continuation.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/continuation.ts)

**步骤：**
- [ ] 1. 在 `orchestrate.ts` 的 POST 路由中引入 `orchestrateSchema`，挂载 `validate(orchestrateSchema)`。
- [ ] 2. 在 `continuation.ts` 的导入端点路由中引入 `continuationImportSchema`，挂载 `validate(continuationImportSchema)`。

---

## 验证计划 (Verification)

### Drift Check
- 运行：
  ```bash
  git diff --stat ca53899..HEAD -- server/validation.ts server/routes/
  ```

### 自动化与边界测试
- **黑盒异常测试**：
  编写测试脚本发送非法的 JSON Body，验证服务器是否返回 `400 Bad Request` 并给出明确的 Zod 错误详情：
  - 发送超过 15 万字的 `text` 到 `/api/extract-skill`
  - 发送挂载了 4 个技能卡的 `skills` 数组到 `/api/orchestrate`
  - 发送空分镜 `sceneBeats` 到 `/api/orchestrate`
- **回归测试**：
  运行 `npx tsc --noEmit && npm run test` 确保已有 278 项测试完全不受影响。
