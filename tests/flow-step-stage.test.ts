import test from 'node:test';
import assert from 'node:assert/strict';
import type { CapabilityStage } from '../shared/types/capability-execution.js';
import { closeDb, createNovel, initDb } from '../server/lib/db.js';
import { resolveProjectExecutionContract } from '../server/helpers/writing-style-service.js';
import { SKILL_SERIES_FLOWS } from '../shared/lib/prompt-governance-catalog.js';
import {
  FLOW_OUTPUT_STAGE_CLASS,
  FLOW_STEP_STAGES,
  resolveFlowStepStage,
  stageClassForFlowOutput,
  stageDistributionOfFlows,
  stageForFlowOutput,
} from '../shared/lib/flow-step-stage.js';

const markerFor = (name: string) => `【流程步骤：${name}】`;

test('step stage declaration wins over the asset stage in both directions', () => {
  const planningOnWriterAsset = resolveFlowStepStage({ stage: 'planner' }, { assetStage: 'writer' });
  assert.equal(planningOnWriterAsset.stage, 'planner');
  assert.equal(planningOnWriterAsset.source, 'declared');
  assert.deepEqual(planningOnWriterAsset.warnings, []);

  const reviewOnPlannerAsset = resolveFlowStepStage({ stage: 'critic' }, { assetStage: 'planner' });
  assert.equal(reviewOnPlannerAsset.stage, 'critic');
  assert.equal(reviewOnPlannerAsset.source, 'declared');

  // 目录来自数据（生成物/JSON），运行时校验仍需覆盖空白与非法值 → 用 cast 触发防御分支。
  const trimmed = resolveFlowStepStage(
    { stage: ' writer ' as CapabilityStage },
    { assetStage: 'planner' }
  );
  assert.equal(trimmed.stage, 'writer');
  assert.equal(trimmed.source, 'declared');
});

test('undeclared step falls back to the asset stage and always reports UNDECLARED', () => {
  const withAsset = resolveFlowStepStage({}, { assetStage: 'writer' });
  assert.equal(withAsset.stage, 'writer');
  assert.equal(withAsset.source, 'asset-fallback');
  assert.deepEqual(withAsset.warnings, ['FLOW_STEP_STAGE_UNDECLARED']);

  const withoutAsset = resolveFlowStepStage({}, {});
  assert.equal(withoutAsset.stage, null);
  assert.equal(withoutAsset.source, 'none');
  assert.deepEqual(withoutAsset.warnings, ['FLOW_STEP_STAGE_UNDECLARED']);

  const absentStage = resolveFlowStepStage({ stage: undefined }, { assetStage: null });
  assert.deepEqual(absentStage.warnings, ['FLOW_STEP_STAGE_UNDECLARED']);
});

test('invalid declaration is reported and never silently replaced by the asset stage', () => {
  const resolution = resolveFlowStepStage(
    { stage: 'draft' as CapabilityStage },
    { assetStage: 'writer' }
  );
  assert.equal(resolution.stage, null);
  assert.equal(resolution.source, 'none');
  assert.equal(resolution.declared, 'draft');
  assert.deepEqual(resolution.warnings, ['FLOW_STEP_STAGE_INVALID']);
  assert.deepEqual([...FLOW_STEP_STAGES], ['planner', 'writer', 'critic']);
});

test('output→stage semantic table covers every catalog output with no drift', () => {
  const outputs = new Set<string>();
  for (const flow of SKILL_SERIES_FLOWS) {
    for (const step of flow.steps) {
      outputs.add(step.output);
      const stageClass = stageClassForFlowOutput(step.output);
      assert.notEqual(stageClass, null, `${flow.id}/${step.id} 输出 ${step.output} 缺语义映射`);
      const semantic = stageForFlowOutput(step.output);
      assert.equal(semantic, step.stage, `${flow.id}/${step.id} 声明阶段与输出语义不一致`);
    }
  }
  assert.equal(outputs.size, Object.keys(FLOW_OUTPUT_STAGE_CLASS).length);
  // 四个「字面容易误读」的输出：动作性质决定语义类，而不是名字。
  assert.equal(stageClassForFlowOutput('chapters-final'), 'drafting');
  assert.equal(stageClassForFlowOutput('polished-draft'), 'drafting');
  assert.equal(stageClassForFlowOutput('chapters-final-checked'), 'review');
  assert.equal(stageClassForFlowOutput('chapters-with-highlights'), 'review');
  assert.equal(stageClassForFlowOutput('未登记输出'), null);
});

test('stage distribution of the six flows is 20 planner / 9 writer / 3 critic with zero undeclared', () => {
  const dist = stageDistributionOfFlows(SKILL_SERIES_FLOWS);
  assert.equal(dist.flows, 6);
  assert.equal(dist.steps, 32);
  assert.equal(dist.declared, 32);
  assert.equal(dist.fallback, 0);
  assert.equal(dist.invalid, 0);
  assert.equal(dist.undeclared, 0);
  assert.deepEqual(dist.byStage, { planner: 20, writer: 9, critic: 3 });
  assert.deepEqual(dist.byClass, { planning: 20, drafting: 9, review: 3 });
  assert.deepEqual(dist.undeclaredSteps, []);
  assert.deepEqual(dist.unknownOutputs, []);
  assert.deepEqual(dist.semanticMismatches, []);
});

test('every catalog step routes its prompt to the declared stage and to no other (32/32)', () => {
  closeDb();
  initDb(':memory:');
  let checked = 0;
  try {
    for (const flow of SKILL_SERIES_FLOWS) {
      for (const step of flow.steps) {
        assert.ok(step.stage, `${flow.id}/${step.id} 未声明 stage`);
        const novelId = `stage-${flow.id}-${step.id}`;
        createNovel({
          id: novelId,
          title: 'Stage',
          authorId: 'local',
          summary: '',
          status: 'ongoing',
          mountedSkillIds: [],
          mountedSkillLoadout: [],
          projectPreferenceProfile: {
            tags: [`current-step:${flow.id}:${step.id}`],
            weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
            acceptedDimensions: [],
            rejectedDimensions: [],
            notes: [],
            evidenceCount: 0,
            skillLoadoutSchemaVersion: 2,
            activeSeriesId: flow.id,
          },
          createdAt: 1,
          updatedAt: 1,
        });
        const contract = resolveProjectExecutionContract(novelId);
        const label = `${flow.id}/${step.id}`;
        assert.ok(contract.flowStep, `${label} 无 flowStep`);
        assert.equal(contract.flowStep?.stage, step.stage, `${label} 注入阶段非声明阶段`);
        assert.equal(contract.flowStep?.stageSource, 'declared', `${label} stageSource 非 declared`);
        assert.equal(contract.flowStep?.stageWarning, undefined, `${label} 带阶段诊断`);
        const declaredPrompt = contract.stagePrompts[step.stage!] || '';
        assert.match(declaredPrompt, new RegExp(markerFor(step.name)), `${label} 声明阶段缺步骤契约`);
        for (const other of FLOW_STEP_STAGES) {
          if (other === step.stage) continue;
          assert.doesNotMatch(
            contract.stagePrompts[other] || '',
            new RegExp(markerFor(step.name)),
            `${label} 步骤契约泄漏到 ${other}`
          );
        }
        checked += 1;
      }
    }
    assert.equal(checked, 32);
  } finally {
    closeDb();
  }
});

test('declaration beats a disagreeing asset stage on real contracts (old 25-writer skew regression)', () => {
  closeDb();
  initDb(':memory:');
  try {
    // 天马大纲流第 1 步：资产 square-76 的 stage 是 polish（旧口径 → writer），声明为 planner。
    createNovel({
      id: 'stage-tianma-1',
      title: 'Stage',
      authorId: 'local',
      summary: '',
      status: 'ongoing',
      mountedSkillIds: [],
      mountedSkillLoadout: [],
      projectPreferenceProfile: {
        tags: ['current-step:tianma-outline-flow:tianma-outline-flow-step1'],
        weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
        acceptedDimensions: [],
        rejectedDimensions: [],
        notes: [],
        evidenceCount: 0,
        skillLoadoutSchemaVersion: 2,
        activeSeriesId: 'tianma-outline-flow',
      },
      createdAt: 1,
      updatedAt: 1,
    });
    const planning = resolveProjectExecutionContract('stage-tianma-1');
    assert.equal(planning.flowStep?.stage, 'planner');
    assert.match(planning.stagePrompts.planner, /【流程步骤：天马爆款脑洞提炼】/);
    assert.doesNotMatch(planning.stagePrompts.writer, /【流程步骤：天马爆款脑洞提炼】/);
    assert.doesNotMatch(planning.stagePrompts.critic, /【流程步骤：天马爆款脑洞提炼】/);

    // 番茄第 1 步：资产 stage 是 polish（旧口径 → writer），动作是诊断 → 声明 critic。
    createNovel({
      id: 'stage-tomato-1',
      title: 'Stage',
      authorId: 'local',
      summary: '',
      status: 'ongoing',
      mountedSkillIds: [],
      mountedSkillLoadout: [],
      projectPreferenceProfile: {
        tags: ['current-step:tomato-platform-flow:tomato-platform-flow-step1'],
        weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
        acceptedDimensions: [],
        rejectedDimensions: [],
        notes: [],
        evidenceCount: 0,
        skillLoadoutSchemaVersion: 2,
        activeSeriesId: 'tomato-platform-flow',
      },
      createdAt: 1,
      updatedAt: 1,
    });
    const review = resolveProjectExecutionContract('stage-tomato-1');
    assert.equal(review.flowStep?.stage, 'critic');
    assert.match(review.stagePrompts.critic, new RegExp(markerFor(review.flowStep!.name)));
    assert.doesNotMatch(review.stagePrompts.writer, new RegExp(markerFor(review.flowStep!.name)));
  } finally {
    closeDb();
  }
});
