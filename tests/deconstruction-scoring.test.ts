import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateDeconstructionCard } from '../shared/lib/deconstruction-scoring';
import type { Skill } from '../shared/types/skills';

test('evaluateDeconstructionCard - Perfect Deconstruction Card should score 100 and obtain Grade S', () => {
  const perfectCard: Partial<Skill> = {
    name: 'Character Motivation Card',
    description: 'A deconstruction card extracting the core drive of characters.',
    fewShots: [
      'The protagonist clenches his fist in silence when facing unfair treatment, illustrating a reserved but deep-seated anger.',
      'Through micro-expressions like narrowing eyes, the antagonist projects subtle menace without speaking out loud.',
      'Secondary characters often show loyalty through actions rather than words, such as guarding the rear during a retreat.'
    ]
  };

  const report = evaluateDeconstructionCard(perfectCard);

  assert.equal(report.score, 100);
  assert.equal(report.grade, 'S');
  assert.equal(report.details.evidenceScore, 30);
  assert.equal(report.details.transferabilityScore, 35);
  assert.equal(report.details.safetyScore, 35);
  assert.equal(report.details.evidenceDeductions.length, 0);
  assert.equal(report.details.transferabilityDeductions.length, 0);
  assert.equal(report.details.safetyDeductions.length, 0);
});

test('evaluateDeconstructionCard - Entity leaks should lead to corresponding score deductions', () => {
  const leakedFamousCard: Partial<Skill> = {
    name: 'Famous Entity Leak Card',
    description: '萧炎 is practicing his fire martial arts here.',
    fewShots: [
      'This shot is long enough to bypass short evidence checks, containing more than twenty characters.',
      'Another valid long shot that has plenty of characters to meet the criteria.',
      'Third shot which is also long enough and detailed enough for the system.'
    ]
  };

  const reportFamous = evaluateDeconstructionCard(leakedFamousCard);
  // Max transferabilityScore is 35. Famous entity '萧炎' deduction is -10.
  // evidenceScore = 30, safetyScore = 35, transferabilityScore = 25. Total = 90.
  assert.equal(reportFamous.details.transferabilityScore, 25);
  assert.equal(reportFamous.score, 90);
  assert.equal(reportFamous.grade, 'S'); // 90 points is still S grade
  assert.equal(reportFamous.details.transferabilityDeductions.length, 1);
  assert.match(reportFamous.details.transferabilityDeductions[0], /萧炎/);

  const leakedPlaceholderCard: Partial<Skill> = {
    name: 'Placeholder Entity Leak Card',
    description: '林天凡 and 楚天凡 are typical placeholder names.',
    fewShots: [
      'This shot is long enough to bypass short evidence checks, containing more than twenty characters.',
      'Another valid long shot that has plenty of characters to meet the criteria.',
      'Third shot which is also long enough and detailed enough for the system.'
    ]
  };

  const reportPlaceholder = evaluateDeconstructionCard(leakedPlaceholderCard);
  // Two placeholders: 林天凡 (-5), 楚天凡 (-5). TransferabilityScore = 35 - 10 = 25.
  assert.equal(reportPlaceholder.details.transferabilityScore, 25);
  assert.equal(reportPlaceholder.score, 90);
  assert.equal(reportPlaceholder.grade, 'S');
  assert.equal(reportPlaceholder.details.transferabilityDeductions.length, 2);
});

test('evaluateDeconstructionCard - AI slop/phrases should lead to pollution safety score deductions', () => {
  const slopCard: Partial<Skill> = {
    name: 'AI Slop Card',
    description: '这章描写细腻，文笔流畅，让人物形象鲜明，真是引人入胜、跃然纸上！',
    fewShots: [
      'This shot is long enough to bypass short evidence checks, containing more than twenty characters.',
      'Another valid long shot that has plenty of characters to meet the criteria.',
      'Third shot which is also long enough and detailed enough for the system.'
    ]
  };

  const report = evaluateDeconstructionCard(slopCard);
  // Under slopPhrases, we have: '描写细腻' (-5), '文笔流畅' (-5), '人物形象鲜明' (-5), '引人入胜' (-5), '跃然纸上' (-5)
  // Total safety score deduction = 5 * 5 = 25.
  // evidenceScore = 30, transferabilityScore = 35, safetyScore = 35 - 25 = 10. Total = 75. Grade A.
  assert.equal(report.details.safetyScore, 10);
  assert.equal(report.score, 75);
  assert.equal(report.grade, 'A');
  assert.equal(report.details.safetyDeductions.length, 5);
});

test('evaluateDeconstructionCard - Evidence count and short sample check', () => {
  // Case A: No few shots
  const zeroShotCard: Partial<Skill> = {
    name: 'Zero Shot Card',
    fewShots: []
  };
  const reportZero = evaluateDeconstructionCard(zeroShotCard);
  assert.equal(reportZero.details.evidenceScore, 0);
  assert.equal(reportZero.score, 70); // 0 + 35 + 35
  assert.equal(reportZero.grade, 'B');

  // Case B: 1 few shot
  const oneShotCard: Partial<Skill> = {
    name: 'One Shot Card',
    fewShots: ['A long enough sentence over twenty characters for testing.']
  };
  const reportOne = evaluateDeconstructionCard(oneShotCard);
  assert.equal(reportOne.details.evidenceScore, 15);
  assert.equal(reportOne.score, 85); // 15 + 35 + 35
  assert.equal(reportOne.grade, 'A');

  // Case C: 2 few shots
  const twoShotCard: Partial<Skill> = {
    name: 'Two Shot Card',
    fewShots: [
      'A long enough sentence over twenty characters for testing.',
      'Another long enough sentence over twenty characters for testing.'
    ]
  };
  const reportTwo = evaluateDeconstructionCard(twoShotCard);
  assert.equal(reportTwo.details.evidenceScore, 25);
  assert.equal(reportTwo.score, 95); // 25 + 35 + 35
  assert.equal(reportTwo.grade, 'S');

  // Case D: Short shot penalty
  const shortShotCard: Partial<Skill> = {
    name: 'Short Shot Card',
    fewShots: [
      'Short shot' // < 20 chars, triggers penalty
    ]
  };
  const reportShort = evaluateDeconstructionCard(shortShotCard);
  // 1 shot is 15 points. Penalty is -5. Total evidence score = 10.
  assert.equal(reportShort.details.evidenceScore, 10);
  assert.equal(reportShort.details.evidenceDeductions.length, 1);
  assert.equal(reportShort.score, 80); // 10 + 35 + 35
});
