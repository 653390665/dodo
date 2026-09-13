import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, createSkill, getSkill, initDb, listSkills, updateSkill } from '../server/lib/db';
import { getDb } from '../server/lib/db-instance';
import type { Skill } from '../shared/types';

function baseSkill(overrides: Partial<Skill> = {}): Skill {
  const now = Date.now();
  return {
    id: 'skill-gov-1',
    name: '冷冽武侠',
    description: '治理字段 roundtrip',
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
    ...overrides,
  };
}

/** 通过落库门禁的完整治理卡字段（Plan 200 的 7 个新列）。 */
function governedFields(overrides: Partial<Skill> = {}): Partial<Skill> {
  return {
    deckGroupId: 'deck-gov-001',
    deconstructionCardType: 'style-card',
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
    sourceType: 'licensed',
    accessTier: 'paid',
    isRuntimeReady: true,
    ...overrides,
  };
}

interface GovernanceRow {
  deck_group_id: string | null;
  deconstruction_card_type: string | null;
  sanitization_status: string | null;
  runtime_status: string | null;
  source_type: string | null;
  access_tier: string | null;
  is_runtime_ready: number | null;
}

function readGovernanceRow(id: string): GovernanceRow {
  return getDb()
    .prepare(
      `SELECT deck_group_id, deconstruction_card_type, sanitization_status,
              runtime_status, source_type, access_tier, is_runtime_ready
       FROM skills WHERE id = ?`
    )
    .get(id) as GovernanceRow;
}

describe('skills governance columns (plan 200)', () => {
  test('createSkill persists all 7 governance fields and reads them back', () => {
    closeDb();
    const dbPath = path.join(os.tmpdir(), `inkflow-gov-cols-${Date.now()}.db`);
    try {
      initDb(dbPath);
      createSkill(baseSkill(governedFields()));

      const expected = governedFields();
      for (const read of [
        getSkill('skill-gov-1'),
        listSkills().find((s) => s.id === 'skill-gov-1'),
      ]) {
        assert.ok(read, 'governed skill should be readable');
        assert.equal(read!.deckGroupId, expected.deckGroupId);
        assert.equal(read!.deconstructionCardType, expected.deconstructionCardType);
        assert.equal(read!.sanitizationStatus, expected.sanitizationStatus);
        assert.equal(read!.runtimeStatus, expected.runtimeStatus);
        assert.equal(read!.sourceType, expected.sourceType);
        assert.equal(read!.accessTier, expected.accessTier);
        assert.equal(read!.isRuntimeReady, expected.isRuntimeReady);
      }

      // 落库真值：直接读列，而非 mapper 合成值
      const row = readGovernanceRow('skill-gov-1');
      assert.equal(row.deck_group_id, 'deck-gov-001');
      assert.equal(row.deconstruction_card_type, 'style-card');
      assert.equal(row.sanitization_status, 'runtime-ready');
      assert.equal(row.runtime_status, 'active');
      assert.equal(row.source_type, 'licensed');
      assert.equal(row.access_tier, 'paid');
      assert.equal(row.is_runtime_ready, 1);
    } finally {
      closeDb();
      fs.rmSync(dbPath, { force: true });
    }
  });

  test('updateSkill rewrites governance columns', () => {
    closeDb();
    initDb(':memory:');
    try {
      createSkill(baseSkill(governedFields()));
      updateSkill('skill-gov-1', { deckGroupId: 'deck-gov-002', accessTier: 'free' });

      const read = getSkill('skill-gov-1');
      assert.equal(read!.deckGroupId, 'deck-gov-002');
      assert.equal(read!.accessTier, 'free');
      // 未触及的治理字段保持不变
      assert.equal(read!.deconstructionCardType, 'style-card');
      assert.equal(read!.runtimeStatus, 'active');
      const row = readGovernanceRow('skill-gov-1');
      assert.equal(row.deck_group_id, 'deck-gov-002');
      assert.equal(row.access_tier, 'free');
      assert.equal(row.runtime_status, 'active');
    } finally {
      closeDb();
    }
  });

  test('explicit isRuntimeReady:false round-trips as 0 and false', () => {
    closeDb();
    initDb(':memory:');
    try {
      // 无 deconstructionCardType / book-extracted 标记的普通卡不触发门禁
      createSkill(baseSkill({ id: 'plain-false', isRuntimeReady: false }));
      const read = getSkill('plain-false');
      assert.equal(read!.isRuntimeReady, false);
      assert.equal(readGovernanceRow('plain-false').is_runtime_ready, 0);
    } finally {
      closeDb();
    }
  });

  test('legacy path without governance fields reads back undefined and NULL columns', () => {
    closeDb();
    initDb(':memory:');
    try {
      createSkill(baseSkill({ id: 'legacy-plain' }));
      const read = getSkill('legacy-plain');
      assert.ok(read);
      assert.equal(read!.deckGroupId, undefined);
      assert.equal(read!.deconstructionCardType, undefined);
      assert.equal(read!.sanitizationStatus, undefined);
      assert.equal(read!.runtimeStatus, undefined);
      assert.equal(read!.sourceType, undefined);
      assert.equal(read!.accessTier, undefined);
      assert.equal(read!.isRuntimeReady, undefined);

      const row = readGovernanceRow('legacy-plain');
      assert.equal(row.deck_group_id, null);
      assert.equal(row.deconstruction_card_type, null);
      assert.equal(row.sanitization_status, null);
      assert.equal(row.runtime_status, null);
      assert.equal(row.source_type, null);
      assert.equal(row.access_tier, null);
      assert.equal(row.is_runtime_ready, null);
    } finally {
      closeDb();
    }
  });

  test('gate rejection semantics unchanged: SKILL_CARD_SOURCE_INVALID / NOT_RUNTIME_READY', () => {
    closeDb();
    initDb(':memory:');
    try {
      // 非授权 sourceType 仍拒绝
      assert.throws(
        () => createSkill(baseSkill(governedFields({ sourceType: 'unauthorized' }))),
        /SKILL_CARD_SOURCE_INVALID/
      );
      // 未达 runtime-ready 仍拒绝（isRuntimeReady 缺失）
      assert.throws(
        () => createSkill(baseSkill(governedFields({ isRuntimeReady: undefined }))),
        /SKILL_CARD_NOT_RUNTIME_READY/
      );
      assert.throws(
        () => createSkill(baseSkill(governedFields({ sanitizationStatus: 'raw' }))),
        /SKILL_CARD_NOT_RUNTIME_READY/
      );
    } finally {
      closeDb();
    }
  });
});
