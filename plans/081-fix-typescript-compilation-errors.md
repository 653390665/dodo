# Plan 081: 修复商业化与配额卡控的 TypeScript 编译错误 (Fix TypeScript Compilation Errors in Commercial Boundary & Quota Control)

由于近期在 InkFlow 仓库中落地了 Phase 6 商业化卡控与 Phase 7 连续性报告更新，开启 strict 模式的 TypeScript 编译器在全局 typecheck 时报出 7 处编译阻断错误。本计划旨在对这些编译期报错进行外科手术式的类型修复，恢复 CI 门禁绿色状态。

## 编译错误列表与根因分析

1. **`quota-guard.ts` 类型推导泄露**: 
   - 错误：`Property 'commercialMode' does not exist on type '{}'.` 
   - 原因：`const profile = novel.projectPreferenceProfile || {}` 导致 `profile` 在 strict 下被推断为 `ProjectPreferenceProfile | {}` 联合类型，无法安全访问特定属性。
2. **`useEditorGenerationFlow.ts` 命名遮蔽（Variable Shadowing）**:
   - 错误：`Property 'dispatchEvent' does not exist on type 'PolishTargetWindow'.`
   - 原因：在 `for (const { snippet, window } of rewriteTargets)` 循环体内，局部变量 `window`（类型为 `PolishTargetWindow`）遮蔽了浏览器全局的 `window` 对象，导致在循环内调用 `window.dispatchEvent` 抛出编译错误。
3. **测试文件 `commercial-boundary.test.ts` 的 Mock 属性缺失**:
   - 错误：`instructions` 属性在 `Skill` 中不存在，且 `mockNovel` 中 `projectPreferenceProfile` 缺失 `ProjectPreferenceProfile` 所必需的其他属性（如 `tags`、`weights` 等）。

---

## User Review Required

> [!IMPORTANT]
> 这是一个纯类型层面的外科手术式修复，**不涉及任何运行时数据库 Schema 变更（Zero Migration）**，对已有功能和测试用例没有任何破坏性影响。

---

## Proposed Changes

### Component: Core Server Helpers & Hooks

#### [MODIFY] [quota-guard.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/helpers/quota-guard.ts)
- 在 `checkQuota` 中，使用类型断言或严格初始化：
  ```typescript
  const profile = (novel.projectPreferenceProfile || {}) as ProjectPreferenceProfile;
  ```
- 在 `consumeQuota` 中，严格声明并初始化 `profile`，以安全满足 `ProjectPreferenceProfile` 类型的必填要求，防止回写 `updateNovel` 时类型不匹配：
  ```typescript
  const profile: ProjectPreferenceProfile = {
    tags: [],
    weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    ...(novel.projectPreferenceProfile || {})
  };
  ```

#### [MODIFY] [useEditorGenerationFlow.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/src/lib/hooks/useEditorGenerationFlow.ts)
- 消除 `window` 的命名遮蔽（Shadowing）。在 `for` 循环中，将解构重命名为 `targetWindow`（或 `patchWindow`），从而安全地恢复对全局 `window.dispatchEvent` 的访问。
  - 修改前:
    ```typescript
    for (const { snippet, window } of rewriteTargets) {
      // ...
      if (data && data.quotaExceeded) {
        window.dispatchEvent(...)
      }
      // ...
      const nextCandidate = applyPatchWindow(candidate, window, rewrittenText);
    }
    ```
  - 修改后:
    ```typescript
    for (const { snippet, window: targetWindow } of rewriteTargets) {
      // ...
      if (data && data.quotaExceeded) {
        window.dispatchEvent(...) // 正确引用浏览器全局 window
      }
      // ...
      const nextCandidate = applyPatchWindow(candidate, targetWindow, rewrittenText);
    }
    ```

---

### Component: Commercial Components

#### [MODIFY] [PremiumUpgradeModal.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/commercial/PremiumUpgradeModal.tsx)
- 在 `handleUpgrade` 中，将 `existingProfile` 的声明强制断言为 `ProjectPreferenceProfile`，以满足 `updateNovel` 期待的完整类型签名：
  ```typescript
  const existingProfile = (novel?.projectPreferenceProfile || {}) as ProjectPreferenceProfile;
  ```

---

### Component: Testing Suite

#### [MODIFY] [commercial-boundary.test.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/tests/commercial-boundary.test.ts)
- 更新 `mockSkill`，删除 `instructions`、`category`、`author` 等在 `Skill` interface 中不存在的冗余键值。补全 `Skill` 所必需的初始占位（如 `description`、`style`、`pacing`、`stabilityScore` 等）：
  ```typescript
  function mockSkill(fields: Partial<Skill>): Skill {
    return {
      id: 'skill-test-1',
      name: '测试技能卡',
      description: 'Mock description',
      style: 'Mock style',
      pacing: 'Mock pacing',
      stabilityScore: 90,
      evaluationFeedback: 'Mock feedback',
      version: 1,
      executionScore: 85, // 默认 A 级
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...fields,
    };
  }
  ```
- 更新 `mockNovel` 中 `projectPreferenceProfile` 结构，补充缺失的必填属性：
  ```typescript
  projectPreferenceProfile: {
    tags: [],
    weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    commercialMode,
    quotaLimits: {
      extractSkillCount: 0,
      extractSkillMax: DEFAULT_QUOTA_MAX.extractSkill,
      generateProseCount: 0,
      generateProseMax: DEFAULT_QUOTA_MAX.generateProse,
      advancedAuditCount: 0,
      advancedAuditMax: DEFAULT_QUOTA_MAX.advancedAudit,
    },
  },
  ```

---

## Verification Plan

### Automated Tests
执行以下命令，确认全局类型校验恢复绿色，且所有单元测试全绿通过：
```bash
# 1. 确认无任何 TypeScript 编译错误
npm run typecheck

# 2. 确认 341 个测试用例全部 100% 通过
npm run test
```
