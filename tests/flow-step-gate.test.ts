import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FLOW_STEP_GATE_KINDS,
  FLOW_STEP_SKIP_REASON_MAX,
  buildFlowStepAdvanceTags,
  evaluateFlowStepGate,
  formatFlowStepSkipTag,
  getNovelSkippedSteps,
  parseFlowStepSkipTag,
  resolveFlowStepGate,
} from '../shared/lib/flow-step-gate';
import { SKILL_SERIES_FLOWS } from '../shared/lib/prompt-governance-catalog';
import { buildFallbackDraft, buildFallbackSceneBeats } from '../server/helpers/fallback-draft';
import type { FlowStepGate, Novel } from '../shared/types';

/** 一段确定能过整章交付门的草稿（与 draft-quality 测试同一夹具来源）。 */
function passingChapterDraft(): string {
  const beats = buildFallbackSceneBeats('主角潜入账房，发现账册缺了一页');
  return buildFallbackDraft(beats, '关键人物：\n- 林舟：账房先生');
}

function novelWithTags(tags: string[]): Novel {
  return { id: 'n1', title: '测试', projectPreferenceProfile: { tags } } as unknown as Novel;
}

// ── 声明解析 ─────────────────────────────────────────────────────

test('未声明 gate 的步骤不做判定（解析为 null）', () => {
  assert.equal(resolveFlowStepGate(undefined), null);
  assert.equal(resolveFlowStepGate({}), null);
  assert.equal(resolveFlowStepGate({ gate: { kind: 'nope' as never } }), null);
});

test('目录中的门声明只落在 generic-novel-flow 的 step5/step6', () => {
  const flow = SKILL_SERIES_FLOWS.find((entry) => entry.id === 'generic-novel-flow');
  assert.ok(flow, 'generic-novel-flow 必须存在');
  const step5 = flow.steps.find((step) => step.id === 'generic-novel-flow-step5');
  const step6 = flow.steps.find((step) => step.id === 'generic-novel-flow-step6');
  assert.deepEqual(step5?.gate, { kind: 'mechanical' });
  assert.deepEqual(step6?.gate, { kind: 'critic', threshold: 80 });

  const xiaofeiji = SKILL_SERIES_FLOWS.find((entry) => entry.id === 'xiaofeiji-novel-flow');
  assert.ok(xiaofeiji, 'xiaofeiji-novel-flow 必须存在');
  assert.equal(
    xiaofeiji.steps.every((step) => step.gate === undefined),
    true,
    '未声明门的链路必须保持无门（旧行为不变）'
  );
});

// ── 未声明 / 非法声明 ───────────────────────────────────────────

test('未声明 gate → pass + UNDECLARED（旧行为不变）', () => {
  const result = evaluateFlowStepGate({ gate: undefined, draftText: '' });
  assert.equal(result.status, 'pass');
  assert.equal(result.kind, null);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.warnings, ['FLOW_STEP_GATE_UNDECLARED']);
});

test('未知门类型 / 非法阈值 → blocked（不确认就不放行）', () => {
  const unknownKind = evaluateFlowStepGate({ gate: { kind: 'nope' } as unknown as FlowStepGate });
  assert.equal(unknownKind.status, 'blocked');
  assert.ok(unknownKind.warnings.includes('FLOW_STEP_GATE_KIND_INVALID'));

  const badThreshold = evaluateFlowStepGate({
    gate: { kind: 'critic', threshold: 0 },
    critic: { status: 'pass', score: 90 },
  });
  assert.equal(badThreshold.status, 'blocked');
  assert.ok(badThreshold.warnings.includes('FLOW_STEP_GATE_THRESHOLD_INVALID'));

  const nanThreshold = evaluateFlowStepGate({
    gate: { kind: 'mechanical', threshold: Number.NaN },
  });
  assert.equal(nanThreshold.status, 'blocked');
  assert.ok(nanThreshold.warnings.includes('FLOW_STEP_GATE_THRESHOLD_INVALID'));
});

// ── mechanical 门 ────────────────────────────────────────────────

test('mechanical 门：无草稿 → blocked + DRAFT_MISSING', () => {
  const result = evaluateFlowStepGate({ gate: { kind: 'mechanical' }, draftText: '   ' });
  assert.equal(result.status, 'blocked');
  assert.ok(result.warnings.includes('FLOW_STEP_GATE_DRAFT_MISSING'));
  assert.deepEqual(result.reasons, ['未提供草稿文本，无法执行机械门校验']);
});

test('mechanical 门：未过整章交付门 → blocked，原因取 violations', () => {
  const result = evaluateFlowStepGate({
    gate: { kind: 'mechanical' },
    draftText: '他只说了一句：这不是正文该有的样子。',
  });
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.length > 0, '必须给出可读原因');
  assert.equal(typeof result.evidence.mechanicalScore, 'number');
  assert.ok((result.evidence.violations?.length ?? 0) > 0);
  assert.ok((result.evidence.draftChars ?? 0) > 0, '草稿字符数必须进入证据');
});

test('mechanical 门：合规整章草稿 → pass', () => {
  const draft = passingChapterDraft();
  const result = evaluateFlowStepGate({ gate: { kind: 'mechanical' }, draftText: draft });
  assert.equal(result.status, 'pass', result.reasons.join('；'));
  assert.ok((result.evidence.mechanicalScore ?? 0) >= 85);
  assert.ok((result.evidence.mechanicalScoreThreshold ?? 0) >= 85);
  assert.equal(result.evidence.mechanicalRequiredChars, 4000);
  assert.ok((result.evidence.draftChars ?? 0) >= 4000);
});

test('mechanical 门：threshold 调整字符门档位，实际生效值按 [800,4000] 夹取', () => {
  const short = '他只说了一句：这不是正文该有的样子。';
  // 声明 100 → 夹取到场景下限 800；原因文案里的门槛即实际生效值。
  const clampedUp = evaluateFlowStepGate({
    gate: { kind: 'mechanical', threshold: 100 },
    draftText: short,
  });
  assert.equal(clampedUp.status, 'blocked');
  assert.equal(clampedUp.evidence.mechanicalRequiredChars, 800);
  assert.ok(
    clampedUp.reasons.some((reason) => reason.includes('800')),
    `原因必须写出实际门槛，实际=${clampedUp.reasons.join('；')}`
  );

  // 声明超大值 → 夹取到整章上限 4000，不能突破整章交付合同。
  const clampedDown = evaluateFlowStepGate({
    gate: { kind: 'mechanical', threshold: 999999 },
    draftText: passingChapterDraft(),
  });
  assert.equal(clampedDown.status, 'pass');
  assert.equal(clampedDown.evidence.mechanicalRequiredChars, 4000);
});

// ── critic 门 ───────────────────────────────────────────────────

test('critic 门：未运行 / unknown / fail → blocked', () => {
  const notRun = evaluateFlowStepGate({ gate: { kind: 'critic' }, critic: { status: 'not_run' } });
  assert.equal(notRun.status, 'blocked');
  assert.ok(notRun.warnings.includes('FLOW_STEP_GATE_CRITIC_MISSING'));

  const missing = evaluateFlowStepGate({ gate: { kind: 'critic' }, critic: null });
  assert.equal(missing.status, 'blocked');
  assert.ok(missing.warnings.includes('FLOW_STEP_GATE_CRITIC_MISSING'));

  const unknown = evaluateFlowStepGate({ gate: { kind: 'critic' }, critic: { status: 'unknown' } });
  assert.equal(unknown.status, 'blocked');
  assert.deepEqual(unknown.reasons, ['审稿结果不可验证（unknown），未确认达标前不放行']);

  const failed = evaluateFlowStepGate({
    gate: { kind: 'critic' },
    critic: { status: 'fail', score: 62 },
  });
  assert.equal(failed.status, 'blocked');
  assert.match(failed.reasons[0], /62/);
});

test('critic 门：pass 但分数低于阈值 → blocked；缺分数且声明阈值 → blocked', () => {
  const belowThreshold = evaluateFlowStepGate({
    gate: { kind: 'critic', threshold: 80 },
    critic: { status: 'pass', score: 62 },
  });
  assert.equal(belowThreshold.status, 'blocked');
  assert.match(belowThreshold.reasons[0], /62/);
  assert.match(belowThreshold.reasons[0], /80/);

  const noScore = evaluateFlowStepGate({
    gate: { kind: 'critic', threshold: 80 },
    critic: { status: 'pass' },
  });
  assert.equal(noScore.status, 'blocked');
  assert.ok(noScore.warnings.includes('FLOW_STEP_GATE_CRITIC_SCORE_MISSING'));

  const atThreshold = evaluateFlowStepGate({
    gate: { kind: 'critic', threshold: 80 },
    critic: { status: 'pass', score: 80 },
  });
  assert.equal(atThreshold.status, 'pass');
  assert.equal(atThreshold.evidence.criticScore, 80);

  const noThresholdDeclared = evaluateFlowStepGate({
    gate: { kind: 'critic' },
    critic: { status: 'pass' },
  });
  assert.equal(noThresholdDeclared.status, 'pass', '未声明阈值时只校验 status');
});

// ── manual 门 ───────────────────────────────────────────────────

test('manual 门：需显式人工确认', () => {
  const unconfirmed = evaluateFlowStepGate({ gate: { kind: 'manual' } });
  assert.equal(unconfirmed.status, 'blocked');
  assert.deepEqual(unconfirmed.reasons, ['该步骤需要人工确认后方可推进']);

  const confirmed = evaluateFlowStepGate({ gate: { kind: 'manual' }, confirmed: true });
  assert.equal(confirmed.status, 'pass');
});

// ── 逃生门（跳过记录） ───────────────────────────────────────────

test('跳过必须带原因：空原因不产生 skipped，非空原因归一后记录', () => {
  const noReason = evaluateFlowStepGate({
    gate: { kind: 'mechanical' },
    draftText: '',
    skipReason: '   ',
  });
  assert.equal(noReason.status, 'blocked', '空原因不允许跳过');

  const blockedThenSkipped = evaluateFlowStepGate({
    gate: { kind: 'critic', threshold: 80 },
    critic: { status: 'fail', score: 40 },
    skipReason: '  初稿  尚未定稿，先推进流程  ',
  });
  assert.equal(blockedThenSkipped.status, 'skipped');
  assert.equal(blockedThenSkipped.skipReason, '初稿 尚未定稿，先推进流程');
  assert.ok(blockedThenSkipped.warnings.includes('FLOW_STEP_GATE_SKIP_RECORDED'));
  assert.ok(blockedThenSkipped.reasons.length > 0, '跳过仍保留「本会被拦」的原因供审计');
  assert.ok(!blockedThenSkipped.warnings.includes('FLOW_STEP_GATE_SKIP_WITHOUT_BLOCK'));

  const longReason = 'x'.repeat(FLOW_STEP_SKIP_REASON_MAX + 50);
  const truncated = evaluateFlowStepGate({
    gate: { kind: 'mechanical' },
    draftText: '',
    skipReason: longReason,
  });
  assert.equal(truncated.skipReason?.length, FLOW_STEP_SKIP_REASON_MAX);

  const pointless = evaluateFlowStepGate({
    gate: { kind: 'manual' },
    confirmed: true,
    skipReason: '本可推进但仍选择跳过',
  });
  assert.equal(pointless.status, 'skipped');
  assert.ok(pointless.warnings.includes('FLOW_STEP_GATE_SKIP_WITHOUT_BLOCK'));
});

test('跳过标签往返：原因可含冒号，空参数不生成标签', () => {
  const tag = formatFlowStepSkipTag('generic-novel-flow', 'generic-novel-flow-step6', '先推进：稍后补审稿');
  assert.equal(tag, 'skipped-step:generic-novel-flow:generic-novel-flow-step6:先推进：稍后补审稿');
  assert.deepEqual(parseFlowStepSkipTag(tag), {
    seriesId: 'generic-novel-flow',
    stepId: 'generic-novel-flow-step6',
    reason: '先推进：稍后补审稿',
  });
  assert.equal(formatFlowStepSkipTag('', 'step', '原因'), '');
  assert.equal(formatFlowStepSkipTag('flow', 'step', '   '), '');
  assert.equal(parseFlowStepSkipTag('completed-step:flow:step1'), null);
  assert.equal(parseFlowStepSkipTag('skipped-step:flow:step1'), null);
});

test('跳过原因可查询：按链路读回，其他链路与已清理记录不出现', () => {
  const tags = [
    'skipped-step:generic-novel-flow:generic-novel-flow-step5:草稿未定稿',
    'skipped-step:generic-novel-flow:generic-novel-flow-step6:审稿未跑',
    'skipped-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1:其他链路',
    'current-step:generic-novel-flow:generic-novel-flow-step6',
  ];
  assert.deepEqual(getNovelSkippedSteps(novelWithTags(tags), 'generic-novel-flow'), [
    { stepId: 'generic-novel-flow-step5', reason: '草稿未定稿' },
    { stepId: 'generic-novel-flow-step6', reason: '审稿未跑' },
  ]);
  assert.deepEqual(getNovelSkippedSteps(novelWithTags([]), 'generic-novel-flow'), []);
});

// ── 推进标签（单一出口） ─────────────────────────────────────────

test('推进标签：复刻旧行为（保无关标签 + 完成入列 + current/completed-flow）', () => {
  const tags = buildFlowStepAdvanceTags({
    activeSeriesId: 'xiaofeiji-novel-flow',
    tags: [
      'other-tag',
      'current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1',
      'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1',
      'current-step:other-flow:other-flow-step1',
    ],
    completedStepIds: ['xiaofeiji-novel-flow-step1'],
    currentStepId: 'xiaofeiji-novel-flow-step2',
    nextStepId: 'xiaofeiji-novel-flow-step3',
  });
  assert.deepEqual(tags, [
    'other-tag',
    'current-step:other-flow:other-flow-step1',
    'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1',
    'completed-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step2',
    'current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step3',
  ]);

  const lastStep = buildFlowStepAdvanceTags({
    activeSeriesId: 'xiaofeiji-novel-flow',
    tags: [],
    completedStepIds: ['xiaofeiji-novel-flow-step1'],
    currentStepId: 'xiaofeiji-novel-flow-step2',
    nextStepId: null,
  });
  assert.ok(lastStep.includes('completed-flow:xiaofeiji-novel-flow'));
  assert.equal(lastStep.some((tag) => tag.startsWith('current-step:xiaofeiji-novel-flow:')), false);
});

test('推进标签：跳过记录原因、仍计入完成；不带原因重新完成清除旧记录', () => {
  const skipped = buildFlowStepAdvanceTags({
    activeSeriesId: 'generic-novel-flow',
    tags: ['current-step:generic-novel-flow:generic-novel-flow-step6'],
    completedStepIds: [],
    currentStepId: 'generic-novel-flow-step6',
    nextStepId: null,
    skipReason: '审稿未跑，先推进',
  });
  assert.ok(skipped.includes('completed-step:generic-novel-flow:generic-novel-flow-step6'));
  assert.ok(skipped.includes('completed-flow:generic-novel-flow'));
  assert.ok(
    skipped.includes('skipped-step:generic-novel-flow:generic-novel-flow-step6:审稿未跑，先推进')
  );

  const redone = buildFlowStepAdvanceTags({
    activeSeriesId: 'generic-novel-flow',
    tags: [
      'skipped-step:generic-novel-flow:generic-novel-flow-step6:审稿未跑，先推进',
      'skipped-step:generic-novel-flow:generic-novel-flow-step5:另一条旧记录',
    ],
    completedStepIds: ['generic-novel-flow-step5'],
    currentStepId: 'generic-novel-flow-step6',
    nextStepId: null,
  });
  assert.equal(
    redone.some((tag) => tag.includes('generic-novel-flow-step6:审稿未跑')),
    false,
    '重新完成该步必须清掉旧跳过记录'
  );
  assert.ok(
    redone.includes('skipped-step:generic-novel-flow:generic-novel-flow-step5:另一条旧记录'),
    '其他步骤的旧记录不受影响'
  );
});

test('门类型枚举是外露契约（三值）', () => {
  assert.deepEqual([...FLOW_STEP_GATE_KINDS], ['mechanical', 'critic', 'manual']);
});
