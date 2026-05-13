import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectPreferenceSnapshot,
  explainFitScoreDelta,
  applyPreferenceFeedback,
  getAcceptedPreferenceRoles,
  getRejectedPreferenceRoles,
} from '../src/lib/preference-flywheel';
import type { Skill, ProjectPreferenceProfile } from '../src/types';

function makeSkill(id: string, name: string, primaryDimension: Skill['primaryDimension']): Skill {
  return {
    id,
    name,
    description: '',
    style: '',
    pacing: '',
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 1,
    createdAt: 1,
    primaryDimension,
    dimensionTags: primaryDimension ? [primaryDimension] : [],
    compositionProfile: {
      styleWeight: primaryDimension === 'style' ? 0.9 : 0.2,
      characterWeight: primaryDimension === 'character' ? 0.9 : 0.2,
      worldWeight: primaryDimension === 'world' ? 0.9 : 0.2,
      powerWeight: 0.2,
      plotWeight: primaryDimension === 'plot' ? 0.9 : 0.2,
      pacingWeight: primaryDimension === 'pacing' ? 0.9 : 0.2,
      conflictTags: [],
      blendHints: [],
    },
    updatedAt: 1,
  };
}

test('buildProjectPreferenceSnapshot summarizes tags and weights', () => {
  const profile = buildProjectPreferenceSnapshot({
    acceptedSkills: [makeSkill('s1', '冷峻刀锋', 'style'), makeSkill('s2', '压抑对峙', 'character')],
    rejectedSkills: [makeSkill('s3', '散文化慢节奏', 'pacing')],
  });

  assert.equal(profile.tags.length > 0, true);
  assert.equal(profile.weights.styleWeight > 0, true);
  assert.equal(profile.rejectedDimensions.includes('pacing'), true);
});

test('explainFitScoreDelta returns readable reasons for score changes', () => {
  const message = explainFitScoreDelta({
    previousScore: 72,
    nextScore: 86,
    matchedTraits: ['冷峻', '强冲突', '紧推进'],
    resolvedConflicts: ['节奏冲突减少'],
    remainingRisks: ['世界铺陈偏重'],
  });

  assert.equal(message.summary.includes('更贴近'), true);
  assert.equal(message.highlights.length >= 2, true);
});

test('applyPreferenceFeedback updates project profile without touching global layer', () => {
  const profile: ProjectPreferenceProfile = {
    tags: ['冷峻', '强冲突'],
    weights: {
      styleWeight: 0.7,
      characterWeight: 0.6,
      worldWeight: 0.3,
      plotWeight: 0.8,
      pacingWeight: 0.7,
    },
    acceptedDimensions: ['style'],
    rejectedDimensions: [],
    notes: ['更接受短句压迫感'],
    evidenceCount: 2,
  };

  const next = applyPreferenceFeedback(profile, {
    action: 'not-for-me',
    dimension: 'world',
    note: '世界设定不要压过人物冲突',
  });

  assert.equal(next.rejectedDimensions.includes('world'), true);
  assert.equal(next.notes.at(-1), '世界设定不要压过人物冲突');
});

test('preference role helpers derive role keys from dimensions and weight signals', () => {
  const profile: ProjectPreferenceProfile = {
    tags: ['主笔文风', '剧情推进'],
    weights: {
      styleWeight: 0.8,
      characterWeight: 0.5,
      worldWeight: 0.3,
      plotWeight: 0.8,
      pacingWeight: 0.3,
    },
    acceptedDimensions: ['style'],
    rejectedDimensions: ['world'],
    notes: [],
    evidenceCount: 4,
  };

  assert.deepEqual(getAcceptedPreferenceRoles(profile), ['lead-style', 'plot-advance']);
  assert.deepEqual(getRejectedPreferenceRoles(profile), ['world-rule', 'pace-control']);
});
