import test from 'node:test';
import assert from 'node:assert/strict';
import { scanForBanWords, formatBanWordReport } from '../src/lib/ban-word-scanner';

test('scanForBanWords detects AI meta-narrative terms', () => {
  const hits = scanForBanWords('总而言之，主角在这个故事中成长了');
  const labels = hits.map(h => h.label);
  assert.ok(labels.includes('AI结论词'));
  assert.ok(labels.includes('元叙事称谓'));
});

test('scanForBanWords is clean for natural prose', () => {
  const hits = scanForBanWords('雨停了。林砚收起刀，走进夜色。');
  assert.equal(hits.length, 0);
});

test('formatBanWordReport groups by label', () => {
  const report = formatBanWordReport([
    { word: '总而言之', label: 'AI结论词', index: 0 },
    { word: '总的来说', label: 'AI结论词', index: 30 },
  ]);
  assert.match(report, /AI结论词/);
  assert.match(report, /总而言之/);
  assert.match(report, /总的来说/);
});
