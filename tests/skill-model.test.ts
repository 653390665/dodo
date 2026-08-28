import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFeedbackScore,
  getSkillScoreChannels,
  calculateSkillFitScore,
  coerceMountedSkillLoadout,
  detectSkillConflicts,
  resolveSkillLoadout,
  summarizeUsageStats,
  evaluateSkillGovernance,
} from '../src/lib/skill-model';
import type { SkillUsageRecord } from '../shared/types';

describe("skill-extraction", () => {
test('evaluateSkillGovernance reports readiness without synthesizing a score', () => {
  assert.deepEqual(evaluateSkillGovernance({
    id: 'ready', name: '可用卡', description: '说明', primaryDimension: 'style',
    dimensionTags: ['style'], style: '规则', pacing: '节奏', stabilityScore: 80,
  } as any), { status: 'ready', reasons: [] });
  const result = evaluateSkillGovernance({ id: '', name: '', description: '' } as any);
  assert.equal(result.status, 'review-required');
  assert.ok(result.reasons.length > 0);
  assert.equal('score' in result, false);
});
test('getSkillScoreChannels separates cold start and observed performance channels', () => {
  const base = {
    executionScore: 88.6,
    stabilityScore: 72.4,
    usageStats: { mountedCount: 0, acceptedCount: 0, rejectedCount: 0, revisedCount: 0, averageFitScore: 0 },
  } as any;
  assert.deepEqual(getSkillScoreChannels(base), {
    coldStartScore: 89,
    evidenceStabilityScore: 72,
    observedPerformance: null,
    governanceGate: { status: 'review-required', reasons: ['缺少能力卡标识', '缺少能力卡名称', '缺少能力卡说明', '未声明主维度', '未声明维度标签', '缺少可执行规则或示例'] },
    coldStartEvidence: { score: 89, sampleSize: 0, coverage: 0, label: '冷启动评分' },
    currentContextFit: null,
    observedUsageFeedback: null,
  });
  assert.deepEqual(getSkillScoreChannels({
    ...base,
    executionScore: 140,
    stabilityScore: -5,
    usageStats: { mountedCount: 2, acceptedCount: 1, rejectedCount: 0, revisedCount: 0, averageFitScore: 80 },
  } as any), {
    coldStartScore: 100,
    evidenceStabilityScore: 0,
    observedPerformance: { score: 71, sampleSize: 2 },
    governanceGate: { status: 'review-required', reasons: ['缺少能力卡标识', '缺少能力卡名称', '缺少能力卡说明', '未声明主维度', '未声明维度标签', '缺少可执行规则或示例'] },
    coldStartEvidence: { score: 100, sampleSize: 0, coverage: 0, label: '冷启动评分' },
    currentContextFit: null,
    observedUsageFeedback: { score: 71, sampleSize: 2 },
  });
});

test('getSkillScoreChannels uses explicit feedback including zero and stability fallback', () => {
  assert.deepEqual(getSkillScoreChannels({ stabilityScore: 61.8, usageStats: { mountedCount: 1, acceptedCount: 0, rejectedCount: 1, revisedCount: 0, averageFitScore: 0 }, feedbackScore: 0 } as any), {
    coldStartScore: null,
    evidenceStabilityScore: 62,
    observedPerformance: { score: 0, sampleSize: 1 },
    governanceGate: { status: 'review-required', reasons: ['缺少能力卡标识', '缺少能力卡名称', '缺少能力卡说明', '未声明主维度', '未声明维度标签', '缺少可执行规则或示例'] },
    coldStartEvidence: { score: null, sampleSize: 0, coverage: 0, label: '冷启动评分' },
    currentContextFit: null,
    observedUsageFeedback: { score: 0, sampleSize: 1 },
  });
  assert.deepEqual(getSkillScoreChannels({ stabilityScore: 61.8 } as any), {
    coldStartScore: null,
    evidenceStabilityScore: 62,
    observedPerformance: null,
    governanceGate: { status: 'review-required', reasons: ['缺少能力卡标识', '缺少能力卡名称', '缺少能力卡说明', '未声明主维度', '未声明维度标签', '缺少可执行规则或示例'] },
    coldStartEvidence: { score: null, sampleSize: 0, coverage: 0, label: '冷启动评分' },
    currentContextFit: null,
    observedUsageFeedback: null,
  });
});

test('getSkillScoreChannels rejects malformed usage statistics', () => {
  const valid = { mountedCount: 1, acceptedCount: 0, rejectedCount: 0, revisedCount: 0, averageFitScore: 50 };
  for (const usageStats of [
    { ...valid, averageFitScore: Number.NaN },
    { ...valid, mountedCount: 0.5 },
    { ...valid, acceptedCount: -1 },
    { ...valid, rejectedCount: Number.POSITIVE_INFINITY },
    { ...valid, revisedCount: -2 },
  ]) {
    assert.equal(getSkillScoreChannels({ executionScore: 80, feedbackScore: 0, usageStats } as any).observedPerformance, null);
  }
});

test('score contract exposes four independent channels without a composite score', () => {
  const channels = getSkillScoreChannels({
    id: 'skill', name: '卡', description: '规则', primaryDimension: 'style', dimensionTags: ['style'], style: '规则',
    executionScore: 80, stabilityScore: 70, sourceType: 'licensed',
  } as any, { requiredDimensions: ['style'], chapterSignals: ['plot'], loadout: [] });
  assert.equal(channels.governanceGate.status, 'ready');
  assert.deepEqual(channels.coldStartEvidence, { score: 80, sampleSize: 0, coverage: 0, label: '冷启动评分' });
  assert.deepEqual(channels.currentContextFit, { score: 0, signalCount: 1, sampleSize: 1 });
  assert.equal(channels.observedUsageFeedback, null);
  assert.equal('totalScore' in channels, false);
});
test('score channels count unique evidence and reject Flow assets', () => {
  const skill = { id: 'card', name: '卡', description: '规则', primaryDimension: 'style', dimensionTags: ['style'], style: '规则', executionScore: 80, evidenceMoments: ['a', 'a', 'b'] } as any;
  const channels = getSkillScoreChannels(skill, { chapterSignals: ['plot', 'plot'], assetKind: 'skill-card' });
  assert.deepEqual(channels.coldStartEvidence, { score: 80, sampleSize: 2, coverage: 2, label: '冷启动评分' });
  assert.deepEqual(channels.currentContextFit, { score: 0, signalCount: 1, sampleSize: 1 });
  const flow = getSkillScoreChannels(skill, { assetKind: 'flow' });
  assert.equal(flow.governanceGate.status, 'review-required');
  assert.match(flow.governanceGate.reasons.join(','), /非能力卡资产/);
});
test('coerceMountedSkillLoadout migrates legacy mountedSkillIds', () => {
  const loadout = coerceMountedSkillLoadout(['skill-a', 'skill-b']);
  assert.deepEqual(loadout, [
    { slot: 0, skillId: 'skill-a', weight: 1, lockedDimensions: [] },
    { slot: 1, skillId: 'skill-b', weight: 1, lockedDimensions: [] },
  ]);
});

test('resolveSkillLoadout preserves an explicitly empty v2 loadout', () => {
  assert.deepEqual(resolveSkillLoadout({
    profileVersion: 2,
    mountedSkillLoadout: [],
    mountedSkillIds: ['legacy-writer'],
  }), { loadout: [], pendingSkillIds: [] });
});

test('resolveSkillLoadout leaves ambiguous legacy slots pending', () => {
  assert.deepEqual(resolveSkillLoadout({
    mountedSkillLoadout: [{ slot: 1, skillId: 'legacy-writer', weight: 1, lockedDimensions: [] }],
  }), { loadout: [], pendingSkillIds: ['legacy-writer'] });
});

test('resolveSkillLoadout leaves duplicate legacy skill ids pending', () => {
  assert.deepEqual(resolveSkillLoadout({
    mountedSkillLoadout: [
      { slot: 0, skillId: 'same-skill', weight: 1, lockedDimensions: [] },
      { slot: 1, skillId: 'same-skill', weight: 1, lockedDimensions: [] },
    ],
  }), { loadout: [], pendingSkillIds: ['same-skill'] });
});

test('resolveSkillLoadout suggests ordered slots for legacy ids but keeps them pending', () => {
  assert.deepEqual(resolveSkillLoadout({
    mountedSkillIds: ['planner', 'writer', 'critic'],
  }), {
    loadout: [
      { slot: 0, skillId: 'planner', weight: 1, lockedDimensions: [] },
      { slot: 1, skillId: 'writer', weight: 1, lockedDimensions: [] },
      { slot: 2, skillId: 'critic', weight: 1, lockedDimensions: [] },
    ],
    pendingSkillIds: ['planner', 'writer', 'critic'],
  });
});

test('resolveSkillLoadout keeps valid v2 slots and marks malformed or duplicate entries pending', () => {
  assert.deepEqual(resolveSkillLoadout({
    profileVersion: 2,
    mountedSkillLoadout: [
      { slot: 0, skillId: 'planner', weight: 1, lockedDimensions: [] },
      { slot: 1, skillId: 'writer-a', weight: 1, lockedDimensions: [] },
      { slot: 1, skillId: 'writer-b', weight: 1, lockedDimensions: [] },
      { slot: 3, skillId: 'legacy-critic', weight: 1, lockedDimensions: [] },
    ],
    mountedSkillIds: ['old-id'],
  }), {
    loadout: [{ slot: 0, skillId: 'planner', weight: 1, lockedDimensions: [] }],
    pendingSkillIds: ['writer-a', 'writer-b', 'legacy-critic'],
  });
});

test('calculateSkillFitScore rewards dimension coverage and context matching', () => {
  const result = calculateSkillFitScore({
    requiredDimensions: ['style', 'world', 'plot'],
    chapterSignals: ['world', 'plot'],
    loadout: [
      {
        id: 'style-1',
        name: '冷峻刀锋',
        stabilityScore: 88,
        primaryDimension: 'style',
        dimensionTags: ['style'],
        compositionProfile: {
          styleWeight: 0.9,
          characterWeight: 0.2,
          worldWeight: 0.1,
          powerWeight: 0.1,
          plotWeight: 0.3,
          pacingWeight: 0.5,
          conflictTags: [],
          blendHints: [],
        },
      },
      {
        id: 'world-1',
        name: '铁血王朝',
        stabilityScore: 84,
        primaryDimension: 'world',
        dimensionTags: ['world', 'power', 'plot'],
        compositionProfile: {
          styleWeight: 0.1,
          characterWeight: 0.2,
          worldWeight: 0.8,
          powerWeight: 0.8,
          plotWeight: 0.6,
          pacingWeight: 0.3,
          conflictTags: [],
          blendHints: [],
        },
      },
    ],
  });

  assert.equal(result.breakdown.coverageScore > 0, true);
  assert.equal(result.breakdown.contextScore > 0, true);
  assert.equal(result.totalScore > 0, true);
  assert.deepEqual(result.conflicts, []);
});

test('calculateSkillFitScore counts strong composition duties beyond explicit dimension tags', () => {
  const result = calculateSkillFitScore({
    requiredDimensions: ['style', 'plot', 'pacing'],
    chapterSignals: ['plot', 'pacing'],
    loadout: [
      {
        id: 'style-1',
        name: '主笔文风卡',
        stabilityScore: 90,
        primaryDimension: 'style',
        dimensionTags: ['style'],
        compositionProfile: {
          styleWeight: 0.92,
          characterWeight: 0.2,
          worldWeight: 0.2,
          powerWeight: 0.1,
          plotWeight: 0.78,
          pacingWeight: 0.76,
          conflictTags: [],
          blendHints: [],
        },
      },
    ],
  });

  assert.equal(result.breakdown.coverageScore, 100);
  assert.equal(result.breakdown.contextScore, 100);
});

test('detectSkillConflicts reports overlapping hostile style skills', () => {
  const conflicts = detectSkillConflicts([
    {
      id: 'a',
      name: '冷峻极简',
      primaryDimension: 'style',
      dimensionTags: ['style'],
      compositionProfile: {
        styleWeight: 0.9,
        characterWeight: 0.1,
        worldWeight: 0.1,
        powerWeight: 0.1,
        plotWeight: 0.1,
        pacingWeight: 0.4,
        conflictTags: ['lush-prose'],
        blendHints: [],
      },
    },
    {
      id: 'b',
      name: '华丽抒情',
      primaryDimension: 'style',
      dimensionTags: ['style'],
      compositionProfile: {
        styleWeight: 0.9,
        characterWeight: 0.1,
        worldWeight: 0.1,
        powerWeight: 0.1,
        plotWeight: 0.1,
        pacingWeight: 0.4,
        conflictTags: ['minimal-prose'],
        blendHints: [],
      },
    },
  ]);

  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].reason, /shared-style-dimensions/);
});

test('calculateSkillFitScore returns capability-oriented recommendation copy when conflicts exist', () => {
  const result = calculateSkillFitScore({
    requiredDimensions: ['style'],
    chapterSignals: ['style'],
    loadout: [
      {
        id: 'a',
        primaryDimension: 'style',
        dimensionTags: ['style'],
        compositionProfile: {
          styleWeight: 0.9,
          characterWeight: 0.1,
          worldWeight: 0.1,
          powerWeight: 0.1,
          plotWeight: 0.1,
          pacingWeight: 0.4,
          conflictTags: ['lush-prose'],
          blendHints: [],
        },
      },
      {
        id: 'b',
        primaryDimension: 'style',
        dimensionTags: ['style'],
        compositionProfile: {
          styleWeight: 0.9,
          characterWeight: 0.1,
          worldWeight: 0.1,
          powerWeight: 0.1,
          plotWeight: 0.1,
          pacingWeight: 0.4,
          conflictTags: ['minimal-prose'],
          blendHints: [],
        },
      },
    ],
  });

  assert.equal(result.recommendations[0], '考虑替换存在作用冲突的能力卡');
});

test('summarizeUsageStats aggregates usage feedback', () => {
  const records: SkillUsageRecord[] = [
    {
      id: '1',
      novelId: 'novel-1',
      mountedSkillIds: ['skill-a'],
      fitScore: 82,
      userAction: 'accepted',
      createdAt: 1,
    },
    {
      id: '2',
      novelId: 'novel-1',
      mountedSkillIds: ['skill-a'],
      fitScore: 64,
      userAction: 'revised',
      createdAt: 2,
    },
    {
      id: '3',
      novelId: 'novel-1',
      mountedSkillIds: ['skill-a'],
      fitScore: 40,
      userAction: 'rejected',
      createdAt: 3,
    },
  ];

  assert.deepEqual(summarizeUsageStats(records), {
    mountedCount: 3,
    acceptedCount: 1,
    rejectedCount: 1,
    revisedCount: 1,
    averageFitScore: 62,
  });
});

test('calculateFeedbackScore produces a bounded recommendation score', () => {
  const score = calculateFeedbackScore({
    mountedCount: 4,
    acceptedCount: 2,
    rejectedCount: 1,
    revisedCount: 1,
    averageFitScore: 78,
  });

  assert.equal(score >= 0 && score <= 100, true);
  assert.equal(score > 50, true);
});
});
