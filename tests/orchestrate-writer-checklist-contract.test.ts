import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../shared/config/prompt-templates';

test('orchestrateWriter prompt includes self-check checklist', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  assert.match(prompt, /自检/);
  assert.match(prompt, /□.*首句/);
  assert.match(prompt, /□.*主角/);
});
