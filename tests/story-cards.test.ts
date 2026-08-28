import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStoryCardsFromModel } from '../server/helpers/story-cards';

test('story cards - parseStoryCardsFromModel parses cards from cards array structure', () => {
  const rawJson = JSON.stringify({
    cards: [
      {
        hook: '第一章主角在雨夜里醒来，去寻找连环凶手',
        whyItWorks: '雨夜的氛围能很好地烘托悬疑感',
        protagonist: '失忆的神探',
        coreConflict: '找出雨夜连环案凶手',
        tone: '冷峻悬疑',
        mixTags: ['悬疑', '失忆']
      }
    ]
  });

  const cards = parseStoryCardsFromModel(rawJson, '寻找雨夜凶手');
  assert.equal(cards.length, 1);
  assert.ok(cards[0].id.startsWith('model-card-'));
  assert.equal(cards[0].hook, '第一章主角在雨夜里醒来，去寻找连环凶手');
  assert.equal(cards[0].whyItWorks, '雨夜的氛围能很好地烘托悬疑感');
  assert.equal(cards[0].protagonist, '失忆的神探');
  assert.equal(cards[0].coreConflict, '找出雨夜连环案凶手');
  assert.deepEqual(cards[0].mixTags, ['悬疑', '失忆']);
});

test('story cards - parseStoryCardsFromModel filters out invalid cards', () => {
  const rawJson = JSON.stringify([
    {
      hook: '关于雨夜的有效钩子',
      whyItWorks: '有效的解释'
    },
    {
      hook: '关于雨夜但缺少 whyItWorks'
    },
    {
      whyItWorks: '缺少 hook 却有解释'
    }
  ]);

  const cards = parseStoryCardsFromModel(rawJson, '寻找雨夜');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].hook, '关于雨夜的有效钩子');
});

test('story cards - parseStoryCardsFromModel handles needs_clarification status', () => {
  const rawJson = JSON.stringify({
    status: 'needs_clarification',
    questions: ['为什么下雨？', '主角是谁？']
  });

  assert.throws(() => {
    parseStoryCardsFromModel(rawJson, '寻找雨夜');
  }, (err: Error) => {
    const data = JSON.parse(err.message);
    return data.type === 'needs_clarification' && data.questions.length === 2;
  });
});

test('story cards - parseStoryCardsFromModel handles mixTags fallback', () => {
  const rawJson = JSON.stringify({
    cards: [
      {
        hook: '关于雨夜的第一个故事方向',
        whyItWorks: '它的价值',
        mixTags: '不是数组的垃圾数据'
      }
    ]
  });

  const cards = parseStoryCardsFromModel(rawJson, '寻找雨夜');
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].mixTags, []);
});
