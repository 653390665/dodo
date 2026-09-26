/**
 * 链路稳定性 / 确定性守卫（跨链路）。
 *
 * 钉住四件事：
 * ① 确定性：同输入重复解析 34 步执行契约，指纹逐字节一致（与解析顺序、时钟无关）；
 * ② 跨链路隔离：一条链路的步骤契约（`【流程步骤：…】` marker）不泄漏进另一条链路，
 *    多作品同库互不影响；
 * ③ 状态隔离：跳过记录（`skipped-step:`）按 seriesId 过滤，往返稳定、推进不重复膨胀；
 * ④ 生成源稳定：公开目录（链路定义唯一来源）重复构建 + 时钟位移逐字节一致。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import { closeDb, createNovel, initDb } from '../server/lib/db.js';
import { resolveProjectExecutionContract } from '../server/helpers/writing-style-service.js';
import { SKILL_SERIES_FLOWS } from '../shared/lib/prompt-governance-catalog.js';
import {
  buildFlowStepAdvanceTags,
  formatFlowStepSkipTag,
  getNovelSkippedSteps,
  parseFlowStepSkipTag,
} from '../shared/lib/flow-step-gate.js';
import {
  buildPublicCatalogModel,
  renderPublicCatalogModule,
} from '../scripts/lib/public-catalog-pipeline.js';
import type { ExecutionSnapshot } from '../shared/types/capability-execution.js';
import type { Novel } from '../shared/types/novel.js';

type FlowStep = (typeof SKILL_SERIES_FLOWS)[number]['steps'][number];

const ALL_STEPS: { flowId: string; step: FlowStep }[] = SKILL_SERIES_FLOWS.flatMap((flow) =>
  flow.steps.map((step) => ({ flowId: flow.id, step }))
);
const novelIdFor = (flowId: string, stepId: string) => `det-${flowId}-${stepId}`;
const markerFor = (name: string) => `【流程步骤：${name}】`;
const hashOf = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

function seedFlowNovel(id: string, flowId: string, stepId: string): void {
  createNovel({
    id,
    title: 'Determinism',
    authorId: 'local',
    summary: '',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    projectPreferenceProfile: {
      tags: [`current-step:${flowId}:${stepId}`],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      skillLoadoutSchemaVersion: 2,
      activeSeriesId: flowId,
    },
    createdAt: 1,
    updatedAt: 1,
  });
}

function seedAllFlowNovels(): void {
  for (const { flowId, step } of ALL_STEPS) {
    seedFlowNovel(novelIdFor(flowId, step.id), flowId, step.id);
  }
}

/** 只投影与链路/注入有关的字段：时间戳等 db 元数据不参与确定性判定。 */
function contractFingerprint(snapshot: ExecutionSnapshot): string {
  return hashOf({
    flowStep: snapshot.flowStep,
    stagePrompts: snapshot.stagePrompts,
    skillStack: snapshot.skillStack,
  });
}

test('六条链路 34 步：重复解析的契约指纹逐字节一致（确定性）', () => {
  closeDb();
  initDb(':memory:');
  try {
    seedAllFlowNovels();
    let checked = 0;
    for (const { flowId, step } of ALL_STEPS) {
      const id = novelIdFor(flowId, step.id);
      const first = resolveProjectExecutionContract(id);
      const second = resolveProjectExecutionContract(id);
      assert.equal(
        contractFingerprint(first),
        contractFingerprint(second),
        `${flowId}/${step.id} 重复解析指纹不一致`
      );
      assert.equal(first.flowStep?.stage, step.stage, `${flowId}/${step.id} 阶段非声明值`);
      assert.equal(
        first.flowStep?.stageSource,
        'declared',
        `${flowId}/${step.id} stageSource 非 declared`
      );
      checked += 1;
    }
    assert.equal(checked, 34);
  } finally {
    closeDb();
  }
});

test('链路之间不串台：任一链路的步骤契约只出现在自己的三层提示词里（34×33 对照）', () => {
  closeDb();
  initDb(':memory:');
  try {
    seedAllFlowNovels();
    const prompts = new Map<string, { planner: string; writer: string; critic: string }>();
    for (const { flowId, step } of ALL_STEPS) {
      const snapshot = resolveProjectExecutionContract(novelIdFor(flowId, step.id));
      prompts.set(`${flowId}/${step.id}`, {
        planner: snapshot.stagePrompts.planner,
        writer: snapshot.stagePrompts.writer,
        critic: snapshot.stagePrompts.critic,
      });
    }
    let comparisons = 0;
    for (const source of ALL_STEPS) {
      const marker = markerFor(source.step.name);
      for (const target of ALL_STEPS) {
        if (source.flowId === target.flowId && source.step.id === target.step.id) continue;
        const targetPrompts = prompts.get(`${target.flowId}/${target.step.id}`);
        assert.ok(targetPrompts, `${target.flowId}/${target.step.id} 无契约提示词`);
        for (const stage of ['planner', 'writer', 'critic'] as const) {
          assert.ok(
            !targetPrompts[stage].includes(marker),
            `${source.flowId}/${source.step.id} 的步骤契约泄漏进 ${target.flowId}/${target.step.id} 的 ${stage}`
          );
        }
        comparisons += 1;
      }
    }
    assert.equal(comparisons, 34 * 33);
  } finally {
    closeDb();
  }
});

test('解析顺序无关：解析其它 31 条步骤不改变本链路契约（无共享可变状态）', () => {
  closeDb();
  initDb(':memory:');
  try {
    seedAllFlowNovels();
    const targetFlow = SKILL_SERIES_FLOWS[0];
    const targetStep = targetFlow.steps[0];
    const targetId = novelIdFor(targetFlow.id, targetStep.id);
    const before = contractFingerprint(resolveProjectExecutionContract(targetId));
    for (const { flowId, step } of [...ALL_STEPS].reverse()) {
      if (flowId === targetFlow.id && step.id === targetStep.id) continue;
      resolveProjectExecutionContract(novelIdFor(flowId, step.id));
    }
    const after = contractFingerprint(resolveProjectExecutionContract(targetId));
    assert.equal(after, before, '解析其它链路后本链路契约发生变化');
  } finally {
    closeDb();
  }
});

test('时钟位移不改变任何链路契约（链路提示词无时间泄漏）', () => {
  closeDb();
  initDb(':memory:');
  try {
    seedAllFlowNovels();
    const sample = SKILL_SERIES_FLOWS.slice(0, 3).map((flow) => ({
      flowId: flow.id,
      stepId: flow.steps[0].id,
    }));
    assert.equal(sample.length, 3, '取样链路缺失');
    const baseline = new Map(
      sample.map((entry) => [
        `${entry.flowId}/${entry.stepId}`,
        contractFingerprint(resolveProjectExecutionContract(novelIdFor(entry.flowId, entry.stepId))),
      ])
    );
    for (const now of [1_700_000_000_000, 2_000_000_000_000]) {
      mock.timers.enable({ apis: ['Date'], now });
      try {
        for (const entry of sample) {
          const key = `${entry.flowId}/${entry.stepId}`;
          assert.equal(
            contractFingerprint(resolveProjectExecutionContract(novelIdFor(entry.flowId, entry.stepId))),
            baseline.get(key),
            `时钟 ${now} 下 ${key} 契约指纹变化`
          );
        }
      } finally {
        mock.timers.reset();
      }
    }
  } finally {
    closeDb();
  }
});

test('跳过记录按链路隔离，往返保真、标签推进不重复膨胀', () => {
  const stepId = 'shared-step-id';
  const reason = '等素材齐了再回填（含:冒号）';
  const seriesA = 'flow-a';
  const seriesB = 'flow-b';

  // 纯函数确定性：同输入两次结果一致。
  const input = {
    activeSeriesId: seriesA,
    tags: [`current-step:${seriesA}:${stepId}`],
    completedStepIds: [] as readonly string[],
    currentStepId: stepId,
    nextStepId: null,
    skipReason: reason,
  };
  const once = buildFlowStepAdvanceTags(input);
  const twice = buildFlowStepAdvanceTags(input);
  assert.deepEqual(twice, once, '同输入两次推进结果不一致');

  // 往返保真：原因里的冒号不破坏解析。
  assert.deepEqual(parseFlowStepSkipTag(formatFlowStepSkipTag(seriesA, stepId, reason)), {
    seriesId: seriesA,
    stepId,
    reason,
  });

  // 链路间隔离：flow-a 的跳过记录对 flow-b 不可见。
  const novelWithSkip = {
    projectPreferenceProfile: { tags: once },
  } as unknown as Novel;
  assert.deepEqual(getNovelSkippedSteps(novelWithSkip, seriesA), [{ stepId, reason }]);
  assert.deepEqual(getNovelSkippedSteps(novelWithSkip, seriesB), []);

  // 推进稳定性：连续推进两步后标签不重复（无膨胀）。
  const firstAdvance = buildFlowStepAdvanceTags({
    activeSeriesId: seriesA,
    tags: [`current-step:${seriesA}:step-1`],
    completedStepIds: [],
    currentStepId: 'step-1',
    nextStepId: 'step-2',
  });
  const secondAdvance = buildFlowStepAdvanceTags({
    activeSeriesId: seriesA,
    tags: firstAdvance,
    completedStepIds: ['step-1'],
    currentStepId: 'step-2',
    nextStepId: 'step-3',
  });
  assert.equal(new Set(secondAdvance).size, secondAdvance.length, '推进后标签出现重复');

  // 不带原因重新完成 → 清除该步旧跳过记录（可纠正历史）。
  const cleared = buildFlowStepAdvanceTags({
    activeSeriesId: seriesA,
    tags: once,
    completedStepIds: [],
    currentStepId: stepId,
    nextStepId: 'next-step',
  });
  assert.deepEqual(
    getNovelSkippedSteps({ projectPreferenceProfile: { tags: cleared } } as unknown as Novel, seriesA),
    []
  );
});

test('链路定义源（公开目录）重复构建与时钟位移后逐字节一致', () => {
  const first = renderPublicCatalogModule(buildPublicCatalogModel().model);
  const second = renderPublicCatalogModule(buildPublicCatalogModel().model);
  assert.equal(first, second, '公开目录重复构建产物不一致');
  assert.ok(first.length > 100_000, '目录产物过小，疑似构建失败');
  mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  try {
    assert.equal(
      renderPublicCatalogModule(buildPublicCatalogModel().model),
      first,
      '时钟位移改变了目录产物'
    );
  } finally {
    mock.timers.reset();
  }
});
