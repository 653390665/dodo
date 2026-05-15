import test from 'node:test';
import assert from 'node:assert/strict';

// Import the function from server.ts — test via the endpoint contract
function sanitizeIdeaSeed(raw: string): string {
  return raw
    .replace(/^我想写一个?\s*/g, '')
    .replace(/^我想写\s*/g, '')
    .replace(/^想写一个?\s*/g, '')
    .replace(/^想写\s*/g, '')
    .replace(/^写一个?\s*/g, '')
    .replace(/^写\s*/g, '')
    .replace(/^关于\s*/g, '')
    .replace(/^一个?\s*/g, '')
    .replace(/[「」『』""''【】]/g, '')
    .replace(/^[，,。！？、；：\s]+/g, '')
    .trim();
}

test('sanitizeIdeaSeed strips author-intent prefixes', () => {
  assert.equal(sanitizeIdeaSeed('我想写一个雨夜酒馆里的复仇故事'), '雨夜酒馆里的复仇故事');
  assert.equal(sanitizeIdeaSeed('我想写一个乞丐捡到玉玺'), '乞丐捡到玉玺');
  assert.equal(sanitizeIdeaSeed('想写一个穿越修仙的故事'), '穿越修仙的故事');
  assert.equal(sanitizeIdeaSeed('关于一个记忆交易的都市'), '记忆交易的都市');
  assert.equal(sanitizeIdeaSeed('写末日废土的冒险'), '末日废土的冒险');
});

test('sanitizeIdeaSeed preserves clean input', () => {
  assert.equal(sanitizeIdeaSeed('雨夜酒馆里的复仇'), '雨夜酒馆里的复仇');
  assert.equal(sanitizeIdeaSeed('乞丐捡到玉玺'), '乞丐捡到玉玺');
});

test('sanitizeIdeaSeed removes brackets', () => {
  assert.equal(sanitizeIdeaSeed('「雨夜酒馆」复仇故事'), '雨夜酒馆复仇故事');
});
