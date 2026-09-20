import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  closeDb,
  createSkill,
  getSkill,
  initDb,
  listSkills,
} from '../server/lib/db';
import type { Skill } from '../shared/types';
import {
  applyBuiltinCloneMigrations,
  selectBuiltinCloneMigrations,
} from '../scripts/migrate-builtin-clone-source';

// Plan 257：四张白标卡双层转 built-in 后，存量克隆占位行的 sourceType 需要一次性
// 迁移（plaza → built-in），否则前端 existing/去重匹配失配。本测试用内存库
// fixture 验证迁移效果与幂等。

function cloneFixture(overrides: Partial<Skill> = {}): Skill {
  const now = Date.now();
  return {
    id: 'clone-1',
    name: '克隆拆书卡',
    description: '克隆占位',
    style: 'INKFLOW_CURATED_RUNTIME_DECOUPLED_PLACEHOLDER',
    pacing: '官方提示词运行时还原',
    vocabulary: [],
    imagery: [],
    fewShots: [],
    corePatterns: [],
    bannedElements: [],
    bannedWords: [],
    stabilityScore: 95,
    evaluationFeedback: 'ok',
    version: 3,
    createdAt: now,
    lineageRootId: 'clone-1',
    primaryDimension: 'pacing',
    dimensionTags: ['pacing'],
    parentSkillId: 'deconstruct-golden-climax',
    sourceType: 'plaza',
    sourceBadge: 'manual',
    deconstructionCardType: 'pacing-card',
    isRuntimeReady: true,
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
    ...overrides,
  } as Skill;
}

describe('plan257 builtin clone source migration', () => {
  beforeEach(() => initDb(':memory:'));
  afterEach(() => closeDb());

  test('migrates only plaza clones of the four builtin source cards and stays idempotent', () => {
    createSkill(cloneFixture({ id: 'clone-pacing' }));
    createSkill(
      cloneFixture({
        id: 'clone-hook',
        parentSkillId: 'deconstruct-suspense-hook',
        deconstructionCardType: 'hook-card',
        primaryDimension: 'style',
        dimensionTags: ['style'],
      })
    );
    createSkill(
      cloneFixture({
        id: 'clone-flavor',
        parentSkillId: 'prose-mouth-flavor',
        deconstructionCardType: undefined,
        isRuntimeReady: undefined,
        sanitizationStatus: undefined,
        runtimeStatus: undefined,
        stabilityScore: 93,
      })
    );
    createSkill(
      cloneFixture({
        id: 'clone-audit',
        parentSkillId: 'audit-logical-sanity',
        deconstructionCardType: undefined,
        isRuntimeReady: undefined,
        sanitizationStatus: undefined,
        runtimeStatus: undefined,
        stabilityScore: 92,
      })
    );
    // 非目标：仍是 plaza 的其他源卡克隆（style-ancient-elegance 维持 plaza 不迁移）。
    createSkill(
      cloneFixture({
        id: 'clone-style-plaza',
        parentSkillId: 'style-ancient-elegance',
        deconstructionCardType: 'style-card',
        primaryDimension: 'style',
        dimensionTags: ['style'],
      })
    );
    // 非目标：已经是 built-in 的克隆（迁移后形态，第二遍不得再动）。
    createSkill(cloneFixture({ id: 'clone-already-builtin', sourceType: 'built-in' }));

    const firstPass = applyBuiltinCloneMigrations(listSkills());
    assert.deepEqual(
      firstPass.map((item) => item.id).sort(),
      ['clone-audit', 'clone-flavor', 'clone-hook', 'clone-pacing']
    );
    for (const id of ['clone-pacing', 'clone-hook', 'clone-flavor', 'clone-audit']) {
      assert.equal(getSkill(id)?.sourceType, 'built-in', id);
    }
    assert.equal(getSkill('clone-style-plaza')?.sourceType, 'plaza');
    assert.equal(getSkill('clone-already-builtin')?.sourceType, 'built-in');

    // 幂等：第二遍选择为空，重复应用 0 行。
    assert.equal(selectBuiltinCloneMigrations(listSkills()).length, 0);
    assert.equal(applyBuiltinCloneMigrations(listSkills()).length, 0);
  });
});
