import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLatency,
  scoreInputAnchoring,
  evaluateFieldCompleteness,
  gradeOutput,
} from '../src/lib/prompt-quality';

test('classifyLatency buckets correctly', () => {
  assert.equal(classifyLatency(7000), 'fast');
  assert.equal(classifyLatency(15000), 'ok');
  assert.equal(classifyLatency(45000), 'slow');
  assert.equal(classifyLatency(90000), 'timeout');
});

test('scoreInputAnchoring detects keyword overlap', () => {
  const score = scoreInputAnchoring(
    '乞丐在街头发现一块刻着龙纹的玉玺',
    '一个乞丐捡到玉玺的故事',
  );
  assert.ok(score >= 0.5, `expected >= 0.5 got ${score}`);
});

test('scoreInputAnchoring returns low for no overlap', () => {
  const score = scoreInputAnchoring('雨夜刀客闯进酒馆复仇', '乞丐玉玺');
  assert.ok(score < 0.3, `expected < 0.3 got ${score}`);
});

test('evaluateFieldCompleteness marks present and missing fields', () => {
  const result = evaluateFieldCompleteness(
    { hook: '刀客复仇', protagonist: '', coreConflict: '追杀' },
    ['hook', 'protagonist', 'coreConflict', 'tone'],
  );
  assert.equal(result.hook, true);
  assert.equal(result.protagonist, false);
  assert.equal(result.coreConflict, true);
  assert.equal(result.tone, false);
});

test('gradeOutput gives F on parse failure', () => {
  const report = { parseSuccess: false, latencyBucket: 'fast' as const, inputAnchoringScore: 0.8, jsonComplete: false, fieldCompleteness: {}, overallGrade: 'F' as const };
  assert.equal(gradeOutput(report), 'F');
});

test('gradeOutput gives A on fast+complete+anchored', () => {
  const report = {
    parseSuccess: true, latencyBucket: 'fast' as const, jsonComplete: true,
    inputAnchoringScore: 0.8,
    fieldCompleteness: { hook: true, protagonist: true, coreConflict: true },
    overallGrade: 'A' as const,
  };
  assert.equal(gradeOutput(report), 'A');
});
