import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStrandWeave } from '../server/routes/world';

test('world pacing - computeStrandWeave counts combat/quest keywords correctly', () => {
  const chapters = [
    { content: '他进入秘境，与强敌决斗，最后一剑击败对手突破境界。' },
    { content: '主角遭遇敌人追杀，发生激烈战斗。' },
    { content: '日常修炼，整理战利品。' }
  ];

  const result = computeStrandWeave(chapters);
  assert.equal(result.questRatio, 100); // 3 out of 3 have combat keywords
  assert.equal(result.fireRatio, 0);
  assert.equal(result.constellationRatio, 0);
});

test('world pacing - computeStrandWeave counts fire/emotion keywords correctly', () => {
  const chapters = [
    { content: '两人的眼神交汇，她感到心疼，紧紧拥抱在一起。' },
    { content: '温柔地牵手散步，相视微笑。' }
  ];

  const result = computeStrandWeave(chapters);
  assert.equal(result.questRatio, 0);
  assert.equal(result.fireRatio, 100); // 2 out of 2
  assert.equal(result.constellationRatio, 0);
});

test('world pacing - computeStrandWeave counts constellation/setting keywords correctly', () => {
  const chapters = [
    { content: '这片大陆的法则由上古宗门流传的历史决定。' }
  ];

  const result = computeStrandWeave(chapters);
  assert.equal(result.questRatio, 0);
  assert.equal(result.fireRatio, 0);
  assert.equal(result.constellationRatio, 100);
});

test('world pacing - computeStrandWeave handles missing content and empty input gracefully', () => {
  const result = computeStrandWeave([
    {},
    { content: undefined }
  ]);

  assert.equal(result.questRatio, 0);
  assert.equal(result.fireRatio, 0);
  assert.equal(result.constellationRatio, 0);
  assert.deepEqual(result.breakWarnings, []);
});

test('world pacing - computeStrandWeave generates warnings for streaks and long gaps', () => {
  // 6 combat chapters in a row
  const chapters = Array.from({ length: 6 }, () => ({ content: '激烈战斗突破' }));
  const result = computeStrandWeave(chapters);

  assert.ok(result.breakWarnings.some(w => w.includes('主线连续 6 章')));
});
