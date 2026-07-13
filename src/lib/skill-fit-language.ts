import type { Chapter, Novel, SkillDimension } from '../../shared/types';
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

  if (checkPowerSignal(currentChapter?.content)) {
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

/**
 * 战力/玄幻设定维度自适应检测函数。过滤掉日常用语中的“灵魂”、“处境”等干扰词，
 * 采用特定的修仙/奇幻高频词频过滤以及特定字频共现检测。
 */
export function checkPowerSignal(content: string | undefined | null): boolean {
  if (!content) return false;

  const powerKeywords = [
    '灵力', '灵压', '境界', '功法', '等阶', '修为', '神魂', '金丹', '元婴', '觉醒', '战力', 
    '属性', '魔法', '内功', '魔力', '武功', '法则', '神格', '奥术', '修真', '筑基', '化神',
    '圣阶', '神阶', '斗气', '精神力'
  ];

  for (const keyword of powerKeywords) {
    if (content.includes(keyword)) {
      return true;
    }
  }

  // 过滤掉非战斗设定的日常关联假阳性词组
  const cleaned = content
    .replace(/处境/g, '')
    .replace(/环境/g, '')
    .replace(/窘境/g, '')
    .replace(/困境/g, '')
    .replace(/边境/g, '')
    .replace(/国境/g, '')
    .replace(/意境/g, '')
    .replace(/心境/g, '')
    .replace(/情境/g, '')
    .replace(/灵魂/g, '')
    .replace(/灵感/g, '')
    .replace(/灵巧/g, '')
    .replace(/灵敏/g, '')
    .replace(/灵性/g, '');

  const countsOfLing = (cleaned.match(/灵/g) || []).length;
  const countsOfJing = (cleaned.match(/境/g) || []).length;

  if (countsOfLing >= 2 || countsOfJing >= 2 || (countsOfLing >= 1 && countsOfJing >= 1)) {
    return true;
  }

  return false;
}

