import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../shared/config/prompt-templates';

test('editorAgent prompt enforces field length caps per scene', () => {
  const prompt = mergePromptTemplates().editorAgent;
  assert.match(prompt, /≤\d+字/);
});

test('editorAgent prompt enforces scene beat coverage', () => {
  const prompt = mergePromptTemplates().editorAgent;
  assert.match(prompt, /关键动作|未覆盖.*FAIL|至少.*2/);
});
