import type { MountedSkillLoadoutItem, Skill } from '../../../shared/types';
import { createSkillUsageRecord } from '../skill-client';

interface RecordSkillUsageOptions {
  fitScore?: number;
  auditScore?: number;
  notes?: string;
  skillIds?: string[];
  databaseGeneration?: number;
}

interface UseSkillLoadoutManagerArgs {
  novelId: string;
  currentChapterId?: string;
  mountedSkills: Skill[];
  mountedSkillLoadout: MountedSkillLoadoutItem[];
  librarySkills: Skill[];
  persistSkillLoadout: (nextLoadout: MountedSkillLoadoutItem[]) => Promise<void>;
  getCurrentFitScore: (skillsOverride?: Skill[]) => number;
}

export function useSkillLoadoutManager({
  novelId,
  currentChapterId,
  mountedSkills,
  mountedSkillLoadout,
  librarySkills,
  persistSkillLoadout,
  getCurrentFitScore,
}: UseSkillLoadoutManagerArgs) {
  const recordSkillUsage = async (
    userAction: 'accepted' | 'revised' | 'rejected',
    options?: RecordSkillUsageOptions,
  ) => {
    const skillIds = options?.skillIds || mountedSkills.map((skill) => skill.id);
    if (skillIds.length === 0) return;
    await createSkillUsageRecord({
      id: crypto.randomUUID(),
      novelId,
      chapterId: currentChapterId,
      mountedSkillIds: skillIds,
      fitScore: options?.fitScore ?? getCurrentFitScore(),
      auditScore: options?.auditScore,
      userAction,
      notes: options?.notes,
      createdAt: Date.now(),
    }, options?.databaseGeneration);
  };

  const assignSkillToSlot = async (slot: number, skillId: string) => {
    const previousSkills = mountedSkillLoadout
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => librarySkills.find((skill) => skill.id === entry.skillId))
      .filter((skill): skill is Skill => Boolean(skill));
    const previousIds = mountedSkillLoadout
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => entry.skillId);
    const existingElsewhere = mountedSkillLoadout.find((entry) => entry.skillId === skillId);
    const nextLoadout = mountedSkillLoadout
      .filter((entry) => entry.slot !== slot && entry.skillId !== skillId)
      .map((entry) =>
        existingElsewhere && entry.slot === existingElsewhere.slot
          ? { ...entry, slot }
          : entry,
      );

    nextLoadout.push({
      slot,
      skillId,
      weight: 1,
      lockedDimensions: [],
    });

    await persistSkillLoadout(nextLoadout.sort((a, b) => a.slot - b.slot));
    if (previousIds.length > 0 && previousIds.join(',') !== nextLoadout.map((entry) => entry.skillId).sort().join(',')) {
      await recordSkillUsage('rejected', {
        fitScore: getCurrentFitScore(previousSkills),
        notes: `slot-${slot}-replaced`,
        skillIds: previousIds,
      });
    }
  };

  const removeSkillFromSlot = async (slot: number) => {
    const previousSkills = mountedSkillLoadout
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => librarySkills.find((skill) => skill.id === entry.skillId))
      .filter((skill): skill is Skill => Boolean(skill));
    const previousIds = mountedSkillLoadout
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => entry.skillId);
    const nextLoadout = mountedSkillLoadout.filter((entry) => entry.slot !== slot);
    await persistSkillLoadout(nextLoadout);
    if (previousIds.length > 0) {
      await recordSkillUsage('rejected', {
        fitScore: getCurrentFitScore(previousSkills),
        notes: `slot-${slot}-removed`,
        skillIds: previousIds,
      });
    }
  };

  return {
    recordSkillUsage,
    assignSkillToSlot,
    removeSkillFromSlot,
  };
}
