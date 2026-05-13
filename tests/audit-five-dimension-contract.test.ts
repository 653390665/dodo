import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../src/config/prompt-templates';

test('manualAudit prompt requires 5-dimension scoring', () => {
  const prompt = mergePromptTemplates().manualAudit;
  assert.match(prompt, /可读性/);
  assert.match(prompt, /分镜执行/);
  assert.match(prompt, /冲突推进/);
  assert.match(prompt, /风格契合/);
  assert.match(prompt, /网文章节感/);
});

test('manualAudit prompt enforces PASS/FAIL gate', () => {
  const prompt = mergePromptTemplates().manualAudit;
  assert.match(prompt, /pass.*true.*false|硬阻断/);
  assert.match(prompt, /failReason/);
});

test('manualAudit prompt enforces field length caps', () => {
  const prompt = mergePromptTemplates().manualAudit;
  assert.match(prompt, /≤ ?\d+ ?字/);
});
