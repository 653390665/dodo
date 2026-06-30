import { generateText } from '../lib/server-llm';
import { getConfig } from '../lib/config';
import { resolvePromptAssetForSurface } from '../../src/lib/prompt-runtime';
import { renderPromptTemplate, buildSkillsPrompt } from './prompt-helpers';
import {
  buildFallbackDraft,
  buildFallbackSceneBeats,
  ensureMinimumDraftLength,
} from './fallback-draft';
import type { Skill } from '../../shared/types';
import type { LearnedPreference } from '../../src/lib/preference-flywheel';
import { PLANNER_SOUL, WRITER_SOUL, CRITIC_SOUL } from '../../shared/config/souls';

/** Maximum retries when critic rejects the draft */
const MAX_RETRIES = 2;
/** Score threshold (0-100) below which the critic triggers a retry */
const SCORE_THRESHOLD = 80;

export interface PipelineProgress {
  onPhase?: (phase: 'planner' | 'writer' | 'critic' | 'retry') => void;
  onWriterToken?: (chunk: string) => void;
  onWriterDone?: () => void;
  onCriticDone?: (feedback: string, isValid: boolean) => void;
  signal?: AbortSignal;
}

export interface PipelineResult {
  sceneBeats: string;
  draft: string;
  audit: string;
  score: number;
  attempts: number;
}

const WRITER_LLM_OPTIONS = {
  timeoutMs: 90_000,
  maxAttempts: 1,
  maxTokens: 8192,
} as const;

const CRITIC_LLM_OPTIONS = {
  timeoutMs: 35_000,
  maxAttempts: 1,
  maxTokens: 1200,
} as const;

/**
 * Run Planner → Writer → Critic pipeline.
 * Planner generates scene beats from user intent.
 * Writer generates draft from beats + context.
 * Critic scores the draft; if below SCORE_THRESHOLD, loops back to Writer (max MAX_RETRIES).
 * If Planner or Writer fails, falls back to deterministic helpers.
 */
export async function runProductionPipeline(params: {
  userIntent: string;
  contextStr: string;
  skills?: Skill[];
  learnedPreferences?: LearnedPreference[];
  progress?: PipelineProgress;
}): Promise<PipelineResult> {
  const { userIntent, contextStr, skills = [], learnedPreferences = [], progress = {} } = params;

  // Build learned preference context
  const learnedContext = learnedPreferences.length > 0
    ? '\n\n【学习到的偏好 — 基于你之前的修改习惯】\n' +
      learnedPreferences.map((lp) => `- ${lp.pattern}（可信度：${Math.round(lp.confidence * 100)}%）`).join('\n')
    : '';

  const augmentedContext = contextStr + learnedContext;

  // ================================================================
  // Phase 1: Planner — generate scene beats from user intent
  // ================================================================
  progress.onPhase?.('planner');

  const plannerAsset = resolvePromptAssetForSurface({
    surface: 'workspace-beats',
    promptTemplates: getConfig().promptTemplates,
    preferredTemplateKey: 'editorAgent',
  });

  const plannerPrompt = renderPromptTemplate(plannerAsset.template, {
    PLANNER_SOUL,
    contextStr: augmentedContext,
    userIntent,
  });

  let sceneBeats: string;
  try {
    sceneBeats = await generateText(getConfig(), {
      prompt: plannerPrompt,
      timeoutMs: 8_000,
      maxAttempts: 1,
      maxTokens: 1600,
      signal: progress.signal,
    });
  } catch (err) {
    console.warn('Planner fell back to deterministic beats:', err);
    sceneBeats = buildFallbackSceneBeats(userIntent);
  }

  // ================================================================
  // Phase 2–3: Writer → Critic loop
  // ================================================================
  progress.onPhase?.('writer');

  const skillsInfo = buildSkillsPrompt(skills);
  let currentDraft = '';
  let criticFeedback = '';
  let auditScore = 0;
  let attempts = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    attempts = attempt + 1;

    // --- Writer ---
    const writerAsset = resolvePromptAssetForSurface({
      surface: 'workspace-draft',
      promptTemplates: getConfig().promptTemplates,
      preferredTemplateKey: 'orchestrateWriter',
    });

    const writerPrompt = renderPromptTemplate(writerAsset.template, {
      WRITER_SOUL,
      contextStr: augmentedContext,
      skillsInfo,
      sceneBeats,
      criticFeedback: criticFeedback || '初稿阶段，请全力输出。',
    });

    try {
      currentDraft = await generateText(getConfig(), {
        prompt: writerPrompt,
        ...WRITER_LLM_OPTIONS,
        signal: progress.signal,
        onToken: (token) => {
          progress.onWriterToken?.(token);
        },
      });
      currentDraft = ensureMinimumDraftLength(currentDraft, sceneBeats, contextStr);
    } catch (err) {
      console.warn('Writer fell back to deterministic draft:', err);
      currentDraft = buildFallbackDraft(sceneBeats, contextStr);
      // Emit tokens for fallback draft
      const chunks = currentDraft.match(/.{1,24}/gs) || [];
      for (const chunk of chunks) {
        progress.onWriterToken?.(chunk);
      }
    }

    progress.onWriterDone?.();

    // --- Critic ---
    progress.onPhase?.('critic');

    const criticAsset = resolvePromptAssetForSurface({
      surface: 'chapter-review',
      promptTemplates: getConfig().promptTemplates,
      preferredTemplateKey: 'orchestrateCritic',
    });

    const criticPrompt = renderPromptTemplate(criticAsset.template, {
      CRITIC_SOUL,
      augmentedContext,
      skillsInfo,
      sceneBeats,
      currentDraft,
    });

    try {
      criticFeedback = await generateText(getConfig(), {
        prompt: criticPrompt,
        ...CRITIC_LLM_OPTIONS,
        signal: progress.signal,
      });
    } catch (err) {
      console.warn('Critic fell back — accepting draft:', err);
      criticFeedback = 'PASS (critic unavailable — accepting draft)';
    }

    // Score extraction: try "PASS" keyword first, then attempt numeric extraction
    const isPass = criticFeedback.includes('PASS');
    const scoreMatch = criticFeedback.match(/(?:score|评分)[\s:]*[-]?\s*(\d+)(?:\/100)?/i);
    auditScore = isPass ? 85 : (scoreMatch ? parseInt(scoreMatch[1], 10) : 60);

    const isValid = isPass || auditScore >= SCORE_THRESHOLD;
    progress.onCriticDone?.(criticFeedback, isValid);

    if (isValid) break;

    // Retry: feed critic feedback to next Writer iteration
    if (attempt < MAX_RETRIES) {
      progress.onPhase?.('retry');
    }
  }

  return {
    sceneBeats,
    draft: currentDraft,
    audit: criticFeedback,
    score: auditScore,
    attempts,
  };
}
