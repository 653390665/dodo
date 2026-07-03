import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../shared/config/prompt-templates';

test('storyCards prompt enforces input anchoring in hook', () => {
  const prompt = mergePromptTemplates().storyCards;
  assert.match(prompt, /输入原文|用户输入|包含.*名词/);
});

test('storyCards prompt enforces field length caps', () => {
  const prompt = mergePromptTemplates().storyCards;
  assert.match(prompt, /≤ ?\d+ ?字/);
});

test('storyCards prompt forbids markdown and thinking', () => {
  const prompt = mergePromptTemplates().storyCards;
  assert.match(prompt, /不输出|只输出.*JSON|字段约束/);
});
