/**
 * 批次 B「空壳链路清账」测试（docs/specs/capability-flow-graph-consolidation.md §5.4）。
 *
 * ① 纯函数：声明/未声明 × 可运行/壳/缺失 的可用性判定与诊断；
 * ② 目录守门：30 步里「声明的仅引导集合 == 检测到的壳集合」，静默壳 0，可运行 13（43.3%）；
 * ③ 集成：真实链路步骤 → 快照 flowStep.availability / guidanceOnly 与目录一致。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import { resolveProjectExecutionContract } from '../server/helpers/writing-style-service.js';
import { PROMPT_GOVERNANCE_CATALOG, SKILL_SERIES_FLOWS } from '../shared/lib/prompt-governance-catalog.js';
import { isShellTemplatePrompt } from '../shared/lib/prompt-shell.js';
import {
  FLOW_STEP_AVAILABILITIES,
  FLOW_STEP_GUIDANCE_WARNINGS,
  GUIDANCE_ONLY_HINT,
  GUIDANCE_ONLY_LABEL,
  resolveFlowStepAvailability,
  runnableStepRatio,
  summarizeFlowStepAvailabilities,
} from '../shared/lib/flow-step-guidance.js';
import type { SkillSeriesFlowStep } from '../shared/types/prompt-assets-governed.js';
import type { Novel } from '../shared/types.js';

// ---------------------------------------------------------------------------
// ① 纯函数
// ---------------------------------------------------------------------------

test('未声明却是壳 → unavailable + FLOW_STEP_GUIDANCE_UNDECLARED_SHELL（静默幻觉被看见）', () => {
  const resolution = resolveFlowStepAvailability({ assetRunnable: true, assetIsShell: true });
  assert.equal(resolution.availability, 'unavailable');
  assert.equal(resolution.declared, false);
  assert.deepEqual([...resolution.warnings], ['FLOW_STEP_GUIDANCE_UNDECLARED_SHELL']);
});

test('声明 guidanceOnly + 壳 → guidance，无诊断', () => {
  const resolution = resolveFlowStepAvailability({
    guidanceOnly: true,
    assetRunnable: true,
    assetIsShell: true,
  });
  assert.equal(resolution.availability, 'guidance');
  assert.equal(resolution.declared, true);
  assert.deepEqual([...resolution.warnings], []);
});

test('声明 guidanceOnly 但资产有可运行正文 → 仍按声明走 guidance，记 WITH_RUNNABLE_ASSET', () => {
  const resolution = resolveFlowStepAvailability({
    guidanceOnly: true,
    assetRunnable: true,
    assetIsShell: false,
  });
  assert.equal(resolution.availability, 'guidance');
  assert.deepEqual([...resolution.warnings], ['FLOW_STEP_GUIDANCE_WITH_RUNNABLE_ASSET']);
});

test('未声明 + 可运行真资产 → asset；未声明 + 缺失/未就绪 → unavailable（无诊断）', () => {
  const usable = resolveFlowStepAvailability({ assetRunnable: true, assetIsShell: false });
  assert.equal(usable.availability, 'asset');
  assert.deepEqual([...usable.warnings], []);

  const missing = resolveFlowStepAvailability({ assetRunnable: false, assetIsShell: false });
  assert.equal(missing.availability, 'unavailable');
  assert.deepEqual([...missing.warnings], []);

  const notReady = resolveFlowStepAvailability({ assetRunnable: false, assetIsShell: true });
  assert.equal(notReady.availability, 'unavailable');
  assert.deepEqual([...notReady.warnings], ['FLOW_STEP_GUIDANCE_UNDECLARED_SHELL']);
});

test('汇总与占比：13/30 → 43.3%；空集合 → 0', () => {
  const resolutions = [
    ...Array.from({ length: 13 }, () => resolveFlowStepAvailability({ assetRunnable: true })),
    ...Array.from({ length: 17 }, () => resolveFlowStepAvailability({ guidanceOnly: true, assetIsShell: true })),
  ];
  const summary = summarizeFlowStepAvailabilities(resolutions);
  assert.deepEqual(summary, { asset: 13, guidance: 17, unavailable: 0, total: 30 });
  assert.equal(runnableStepRatio(summary), 43.3);
  assert.equal(runnableStepRatio(summarizeFlowStepAvailabilities([])), 0);
  assert.deepEqual([...FLOW_STEP_AVAILABILITIES], ['asset', 'guidance', 'unavailable']);
  assert.deepEqual([...FLOW_STEP_GUIDANCE_WARNINGS], [
    'FLOW_STEP_GUIDANCE_UNDECLARED_SHELL',
    'FLOW_STEP_GUIDANCE_WITH_RUNNABLE_ASSET',
  ]);
});

test('展示文案：标签固定为「仅引导」，提示文案非空且解释自备素材', () => {
  assert.equal(GUIDANCE_ONLY_LABEL, '仅引导');
  assert.ok(GUIDANCE_ONLY_HINT.includes('仅引导'));
  assert.ok(GUIDANCE_ONLY_HINT.includes('引用壳'));
});

// ---------------------------------------------------------------------------
// ② 目录守门（真实目录）
// ---------------------------------------------------------------------------

interface StepAudit {
  flowId: string;
  step: SkillSeriesFlowStep;
  assetRunnable: boolean;
  assetIsShell: boolean;
}

function auditSteps(): StepAudit[] {
  return SKILL_SERIES_FLOWS.flatMap((flow) =>
    flow.steps.map((step) => {
      const asset = PROMPT_GOVERNANCE_CATALOG.find((item) => item.id === step.assetId);
      return {
        flowId: flow.id,
        step,
        assetRunnable: Boolean(
          asset?.isRuntimeReady &&
            asset.runtimeStatus === 'active' &&
            asset.sanitizationStatus === 'runtime-ready'
        ),
        assetIsShell: isShellTemplatePrompt(asset?.template),
      };
    })
  );
}

test('目录守门：30 步；声明的仅引导集合 == 检测到的壳集合（17），静默壳 0', () => {
  const audits = auditSteps();
  const declared = audits.filter((row) => row.step.guidanceOnly === true).map((row) => row.step.id).sort();
  const shells = audits.filter((row) => row.assetIsShell).map((row) => row.step.id).sort();
  assert.equal(audits.length, 30);
  assert.equal(shells.length, 17);
  assert.deepEqual(declared, shells, '壳步骤必须显式声明「仅引导」，且声明不得越界到真资产步骤');
});

test('目录守门：可运行 13 / 仅引导 17 / 不可用 0，可运行占比 43.3%', () => {
  const audits = auditSteps();
  const resolutions = audits.map((row) =>
    resolveFlowStepAvailability({
      guidanceOnly: row.step.guidanceOnly,
      assetRunnable: row.assetRunnable,
      assetIsShell: row.assetIsShell,
    })
  );
  assert.deepEqual(summarizeFlowStepAvailabilities(resolutions), {
    asset: 13,
    guidance: 17,
    unavailable: 0,
    total: 30,
  });
  assert.equal(runnableStepRatio(summarizeFlowStepAvailabilities(resolutions)), 43.3);
  assert.ok(
    resolutions.every((resolution) => resolution.warnings.length === 0),
    '目录内不得存在静默壳或过度声明'
  );
});

test('目录守门：逐链路「仅引导」声明数（番茄 5 / 天马 4 / 风华 4 / 小飞鸡 2 / 拆书 2）', () => {
  const counts: Record<string, number> = {};
  for (const row of auditSteps()) {
    if (row.step.guidanceOnly === true) counts[row.flowId] = (counts[row.flowId] ?? 0) + 1;
  }
  assert.deepEqual(counts, {
    'xiaofeiji-novel-flow': 2,
    'tomato-platform-flow': 5,
    'book-deconstruction-flow': 2,
    'fenghua-short-flow': 4,
    'tianma-outline-flow': 4,
  });
  assert.equal(SKILL_SERIES_FLOWS.find((flow) => flow.id === 'generic-novel-flow')?.steps.some((s) => s.guidanceOnly === true), false);
});

// ---------------------------------------------------------------------------
// ③ 集成（真实目录 + 内存库）
// ---------------------------------------------------------------------------

function baseNovel(id: string, flowId: string, stepId: string): Novel {
  return {
    id,
    title: 'Guidance Novel',
    authorId: 'author',
    summary: '',
    status: 'ongoing',
    projectPreferenceProfile: {
      tags: [`current-step:${flowId}:${stepId}`],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        activeFlowId: flowId,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

test('集成：小飞鸡 step1（壳）→ 快照 guidance + guidanceOnly，无诊断', () => {
  closeDb();
  initDb(':memory:');
  try {
    db.createNovel(
      baseNovel('guidance-shell-novel', 'xiaofeiji-novel-flow', 'xiaofeiji-novel-flow-step1')
    );
    const snapshot = resolveProjectExecutionContract('guidance-shell-novel');
    assert.ok(snapshot.flowStep);
    assert.equal(snapshot.flowStep?.assetId, 'square-182');
    assert.equal(snapshot.flowStep?.availability, 'guidance');
    assert.equal(snapshot.flowStep?.guidanceOnly, true);
    assert.equal(snapshot.flowStep?.guidanceWarning, undefined);
    // 壳资产的转投语不得进入步骤 prompt（Plan 261 修复⑬的行为保持不变）。
    assert.ok(!snapshot.flowStep?.prompt.includes('围绕'));
  } finally {
    closeDb();
  }
});

test('集成：通用链 step5（真资产）→ 快照 asset + guidanceOnly=false', () => {
  closeDb();
  initDb(':memory:');
  try {
    db.createNovel(baseNovel('guidance-asset-novel', 'generic-novel-flow', 'generic-novel-flow-step5'));
    const snapshot = resolveProjectExecutionContract('guidance-asset-novel');
    assert.ok(snapshot.flowStep);
    assert.equal(snapshot.flowStep?.assetId, 'core-slop-shield');
    assert.equal(snapshot.flowStep?.availability, 'asset');
    assert.equal(snapshot.flowStep?.guidanceOnly, false);
    assert.equal(snapshot.flowStep?.guidanceWarning, undefined);
  } finally {
    closeDb();
  }
});

test('集成：未声明的壳步骤（临时声明撤销）→ unavailable + 静默壳诊断', () => {
  const step = SKILL_SERIES_FLOWS.find((flow) => flow.id === 'tianma-outline-flow')?.steps.find(
    (item) => item.id === 'tianma-outline-flow-step1'
  );
  assert.ok(step);
  const original = step!.guidanceOnly;
  closeDb();
  initDb(':memory:');
  try {
    (step as unknown as { guidanceOnly?: boolean }).guidanceOnly = undefined;
    db.createNovel(baseNovel('guidance-silent-novel', 'tianma-outline-flow', 'tianma-outline-flow-step1'));
    const snapshot = resolveProjectExecutionContract('guidance-silent-novel');
    assert.equal(snapshot.flowStep?.availability, 'unavailable');
    assert.equal(snapshot.flowStep?.guidanceOnly, false);
    assert.equal(snapshot.flowStep?.guidanceWarning, 'FLOW_STEP_GUIDANCE_UNDECLARED_SHELL');
  } finally {
    (step as unknown as { guidanceOnly?: boolean }).guidanceOnly = original;
    closeDb();
  }
});
