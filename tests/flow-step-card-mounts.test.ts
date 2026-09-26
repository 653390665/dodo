/**
 * Plan 262 C1「cardRef 挂真实步骤」测试（docs/specs/capability-flow-graph-consolidation.md §5.15）。
 *
 * ① 目录声明：番茄 / 天马 / 拆书 / 风华 / 小飞鸡 五条平台链路各 ≥1 步挂 `cardRef`，
 *    且每步挂卡都能解析（角色投影一致、阶段 = 步骤声明阶段、无诊断）；
 * ② 集成：逐条挂卡步骤 → 声明阶段 prompt 命中「【步骤卡：ID（role）】」+ 卡面特征串，其它阶段不命中；
 * ③ 回归：未挂卡步骤仍走 assetId 路径（`stagePrompts` 缺省、三阶段不含步骤卡标记）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import { resolveProjectExecutionContract } from '../server/helpers/writing-style-service.js';
import { SKILL_SERIES_FLOWS, PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';
import { CAPABILITY_STAGES, resolveFlowStepCard } from '../shared/lib/flow-step-card-slot.js';
import type { Novel } from '../shared/types.js';

const PLATFORM_FLOW_IDS = [
  'tomato-platform-flow',
  'tianma-outline-flow',
  'book-deconstruction-flow',
  'fenghua-short-flow',
  'xiaofeiji-novel-flow',
] as const;

const MOUNTS = [
  { flowId: 'xiaofeiji-novel-flow', stepId: 'xiaofeiji-novel-flow-step1', cardId: 'private-181', role: 'rule', stage: 'planner' },
  { flowId: 'tianma-outline-flow', stepId: 'tianma-outline-flow-step4', cardId: 'private-168', role: 'rule', stage: 'planner' },
  { flowId: 'fenghua-short-flow', stepId: 'fenghua-short-flow-step1', cardId: 'private-89', role: 'rule', stage: 'planner' },
  { flowId: 'book-deconstruction-flow', stepId: 'book-deconstruction-flow-step2', cardId: 'deconstruction-pacing-dissect', role: 'rule', stage: 'planner' },
  { flowId: 'tomato-platform-flow', stepId: 'tomato-platform-flow-step2', cardId: 'de-ai-tells-guard', role: 'rule', stage: 'writer' },
  { flowId: 'tomato-platform-flow', stepId: 'tomato-platform-flow-step3', cardId: 'tomato-opening-diagnostic', role: 'diagnostic', stage: 'critic' },
] as const;

function flowOf(flowId: string) {
  const flow = SKILL_SERIES_FLOWS.find((item) => item.id === flowId);
  assert.ok(flow, `${flowId} must exist`);
  return flow!;
}

function stepOf(flowId: string, stepId: string) {
  const step = flowOf(flowId).steps.find((item) => item.id === stepId);
  assert.ok(step, `${stepId} must exist`);
  return step!;
}

function allMounted() {
  return SKILL_SERIES_FLOWS.flatMap((flow) =>
    flow.steps.filter((step) => step.cardRef).map((step) => ({ flowId: flow.id, step }))
  );
}

/** 卡面特征串：去空白后的前 24 字（与 marker 一并构成可归因命中）。 */
function cardTextSignature(cardId: string): string {
  const asset = PROMPT_GOVERNANCE_CATALOG.find((item) => item.id === cardId);
  assert.ok(asset, `${cardId} must exist in catalog`);
  return (asset!.template ?? '').replace(/\s+/g, '').slice(0, 24);
}

function baseNovel(id: string, flowId: string, stepId: string): Novel {
  return {
    id,
    title: `Mount ${stepId}`,
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

test('目录声明：五条平台链路各 ≥1 步挂 cardRef，共 6 步且全部可解析', () => {
  const mounted = allMounted();
  assert.equal(mounted.length, 6, mounted.map((item) => item.step.id).join(', '));
  const byFlow = new Map<string, number>();
  for (const { flowId } of mounted) byFlow.set(flowId, (byFlow.get(flowId) ?? 0) + 1);
  for (const flowId of PLATFORM_FLOW_IDS) {
    assert.ok((byFlow.get(flowId) ?? 0) >= 1, `${flowId} 至少 1 步挂卡`);
  }
  for (const { flowId, step } of mounted) {
    const attempt = resolveFlowStepCard(step);
    const resolved = attempt.resolution;
    assert.ok(resolved, `${flowId}/${step.id} 应能解析（warning=${attempt.warning ?? 'none'}）`);
    assert.equal(resolved!.warning, undefined, `${step.id} 不应有角色不一致诊断`);
    assert.equal(resolved!.projectedRole, step.cardRef!.role, `${step.id} 声明角色应与投影一致`);
    assert.deepEqual([...resolved!.stages], [step.stage], `${step.id} 卡面阶段应等于步骤声明阶段`);
    assert.ok(resolved!.prompt.length > 0, `${step.id} 卡面正文非空`);
  }
});

for (const mount of MOUNTS) {
  test(`集成：${mount.stepId} 挂卡 → 仅 ${mount.stage} prompt 命中卡面`, () => {
    const novelId = `mount-${mount.stepId}`;
    closeDb();
    initDb(':memory:');
    try {
      db.createNovel(baseNovel(novelId, mount.flowId, mount.stepId));
      const snapshot = resolveProjectExecutionContract(novelId);
      const marker = `【步骤卡：${mount.cardId}（${mount.role}）】`;
      const signature = cardTextSignature(mount.cardId);
      const prompt = snapshot.stagePrompts[mount.stage];
      assert.ok(prompt.includes(marker), `${mount.stage} 应含步骤卡标记`);
      // 卡面正文原样注入（含换行缩进）→ 比对前统一去空白，只钉「特征串确实进了该阶段」。
      assert.ok(
        prompt.replace(/\s+/g, '').includes(signature),
        `${mount.stage} 应含卡面特征串「${signature}」`
      );
      for (const stage of CAPABILITY_STAGES) {
        if (stage === mount.stage) continue;
        assert.ok(!snapshot.stagePrompts[stage].includes(marker), `${stage} 不得命中未声明阶段的卡面`);
      }
      assert.equal(snapshot.flowStep?.cardId, mount.cardId);
      assert.equal(snapshot.flowStep?.cardRole, mount.role);
      assert.deepEqual([...(snapshot.flowStep?.cardStages ?? [])], [mount.stage]);
      assert.equal(snapshot.flowStep?.cardWarning, undefined);
      // assetId 路径保留（回退不被破坏）
      assert.equal(snapshot.flowStep?.assetId, stepOf(mount.flowId, mount.stepId).assetId);
    } finally {
      closeDb();
    }
  });
}

test('回归：未挂卡步骤仍走 assetId 路径（stagePrompts 缺省、无步骤卡标记）', () => {
  closeDb();
  initDb(':memory:');
  try {
    db.createNovel(baseNovel('mount-none', 'generic-novel-flow', 'generic-novel-flow-step5'));
    const snapshot = resolveProjectExecutionContract('mount-none');
    assert.ok(snapshot.flowStep);
    assert.equal(snapshot.flowStep?.assetId, 'core-slop-shield');
    assert.equal(snapshot.flowStep?.cardId, undefined);
    assert.equal(snapshot.flowStep?.stagePrompts, undefined);
    for (const stage of CAPABILITY_STAGES) {
      assert.ok(!snapshot.stagePrompts[stage].includes('【步骤卡：'), `${stage} 不应有步骤卡块`);
    }
  } finally {
    closeDb();
  }
});
