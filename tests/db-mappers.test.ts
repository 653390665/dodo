import test from 'node:test';
import assert from 'node:assert/strict';

import { rowToChapter, rowToNovel, rowToSkill, type SkillRow } from '../server/lib/db-mappers';
import { logger } from '../server/logger';

function skillRow(overrides: Partial<SkillRow>): SkillRow {
  return {
    id: 'skill', name: '', description: '', style: '', pacing: '', vocabulary: '[]',
    sentence_structure: null, imagery: '[]', banned_words: '[]', few_shots: '[]',
    character_traits: null, world_building: null, foreshadowing: null, plot_pattern: null,
    core_patterns: '[]', banned_elements: '[]', stability_score: 0, evaluation_feedback: '',
    version: 1, parent_skill_id: null, lineage_root_id: null, primary_dimension: null,
    dimension_tags: '[]', composition_profile: '{}', usage_stats: '{}', feedback_score: 0,
    fusion_meta: null, method_chain: null, why_this_skill_works: null, source_badge: null,
    created_at: 0, updated_at: null,
    ...overrides,
  };
}

test('rowToNovel maps persisted JSON and snake_case fields without changing legacy fallbacks', () => {
  const novel = rowToNovel({
    id: 'novel-1',
    title: 'Novel',
    author_id: 'author-1',
    summary: '',
    cover_image: null,
    status: 'ongoing',
    world_rules: null,
    global_outline: null,
    mounted_skill_ids: '["skill-1"]',
    mounted_skill_loadout: '{broken',
    project_preference_profile: '{"contract":{"styleAnchors":["clean"]}}',
    created_at: 1,
    updated_at: 2,
  });

  assert.equal(novel.authorId, 'author-1');
  assert.equal(novel.coverImage, null);
  assert.deepEqual(novel.mountedSkillIds, ['skill-1']);
  assert.deepEqual(novel.mountedSkillLoadout, []);
  assert.deepEqual(novel.projectPreferenceProfile, {
    contract: { styleAnchors: ['clean'] }, tags: [],
    weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
    acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
  });
});

test('rowToChapter maps workflow metadata and preserves current nullable column output', () => {
  const chapter = rowToChapter({
    id: 'chapter-1',
    novel_id: 'novel-1',
    volume_name: null,
    title: 'Chapter',
    content: '',
    order: 1,
    word_count: 0,
    scene_beats: null,
    critique: null,
    workflow_meta: '{"version":1}',
    created_at: 1,
    updated_at: 2,
  });

  assert.equal(chapter.novelId, 'novel-1');
  assert.equal(chapter.volumeName, null);
  assert.equal(chapter.sceneBeats, null);
  assert.deepEqual(chapter.workflowMeta, { version: 1 });
});

test('rowToChapter malformed workflow metadata falls back without throwing', () => {
  const chapter = rowToChapter({
    id: 'chapter-bad-json', novel_id: 'novel-1', volume_name: null, title: 'Chapter', content: '',
    order: 1, word_count: 0, scene_beats: null, critique: null, workflow_meta: '{broken', created_at: 1, updated_at: 2,
  });
  assert.equal(chapter.workflowMeta, undefined);
});

test('rowToNovel malformed JSON columns preserve empty fallbacks', () => {
  const novel = rowToNovel({
    id: 'novel-bad-json', title: 'Novel', author_id: 'author-1', summary: '', cover_image: null, status: 'ongoing',
    world_rules: null, global_outline: null, mounted_skill_ids: '{broken', mounted_skill_loadout: null,
    project_preference_profile: '[broken', created_at: 1, updated_at: 2,
  });
  assert.deepEqual(novel.mountedSkillIds, []);
  assert.deepEqual(novel.projectPreferenceProfile, {
    tags: [],
    weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
    acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
  });
});

test('safeJsonParse via rowToSkill: valid JSON returns parsed value', () => {
  const row = skillRow({
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
  });
  const skill = rowToSkill(row);
  assert.deepEqual(skill.bannedWords, ['word-a', 'word-b']);
});

test('safeJsonParse via rowToSkill: null column returns fallback', () => {
  const row = skillRow({
    id: 'skill-2',
    banned_words: null,
    stability_score: 1,
    version: 1,
  });
  const skill = rowToSkill(row);
  assert.deepEqual(skill.bannedWords, []);
});

test('safeJsonParse via rowToSkill: null optional JSON values return fallback', () => {
  const row = skillRow({
    id: 'skill-3',
    banned_words: null,
    few_shots: null,
    composition_profile: null,
    stability_score: 1,
    version: 1,
  });
  const skill = rowToSkill(row);
  assert.deepEqual(skill.bannedWords, []);
  assert.deepEqual(skill.fewShots, []);
  assert.deepEqual(skill.compositionProfile, {});
});

test('rowToSkill preserves zero updatedAt and normalizes nullable fields', () => {
  const row = skillRow({
    id: 'skill-nullable',
    description: null,
    style: null,
    pacing: null,
    stability_score: null,
    evaluation_feedback: null,
    version: null,
    feedback_score: null,
    updated_at: 0,
    parent_skill_id: null,
    source_badge: null,
  });
  const skill = rowToSkill(row);
  assert.equal(skill.description, '');
  assert.equal(skill.style, '');
  assert.equal(skill.pacing, '');
  assert.equal(skill.stabilityScore, 0);
  assert.equal(skill.evaluationFeedback, '');
  assert.equal(skill.version, 1);
  assert.equal(skill.feedbackScore, undefined);
  assert.equal(skill.updatedAt, 0);
  assert.equal(skill.parentSkillId, undefined);
  assert.equal(skill.sourceBadge, undefined);
});

test('safeJsonParse via rowToSkill: malformed JSON returns fallback and does not throw', () => {
  const row = skillRow({
    id: 'skill-4',
    banned_words: '{{invalid}}',
    few_shots: '[broken',
    composition_profile: '{not json',
    stability_score: 1,
    version: 1,
  });
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
    const row = skillRow({
      id: 'skill-5',
      name: 'Corrupt Skill',
      description: 'desc',
      style: 'style',
      pacing: 'fast',
      banned_words: '{{invalid json}}',
      stability_score: 5,
      evaluation_feedback: 'ok',
      version: 1,
    });
    const skill = rowToSkill(row);
    assert.equal(skill.id, 'skill-5');
    assert.deepEqual(skill.bannedWords, []);
    assert.ok(warns.some((w) => w.includes('[db-mappers] Malformed JSON')));
  } finally {
    logger.warn = originalWarn;
  }
});
