import { useMemo } from 'react';

import type {
  AgentTab,
  Chapter,
  Character,
  CopilotSuggestion,
  Faction,
  Item,
  Location,
  Novel,
  PowerLevel,
  Skill,
  SniffedEntities,
  TimelineEvent,
} from '../../types';
import type { AgentContext, SceneType } from '../agents';
import { buildCopilotSuggestion } from '../copilot-stage';
import { calculateSkillFitScore } from '../skill-model';
import { deriveSkillFitNeeds } from '../skill-fit-language';

interface UseEditorIntelligenceContextArgs {
  novel: Novel;
  chapters: Chapter[];
  currentChapter: Chapter | null;
  characters: Character[];
  locations: Location[];
  items: Item[];
  factions: Faction[];
  powerLevels: PowerLevel[];
  timelineEvents: TimelineEvent[];
  librarySkills: Skill[];
  mountedSkillLoadout: Array<{ slot: number; skillId: string }>;
  sniffedEntities: SniffedEntities | null;
  userIntent: string;
  agentTab: AgentTab;
}

export function useEditorIntelligenceContext({
  novel,
  chapters,
  currentChapter,
  characters,
  locations,
  items,
  factions,
  powerLevels,
  timelineEvents,
  librarySkills,
  mountedSkillLoadout,
  sniffedEntities,
  userIntent,
  agentTab,
}: UseEditorIntelligenceContextArgs) {
  const mountedSkillIds = useMemo(
    () => mountedSkillLoadout.slice().sort((a, b) => a.slot - b.slot).map((entry) => entry.skillId),
    [mountedSkillLoadout],
  );

  const mountedSkills = useMemo(
    () =>
      mountedSkillIds
        .map((skillId) => librarySkills.find((skill) => skill.id === skillId))
        .filter((skill): skill is Skill => Boolean(skill)),
    [librarySkills, mountedSkillIds],
  );

  const sceneType = useMemo<SceneType | undefined>(() => {
    const signals = (userIntent || '') + (currentChapter?.content?.slice(-500) || '');
    const dialogueScore = (signals.match(/对话|对白|说|问|答|谈|聊|争吵|质问|试探|回答/g) || []).length;
    const actionScore = (signals.match(/打|战|杀|追|逃|冲|砍|刺|闪|躲|搏|斗|出手/g) || []).length;
    const politicsScore = (signals.match(/势力|门派|权力|计谋|算计|联合|背叛|交易|谈判|布局/g) || []).length;
    const emotionalScore = (signals.match(/情感|心痛|回忆|思念|悲伤|眼泪|孤独|拥抱|温暖|感动|沉默/g) || []).length;

    const scores: { type: SceneType; score: number }[] = [
      { type: 'dialogue', score: dialogueScore },
      { type: 'action', score: actionScore },
      { type: 'politics', score: politicsScore },
      { type: 'emotional', score: emotionalScore },
    ];
    const best = scores.reduce((a, b) => (a.score > b.score ? a : b));
    return best.score >= 3 ? best.type : undefined;
  }, [currentChapter?.content, userIntent]);

  const previousChaptersSummary = useMemo(() => {
    if (!currentChapter) return '';

    const previousChapters = chapters
      .filter((chapter) => chapter.order < currentChapter.order)
      .sort((a, b) => b.order - a.order)
      .slice(0, 3)
      .reverse();

    if (previousChapters.length === 0) {
      return '这是本作最初阶段，暂无前情提要。';
    }

    return previousChapters
      .map((chapter) => `【${chapter.title}】:\n<分镜纲要>${chapter.sceneBeats || '无'}</分镜纲要>\n`)
      .join('\n');
  }, [chapters, currentChapter]);

  const agentContext = useMemo<AgentContext>(
    () => ({
      novel,
      characters,
      locations,
      items,
      timelineEvents,
      factions,
      powerLevels,
      previousChaptersSummary,
      activeEntityNames: sniffedEntities?.activeExisting,
      mountedSkills,
      sceneType,
    }),
    [
      characters,
      factions,
      items,
      locations,
      mountedSkills,
      novel,
      powerLevels,
      previousChaptersSummary,
      sceneType,
      sniffedEntities?.activeExisting,
      timelineEvents,
    ],
  );

  const getCurrentFitScore = (skillsOverride = mountedSkills) => {
    const needs = deriveSkillFitNeeds(novel, currentChapter);
    return calculateSkillFitScore({
      requiredDimensions: needs.requiredDimensions,
      chapterSignals: needs.chapterSignals,
      loadout: skillsOverride,
    }).totalScore;
  };

  const copilotSuggestion = useMemo<CopilotSuggestion>(
    () =>
      buildCopilotSuggestion({
        hasCurrentChapter: Boolean(currentChapter),
        hasSummary: Boolean(novel.summary?.trim()),
        hasGlobalOutline: Boolean(novel.globalOutline?.trim()),
        hasWorldRules: Boolean(novel.worldRules?.trim()),
        hasSceneBeats: Boolean(currentChapter?.sceneBeats?.trim()),
        hasChapterContent: Boolean(currentChapter?.content?.trim()),
        hasCritique: Boolean(currentChapter?.critique?.trim()),
        hasSniffedNewEntities: Boolean(sniffedEntities?.newEntities?.length),
        mountedSkillCount: mountedSkillLoadout.length,
        fitScore: getCurrentFitScore(),
        lastFocusArea: agentTab === 'copilot-home' ? 'editor' : agentTab,
      }),
    [
      agentTab,
      currentChapter,
      mountedSkillLoadout.length,
      novel.globalOutline,
      novel.summary,
      novel.worldRules,
      sniffedEntities?.newEntities?.length,
      mountedSkills,
    ],
  );

  return {
    mountedSkills,
    sceneType,
    agentContext,
    copilotSuggestion,
    getCurrentFitScore,
  };
}
