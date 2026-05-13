import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSkillRoleLabel,
  getSkillRoleTags,
  normalizeRoleKey,
  collectSkillRoleKeys,
} from '../src/lib/skill-language';

test('getSkillRoleLabel maps primary dimension to writing-role language', () => {
  assert.equal(getSkillRoleLabel('style'), '主笔文风');
  assert.equal(getSkillRoleLabel('character'), '人物驱动');
  assert.equal(getSkillRoleLabel('world'), '世界约束');
  assert.equal(getSkillRoleLabel('power'), '体系爆点');
  assert.equal(getSkillRoleLabel('plot'), '剧情推进');
  assert.equal(getSkillRoleLabel('pacing'), '节奏调速');
  assert.equal(getSkillRoleLabel(undefined), '综合策略');
});

test('getSkillRoleTags converts dimension tags into readable writing-role tags', () => {
  assert.deepEqual(getSkillRoleTags(['style', 'plot', 'pacing']), ['主笔文风', '剧情推进', '节奏调速']);
});

test('normalizeRoleKey and collectSkillRoleKeys provide stable internal role keys', () => {
  assert.equal(normalizeRoleKey('style'), 'lead-style');
  assert.equal(normalizeRoleKey('plot'), 'plot-advance');
  assert.deepEqual(
    collectSkillRoleKeys({
      primaryDimension: 'style',
      dimensionTags: ['style'],
      compositionProfile: {
        styleWeight: 0.88,
        characterWeight: 0.2,
        worldWeight: 0.2,
        powerWeight: 0.2,
        plotWeight: 0.79,
        pacingWeight: 0.75,
        conflictTags: [],
        blendHints: [],
      },
    }),
    ['lead-style', 'plot-advance', 'pace-control'],
  );
});
