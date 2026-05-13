import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSkillDeckFromEvidence } from '../src/lib/book-skill-aggregation';

test('buildSkillDeckFromEvidence outputs one main card and bounded support cards with evidence coverage', () => {
  const deck = buildSkillDeckFromEvidence([
    {
      stage: 'opening',
      skillSignals: [{ dimension: 'style', weight: 0.92, evidence: '冷峻短句稳定出现' }],
    },
    {
      stage: 'mid',
      skillSignals: [{ dimension: 'character', weight: 0.74, evidence: '人物试探与克制反复出现' }],
    },
    {
      stage: 'climax',
      skillSignals: [{ dimension: 'plot', weight: 0.78, evidence: '冲突升级与悬念收束清晰' }],
    },
  ]);

  assert.equal(deck.mainCard != null, true);
  assert.equal(deck.supportCards.length >= 1, true);
  assert.equal(deck.supportCards.length <= 4, true);
  assert.equal(typeof deck.mainCard.evidenceCoverage, 'string');
  assert.equal(deck.mainCard.name.length > 0, true);
  assert.equal(deck.mainCard.evaluationFeedback.includes('基于整书分段证据汇总'), true);
});

test('style-led deck card carries pacing and plot context for direct writing use', () => {
  const deck = buildSkillDeckFromEvidence([
    {
      stage: 'opening',
      skillSignals: [
        { dimension: 'style', weight: 0.95, evidence: '冷峻短句贴着视角推进' },
        { dimension: 'pacing', weight: 0.82, evidence: '铺垫很短，三四句内就给出压迫感' },
      ],
    },
    {
      stage: 'mid',
      skillSignals: [
        { dimension: 'plot', weight: 0.78, evidence: '每一小段都带试探和反转' },
      ],
    },
    {
      stage: 'climax',
      skillSignals: [
        { dimension: 'style', weight: 0.93, evidence: '爆点前仍保持克制句法' },
      ],
    },
  ]);

  assert.equal(deck.mainCard.name, '主笔文风卡');
  assert.equal(Boolean(deck.mainCard.style), true);
  assert.equal(Boolean(deck.mainCard.pacing), true);
  assert.equal(Boolean(deck.mainCard.plotPattern), true);
});
