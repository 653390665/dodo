// Plan 260：技法优先度系统——归一化、装配排序稳定性、向后兼容与角色标注。
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, getDatabaseGeneration } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import { createChapter } from '../server/lib/db/chapters.js';
import {
  resolveWritingStyleRequest,
} from '../server/helpers/writing-style-service.js';
import { normalizeProjectPreferenceProfile } from '../shared/lib/project-preference-profile.js';
import type { Novel, Skill } from '../shared/types.js';

function skill(id: string, version = 1): Skill {
  return {
    id, name: id, description: `${id} description`, style: `${id} style`, pacing: `${id} pacing`,
    stabilityScore: 90, evaluationFeedback: '', version, createdAt: 1,
  } as Skill;
}

function novel(id = 'novel-1'): Novel {
  return {
    id, title: 'Novel', authorId: 'author', summary: '', status: 'ongoing',
    mountedSkillIds: ['planner', 'writer', 'critic'],
    mountedSkillLoadout: [
      { slot: 0, skillId: 'planner', weight: 1, lockedDimensions: [] },
      { slot: 1, skillId: 'writer', weight: 1, lockedDimensions: [] },
      { slot: 2, skillId: 'critic', weight: 1, lockedDimensions: [] },
    ],
    projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      skillLoadoutSchemaVersion: 2, contract: { styleAnchors: ['克制', '短句'] },
    },
    createdAt: 1, updatedAt: 1,
  };
}

test('normalizes techniquePriorities by id dedupe, role whitelist and order fill', () => {
  const normalized = normalizeProjectPreferenceProfile({
    capabilityModelVersion: 3,
    capabilityProfile: {
      version: 3,
      projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
      techniquePriorities: [
        { id: ' base-card ', role: 'base', order: 2 },
        { id: 'base-card', role: 'accent', order: 0 }, // 同 id 重复：首见生效
        { id: 'seasonal-card', role: 'seasonal' }, // order 缺省按出现序填充
        { id: 'bad-role', role: 'bogus' }, // role 白名单外：丢弃
        { id: 42, role: 'accent' }, // id 非字符串：丢弃
        'junk', // 非对象：丢弃
      ],
    },
  });

  assert.deepEqual(normalized.capabilityProfile?.techniquePriorities, [
    { id: 'base-card', role: 'base', order: 2 },
    { id: 'seasonal-card', role: 'seasonal', order: 1 },
  ]);
});

test('keeps techniquePriorities absent for legacy profiles and empty for malformed lists', () => {
  const legacy = normalizeProjectPreferenceProfile({
    capabilityModelVersion: 3,
    capabilityProfile: {
      version: 3,
      projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
    },
  });
  assert.equal(legacy.capabilityProfile?.techniquePriorities, undefined);

  const malformed = normalizeProjectPreferenceProfile({
    capabilityModelVersion: 3,
    capabilityProfile: {
      version: 3,
      projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
      techniquePriorities: 'not-a-list',
    },
  });
  assert.deepEqual(malformed.capabilityProfile?.techniquePriorities, []);
});

test('orders techniques base, accent by order, seasonal by order and annotates roles', () => {
  closeDb(); initDb(':memory:');
  try {
    const base = novel();
    base.projectPreferenceProfile = {
      ...base.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
        projectTechniqueIds: [
          'prose-action-booster',
          'de-ai-slop-shield',
          'prose-mouth-flavor',
          'de-ai-rhythm-restorer',
        ],
        techniquePriorities: [
          { id: 'de-ai-slop-shield', role: 'base', order: 99 },
          { id: 'de-ai-rhythm-restorer', role: 'seasonal', order: -5 },
        ],
      },
    };
    db.createNovel(base);

    const resolved = resolveWritingStyleRequest(base.id);

    // 排序桶：base → accent(order=原数组下标) → seasonal(order)。未标注视为 accent。
    assert.deepEqual(
      resolved.executionSnapshot.techniques.writer.map((item) => item.id),
      ['de-ai-slop-shield', 'prose-action-booster', 'prose-mouth-flavor', 'de-ai-rhythm-restorer']
    );
    // planner/writer 段内角色标注：仅 base 用「基调」，其余「强化」/「季节」。
    const writerPrompt = resolved.executionSnapshot.stagePrompts.writer;
    assert.match(writerPrompt, /【基调技法：de-ai-slop-shield】/);
    assert.match(writerPrompt, /【强化技法：prose-action-booster】/);
    assert.match(writerPrompt, /【强化技法：prose-mouth-flavor】/);
    assert.match(writerPrompt, /【季节技法：de-ai-rhythm-restorer】/);
    // 基调技法在注入序列首位。
    const baseHead = writerPrompt.indexOf('【基调技法：de-ai-slop-shield】');
    const accentHead = writerPrompt.indexOf('【强化技法：prose-action-booster】');
    const seasonalHead = writerPrompt.indexOf('【季节技法：de-ai-rhythm-restorer】');
    assert.ok(baseHead >= 0 && accentHead > baseHead && seasonalHead > accentHead);
    // critic 段保持旧版【阶段技法】标注（角色标注仅限 planner/writer）。
    const criticPrompt = resolved.executionSnapshot.stagePrompts.critic;
    assert.match(criticPrompt, /【阶段技法：de-ai-slop-shield】/);
    assert.doesNotMatch(criticPrompt, /【基调技法：de-ai-slop-shield】/);
  } finally { closeDb(); }
});

test('keeps legacy byte-identical output when techniquePriorities is absent or empty', () => {
  closeDb(); initDb(':memory:');
  try {
    for (const id of ['planner', 'writer', 'critic']) db.createSkill(skill(id));
    const withoutField = { ...novel('novel-legacy'), updatedAt: 1 };
    withoutField.projectPreferenceProfile = {
      ...withoutField.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
        projectTechniqueIds: ['prose-action-booster', 'prose-mouth-flavor'],
      },
    };
    db.createNovel(withoutField);
    db.createNovel({
      ...withoutField,
      id: 'novel-empty',
      capabilityProfile: undefined,
      projectPreferenceProfile: {
        ...withoutField.projectPreferenceProfile!, capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
          favoriteTechniqueIds: [],
          projectTechniqueIds: ['prose-action-booster', 'prose-mouth-flavor'],
          techniquePriorities: [],
        },
      },
    } as Novel);

    const legacy = resolveWritingStyleRequest('novel-legacy');
    const empty = resolveWritingStyleRequest('novel-empty');

    // 无 priorities 字段时与旧版完全一致：装备顺序即注入顺序，标注保持【阶段技法】。
    assert.deepEqual(
      legacy.executionSnapshot.techniques.writer.map((item) => item.id),
      ['prose-action-booster', 'prose-mouth-flavor']
    );
    const writerPrompt = legacy.executionSnapshot.stagePrompts.writer;
    assert.match(writerPrompt, /【阶段技法：prose-action-booster】/);
    assert.match(writerPrompt, /【阶段技法：prose-mouth-flavor】/);
    assert.doesNotMatch(writerPrompt, /基调技法|强化技法|季节技法/);
    // 空 priorities 数组与缺省字段逐字节一致。
    assert.equal(empty.executionSnapshot.stagePrompts.writer, legacy.executionSnapshot.stagePrompts.writer);
    assert.deepEqual(empty.executionSnapshot.techniques, legacy.executionSnapshot.techniques);
  } finally { closeDb(); }
});

test('resolves roles through membership mapping for persisted plaza techniques', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill({
      ...skill('persisted-mouth-flavor', 3),
      parentSkillId: 'prose-mouth-flavor',
      sourceType: 'plaza',
      sourceBadge: 'manual',
    });
    const base = novel();
    base.projectPreferenceProfile = {
      ...base.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
        projectTechniqueIds: ['persisted-mouth-flavor'],
        capabilityMemberships: [{
          sourceId: 'prose-mouth-flavor',
          sourceVersion: '3',
          sourceType: 'plaza',
          persistedSkillId: 'persisted-mouth-flavor',
        }],
        techniquePriorities: [{ id: 'persisted-mouth-flavor', role: 'base', order: 0 }],
      },
    };
    db.createNovel(base);

    const resolved = resolveWritingStyleRequest(base.id);

    assert.equal(resolved.executionSnapshot.techniques.writer[0]?.id, 'prose-mouth-flavor');
    assert.match(
      resolved.executionSnapshot.stagePrompts.writer,
      /【基调技法：prose-mouth-flavor】/
    );
  } finally { closeDb(); }
});

test('chapter techniques stay unannotated and last while project base leads the stage', () => {
  closeDb(); initDb(':memory:');
  try {
    const base = novel();
    base.projectPreferenceProfile = {
      ...base.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
        projectTechniqueIds: ['prose-action-booster'],
        techniquePriorities: [{ id: 'prose-action-booster', role: 'base', order: 0 }],
      },
    };
    db.createNovel(base);
    createChapter({ id: 'chapter-1', novelId: base.id, title: '第一章', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1,
      workflowMeta: { version: 1, capabilityState: { novelId: base.id, databaseGeneration: getDatabaseGeneration(), techniqueIds: ['prose-mouth-flavor'], overlayCardIds: [], techniqueVersions: { 'prose-mouth-flavor': 3 }, updatedAt: 1 } } });

    const resolved = resolveWritingStyleRequest(base.id, { chapterId: 'chapter-1' });

    // 本章技法未标注：保持【阶段技法】格式，且排在作品技法之后。
    assert.deepEqual(
      resolved.executionSnapshot.techniques.writer.map((item) => item.id),
      ['prose-action-booster', 'prose-mouth-flavor']
    );
    const writerPrompt = resolved.executionSnapshot.stagePrompts.writer;
    assert.match(writerPrompt, /【阶段技法：prose-mouth-flavor】/);
    assert.doesNotMatch(writerPrompt, /强化技法：prose-mouth-flavor|季节技法/);
    assert.match(writerPrompt, /【基调技法：prose-action-booster】/);
    assert.ok(writerPrompt.indexOf('【基调技法：prose-action-booster】') < writerPrompt.indexOf('【阶段技法：prose-mouth-flavor】'));
  } finally { closeDb(); }
});
