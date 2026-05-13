import type { Chapter, Novel, SkillDimension } from '../types';
import { getSkillRoleLabel } from './skill-language';

export interface SkillFitNeeds {
  requiredDimensions: SkillDimension[];
  chapterSignals: SkillDimension[];
  requiredRoleLabels: string[];
  chapterRoleLabels: string[];
}

export function deriveSkillFitNeeds(novel: Novel, currentChapter: Chapter | null): SkillFitNeeds {
  const requiredDimensions = new Set<SkillDimension>(['style', 'plot', 'pacing']);
  const chapterSignals = new Set<SkillDimension>(['plot']);

  if (novel.worldRules || novel.globalOutline) {
    requiredDimensions.add('world');
  }

  if (currentChapter?.sceneBeats) {
    requiredDimensions.add('plot');
    chapterSignals.add('pacing');
  }

  if (currentChapter?.content && currentChapter.content.length > 80) {
    requiredDimensions.add('character');
  }

  if (novel.worldRules) {
    chapterSignals.add('world');
  }

  if (currentChapter?.content?.includes('境') || currentChapter?.content?.includes('灵')) {
    chapterSignals.add('power');
  }

  const requiredList = Array.from(requiredDimensions);
  const signalList = Array.from(chapterSignals);

  return {
    requiredDimensions: requiredList,
    chapterSignals: signalList,
    requiredRoleLabels: requiredList.map((dimension) => getSkillRoleLabel(dimension)),
    chapterRoleLabels: signalList.map((dimension) => getSkillRoleLabel(dimension)),
  };
}
