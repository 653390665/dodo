import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextPrompt } from '../src/lib/agents';

test('buildContextPrompt describes mounted skills with writing-role language', () => {
  const prompt = buildContextPrompt({
    novel: {
      id: 'n1',
      title: '测试',
      authorId: 'u1',
      summary: '一个测试故事。',
      status: 'ongoing',
      createdAt: 1,
      updatedAt: 1,
    },
    characters: [],
    mountedSkills: [
      {
        id: 's1',
        name: '主笔文风卡',
        description: '负责统一正文语气。',
        style: '冷峻短句',
        pacing: '推进很紧',
        stabilityScore: 88,
        evaluationFeedback: '适合挂在主笔位',
        version: 1,
        createdAt: 1,
        primaryDimension: 'style',
        dimensionTags: ['style', 'plot'],
        characterTraits: '人物试探感强',
        worldBuilding: '规则压迫感强',
        compositionProfile: {
          styleWeight: 0.85,
          characterWeight: 0.45,
          worldWeight: 0.35,
          powerWeight: 0.25,
          plotWeight: 0.7,
          pacingWeight: 0.75,
          conflictTags: [],
          blendHints: [],
        },
      },
    ],
  });

  assert.equal(prompt.includes('写作职责: 主笔文风'), true);
  assert.equal(prompt.includes('职责标签: 主笔文风、剧情推进'), true);
  assert.equal(prompt.includes('组合策略画像:'), true);
});
