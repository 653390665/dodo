import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoryCardsResponse } from '../src/lib/onboarding-model';

test('normalizeStoryCardsResponse unwraps cards array from JSON payload', () => {
  const cards = normalizeStoryCardsResponse(`
  {
    "cards": [
      {
        "id": "c1",
        "hook": "一句话卖点",
        "protagonist": "主角设定",
        "coreConflict": "核心冲突",
        "tone": "冷峻悬疑",
        "whyItWorks": "有钩子",
        "starterSeeds": {
          "worldSeed": "世界种子",
          "relationshipSeed": "关系种子",
          "chapterOneSeed": "第一章种子"
        },
        "planningFit": {
          "recommendedLength": "120000-200000 字",
          "recommendedFocus": "冲突推进优先",
          "recommendedPacing": "紧推进",
          "reason": "适合连续追读。"
        },
        "riskNote": "风险",
        "mixTags": ["x"],
        "signals": {
          "tone": "grim",
          "conflictType": "survival-mystery",
          "worldWeight": 0.7,
          "characterWeight": 0.6,
          "pacingPreference": "tight"
        }
      }
    ]
  }
  `);

  assert.equal(cards.length, 1);
  assert.equal(cards[0].starterSeeds.chapterOneSeed, '第一章种子');
  assert.equal(cards[0].planningFit.recommendedPacing, '紧推进');
});
