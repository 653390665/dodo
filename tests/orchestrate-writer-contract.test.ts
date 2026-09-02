import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePromptTemplates } from '../shared/config/prompt-templates';

// ============================================================
// Contract tests for orchestrateWriter prompt
// These test the TEMPLATE TEXT, not model output.
// Must pass against the current prompt BEFORE any changes.
// ============================================================

// --- Ban on meta-narrative "主角" ---

test('orchestrateWriter bans "主角" in body text', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  // Rule 10: explicit ban
  assert.match(prompt, /禁止.*主角|不要出现.*主角|不准.*主角/);
  // Self-check item
  assert.match(prompt, /□.*未出现.*主角/);
});

// --- Scene ending constraints (anti-cliche) ---

test('orchestrateWriter requires scene endings use action/sound/environment, not cliches', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  // Writing method #8: end with action/sound/environment change
  assert.match(prompt, /结尾.*动作.*声音.*环境/);
  // Self-check item for scene ending
  assert.match(prompt, /□.*场景收束/);
});

test('orchestrateWriter explicitly bans cliche ending patterns', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  // Rule 17: banned cliche endings
  assert.match(prompt, /转身离去/);
  assert.match(prompt, /渐行渐远/);
  assert.match(prompt, /套路.*收束|套路化.*收束/);
  // Quality section: cliche ending = FAIL
  assert.match(prompt, /场景结尾.*不合格|套路收束.*不合格/);
});

// --- Dialogue preamble (observation/pause/probing before ALL dialogue) ---

test('orchestrateWriter requires dialogue preamble with observation/pause/probing', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  // Rule 14: ALL dialogue must have preamble (not just "重要对白")
  assert.match(prompt, /任何对白.*前因|对白.*必须有前因/);
  assert.match(prompt, /观察.*停顿.*试探/);
  // Not just key dialogue — applies to every spoken line
  assert.match(prompt, /为什么.*开口|为什么在这个时刻/);
  // Self-check item for dialogue preamble (expanded from "关键对话" to "每一处对白")
  assert.match(prompt, /□.*每一处对白|□.*对白前/);
});

// --- Dynamic entry (anti-weather-report opening) ---

test('orchestrateWriter requires dynamic entry in first sentence', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  // Rule 11: first sentence must be dynamic
  assert.match(prompt, /首句.*声音.*动作.*碰撞.*异动|声音.*动作.*门响.*视线/);
  // Self-check item
  assert.match(prompt, /□.*首句.*声音.*动作/);
});

// --- Character naming: natural reference, no repeated "主角" ---

test('orchestrateWriter requires natural character naming', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  // Rule 9: natural referent switching
  assert.match(prompt, /称谓.*自然|自然.*指代/);
  // Rule 10: if unnamed, use in-text descriptors
  assert.match(prompt, /那人|那青年|那江湖客/);
});

// --- Scene beat fidelity ---

test('orchestrateWriter enforces scene beat execution', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  // Rule 1: follow beat order
  assert.match(prompt, /按分镜顺序/);
  // Rule 15: props and actions must land
  assert.match(prompt, /道具.*必须.*兑现|必须.*发生.*推动/);
  // Self-check item
  assert.match(prompt, /□.*道具.*出现/);
});

// --- Output mode: no markdown, no explanation ---

test('orchestrateWriter requires plain body text output only', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  assert.match(prompt, /不要输出.*标题.*说明.*注释|不要附加.*解释/);
  assert.match(prompt, /直接输出正文/);
});

// --- Quality floor: no fragment sentences ---

test('orchestrateWriter enforces quality floor on readable sentences', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  assert.match(prompt, /完整.*中文.*句子|禁止.*残句.*病句/);
  assert.match(prompt, /□.*无残句.*病句.*主谓不明/);
});

// --- Word count guidance ---

test('orchestrateWriter provides word count guidance', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  assert.match(prompt, /字数|word.?count|字|章节字数/i);
});

// --- Self-check checklist completeness ---

test('orchestrateWriter self-check checklist covers all critical items', () => {
  const prompt = mergePromptTemplates().orchestrateWriter;
  // All 8 checklist items must be present (incl. de-ai-tells guard items)
  const checks = prompt.match(/□/g);
  assert.ok(checks, 'checklist must exist');
  assert.equal(checks.length, 8, 'checklist must have exactly 8 items');
});
