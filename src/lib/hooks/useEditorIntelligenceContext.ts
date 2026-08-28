import { useCallback, useMemo } from 'react';
import { CURATED_PRODUCT_SKILLS, PROMPT_GOVERNANCE_CATALOG } from '../../../shared/lib/public-skill-catalog';

import type {
  AgentTab,
  Chapter,
  ChapterMetadata,
  Character,
  ContinuationPack,
  CopilotSuggestion,
  Faction,
  Foreshadowing,
  Item,
  Location,
  Novel,
  PowerLevel,
  Skill,
  SniffedEntities,
  TimelineEvent,
} from '../../../shared/types';
import type { AgentContext, SceneType } from '../agents';
import { buildCopilotSuggestion } from '../copilot-stage';
import { getPreferredContinuationPack } from '../continuation-pack-selection';
import { getProjectCapabilityCardIds } from '../capability-card-count';
import { calculateSkillFitScore } from '../skill-model';
import { deriveSkillFitNeeds } from '../skill-fit-language';

interface UseEditorIntelligenceContextArgs {
  novel: Novel;
  chapters: ChapterMetadata[];
  currentChapter: Chapter | null;
  characters: Character[];
  locations: Location[];
  items: Item[];
  factions: Faction[];
  powerLevels: PowerLevel[];
  timelineEvents: TimelineEvent[];
  foreshadowings?: Foreshadowing[];
  librarySkills: Skill[];
  mountedSkillLoadout: Array<{ slot: number; skillId: string }>;
  continuationPacks: ContinuationPack[];
  selectedContinuationPackId: string;
  sniffedEntities: SniffedEntities | null;
  userIntent: string;
  agentTab: AgentTab;
  stackedDeconstructionCardIds?: string[];
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
  foreshadowings = [],
  librarySkills,
  mountedSkillLoadout,
  continuationPacks,
  selectedContinuationPackId,
  sniffedEntities,
  userIntent,
  agentTab,
  stackedDeconstructionCardIds,
}: UseEditorIntelligenceContextArgs) {
  const projectCapabilityCardIds = useMemo(
    () => getProjectCapabilityCardIds(novel, mountedSkillLoadout),
    [mountedSkillLoadout, novel],
  );

  const mountedSkills = useMemo(() => {
    const base: Skill[] = [];
    const addSkillById = (skillId: string) => {
      if (base.some((skill) => skill.id === skillId)) return;
      const skill = librarySkills.find((entry) => entry.id === skillId || entry.parentSkillId === skillId);
      if (skill) {
        base.push(skill);
        return;
      }
      const curatedSkill = CURATED_PRODUCT_SKILLS.find((entry) => entry.id === skillId);
      if (curatedSkill) {
        base.push({
          id: curatedSkill.id,
          name: curatedSkill.title,
          description: curatedSkill.goal,
          style: curatedSkill.goal,
          pacing: curatedSkill.successSignal || '',
          stabilityScore: curatedSkill.score || 80,
          evaluationFeedback: '',
          version: 1,
          createdAt: 0,
          parentSkillId: curatedSkill.parentSkillId,
          primaryDimension: 'style',
          sourceType: curatedSkill.sourceType,
        });
        return;
      }
      const asset = PROMPT_GOVERNANCE_CATALOG.find((entry) => entry.id === skillId);
      if (!asset) return;
      base.push({
        id: asset.id,
        name: asset.title,
        description: asset.goal,
        style: asset.template,
        pacing: asset.successSignal || '',
        stabilityScore: asset.score || 80,
        evaluationFeedback: asset.recommendationReason || '',
        version: 1,
        createdAt: 0,
        primaryDimension: 'style',
        deconstructionCardType: asset.deconstructionCardType,
      });
    };

    projectCapabilityCardIds.forEach(addSkillById);

    // 推荐卡 V2：叠加虚拟化的拆书卡/推荐卡
    if (stackedDeconstructionCardIds && stackedDeconstructionCardIds.length > 0) {
      stackedDeconstructionCardIds.forEach(addSkillById);
    }

    return base;
  }, [librarySkills, projectCapabilityCardIds, stackedDeconstructionCardIds]);

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
      .map((chapter) => `【${chapter.title}】:\n<分镜纲要>${(chapter as Partial<Chapter>).sceneBeats || '无'}</分镜纲要>\n`)
      .join('\n');
  }, [chapters, currentChapter]);

  const agentContext = useMemo<AgentContext>(
    () => ({
      novel,
      chapterId: currentChapter?.id,
      characters,
      locations,
      items,
      timelineEvents,
      foreshadowings,
      factions,
      powerLevels,
      previousChaptersSummary,
      activeEntityNames: sniffedEntities?.activeExisting,
      mountedSkills,
      sceneType,
      chapterOrder: currentChapter ? currentChapter.order : 1,
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
      foreshadowings,
      currentChapter,
    ],
  );

  const getCurrentFitScore = useCallback(
    (skillsOverride = mountedSkills) => {
      const needs = deriveSkillFitNeeds(novel, currentChapter);
      return calculateSkillFitScore({
        requiredDimensions: needs.requiredDimensions,
        chapterSignals: needs.chapterSignals,
        loadout: skillsOverride,
      }).totalScore;
    },
    [novel, currentChapter, mountedSkills],
  );

  const copilotSuggestion = useMemo<CopilotSuggestion>(
    () => {
      const selectedContinuationPack = getPreferredContinuationPack(
        continuationPacks,
        selectedContinuationPackId,
      );
      const hasContinuationPackContext = Boolean(
        selectedContinuationPack?.status === 'approved' &&
        (
          selectedContinuationPack.continuationTask?.trim() ||
          selectedContinuationPack.canonFacts.length > 0 ||
          selectedContinuationPack.characterStates.length > 0 ||
          selectedContinuationPack.sourceMap?.sections?.length ||
          selectedContinuationPack.plotState?.latestScene?.trim()
        ),
      );

      return buildCopilotSuggestion({
        hasCurrentChapter: Boolean(currentChapter),
        hasSummary: Boolean(novel.summary?.trim()),
        hasGlobalOutline: Boolean(novel.globalOutline?.trim()),
        hasWorldRules: Boolean(novel.worldRules?.trim()),
        hasContinuationPackContext,
        hasSceneBeats: Boolean(currentChapter?.sceneBeats?.trim()),
        hasChapterContent: Boolean(currentChapter?.content?.trim()),
        hasCritique: Boolean(currentChapter?.critique?.trim()),
        hasSniffedNewEntities: Boolean(sniffedEntities?.newEntities?.length),
        mountedSkillCount: projectCapabilityCardIds.length,
        fitScore: getCurrentFitScore(),
        lastFocusArea: agentTab === 'copilot-home' ? 'editor' : agentTab,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      agentTab,
      continuationPacks,
      currentChapter,
      novel.globalOutline,
      novel.summary,
      novel.worldRules,
      projectCapabilityCardIds.length,
      selectedContinuationPackId,
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
