import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../shared/config/prompt-templates';

test('extractSkill style field has character cap', () => {
  const prompt = mergePromptTemplates().extractSkill;
  assert.match(prompt, /笔调|句法|意象/);
  assert.match(prompt, /≤\d+字/);
});

test('extractSkill enforces field length caps', () => {
  const prompt = mergePromptTemplates().extractSkill;
  assert.match(prompt, /≤\d+字/);
});
