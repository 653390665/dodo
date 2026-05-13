import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../src/config/prompt-templates';

test('setupTaskRefine requires JSON output with field caps', () => {
  const prompt = mergePromptTemplates().setupTaskRefine;
  assert.match(prompt, /JSON|json/);
  assert.match(prompt, /≤\d+字/);
  assert.match(prompt, /changedFields/);
});
