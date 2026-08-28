import test from 'node:test';
import assert from 'node:assert/strict';
import { assessStorySeedQuality, sanitizeIdeaSeed } from '../src/lib/story-seed';

test('sanitizeIdeaSeed strips author-intent prefixes', () => {
  assert.equal(sanitizeIdeaSeed('我想写一个雨夜酒馆里的复仇故事'), '雨夜酒馆里的复仇故事');
  assert.equal(sanitizeIdeaSeed('想写一个穿越修仙的故事'), '穿越修仙的故事');
  assert.equal(sanitizeIdeaSeed('关于一个记忆交易的都市'), '记忆交易的都市');
});

test('assessStorySeedQuality accepts compact but expandable story seeds', () => {
  const result = assessStorySeedQuality('长生剑来的故事');
  assert.equal(result.status, 'ok');
});

test('assessStorySeedQuality rejects obvious noise', () => {
  const result = assessStorySeedQuality('111111111111');
  assert.equal(result.status, 'needs_clarification');
  assert.ok(result.error.includes('数字'));
});
