import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  closeDb,
  createNovel,
  createNovelWithChapter,
  getNovel,
  initDb,
  updateNovel,
} from '../server/lib/db';
import { preflightNovelEntity } from '../server/lib/db/novel-entity-preflight';
import type { Chapter, Novel, ProjectPreferenceProfile } from '../shared/types';

// Plan 257：新书默认创作流程——客户端建档漏斗（preflightNovelEntity 的
// createNovel / createNovelWithChapter 分支）在未带 v3 能力配置时默认激活
// generic-novel-flow；显式选择 / 显式未选 / 显式清除均不被覆盖；服务端内部
// 直建（db.createNovel）与既有作品更新不受影响。

const preflightCtx = {
  getNovel: () => undefined,
  getSkill: () => undefined,
};

const bareNovel = (id: string, overrides: Partial<Novel> = {}): Novel => ({
  id,
  title: `作品 ${id}`,
  authorId: 'local',
  summary: '',
  status: 'ongoing',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const firstChapter = (id: string, novelId: string): Chapter => ({
  id,
  novelId,
  title: '第一章',
  content: '',
  order: 1,
  wordCount: 0,
  createdAt: 1,
  updatedAt: 1,
});

const v3Profile = (
  overrides: Partial<NonNullable<ProjectPreferenceProfile['capabilityProfile']>> = {}
): ProjectPreferenceProfile => ({
  tags: [],
  weights: {
    styleWeight: 0.5,
    characterWeight: 0.5,
    worldWeight: 0.5,
    plotWeight: 0.5,
    pacingWeight: 0.5,
  },
  acceptedDimensions: [],
  rejectedDimensions: [],
  notes: [],
  evidenceCount: 0,
  capabilityModelVersion: 3,
  capabilityProfile: {
    version: 3,
    projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
    favoriteTechniqueIds: [],
    capabilityMemberships: [],
    ...overrides,
  },
});

/** 镜像 /api/db proxy 的建档调用次序：先 preflight 校验/归一化，再入库。 */
function createNovelViaProxy(entity: Novel): void {
  preflightNovelEntity('createNovel', entity as unknown as Record<string, unknown>, undefined, preflightCtx);
  createNovel(entity);
}

describe('plan257 新书默认创作流程', () => {
  beforeEach(() => initDb(':memory:'));
  afterEach(() => closeDb());

  test('新建作品且无能力配置时默认 activeFlowId 为 generic-novel-flow', () => {
    const entity = bareNovel('n-bare');
    createNovelViaProxy(entity);
    const profile = getNovel('n-bare')?.projectPreferenceProfile;
    assert.equal(profile?.capabilityModelVersion, 3);
    assert.equal(profile?.capabilityProfile?.activeFlowId, 'generic-novel-flow');
    // 注入的是归一化后的完整 v3 档案（卡组等结构就位，避免下游二次兜底）。
    assert.deepEqual(profile?.capabilityProfile?.projectSkillDeck?.supportCardIds, []);
    assert.deepEqual(profile?.capabilityProfile?.capabilityMemberships, []);
  });

  test('createNovelWithChapter（书库新建主路径）同样注入默认流程', () => {
    const entity = bareNovel('n-lib');
    preflightNovelEntity(
      'createNovelWithChapter',
      entity as unknown as Record<string, unknown>,
      undefined,
      preflightCtx
    );
    createNovelWithChapter(entity, firstChapter('c1', 'n-lib'));
    assert.equal(
      getNovel('n-lib')?.projectPreferenceProfile?.capabilityProfile?.activeFlowId,
      'generic-novel-flow'
    );
  });

  test('客户端显式选择其他 flow 时不被覆盖', () => {
    const entity = bareNovel('n-explicit', {
      projectPreferenceProfile: v3Profile({ activeFlowId: 'book-deconstruction-flow' }),
    });
    createNovelViaProxy(entity);
    assert.equal(
      getNovel('n-explicit')?.projectPreferenceProfile?.capabilityProfile?.activeFlowId,
      'book-deconstruction-flow'
    );
  });

  test('建档时带 v3 配置但未选 flow 的新作保持未选择态（尊重显式初始化）', () => {
    const entity = bareNovel('n-unset', { projectPreferenceProfile: v3Profile() });
    createNovelViaProxy(entity);
    assert.equal(
      getNovel('n-unset')?.projectPreferenceProfile?.capabilityProfile?.activeFlowId,
      undefined
    );
  });

  test('服务端内部直建（db.createNovel）不注入，行为保持不变', () => {
    createNovel(bareNovel('n-internal'));
    const profile = getNovel('n-internal')?.projectPreferenceProfile;
    // 读映射层对空 profile 的既有归一化（weights 等）仍在，但无任何 v3 能力配置。
    assert.equal(profile?.capabilityModelVersion, undefined);
    assert.equal(profile?.capabilityProfile, undefined);
  });

  test('既有作品不迁移：updateNovel 不注入默认，显式清除后保持清除', () => {
    // 建档注入默认后，用户显式清除（updateNovel 携带无 activeFlowId 的 v3 档案）。
    const entity = bareNovel('n-clear');
    createNovelViaProxy(entity);
    assert.equal(
      getNovel('n-clear')?.projectPreferenceProfile?.capabilityProfile?.activeFlowId,
      'generic-novel-flow'
    );
    updateNovel('n-clear', {
      projectPreferenceProfile: v3Profile({
        projectSkillDeck: { supportCardIds: [], updatedAt: 2 },
      }),
    });
    const afterClear = getNovel('n-clear')?.projectPreferenceProfile?.capabilityProfile;
    assert.equal(afterClear?.activeFlowId, undefined);
    assert.equal(afterClear?.projectSkillDeck?.updatedAt, 2);

    // 历史作品形态（无 v3 标记的非空 profile）经 update 不被迁移注入。
    createNovel(
      bareNovel('n-legacy', {
        projectPreferenceProfile: { tags: ['历史'], evidenceCount: 3 } as ProjectPreferenceProfile,
      })
    );
    updateNovel('n-legacy', {
      projectPreferenceProfile: {
        tags: ['历史'],
        evidenceCount: 4,
      } as ProjectPreferenceProfile,
    });
    assert.equal(getNovel('n-legacy')?.projectPreferenceProfile?.capabilityProfile, undefined);
    assert.equal(getNovel('n-legacy')?.projectPreferenceProfile?.capabilityModelVersion, undefined);
  });
});
