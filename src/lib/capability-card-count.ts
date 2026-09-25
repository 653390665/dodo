import type { MountedSkillLoadoutItem, Novel } from '../../shared/types';
import { resolveProjectCards } from '../../shared/lib/capability-assembly';
import { getProjectCapabilityProfile, getProjectDeckIds } from './skills-studio-governance';

type CapabilityLoadoutSlot = Pick<MountedSkillLoadoutItem, 'slot' | 'skillId'>;

export function getProjectCapabilityCardCount(
  novel: Pick<Novel, 'projectPreferenceProfile' | 'mountedSkillIds'>,
  mountedSkillLoadout?: CapabilityLoadoutSlot[]
): number {
  return getProjectCapabilityCardIds(novel, mountedSkillLoadout).length;
}

export function getProjectCapabilityCardIds(
  novel: Pick<Novel, 'projectPreferenceProfile' | 'mountedSkillIds'>,
  mountedSkillLoadout?: CapabilityLoadoutSlot[]
): string[] {
  // 装配字段收敛（批次 A）：capabilityProfile.projectCards 声明即权威（含显式空数组）；
  // 缺省时按旧优先级合并读取（卡组 → 挂载槽按 slot 升序 → mountedSkillIds，见 shared/lib/capability-assembly.ts）。
  // 下句字面量被 plan158-frontend-cleanup.test.ts 以源码文本钉住，勿改写形态。
  const projectDeckIds = getProjectDeckIds(getProjectCapabilityProfile(novel));
  return resolveProjectCards({
    capabilityProfile: getProjectCapabilityProfile(novel),
    projectDeckIds,
    mountedSkillLoadout,
    mountedSkillIds: novel.mountedSkillIds,
  }).ids;
}
