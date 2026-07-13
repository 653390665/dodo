import test from 'node:test';
import assert from 'node:assert/strict';

import { rowToSkill } from '../server/lib/db-mappers';
import { logger } from '../server/logger';

test('safeJsonParse via rowToSkill: valid JSON returns parsed value', () => {
  const row = {
    id: 'skill-1',
    name: 'Test Skill',
    description: 'desc',
    style: 'style',
    pacing: 'fast',
    sentence_structure: 's',
    banned_words: '["word-a","word-b"]',
    few_shots: '[]',
    vocabulary: '[]',
    imagery: '[]',
    character_traits: '',
    world_building: '',
    plot_pattern: '',
    foreshadowing: '',
    core_patterns: '[]',
    banned_elements: '[]',
    stability_score: 1,
    evaluation_feedback: '',
    version: 1,
    dimension_tags: '[]',
    composition_profile: '{}',
    usage_stats: '{}',
  };
  const skill = rowToSkill(row);
  assert.deepEqual(skill.bannedWords, ['word-a', 'word-b']);
});

test('safeJsonParse via rowToSkill: null column returns fallback', () => {
  const row = {
    id: 'skill-2',
    banned_words: null,
    stability_score: 1,
    version: 1,
  };
  const skill = rowToSkill(row);
  assert.deepEqual(skill.bannedWords, []);
});

test('safeJsonParse via rowToSkill: undefined column returns fallback', () => {
  const row = {
    id: 'skill-3',
    stability_score: 1,
    version: 1,
  };
  const skill = rowToSkill(row);
  assert.deepEqual(skill.bannedWords, []);
  assert.deepEqual(skill.fewShots, []);
  assert.deepEqual(skill.compositionProfile, {});
});

test('safeJsonParse via rowToSkill: malformed JSON returns fallback and does not throw', () => {
  const row = {
    id: 'skill-4',
    banned_words: '{{invalid}}',
    few_shots: '[broken',
    composition_profile: '{not json',
    stability_score: 1,
    version: 1,
  };
  const skill = rowToSkill(row);
  assert.deepEqual(skill.bannedWords, []);
  assert.deepEqual(skill.fewShots, []);
  assert.deepEqual(skill.compositionProfile, {});
});

test('rowToSkill with corrupted banned_words column still returns valid Skill object', () => {
  const warns: string[] = [];
  const originalWarn = logger.warn;
  logger.warn = (context: string) => { warns.push(context); };
  try {
    const row = {
      id: 'skill-5',
      name: 'Corrupt Skill',
      description: 'desc',
      style: 'style',
      pacing: 'fast',
      banned_words: '{{invalid json}}',
      stability_score: 5,
      evaluation_feedback: 'ok',
      version: 1,
    };
    const skill = rowToSkill(row);
    assert.equal(skill.id, 'skill-5');
    assert.deepEqual(skill.bannedWords, []);
    assert.ok(warns.some((w) => w.includes('[db-mappers] Malformed JSON')));
  } finally {
    logger.warn = originalWarn;
  }
});
