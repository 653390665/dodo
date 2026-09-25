import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getProjectDeckCardIds,
  isCapabilityAssemblyMigrated,
  migrateCapabilityAssembly,
  resolveCapabilityAssembly,
  resolveChapterCards,
  resolveProjectCards,
  resolveSingleRunCard,
} from '../shared/lib/capability-assembly.js';
import type { ProjectCapabilityProfile } from '../shared/types/preferences.js';
import { normalizeProjectPreferenceProfile } from '../shared/lib/project-preference-profile.js';

/**
 * 批次 A 装配字段收敛验收：
 * ① 旧装配字段数据在新读取路径下结果不变（迁移测试）
 * ② 迁移函数重复执行结果一致（幂等）
 * ③ deprecated 标记在类型层可见
 */

function profileWithDeck(
  deck: Partial<ProjectCapabilityProfile['projectSkillDeck']> & { mainCardId?: string }
): ProjectCapabilityProfile {
  return {
    version: 3,
    projectSkillDeck: {
      ...(deck.mainCardId ? { mainCardId: deck.mainCardId } : {}),
      supportCardIds: deck.supportCardIds ?? [],
      updatedAt: deck.updatedAt ?? 0,
    },
    favoriteTechniqueIds: [],
  };
}

const LEGACY_FIXTURES: Array<{
  name: string;
  profile: ProjectCapabilityProfile;
  loadout?: Array<{ slot: number; skillId: string }>;
  mountedSkillIds?: string[];
  expected: string[];
}> = [
  {
    name: '卡组非空（主卡 + 辅卡，去重）优先于挂载槽与 mountedSkillIds',
    profile: profileWithDeck({ mainCardId: 'main', supportCardIds: ['support', 'main'] }),
    loadout: [{ slot: 1, skillId: 'loadout-b' }],
    mountedSkillIds: ['legacy-a'],
    expected: ['main', 'support'],
  },
  {
    name: '卡组为空时按 slot 升序取挂载槽（空 skillId 跳过）',
    profile: profileWithDeck({}),
    loadout: [
      { slot: 2, skillId: 'b' },
      { slot: 0, skillId: 'a' },
      { slot: 1, skillId: '' },
    ],
    mountedSkillIds: ['legacy-a'],
    expected: ['a', 'b'],
  },
  {
    name: '无卡组无挂载槽时逐项回退 mountedSkillIds',
    profile: profileWithDeck({}),
    mountedSkillIds: ['legacy-a', 'legacy-b'],
    expected: ['legacy-a', 'legacy-b'],
  },
];

test('旧装配字段在新读取路径下结果不变（迁移测试）', () => {
  for (const fixture of LEGACY_FIXTURES) {
    const legacyInput = {
      capabilityProfile: fixture.profile,
      mountedSkillLoadout: fixture.loadout ?? null,
      mountedSkillIds: fixture.mountedSkillIds ?? null,
    };

    // 未迁移时：新读取路径 ≡ 旧优先级
    assert.deepEqual(resolveProjectCards(legacyInput).ids, fixture.expected, fixture.name);
    assert.equal(isCapabilityAssemblyMigrated(fixture.profile), false, fixture.name);

    // 迁移后：写入的 projectCards 即为旧路径结果，且读取结果不变
    const { profile: migrated, changed } = migrateCapabilityAssembly(fixture.profile, {
      mountedSkillLoadout: fixture.loadout ?? null,
      mountedSkillIds: fixture.mountedSkillIds ?? null,
    });
    assert.equal(changed, true, fixture.name);
    assert.ok(migrated, fixture.name);
    assert.deepEqual(migrated!.projectCards, fixture.expected, fixture.name);
    assert.deepEqual(
      resolveProjectCards({ capabilityProfile: migrated }).ids,
      fixture.expected,
      fixture.name
    );
    assert.equal(isCapabilityAssemblyMigrated(migrated), true, fixture.name);

    // 迁移只新增 projectCards：其余字段逐项不变（含引用相等）
    const { projectCards: _migratedCards, ...restMigrated } = migrated!;
    const { ...restOriginal } = fixture.profile;
    assert.deepEqual(restMigrated, restOriginal, fixture.name);
    assert.equal(migrated!.projectSkillDeck, fixture.profile.projectSkillDeck, fixture.name);
  }
});

test('旧装配字段为空时不写入显式空数组（保持未声明，changed=false）', () => {
  const profile = profileWithDeck({});
  const { profile: migrated, changed } = migrateCapabilityAssembly(profile);
  assert.equal(changed, false);
  assert.equal(migrated, profile);
  assert.equal(migrated!.projectCards, undefined);
  assert.deepEqual(resolveProjectCards({ capabilityProfile: migrated }).ids, []);
});

test('旧字段含重复/空白项时迁移按新字段语义归一，之后读取为固定点', () => {
  const profile = profileWithDeck({});
  const legacy = { mountedSkillIds: [' legacy-a ', 'legacy-a', 'legacy-b'] };
  // 未迁移：旧路径逐项返回（含重复与空白）
  assert.deepEqual(
    resolveProjectCards({ capabilityProfile: profile, ...legacy }).ids,
    [' legacy-a ', 'legacy-a', 'legacy-b']
  );
  const first = migrateCapabilityAssembly(profile, legacy);
  assert.equal(first.changed, true);
  assert.deepEqual(first.profile!.projectCards, ['legacy-a', 'legacy-b']);
  assert.deepEqual(resolveProjectCards({ capabilityProfile: first.profile }).ids, [
    'legacy-a',
    'legacy-b',
  ]);
  const second = migrateCapabilityAssembly(first.profile, legacy);
  assert.equal(second.changed, false);
  assert.equal(second.profile, first.profile);
});

test('迁移函数幂等：重复执行 changed=false 且结果一致', () => {
  const profile = profileWithDeck({ mainCardId: 'main', supportCardIds: ['support'] });
  const legacy = { mountedSkillLoadout: [{ slot: 0, skillId: 'loadout-a' }] };
  const first = migrateCapabilityAssembly(profile, legacy);
  assert.equal(first.changed, true);
  const second = migrateCapabilityAssembly(first.profile, legacy);
  assert.equal(second.changed, false);
  assert.equal(second.profile, first.profile); // 同一引用返回，避免无谓写库
  assert.deepEqual(second.profile, first.profile);
  assert.deepEqual(first.profile!.projectCards, ['main', 'support']);
});

test('新字段声明即权威（含显式空数组），迁移不覆盖', () => {
  const legacyInput = {
    capabilityProfile: profileWithDeck({ mainCardId: 'main' }),
    mountedSkillLoadout: [{ slot: 0, skillId: 'loadout-a' }],
    mountedSkillIds: ['legacy-a'],
  };
  const declared = { ...legacyInput, capabilityProfile: { ...legacyInput.capabilityProfile, projectCards: [] } };
  assert.deepEqual(resolveProjectCards(declared).ids, []);
  assert.equal(resolveProjectCards(declared).source, 'project-cards');

  const declaredNonEmpty = {
    ...legacyInput,
    capabilityProfile: { ...legacyInput.capabilityProfile, projectCards: [' new-card ', 'new-card'] },
  };
  assert.deepEqual(resolveProjectCards(declaredNonEmpty).ids, ['new-card']);

  const { changed } = migrateCapabilityAssembly(declared.capabilityProfile, {
    mountedSkillLoadout: legacyInput.mountedSkillLoadout,
  });
  assert.equal(changed, false);
});

test('chapter/singleRun 合并读取旧来源，且迁移不捏造作用域', () => {
  const profile = profileWithDeck({});
  const assembled = resolveCapabilityAssembly({
    capabilityProfile: profile,
    chapterCapabilityState: { techniqueIds: ['t1'], overlayCardIds: ['o1', 'o2'] },
    sessionCardIds: ['session-card', 'session-card-2'],
  });
  assert.deepEqual(assembled.chapterCards, ['t1', 'o1', 'o2']);
  assert.equal(assembled.sources.chapterCards, 'chapter-capability-state');
  assert.equal(assembled.singleRunCard, 'session-card');
  assert.equal(assembled.sources.singleRunCard, 'session-cards');

  // 新字段声明时覆盖旧来源
  const declared = resolveCapabilityAssembly({
    capabilityProfile: { ...profile, chapterCards: ['declared-chapter'], singleRunCard: 'declared-run' },
    chapterCapabilityState: { techniqueIds: ['t1'] },
    sessionCardIds: ['session-card'],
  });
  assert.deepEqual(declared.chapterCards, ['declared-chapter']);
  assert.equal(declared.singleRunCard, 'declared-run');

  // 无旧来源 → 空/缺省
  assert.deepEqual(resolveChapterCards({ capabilityProfile: profile }).ids, []);
  assert.equal(resolveSingleRunCard({ capabilityProfile: profile }).source, 'none');

  // 迁移不把章节态/请求期数据写进作品 profile（作用域不放大）
  const { profile: migrated } = migrateCapabilityAssembly(profile, {
    mountedSkillIds: ['legacy-a'],
  });
  assert.equal(migrated!.chapterCards, undefined);
  assert.equal(migrated!.singleRunCard, undefined);
});

test('卡组 ID 单一事实源：与旧 getProjectDeckIds 规则一致', () => {
  assert.deepEqual(getProjectDeckCardIds(null), []);
  assert.deepEqual(getProjectDeckCardIds(profileWithDeck({})), []);
  assert.deepEqual(
    getProjectDeckCardIds(profileWithDeck({ mainCardId: 'main', supportCardIds: ['a', 'a', ''] })),
    ['main', 'a']
  );
});

test('写路径归一化保留「声明即权威」语义，迁移经归一后仍幂等', () => {
  const baseProfile = {
    version: 3 as const,
    projectSkillDeck: { mainCardId: 'main', supportCardIds: ['s1'], updatedAt: 5 },
    favoriteTechniqueIds: [] as string[],
  };
  const normalized = normalizeProjectPreferenceProfile({
    capabilityModelVersion: 3,
    capabilityProfile: { ...baseProfile, projectCards: [] },
  }).capabilityProfile!;
  // 显式空数组经写路径归一化后仍是「已声明」，读取为 0 张（而不是回退卡组）
  assert.deepEqual(normalized.projectCards, []);
  assert.deepEqual(resolveProjectCards({ capabilityProfile: normalized }).ids, []);
  // 落库 JSON 往返后语义不变
  const roundTrip = normalizeProjectPreferenceProfile(
    JSON.parse(JSON.stringify({ capabilityModelVersion: 3, capabilityProfile: normalized }))
  ).capabilityProfile!;
  assert.deepEqual(roundTrip.projectCards, []);

  const legacyProfile = normalizeProjectPreferenceProfile({
    capabilityModelVersion: 3,
    capabilityProfile: { ...baseProfile, projectSkillDeck: { supportCardIds: [], updatedAt: 1 } },
  }).capabilityProfile!;
  const migrated = migrateCapabilityAssembly(legacyProfile, {
    mountedSkillIds: [' m1 ', 'm1', 'm2'],
  });
  assert.equal(migrated.changed, true);
  assert.deepEqual(migrated.profile!.projectCards, ['m1', 'm2']);
  assert.equal(migrateCapabilityAssembly(migrated.profile, { mountedSkillIds: ['m1'] }).changed, false);
});

test('deprecated 标记在类型层可见（mountedSkillLoadout 两处声明）', () => {
  const novelTypes = readFileSync(resolve(process.cwd(), 'shared/types/novel.ts'), 'utf8');
  const skillModel = readFileSync(resolve(process.cwd(), 'shared/lib/skill-model.ts'), 'utf8');
  assert.match(novelTypes, /@deprecated[\s\S]{0,240}?mountedSkillLoadout\?:/);
  assert.match(skillModel, /@deprecated[\s\S]{0,240}?mountedSkillLoadout\?:/);
});
