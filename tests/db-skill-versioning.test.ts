import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDb,
  createSkill,
  createNovel,
  createChapter,
  createSkillUsageRecord,
  getSkill,
  initDb,
  listSkillUsageRecords,
  listSkillVersions,
  updateSkill,
} from '../server/lib/db';
import type { Chapter, Novel, Skill, SkillFusionMeta } from '../shared/types';

function baseSkill(overrides: Partial<Skill> = {}): Skill {
  const now = Date.now();
  return {
    id: 'skill-v1',
    name: '冷冽武侠',
    description: 'v1',
    style: '冷峻',
    pacing: '快慢结合',
    vocabulary: [],
    imagery: [],
    bannedWords: [],
    fewShots: [],
    corePatterns: [],
    bannedElements: [],
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 1,
    createdAt: now,
    lineageRootId: 'skill-v1',
    dimensionTags: ['style'],
    ...overrides,
  };
}

describe("db-compat", () => {
test('save-as-new-version preserves lineage and records usage', () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-skill-${Date.now()}.db`);

  try {
    initDb(dbPath);

    createSkill(baseSkill());
    updateSkill('skill-v1', { description: 'v1-updated' });
    createSkill(
      baseSkill({
        id: 'skill-v2',
        description: 'v2',
        style: '更冷',
        pacing: '更快',
        stabilityScore: 82,
        version: 2,
        parentSkillId: 'skill-v1',
        lineageRootId: 'skill-v1',
      }),
    );

    const versions = listSkillVersions('skill-v1');
    assert.equal(versions.length, 2);
    assert.equal(versions[0].id, 'skill-v1');
    assert.equal(versions[1].parentSkillId, 'skill-v1');
    assert.equal(versions[1].version, 2);

    createNovel({
      id: 'novel-1',
      title: 'Test Novel',
      authorId: 'local-user',
      summary: '',
      status: 'ongoing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Novel);

    createChapter({
      id: 'chapter-1',
      novelId: 'novel-1',
      title: 'Test Chapter',
      content: '',
      order: 1,
      wordCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Chapter);

    createSkillUsageRecord({
      id: 'usage-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      mountedSkillIds: ['skill-v1', 'skill-v2'],
      fitScore: 86,
      auditScore: 78,
      userAction: 'accepted',
      createdAt: Date.now(),
    });

    const records = listSkillUsageRecords('skill-v2');
    assert.equal(records.length, 1);
    assert.equal(records[0].fitScore, 86);
    assert.deepEqual(records[0].mountedSkillIds, ['skill-v1', 'skill-v2']);
  } finally {
    closeDb();
    fs.rmSync(dbPath, { force: true });
  }
});

test('fusionMeta round-trip through create and read', () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-fusion-meta-${Date.now()}.db`);

  try {
    initDb(dbPath);

    const fusionMeta: SkillFusionMeta = {
      mainSkillId: 'skill-v1',
      supportSkillId: 'char-1',
      retainedTraits: ['冷峻短句', '低解释'],
      absorbedTraits: ['人物对峙张力', '对白前试探动作'],
      risks: ['同主维度叠加可能导致风格过载'],
      components: [{ skillId: 'skill-v1', version: 1 }, { skillId: 'char-1', version: 1 }],
      dimensionOwners: { style: 'skill-v1' },
      resolvedRules: { version: 1, dimensions: { style: { owner: 'skill-v1', effective: { style: '冷峻' } } }, lineage: { sources: [{ skillId: 'skill-v1' }, { skillId: 'char-1' }] } },
    };

    const now = Date.now();
    createSkill(baseSkill());
    createSkill(baseSkill({ id: 'char-1', sourceBadge: 'book-extracted', sourceType: 'book-extracted', deconstructionCardType: 'style-card', executionScore: 80,
      isRuntimeReady: true, sanitizationStatus: 'runtime-ready', runtimeStatus: 'active' } as Partial<Skill>));
    updateSkill('skill-v1', { sourceBadge: 'book-extracted', sourceType: 'book-extracted', deconstructionCardType: 'style-card', executionScore: 80,
      isRuntimeReady: true, sanitizationStatus: 'runtime-ready', runtimeStatus: 'active' } as Partial<Skill>);
    createSkill({
      id: 'fusion-1',
      name: '冷峻刀锋 · 压抑对峙 融合版',
      description: '冷峻刀锋 为主卡，融合 压抑对峙 的辅卡特征。',
      style: '冷峻',
      pacing: '快慢结合',
      vocabulary: [],
      imagery: [],
      bannedWords: [],
      fewShots: [],
      corePatterns: [],
      bannedElements: [],
      stabilityScore: 80,
      evaluationFeedback: '',
      version: 2,
      parentSkillId: 'skill-v1',
      lineageRootId: 'skill-v1',
      primaryDimension: 'style',
      dimensionTags: ['style', 'character'],
      fusionMeta,
      sourceBadge: 'fused',
      sourceType: 'book-extracted',
      deconstructionCardType: 'style-card',
      executionScore: 80,
      isRuntimeReady: true,
      sanitizationStatus: 'runtime-ready',
      runtimeStatus: 'active',
      createdAt: now,
    } as Skill);

    const read = getSkill('fusion-1');
    assert.ok(read, 'fusion skill should be readable');
    assert.ok(read!.fusionMeta, 'fusionMeta should be persisted');
    assert.equal(read!.fusionMeta!.mainSkillId, 'skill-v1');
    assert.equal(read!.fusionMeta!.supportSkillId, 'char-1');
    assert.equal(getSkill('char-1')?.sourceType, 'book-extracted');
    assert.equal((getSkill('char-1') as Skill & { isRuntimeReady?: boolean }).isRuntimeReady, true);
    assert.deepEqual(read!.fusionMeta!.retainedTraits, ['冷峻短句', '低解释']);
    assert.deepEqual(read!.fusionMeta!.absorbedTraits, ['人物对峙张力', '对白前试探动作']);
    assert.deepEqual(read!.fusionMeta!.risks, ['同主维度叠加可能导致风格过载']);

    assert.throws(
      () => updateSkill('fusion-1', { deconstructionCardType: undefined }),
      /SKILL_CARD_TYPE_INVALID/,
    );

    // update with modified fusionMeta
    updateSkill('fusion-1', {
      fusionMeta: { ...fusionMeta, risks: [...(fusionMeta.risks || []), '继续启用世界观能力卡可能压慢节奏'] },
    });

    const updated = getSkill('fusion-1');
    assert.ok(updated!.fusionMeta);
    assert.equal(updated!.fusionMeta!.risks?.length, 2);
    assert.equal(updated!.fusionMeta!.risks?.[1], '继续启用世界观能力卡可能压慢节奏');

    // fusionMeta survives a partial update (no fusionMeta in data)
    updateSkill('fusion-1', { description: 'updated description only' });
    const afterPartial = getSkill('fusion-1');
    assert.ok(afterPartial!.fusionMeta, 'fusionMeta should survive partial update');
    assert.equal(afterPartial!.fusionMeta!.mainSkillId, 'skill-v1');
  } finally {
    closeDb();
    fs.rmSync(dbPath, { force: true });
  }
});

test('legacy manual skills remain writable', () => {
  closeDb();
  initDb(':memory:');
  try {
    createSkill(baseSkill({ id: 'manual-skill' }));
    updateSkill('manual-skill', { description: 'manual-updated' });
    assert.equal(getSkill('manual-skill')?.description, 'manual-updated');
  } finally { closeDb(); }
});

test('incomplete skill cards are rejected at persistence', () => {
  closeDb();
  initDb(':memory:');
  try {
    assert.throws(
      () => createSkill(baseSkill({ id: 'incomplete-card', deconstructionCardType: 'style-card' })),
      /SKILL_CARD_SOURCE_INVALID/,
    );
  } finally { closeDb(); }
});

test('runtime-ready skill cards round-trip through create and update', () => {
  closeDb();
  initDb(':memory:');
  try {
    const card = baseSkill({
      id: 'runtime-card', sourceType: 'book-extracted', sourceBadge: 'book-extracted',
      deconstructionCardType: 'style-card', executionScore: 80,
      isRuntimeReady: true, sanitizationStatus: 'runtime-ready', runtimeStatus: 'active',
    } as Partial<Skill>);
    createSkill(card);
    updateSkill(card.id, { description: 'updated card' });
    const read = getSkill(card.id);
    assert.equal(read?.description, 'updated card');
    assert.equal(read?.deconstructionCardType, 'style-card');
    assert.equal((read as Skill & { isRuntimeReady?: boolean })?.isRuntimeReady, true);
  } finally { closeDb(); }
});

test('fused partial update is still governed by the skill-card gate', () => {
  closeDb();
  initDb(':memory:');
  try {
    const fused = baseSkill({
      id: 'fused-invalid', sourceBadge: 'fused', fusionMeta: {} as SkillFusionMeta,
    });
    assert.throws(() => createSkill(fused), /SKILL_CARD_TYPE_INVALID/);
  } finally { closeDb(); }
});
});
