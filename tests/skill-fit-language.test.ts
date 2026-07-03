import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { deriveSkillFitNeeds } from '../src/lib/skill-fit-language';

describe("skill-extraction", () => {
test('deriveSkillFitNeeds returns dimension inputs plus readable role labels', () => {
  const result = deriveSkillFitNeeds(
    {
      id: 'n1',
      title: '测试项目',
      authorId: 'u1',
      summary: '测试',
      status: 'ongoing',
      worldRules: '存在明确力量规则',
      globalOutline: '整体推进大纲',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'c1',
      novelId: 'n1',
      title: '第一章',
      content: '主角感知到灵压，境界差距被直接点明。',
      order: 1,
      wordCount: 1200,
      sceneBeats: '冲突推进并快速转场',
      createdAt: 1,
      updatedAt: 1,
    },
  );

  assert.deepEqual(result.requiredDimensions, ['style', 'plot', 'pacing', 'world']);
  assert.deepEqual(result.chapterSignals, ['plot', 'pacing', 'world', 'power']);
  assert.deepEqual(result.requiredRoleLabels, ['主笔文风', '剧情推进', '节奏调速', '世界约束']);
  assert.deepEqual(result.chapterRoleLabels, ['剧情推进', '节奏调速', '世界约束', '体系爆点']);
});
});
