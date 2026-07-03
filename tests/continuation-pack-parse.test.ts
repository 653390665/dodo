import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  buildContinuationPackParseAttempts,
  buildContinuationPackPrompt,
} from '../src/lib/continuation-pack-parse';

describe("continuation", () => {
test('buildContinuationPackParseAttempts uses an aggressive shrinking ladder for MiniMax', () => {
  const attempts = buildContinuationPackParseAttempts('https://api.minimaxi.com/v1');

  assert.deepEqual(attempts, [
    { maxCharsPerDocument: 2500, maxTokens: 2048, compactMode: false },
    { maxCharsPerDocument: 1500, maxTokens: 1536, compactMode: true },
    { maxCharsPerDocument: 800, maxTokens: 1024, compactMode: true },
    { maxCharsPerDocument: 400, maxTokens: 768, compactMode: true },
  ]);
});

test('buildContinuationPackPrompt adds compact retry rules when compact mode is enabled', () => {
  const prompt = buildContinuationPackPrompt('【PRD.md】测试', true);

  assert.match(prompt, /压缩重试模式/);
  assert.match(prompt, /优先保证 JSON 完整闭合/);
  assert.match(prompt, /【PRD\.md】测试/);
});

test('buildContinuationPackPrompt keeps the fuller budget rules by default', () => {
  const prompt = buildContinuationPackPrompt('【PRD.md】测试');

  assert.match(prompt, /canonFacts 最多 8 条/);
  assert.doesNotMatch(prompt, /压缩重试模式/);
});
});
