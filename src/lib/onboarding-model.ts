import type {
  ProjectPreferenceProfile,
  SetupTaskDraft,
  Skill,
  StoryIdeaCard,
  StoryPlanningInput,
  StorySkillRecommendation,
} from '../types';

const TASK_META: Array<{
  key: SetupTaskDraft['key'];
  title: string;
  pick: (card: StoryIdeaCard) => string;
}> = [
  { key: 'protagonist', title: '主角是谁', pick: (card) => card.protagonist },
  { key: 'core-conflict', title: '核心冲突', pick: (card) => card.coreConflict },
  { key: 'world-rules', title: '世界规则 / 故事背景', pick: (card) => card.starterSeeds.worldSeed },
  { key: 'relationship', title: '关键关系', pick: (card) => card.starterSeeds.relationshipSeed },
  { key: 'chapter-one', title: '第一章起点', pick: (card) => card.starterSeeds.chapterOneSeed },
  { key: 'tone', title: '风格与读感', pick: (card) => card.tone },
];

function formatWordCount(expectedWordCount: number) {
  if (expectedWordCount >= 10000) {
    const value = Number((expectedWordCount / 10000).toFixed(expectedWordCount % 10000 === 0 ? 0 : 1));
    return `${value}万字`;
  }
  return `${expectedWordCount}字`;
}

function formatPlanningSummary(planning: StoryPlanningInput): string {
  const focusLabel =
    planning.storyFocus === 'plot'
      ? '剧情推进优先'
      : planning.storyFocus === 'character'
        ? '人物关系优先'
        : '世界设定优先';
  const pacingLabel =
    planning.pacingPreference === 'tight'
      ? '紧推进'
      : planning.pacingPreference === 'slow-burn'
        ? '慢热铺陈'
        : '均衡推进';

  return `预计总字数 ${formatWordCount(planning.expectedWordCount)}，以${focusLabel}为主，整体采用${pacingLabel}。`;
}

export function buildProjectPreferenceProfileFromPlanning(planning: StoryPlanningInput): ProjectPreferenceProfile {
  const focusWeights =
    planning.storyFocus === 'plot'
      ? { plotWeight: 0.8, characterWeight: 0.55, worldWeight: 0.35 }
      : planning.storyFocus === 'character'
        ? { plotWeight: 0.55, characterWeight: 0.8, worldWeight: 0.35 }
        : { plotWeight: 0.35, characterWeight: 0.5, worldWeight: 0.8 };
  const pacingWeight =
    planning.pacingPreference === 'tight'
      ? 0.8
      : planning.pacingPreference === 'slow-burn'
        ? 0.35
        : 0.55;

  const tags = [
    planning.expectedWordCount >= 400000 ? '长篇推进' : planning.expectedWordCount >= 120000 ? '中长篇推进' : '短中篇推进',
    planning.storyFocus === 'plot'
      ? '剧情推进优先'
      : planning.storyFocus === 'character'
        ? '人物关系优先'
        : '世界设定优先',
    planning.pacingPreference === 'tight'
      ? '紧推进'
      : planning.pacingPreference === 'slow-burn'
        ? '慢热铺陈'
        : '均衡推进',
  ];

  return {
    tags,
    weights: {
      styleWeight: 0.5,
      characterWeight: focusWeights.characterWeight,
      worldWeight: focusWeights.worldWeight,
      plotWeight: focusWeights.plotWeight,
      pacingWeight,
    },
    acceptedDimensions:
      planning.storyFocus === 'plot'
        ? ['plot', 'pacing']
        : planning.storyFocus === 'character'
          ? ['character']
          : ['world'],
    rejectedDimensions: [],
    notes: [`预计总字数：${formatWordCount(planning.expectedWordCount)}`],
    evidenceCount: 1,
  };
}

export function buildSetupTasksFromStoryCard(card: StoryIdeaCard, planning?: StoryPlanningInput): SetupTaskDraft[] {
  const tasks: SetupTaskDraft[] = TASK_META.map((meta) => ({
    key: meta.key,
    title: meta.title,
    summary: meta.pick(card),
    status: meta.pick(card).trim() ? 'drafted' : 'empty',
    source: 'story-card',
  }));

  if (planning) {
    tasks.push({
      key: 'story-scale',
      title: '篇幅与推进规划',
      summary: formatPlanningSummary(planning),
      status: 'drafted',
      source: 'user-edit',
    });
  }

  return tasks;
}

export function countCompletedSetupTasks(tasks: SetupTaskDraft[]): number {
  return tasks.filter((task) => task.status === 'confirmed').length;
}

function paceWeight(preference: StoryIdeaCard['signals']['pacingPreference']) {
  if (preference === 'tight') return 0.85;
  if (preference === 'slow-burn') return 0.3;
  return 0.55;
}

export function recommendSkillsForStoryCard(
  card: StoryIdeaCard,
  skills: Skill[],
): StorySkillRecommendation[] {
  return skills
    .map((skill) => {
      const profile = skill.compositionProfile;
      if (!profile) {
        return {
          skillId: skill.id,
          skillName: skill.name,
          score: 0,
          reason: `${skill.name} 缺少职责画像，无法稳定匹配当前故事方案。`,
        };
      }

      const score =
        profile.styleWeight * 100 +
        profile.plotWeight * 45 +
        profile.worldWeight * card.signals.worldWeight * 100 +
        profile.characterWeight * card.signals.characterWeight * 100 +
        profile.pacingWeight * paceWeight(card.signals.pacingPreference) * 100;

      const reasonBits: string[] = [];
      if ((skill.dimensionTags || []).includes('style')) reasonBits.push('能贴合当前故事气质');
      if ((skill.dimensionTags || []).includes('world') && card.signals.worldWeight >= 0.6) {
        reasonBits.push('能补强世界规则表达');
      }
      if ((skill.dimensionTags || []).includes('character') && card.signals.characterWeight >= 0.6) {
        reasonBits.push('能强化人物对峙感');
      }
      if ((skill.dimensionTags || []).includes('plot')) reasonBits.push('能承接当前冲突推进');
      if ((skill.dimensionTags || []).includes('pacing') && card.signals.pacingPreference === 'tight') {
        reasonBits.push('适合紧张推进节奏');
      }

      return {
        skillId: skill.id,
        skillName: skill.name,
        score,
        reason: reasonBits[0] || '与当前方案职责画像较为接近。',
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export function normalizeStoryCardsResponse(raw: string): StoryIdeaCard[] {
  const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : Array.isArray(parsed) ? parsed : [];
  return cards;
}
