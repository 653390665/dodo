/**
 * Prompt chain system — modular 3-chain pipeline.
 * Inspired by Chinese-WebNovel-Skill's modular routing:
 * Pre-planning → Body execution → Final review.
 *
 * Each chain contains focused sub-modules that generate prompts
 * targeting one aspect at a time, producing higher-quality output
 * than monolithic prompts.
 */
import type { PromptTemplateKey } from './prompt-templates';

export const PROMPT_CHAINS = {
  /** Chain 1: Pre-planning — concept → opening → volume outline */
  prePlanning: ['chainConcept', 'chainOpening', 'chainVolumeOutline'] as const,

  /** Chain 2: Body execution — plot/character/transition/dialogue/ending/anti-AI */
  bodyExecution: [
    'chainPlotLogic',
    'chainCharacterConsistency',
    'chainTransition',
    'chainDialogue',
    'chainChapterEnding',
    'chainAntiAiVoice',
  ] as const,

  /** Chain 3: Final review — consistency check only */
  finalReview: ['chainConsistencyReview'] as const,
} as const;

export type PromptChain = keyof typeof PROMPT_CHAINS;
export type ChainModule = (typeof PROMPT_CHAINS)[PromptChain][number];

/** Chain metadata for UI display */
export const CHAIN_LABELS: Record<PromptChain, string> = {
  prePlanning: '写前规划',
  bodyExecution: '正文执行',
  finalReview: '写后审查',
};

export const MODULE_LABELS: Record<ChainModule, string> = {
  chainConcept: '概念规划',
  chainOpening: '开篇设计',
  chainVolumeOutline: '卷纲生成',
  chainPlotLogic: '情节逻辑',
  chainCharacterConsistency: '角色一致性',
  chainTransition: '章间过渡',
  chainDialogue: '对话质量',
  chainChapterEnding: '章尾钩子',
  chainAntiAiVoice: '去 AI 腔',
  chainConsistencyReview: '一致性审查',
};
