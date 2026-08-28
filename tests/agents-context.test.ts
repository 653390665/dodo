import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextPrompt } from '../src/lib/agents';

test('buildContextPrompt leaves skill and writing-style injection to the server resolver', () => {
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

  assert.equal(prompt.includes('主笔文风卡'), false);
  assert.equal(prompt.includes('冷峻短句'), false);
  assert.equal(prompt.includes('Mounted Skills'), false);
});
