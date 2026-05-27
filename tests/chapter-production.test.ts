import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChapterProductionTitle,
  buildProductionPromptContexts,
  getNextChapterOrder,
  normalizeProductionIntent,
} from '../src/lib/chapter-production';
import type { Chapter } from '../src/types';

test('getNextChapterOrder returns one more than highest existing order', () => {
  const chapters = [
    { id: 'c1', order: 1 },
    { id: 'c3', order: 3 },
    { id: 'c2', order: 2 },
  ] as Chapter[];
  assert.equal(getNextChapterOrder(chapters), 4);
});

test('buildChapterProductionTitle formats next chapter title', () => {
  assert.equal(buildChapterProductionTitle(4), '第 4 章');
});

test('normalizeProductionIntent uses a practical default', () => {
  assert.equal(
    normalizeProductionIntent(''),
    '延续上一章剧情，生成下一章分镜、正文和连续性审计。',
  );
  assert.equal(normalizeProductionIntent('  追兵入城  '), '追兵入城');
});

test('buildProductionPromptContexts injects continuation pack context into planner and writer prompts', () => {
  const contexts = buildProductionPromptContexts({
    layeredContext: '【世界观】城池将倾',
    plannerContext: '近期章节：主角刚拿到账本',
    writerContext: '关键人物：林照',
    continuationPackContext: '【资料包续写任务】逼问掌柜，保住账本。',
  });

  assert.match(contexts.planner, /资料包续写任务/);
  assert.match(contexts.planner, /近期章节/);
  assert.match(contexts.writer, /资料包续写任务/);
  assert.match(contexts.writer, /关键人物/);
});
