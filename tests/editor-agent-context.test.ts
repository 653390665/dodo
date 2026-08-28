import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContextPrompt } from '../src/lib/agents.ts';
import type { AgentContext } from '../src/lib/agents.ts';

const baseContext: AgentContext = {
  novel: {
    id: 'novel-context',
    title: '伏笔测试',
    authorId: 'local-user',
    summary: '测试作品',
    status: 'ongoing',
    createdAt: 1,
    updatedAt: 1,
  },
  chapterId: 'chapter-1',
  characters: [],
};

test('buildContextPrompt includes open foreshadowings with stable identifiers', () => {
  const prompt = buildContextPrompt({
    ...baseContext,
    foreshadowings: [{
      id: 'promise-unique-17',
      novelId: 'novel-context',
      title: '黑曜石裂纹',
      description: '裂纹会在月蚀时发出第二种颜色',
      status: 'planted',
      relatedCharacterIds: [],
      createdAt: 1,
      updatedAt: 1,
    }],
  });

  assert.match(prompt, /开放伏笔/);
  assert.match(prompt, /promise-unique-17/);
  assert.match(prompt, /黑曜石裂纹/);
});

test('buildContextPrompt bounds foreshadowing memory instead of injecting an unbounded ledger', () => {
  const foreshadowings = Array.from({ length: 40 }, (_, index) => ({
    id: `promise-${index}`,
    novelId: 'novel-context',
    title: `伏笔-${index}`,
    description: 'x'.repeat(500),
    status: 'planted' as const,
    relatedCharacterIds: [],
    createdAt: index,
    updatedAt: index,
  }));

  const prompt = buildContextPrompt({ ...baseContext, foreshadowings });
  assert.ok(prompt.length < 8_000, `prompt unexpectedly grew to ${prompt.length} chars`);
  assert.match(prompt, /promise-0/);
});
