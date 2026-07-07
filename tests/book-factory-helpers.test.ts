import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSkillConfig, normalizeSkillConfigs } from '../src/components/book-factory/useBookFactory';

test('book factory - normalizeSkillConfig sets defaults for missing dimensions', () => {
  const result = normalizeSkillConfig({
    name: '测试技能',
    description: '一个简单的测试技能'
  });

  assert.equal(result.primaryDimension, 'style');
  assert.deepEqual(result.dimensionTags, ['style']);
  assert.equal(result.compositionProfile!.styleWeight, 0.8);
  assert.equal(result.compositionProfile!.characterWeight, 0.4);
});

test('book factory - normalizeSkillConfig handles empty dimensionTags and profile overrides', () => {
  const result = normalizeSkillConfig({
    name: '覆盖测试',
    primaryDimension: 'character',
    dimensionTags: [],
    compositionProfile: {
      styleWeight: 0.1,
      characterWeight: 0.9,
      conflictTags: ['冲突'],
      blendHints: ['混合']
    }
  });

  assert.equal(result.primaryDimension, 'character');
  assert.deepEqual(result.dimensionTags, ['style']); // empty array falls back to default
  assert.equal(result.compositionProfile!.styleWeight, 0.1);
  assert.equal(result.compositionProfile!.characterWeight, 0.9);
  assert.equal(result.compositionProfile!.worldWeight, 0.4); // missing weight gets default
  assert.deepEqual(result.compositionProfile!.conflictTags, ['冲突']);
  assert.deepEqual(result.compositionProfile!.blendHints, ['混合']);
});

test('book factory - normalizeSkillConfig falls back to style when all tags are invalid', () => {
  const result = normalizeSkillConfig({
    name: '无效维度测试',
    dimensionTags: ['invalid_tag_1', 'another_invalid']
  });

  assert.deepEqual(result.dimensionTags, ['style']);
});

test('book factory - normalizeSkillConfigs parses multiple raw input formats', () => {
  // Format 1: { skills: [...] }
  const format1 = normalizeSkillConfigs({
    skills: [
      { name: '技能1', primaryDimension: 'pacing' }
    ]
  });
  assert.equal(format1.length, 1);
  assert.equal(format1[0].name, '技能1');
  assert.equal(format1[0].primaryDimension, 'pacing');

  // Format 2: Array directly
  const format2 = normalizeSkillConfigs([
    { name: '技能2', primaryDimension: 'character' }
  ]);
  assert.equal(format2.length, 1);
  assert.equal(format2[0].name, '技能2');
  assert.equal(format2[0].primaryDimension, 'character');

  // Format 3: Single object
  const format3 = normalizeSkillConfigs({
    name: '技能3',
    primaryDimension: 'world'
  });
  assert.equal(format3.length, 1);
  assert.equal(format3[0].name, '技能3');
  assert.equal(format3[0].primaryDimension, 'world');

  // Format 4: Empty input
  const format4 = normalizeSkillConfigs(null);
  assert.equal(format4.length, 0);
});
