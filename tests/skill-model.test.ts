import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFeedbackScore,
  calculateSkillFitScore,
  coerceMountedSkillLoadout,
  detectSkillConflicts,
  summarizeUsageStats,
} from '../src/lib/skill-model';
import type { SkillUsageRecord } from '../src/types';

test('coerceMountedSkillLoadout migrates legacy mountedSkillIds', () => {
  const loadout = coerceMountedSkillLoadout(['skill-a', 'skill-b']);
  assert.deepEqual(loadout, [
    { slot: 0, skillId: 'skill-a', weight: 1, lockedDimensions: [] },
    { slot: 1, skillId: 'skill-b', weight: 1, lockedDimensions: [] },
  ]);
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

test('calculateSkillFitScore returns responsibility-oriented recommendation copy when conflicts exist', () => {
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

  assert.equal(result.recommendations[0], '考虑替换存在职责冲突的卡牌');
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
