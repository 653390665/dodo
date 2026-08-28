import type { MountedSkillLoadoutItem, Novel } from '../../shared/types';
import { getProjectCapabilityProfile, getProjectDeckIds } from './skills-studio-governance';

type CapabilityLoadoutSlot = Pick<MountedSkillLoadoutItem, 'slot' | 'skillId'>;

export function getProjectCapabilityCardCount(
  novel: Pick<Novel, 'projectPreferenceProfile' | 'mountedSkillIds'>,
  mountedSkillLoadout?: CapabilityLoadoutSlot[],
): number {
  return getProjectCapabilityCardIds(novel, mountedSkillLoadout).length;
}

export function getProjectCapabilityCardIds(
  novel: Pick<Novel, 'projectPreferenceProfile' | 'mountedSkillIds'>,
  mountedSkillLoadout?: CapabilityLoadoutSlot[],
): string[] {
  const projectDeckIds = getProjectDeckIds(getProjectCapabilityProfile(novel));
  if (projectDeckIds.length > 0) return projectDeckIds;
  if (mountedSkillLoadout) {
    return mountedSkillLoadout
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((slot) => slot.skillId)
      .filter((skillId): skillId is string => Boolean(skillId));
  }
  return novel.mountedSkillIds || [];
}
