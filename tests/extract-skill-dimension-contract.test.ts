import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../src/config/prompt-templates';

test('extractSkill splits style into sub-dimensions', () => {
  const prompt = mergePromptTemplates().extractSkill;
  assert.match(prompt, /笔调|句法|意象/);
});

test('extractSkill enforces field length caps', () => {
  const prompt = mergePromptTemplates().extractSkill;
  assert.match(prompt, /≤\d+字/);
});
