import { describe, expect, test } from 'vitest';

import type { Novel, ProjectCapabilityProfile, ProjectPreferenceProfile } from '../../shared/types';
import { getProjectCapabilityCardCount, getProjectCapabilityCardIds } from '../lib/capability-card-count';

type CardNovel = Pick<Novel, 'projectPreferenceProfile' | 'mountedSkillIds'>;

function preferenceProfile(capabilityProfile: ProjectCapabilityProfile): ProjectPreferenceProfile {
  return {
    tags: [],
    weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    capabilityModelVersion: 3,
    capabilityProfile,
  };
}

function capabilityProfile(
  deck: ProjectCapabilityProfile['projectSkillDeck'],
  extra: Partial<ProjectCapabilityProfile> = {}
): ProjectCapabilityProfile {
  return { version: 3, projectSkillDeck: deck, favoriteTechniqueIds: [], ...extra };
}

function novelWith(
  capability: ProjectCapabilityProfile | undefined,
  mountedSkillIds?: string[]
): CardNovel {
  return {
    ...(capability ? { projectPreferenceProfile: preferenceProfile(capability) } : {}),
    ...(mountedSkillIds ? { mountedSkillIds } : {}),
  };
}

// 装配字段收敛（批次 A）：读取路径单测——新字段 projectCards 声明即权威，
// 缺省时严格复刻旧优先级（卡组 → 挂载槽按 slot 升序 → mountedSkillIds）。

describe('getProjectCapabilityCardIds 装配读取优先级', () => {
  test('卡组非空时优先返回卡组（主卡 + 辅卡，去重）', () => {
    const novel = novelWith(
      capabilityProfile({
        mainCardId: 'main',
        supportCardIds: ['support', 'main', ''],
        updatedAt: 1,
      }),
      ['legacy-a']
    );
    expect(getProjectCapabilityCardIds(novel, [{ slot: 0, skillId: 'loadout-a' }])).toEqual([
      'main',
      'support',
    ]);
    expect(getProjectCapabilityCardCount(novel, [{ slot: 0, skillId: 'loadout-a' }])).toBe(2);
  });

  test('卡组为空时按 slot 升序取挂载槽（空 skillId 跳过），忽略 mountedSkillIds', () => {
    const novel = novelWith(
      capabilityProfile({ supportCardIds: [], updatedAt: 0 }),
      ['legacy-a']
    );
    expect(
      getProjectCapabilityCardIds(novel, [
        { slot: 2, skillId: 'b' },
        { slot: 0, skillId: 'a' },
        { slot: 1, skillId: '' },
      ])
    ).toEqual(['a', 'b']);
  });

  test('无卡组无挂载槽时逐项回退 mountedSkillIds（保持旧行为，不去重）', () => {
    const novel = novelWith(capabilityProfile({ supportCardIds: [], updatedAt: 0 }), [
      'legacy-a',
      'legacy-a',
    ]);
    expect(getProjectCapabilityCardIds(novel)).toEqual(['legacy-a', 'legacy-a']);
  });

  test('新字段 projectCards 声明即权威（含显式空数组）', () => {
    const withCards = novelWith(
      capabilityProfile(
        { mainCardId: 'main', supportCardIds: ['support'], updatedAt: 1 },
        { projectCards: ['declared-card', 'declared-card'] }
      ),
      ['legacy-a']
    );
    expect(getProjectCapabilityCardIds(withCards, [{ slot: 0, skillId: 'loadout-a' }])).toEqual([
      'declared-card',
    ]);

    const explicitlyEmpty = novelWith(
      capabilityProfile(
        { mainCardId: 'main', supportCardIds: ['support'], updatedAt: 1 },
        { projectCards: [] }
      ),
      ['legacy-a']
    );
    expect(getProjectCapabilityCardCount(explicitlyEmpty)).toBe(0);
  });

  test('无 v3 capabilityProfile 时不进入新路径，仍回退旧字段', () => {
    const legacyOnly = novelWith(undefined, ['legacy-a']);
    expect(getProjectCapabilityCardIds(legacyOnly)).toEqual(['legacy-a']);
    expect(getProjectCapabilityCardIds(legacyOnly, [{ slot: 0, skillId: 'loadout-a' }])).toEqual([
      'loadout-a',
    ]);
  });
});
