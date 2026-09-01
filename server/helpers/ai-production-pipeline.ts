import { governedGenerateText as generateText } from './governed-llm';
import { getConfig, type AppConfig } from '../lib/config';
import { logger } from '../logger';
import { resolvePromptAssetForSurface } from '../../shared/lib/prompt-runtime';
import { AUDIT_OUTPUT_CONTRACT, renderPromptTemplate, wrapUserInput } from './prompt-helpers';
import { convertFiveDimToStructured, parseAuditResponseWithDiagnostics } from '../../shared/lib/audit-structured';
import {
  buildFallbackDraft,
  buildFallbackSceneBeats,
  ensureMinimumDraftLength,
} from './fallback-draft';
import type { LearnedPreference } from '../../shared/lib/preference-flywheel';
import { PLANNER_SOUL, WRITER_SOUL, CRITIC_SOUL } from '../../shared/config/souls';
import { resolveEffectiveMinDraftChars, validateCompleteChapterDraftQuality } from '../../shared/lib/draft-quality';

/** Maximum retries when critic rejects the draft */
const MAX_RETRIES = 2;
/** Score threshold (0-100) below which the critic triggers a retry */
const SCORE_THRESHOLD = 80;
export const UNKNOWN_CRITIC_FEEDBACK = '审稿结果不可验证，未完成结构化审阅，请重试。';

const REQUIRED_CRITIC_EVIDENCE = ['scene_execution', 'character_state', 'hard_canon', 'foreshadowing'] as const;

function hasCompleteCriticEvidence(audit: ReturnType<typeof convertFiveDimToStructured>): boolean {
  return REQUIRED_CRITIC_EVIDENCE.every((category) => audit.evidence?.some((item) => item.category === category));
}

export function classifyCriticFeedback(feedback: string, available = true): { status: 'pass' | 'fail' | 'unknown'; score?: number } {
  if (!available || typeof feedback !== 'string') return { status: 'unknown' };
  const parsed = parseAuditResponseWithDiagnostics(feedback);
  if (parsed.diagnostic) return { status: 'unknown' };

  if (parsed.fiveDim) {
    const score = Math.round((parsed.fiveDim.totalScore / 50) * 100);
    const structured = convertFiveDimToStructured(parsed.fiveDim);
    if (parsed.fiveDim.pass && score >= SCORE_THRESHOLD && !hasCompleteCriticEvidence(structured)) return { status: 'unknown' };
    return { status: parsed.fiveDim.pass && score >= SCORE_THRESHOLD ? 'pass' : 'fail', score };
  }

  if (!parsed.structured || !Number.isFinite(parsed.structured.score) || parsed.structured.score < 0 || parsed.structured.score > 100) {
    return { status: 'unknown' };
  }
  const score = Math.round(parsed.structured.score);
  const hasCriticalIssue = parsed.structured.fatalIssues.some((issue) => issue.severity === 'critical');
  if (score >= SCORE_THRESHOLD && !hasCriticalIssue && !hasCompleteCriticEvidence(parsed.structured)) return { status: 'unknown' };
  return { status: score >= SCORE_THRESHOLD && !hasCriticalIssue ? 'pass' : 'fail', score };
}

export interface PipelineProgress {
  onPhase?: (phase: 'planner' | 'writer' | 'critic' | 'retry') => void;
  onWriterToken?: (chunk: string) => void;
  onWriterDone?: () => void;
  onCriticDone?: (feedback: string, isValid: boolean, meta?: { status: 'pass' | 'fail' | 'unknown'; score?: number }) => void;
  signal?: AbortSignal;
}

export interface PipelineResult {
  sceneBeats: string;
  draft: string;
  audit: string;
  score?: number;
  auditStatus: 'pass' | 'fail' | 'unknown';
  /** Provider provenance. A deterministic fallback can never be a normal model apply. */
  source: 'model' | 'fallback';
  attempts: number;
}

const WRITER_LLM_OPTIONS = {
  timeoutMs: 90_000,
  maxAttempts: 1,
  maxTokens: 8192,
} as const;

// Per-scene budget for split-scene generation (scheme C): one scene is a few
// hundred characters, so a fraction of the whole-chapter budget suffices and
// slow upstreams can finish within the per-call window.
const WRITER_SCENE_MAX_TOKENS = 2400;
/** Minimum scene blocks for split generation; below this, single-shot the chapter. */
const MIN_SCENES_FOR_SPLIT = 2;

/**
 * Split structured scene beats into per-scene blocks ("### 场景 N" headings —
 * the format produced by both the planner and buildFallbackSceneBeats).
 * Returns an empty array when there are fewer than two scenes; callers then
 * keep the single-shot whole-chapter path.
 */
export function splitSceneBeats(beats: string): string[] {
  const blocks = String(beats || '')
    .split(/(?=###\s*场景)/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && /^###\s*场景/.test(block));
  return blocks.length >= MIN_SCENES_FOR_SPLIT ? blocks : [];
}

/**
 * Scheme C+A: the writing stage may use a stronger model than the global one.
 * Precedence: INKFLOW_WRITER_MODEL env > config.writerModel > config.model.
 */
function resolveWriterConfig(base: AppConfig): AppConfig {
  const writerModel = process.env.INKFLOW_WRITER_MODEL?.trim() || base.writerModel?.trim() || '';
  return writerModel && writerModel !== base.model ? { ...base, model: writerModel } : base;
}

const CRITIC_LLM_OPTIONS = {
  timeoutMs: 35_000,
  maxAttempts: 1,
  maxTokens: 1200,
} as const;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new Error('Production pipeline aborted');
  error.name = 'AbortError';
  throw error;
}

function buildValidatedFallbackDraft(sceneBeats: string, contextStr: string, minChars?: number): string {
  const fallbackDraft = buildFallbackDraft(sceneBeats, contextStr, minChars);
  const quality = validateCompleteChapterDraftQuality(fallbackDraft, undefined, { minChars });
  if (!quality.ok) {
    throw new Error(`DRAFT_QUALITY_GATE_FAILED:${quality.violations.join('；')}`);
  }
  return fallbackDraft;
}

/**
 * Run Planner → Writer → Critic pipeline.
 * Planner generates scene beats from user intent.
 * Writer generates draft from beats + context.
 * Critic scores the draft; if below SCORE_THRESHOLD, loops back to Writer (max MAX_RETRIES).
 * If Planner or Writer fails, falls back to deterministic helpers.
 */
export async function runProductionPipeline(params: {
  novelId: string;
  userIntent: string;
  contextStr: string;
  stageContexts?: { planner: string; writer: string; critic: string };
  stagePrompts: { planner: string; writer: string; critic: string };
  learnedPreferences?: LearnedPreference[];
  progress?: PipelineProgress;
}): Promise<PipelineResult> {
  const { novelId, userIntent, contextStr, stageContexts, stagePrompts, learnedPreferences = [], progress = {} } = params;
  const minDraftChars = resolveEffectiveMinDraftChars(userIntent);

  // Build learned preference context
  const learnedContext = learnedPreferences.length > 0
    ? '\n\n【学习到的偏好 — 基于你之前的修改习惯】\n' +
      learnedPreferences.map((lp) => `- ${lp.pattern}（可信度：${Math.round(lp.confidence * 100)}%）`).join('\n')
    : '';

  const augmentedContexts = {
    // Learned writing preferences belong to Writer/Critic. Planner should
    // receive only story facts and the current intent, otherwise style noise
    // can displace the chapter-level planning constraints.
    planner: stageContexts?.planner ?? contextStr,
    writer: (stageContexts?.writer ?? contextStr) + learnedContext,
    critic: (stageContexts?.critic ?? contextStr) + learnedContext,
  };

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
    contextStr: augmentedContexts.planner,
    skillsInfo: stagePrompts.planner,
    userIntent: wrapUserInput(userIntent),
  });

  let sceneBeats: string;
  try {
    sceneBeats = await generateText(getConfig(), {
      prompt: plannerPrompt,
      timeoutMs: 8_000,
      maxAttempts: 1,
      maxTokens: 1600,
      signal: progress.signal,
      novelId,
    }, {
      operation: 'production-pipeline-planner',
      novelId,
      timeoutMs: 8_000,
      concurrency: 2,
      signal: progress.signal,
    });
  } catch (err) {
    throwIfAborted(progress.signal);
    logger.warn('Planner fell back to deterministic beats', err);
    sceneBeats = buildFallbackSceneBeats(userIntent);
  }

  // ================================================================
  // Phase 2–3: Writer → Critic loop
  // ================================================================
  const writerSkillsInfo = stagePrompts.writer;
  const criticSkillsInfo = stagePrompts.critic;
  let currentDraft = '';
  let criticFeedback = '';
  let auditScore = 0;
  let auditStatus: PipelineResult['auditStatus'] = 'unknown';
  let draftSource: PipelineResult['source'] = 'model';
  let criticAvailable: boolean;
  let attempts = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    attempts = attempt + 1;
    criticAvailable = false;
    progress.onPhase?.('writer');

    // --- Writer ---
    const writerAsset = resolvePromptAssetForSurface({
      surface: 'workspace-draft',
      promptTemplates: getConfig().promptTemplates,
      preferredTemplateKey: 'orchestrateWriter',
    });

    const writerPrompt = renderPromptTemplate(writerAsset.template, {
      WRITER_SOUL,
      contextStr: augmentedContexts.writer,
      skillsInfo: writerSkillsInfo,
      sceneBeats,
      criticFeedback: criticFeedback || '初稿阶段，请全力输出。',
    });

    draftSource = 'model';
    try {
      let streamedWriterText = '';
      const writerConfig = resolveWriterConfig(getConfig());
      const sceneSections = splitSceneBeats(sceneBeats);

      if (sceneSections.length >= MIN_SCENES_FOR_SPLIT) {
        // Scheme C — split-scene generation: one model call per scene block,
        // each seeded with the tail of the previous scene for continuity.
        // A slow upstream only needs to finish a few hundred characters per
        // call instead of a whole 4000-char chapter in one window.
        const parts: string[] = [];
        let previousTail = '';
        for (let i = 0; i < sceneSections.length; i++) {
          throwIfAborted(progress.signal);
          const isFinalScene = i === sceneSections.length - 1;
          const sectionPrompt = renderPromptTemplate(writerAsset.template, {
            WRITER_SOUL,
            contextStr: augmentedContexts.writer
              + (previousTail ? `\n【上一场景结尾——保持人物、时间与节奏的衔接，不要复述】\n${previousTail}` : ''),
            skillsInfo: writerSkillsInfo,
            sceneBeats: sceneSections[i]
              + (isFinalScene ? '\n\n（本章最终场景：按分镜收束本章悬念，给出章节结尾。）' : '\n\n（写完本场景即停，不要越到下一场景。）'),
            criticFeedback: criticFeedback
              || (i === 0 ? '初稿阶段，请全力输出。' : '继续本章的下一场景，保持人物与节奏连贯。'),
          });
          const sectionText = await generateText(writerConfig, {
            prompt: sectionPrompt,
            ...WRITER_LLM_OPTIONS,
            maxTokens: WRITER_SCENE_MAX_TOKENS,
            // Reasoning chains would eat the per-scene token budget and leave
            // the prose truncated empty (finish_reason=length).
            disableThinking: true,
            signal: progress.signal,
            onToken: (token) => {
              streamedWriterText += token;
            },
            novelId,
          }, {
            operation: 'production-pipeline-writer',
            novelId,
            timeoutMs: WRITER_LLM_OPTIONS.timeoutMs,
            concurrency: 2,
            signal: progress.signal,
          });
          const trimmed = String(sectionText).trim();
          if (trimmed) {
            parts.push(trimmed);
            previousTail = trimmed.slice(-280);
          }
        }
        if (parts.length === 0) throw new Error('empty_response');
        currentDraft = parts.join('\n\n');
      } else {
        currentDraft = await generateText(writerConfig, {
          prompt: writerPrompt,
          ...WRITER_LLM_OPTIONS,
          signal: progress.signal,
          onToken: (token) => {
            streamedWriterText += token;
          },
          novelId,
        }, {
          operation: 'production-pipeline-writer',
          novelId,
          timeoutMs: WRITER_LLM_OPTIONS.timeoutMs,
          concurrency: 2,
          signal: progress.signal,
        });
      }
      currentDraft = ensureMinimumDraftLength(currentDraft, sceneBeats, augmentedContexts.writer, minDraftChars);
      if (process.env.DEBUG_GATE_IN === '1') {
        console.error('[DEBUG-gatein] len=' + String(currentDraft).length + ' head=' + JSON.stringify(String(currentDraft).slice(0, 150)));
      }
      const draftQuality = validateCompleteChapterDraftQuality(currentDraft, undefined, { minChars: minDraftChars });
      if (!draftQuality.ok) {
        logger.warn('Writer output failed the prose quality gate; using fallback draft', {
          novelId,
          violations: draftQuality.violations,
          evidence: (draftQuality.findings || []).slice(0, 8).map((finding) => ({
            code: finding.code,
            snippets: (finding.evidence || []).slice(0, 3).map((entry) => entry.snippet),
          })),
        });
        currentDraft = buildValidatedFallbackDraft(sceneBeats, augmentedContexts.writer, minDraftChars);
        draftSource = 'fallback';
      } else {
        const chunks = (streamedWriterText || currentDraft).match(/.{1,24}/gs) || [];
        for (const chunk of chunks) {
          throwIfAborted(progress.signal);
          progress.onWriterToken?.(chunk);
        }
      }
    } catch (err) {
      throwIfAborted(progress.signal);
      if (err instanceof Error && err.message.startsWith('DRAFT_QUALITY_GATE_FAILED:')) {
        throw err;
      }
      logger.warn('Writer fell back to deterministic draft', err);
      currentDraft = buildValidatedFallbackDraft(sceneBeats, augmentedContexts.writer);
      draftSource = 'fallback';
      // Emit tokens for fallback draft
      const chunks = currentDraft.match(/.{1,24}/gs) || [];
      for (const chunk of chunks) {
        throwIfAborted(progress.signal);
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
      contextStr: augmentedContexts.critic,
      skillsInfo: criticSkillsInfo,
      sceneBeats,
      currentDraft,
    });

    try {
      criticFeedback = await generateText(getConfig(), {
        prompt: criticPrompt + AUDIT_OUTPUT_CONTRACT,
        ...CRITIC_LLM_OPTIONS,
        signal: progress.signal,
        novelId,
        outputMode: 'audit-json',
        responseMimeType: 'application/json',
      }, {
        operation: 'production-pipeline-critic',
        novelId,
        timeoutMs: CRITIC_LLM_OPTIONS.timeoutMs,
        concurrency: 2,
        signal: progress.signal,
      });
      criticAvailable = true;
    } catch (err) {
      throwIfAborted(progress.signal);
      logger.warn('Critic fell back — accepting draft', err);
      criticFeedback = '审计不可用：模型审计请求失败，保留草稿预览。';
      auditStatus = 'unknown';
      auditScore = 0;
    }

    // Only structured audits are trusted; unavailable or unparseable audits stay UNKNOWN.
    if (criticAvailable) {
      const classification = classifyCriticFeedback(criticFeedback);
      auditScore = classification.score ?? 0;
      auditStatus = classification.status;
      if (auditStatus === 'unknown') criticFeedback = UNKNOWN_CRITIC_FEEDBACK;
    }

    const isValid = auditStatus === 'pass';
    progress.onCriticDone?.(criticFeedback, isValid, { status: auditStatus, score: auditStatus === 'unknown' ? undefined : auditScore });

    if (isValid || auditStatus === 'unknown') break;

    // Retry: feed critic feedback to next Writer iteration
    if (attempt < MAX_RETRIES) {
      progress.onPhase?.('retry');
    }
  }

  return {
    sceneBeats,
    draft: currentDraft,
    audit: criticFeedback,
    score: auditStatus === 'unknown' ? undefined : auditScore,
    auditStatus,
    source: draftSource,
    attempts,
  };
}
