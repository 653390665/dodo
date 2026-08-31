import type { Express } from 'express';
import { z } from 'zod';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import { resolvePromptAssetForSurface } from '../../shared/lib/prompt-runtime';
import { renderPromptTemplate, resolveChainPrompt, wrapUserInput } from '../helpers/prompt-helpers';
import { rateLimit } from '../middleware/rate-limit';
import { logger } from '../logger';
import {
  buildFallbackDraft,
  buildFallbackSceneBeats,
  ensureMinimumDraftLength,
  countDraftChars,
} from '../helpers/fallback-draft';
import { emitTextAsTokens } from '../helpers/async-utils';
import { PLANNER_SOUL, WRITER_SOUL, CRITIC_SOUL } from '../../shared/config/souls';
import * as db from '../lib/db';
import { validate, orchestrateSchema, orchestrateDraftSchema } from '../validation';
import {
  reserveQuota,
  commitQuotaReservation,
  settleQuotaReservation,
  quotaFailureHttpStatus,
} from '../helpers/quota-guard.js';
import { getPlotBudgetGuidelines } from '../helpers/plot-budget';
import { getActiveDimensionSignals } from '../../shared/lib/prompt-assets-governed.js';
import { bindClientDisconnect, isStreamDisconnected } from '../helpers/stream-disconnect';
import { createLlmExecution, LlmExecutionRejectedError } from '../helpers/llm-execution-gate';
import type { Skill } from '../../shared/types';
import { consumeOnboardingLlmSession } from '../helpers/onboarding-llm-session';
import { getDatabaseGeneration } from '../lib/db-instance';
import { classifyCriticFeedback, UNKNOWN_CRITIC_FEEDBACK } from '../helpers/ai-production-pipeline';
import { ProviderError, toProviderErrorEnvelope } from '../lib/server-llm';
import { randomUUID } from 'node:crypto';
import { requireWritingStyleConfirmation, resolveWritingStyleRequest, WritingStyleRequestError } from '../helpers/writing-style-service.js';
import { buildServerStoryContextWithSemantic } from '../helpers/story-context.js';
import { resolveEffectiveMinDraftChars, validateCompleteChapterDraftQuality } from '../../shared/lib/draft-quality';

const EDITOR_AGENT_CHAIN_MODULES = [
  'chainConcept',
  'chainOpening',
  'chainVolumeOutline',
  'chainPlotLogic',
  'chainCharacterConsistency',
  'chainTransition',
  'chainDialogue',
  'chainChapterEnding',
  'chainAntiAiVoice',
  'chainConsistencyReview',
] as const;
const PLANNER_CHAIN_MODULES = new Set(['chainConcept', 'chainOpening', 'chainVolumeOutline', 'chainPlotLogic', 'chainCharacterConsistency']);
const WRITER_CHAIN_MODULES = new Set(['chainTransition', 'chainDialogue', 'chainChapterEnding', 'chainAntiAiVoice']);

const editorAgentSkillCoreSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().max(500),
  description: z.string().max(20_000),
  style: z.string().max(20_000),
  pacing: z.string().max(20_000),
  stabilityScore: z.number().finite(),
  evaluationFeedback: z.string().max(20_000),
  version: z.number().int().nonnegative(),
  createdAt: z.number().finite(),
}).passthrough();

const editorAgentSkillSchema = z.custom<Skill>(
  (value) => editorAgentSkillCoreSchema.safeParse(value).success,
  { message: 'Invalid skill payload' },
);

const editorAgentSchema = z.object({
  userIntent: z.string().trim().min(1).max(20_000),
  contextStr: z.string().max(200_000).default(''),
  surface: z.enum([
    'welcome',
    'world-onboarding',
    'workspace-beats',
    'workspace-draft',
    'chapter-polish',
    'chapter-review',
  ]).default('workspace-beats'),
  continuationPackId: z.string().trim().min(1).max(200).optional(),
  chain: z.array(z.enum(EDITOR_AGENT_CHAIN_MODULES)).max(6).optional(),
  chapterOrder: z.coerce.number().int().min(0).max(1_000_000).transform((order) => Math.max(1, order)).optional(),
  novelId: z.string().trim().min(1).max(200),
  chapterId: z.string().trim().min(1).max(200),
  skills: z.array(editorAgentSkillSchema).max(32).default([]),
  styleConfirmationFingerprint: z.string().length(64).optional(),
  writingStyleFingerprint: z.string().length(64).optional(),
  sessionCardIds: z.array(z.string().trim().min(1).max(200)).max(6).optional(),
  databaseGeneration: z.number().int().nonnegative(),
}).strict().superRefine((value, ctx) => {
  if (value.chain && new Set(value.chain).size !== value.chain.length) {
    ctx.addIssue({ code: 'custom', path: ['chain'], message: 'Chain modules must be unique' });
  }
});

const ORCHESTRATE_WRITER_LLM_OPTIONS = {
  timeoutMs: 90_000,
  maxAttempts: 1,
  maxTokens: 8192,
} as const;

const inspirationRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(200_000),
  surface: z.enum([
    'welcome',
    'world-onboarding',
    'workspace-beats',
    'workspace-draft',
    'chapter-polish',
    'chapter-review',
  ]).default('workspace-draft'),
  novelId: z.string().trim().min(1).max(200).optional(),
  onboardingSessionId: z.string().trim().min(1).max(200).optional(),
  purpose: z.enum(['conversation', 'sync-extraction', 'world-bible']).default('conversation'),
  databaseGeneration: z.number().int().nonnegative(),
}).strict();

const providerStatusByCode = {
  configuration: 503,
  authentication: 401,
  billing: 402,
  parameter_incompatible: 400,
  rate_limit: 429,
  service_unavailable: 503,
  network: 502,
  timeout: 504,
  empty_response: 502,
  quality_rejected: 422,
} as const;

function safeInspirationError(error: unknown, traceId: string) {
  if (error instanceof ProviderError) return toProviderErrorEnvelope(error);
  return { error: '灵感服务暂不可用，请稍后重试', code: 'INSPIRATION_UNAVAILABLE', traceId, retriable: true };
}

function safeEditorAgentError(error: unknown, traceId: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && (error.name === 'AbortError' || /abort|cancel|取消|中断/i.test(message))) {
    return { error: '编辑助手请求已取消，请重新提交。', code: 'EDITOR_AGENT_CANCELLED', traceId, retriable: false, finishReason: undefined };
  }
  if (error instanceof ProviderError) return toProviderErrorEnvelope(error);
  return { error: '编辑助手暂不可用，请稍后重试', code: 'EDITOR_AGENT_UNAVAILABLE', traceId, retriable: true, finishReason: undefined };
}

const ORCHESTRATE_CRITIC_LLM_OPTIONS = {
  timeoutMs: 35_000,
  maxAttempts: 1,
  maxTokens: 1200,
} as const;

// ---- Lightweight In-Memory Job Queue / Store ----
interface Job {
  id: string;
  status: 'queueing' | 'running' | 'completed' | 'failed';
  progress: number;
  result?: unknown;
  error?: string;
  createdAt: number;
  databaseGeneration: number;
  code?: string;
  traceId?: string;
  retriable?: boolean;
  finishReason?: string;
}

const jobs = new Map<string, Job>();
const jobAbortControllers = new Map<string, AbortController>();
const JOB_TTL = 15 * 60 * 1000; // 15 minutes TTL

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > JOB_TTL) {
      jobs.delete(id);
      jobAbortControllers.get(id)?.abort(new Error('编辑助手任务已过期。'));
      jobAbortControllers.delete(id);
    }
  }
}

// Prune old jobs periodically
setInterval(pruneJobs, 60 * 1000).unref();

function createJob(databaseGeneration: number): string {
  pruneJobs();
  const id = 'job_' + Math.random().toString(36).substring(2, 15);
  jobs.set(id, {
    id,
    status: 'queueing',
    progress: 10,
    createdAt: Date.now(),
    databaseGeneration,
  });
  return id;
}

function updateJob(id: string, updates: Partial<Omit<Job, 'id' | 'createdAt'>>) {
  const job = jobs.get(id);
  if (job) {
    Object.assign(job, updates);
  }
}

export function registerAgentsRoutes(app: Express) {
  // GET endpoint to query agents background job status
  app.get('/api/agents/jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: '编辑助手任务不存在或已过期，请重新提交。' });
    }
    const requestedGeneration = Number(req.query.databaseGeneration);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration !== job.databaseGeneration) {
      return res.status(409).json({ code: 'DATABASE_GENERATION_STALE', error: '数据库已变化，请刷新后重试' });
    }
    if (job.databaseGeneration !== getDatabaseGeneration()) {
      jobAbortControllers.get(jobId)?.abort(new Error('数据库已在编辑助手任务期间切换。'));
      updateJob(jobId, { status: 'failed', progress: 100, error: '数据库已在编辑助手任务期间切换，请重新提交。' });
      return res.status(409).json({ code: 'DATABASE_GENERATION_STALE', error: '数据库已变化，请刷新后重试' });
    }
    res.json(job);
  });

  app.post('/api/agents/jobs/:jobId/cancel', (req, res) => {
    const job = jobs.get(req.params.jobId);
    const controller = jobAbortControllers.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: '编辑助手任务不存在或已过期，请重新提交。' });
    const requestedGeneration = Number(req.query.databaseGeneration);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration !== job.databaseGeneration) {
      return res.status(409).json({ error: '编辑助手任务状态已过期，请重新提交。' });
    }
    if (!controller || job.status === 'completed' || job.status === 'failed') {
      return res.status(409).json({ error: '当前编辑助手任务不能取消。' });
    }
    controller.abort(new Error('编辑助手任务已取消。'));
    updateJob(job.id, { status: 'failed', progress: 100, error: '编辑助手任务已取消。' });
    return res.json({ cancelled: true });
  });

  app.post('/api/inspiration', async (req, res) => {
    if (!rateLimit('inspiration')) return res.status(429).json({ error: '灵感请求过于频繁，请稍后再试。', retryAfter: 5 });
    const controller = new AbortController();
    let inspirationTraceId = `llm_${randomUUID()}`;
    const disposeDisconnect = bindClientDisconnect(req, res, () => {
      controller.abort();
    });
    try {
      const parsedRequest = inspirationRequestSchema.safeParse(req.body);
      if (!parsedRequest.success) {
        return res.status(400).json({ error: '灵感请求参数无效', code: 'INVALID_INSPIRATION_REQUEST' });
      }
      const { prompt, surface, novelId, onboardingSessionId, purpose, databaseGeneration: requestedGeneration } = parsedRequest.data;
      const databaseGeneration = requestedGeneration;
      if (databaseGeneration !== getDatabaseGeneration()) {
        return res.status(409).json({ error: '数据库已变化，请刷新后重试', code: 'DATABASE_GENERATION_STALE' });
      }
      if (!novelId || typeof novelId !== 'string') {
        if (surface !== 'welcome') {
          return res.status(400).json({ error: '请先选择作品，再使用写作灵感助手。' });
        }
        const session = consumeOnboardingLlmSession(onboardingSessionId, 'inspiration');
        if (!session.allowed) return res.status(session.status).json({ error: session.error });
      }
      const execution = await createLlmExecution({
        operation: surface === 'welcome' && !novelId ? 'onboarding-inspiration' : 'inspiration',
        novelId: typeof novelId === 'string' ? novelId : undefined,
        // Only general conversation is charged against the chapter-writing quota.
        // World-bible assistance and extraction remain rate-limited, but are not prose generation.
        ...(typeof novelId === 'string' && purpose === 'conversation'
          ? { quotaType: 'generateProse' as const, accessContext: 'basic-byok' as const }
          : {}),
        timeoutMs: 90_000,
        signal: controller.signal,
        concurrency: 2,
        databaseGeneration,
      });
      inspirationTraceId = execution.traceId;
      const promptAsset = resolvePromptAssetForSurface({
        // Inspiration uses the discovery assistant identity even when the
        // caller is a workspace surface. Passing workspace-draft here would
        // silently select the prose writer asset because overrides are stage-scoped.
        surface: 'welcome',
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'inspirationSystem',
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-InkFlow-Database-Generation', String(databaseGeneration));
      req.socket.setTimeout(0);

      await execution.run(async ({ signal }) => {
        await generateText(getConfig(), {
          prompt,
          systemInstruction: purpose === 'sync-extraction'
            ? '你是严格的世界观资料结构化整理器。只输出用户要求的单一合法 JSON 根对象，不输出 Markdown、解释、注释或思考过程。'
            : promptAsset.template,
          timeoutMs: 90_000,
          maxAttempts: 2,
          maxTokens: purpose === 'sync-extraction' || purpose === 'world-bible' ? 8192 : 2048,
          ...(purpose === 'sync-extraction'
            ? { responseMimeType: 'application/json', disableThinking: true }
            : purpose === 'world-bible' ? { disableThinking: true } : {}),
          onToken: (token) => {
            if (databaseGeneration !== getDatabaseGeneration()) {
              controller.abort(new Error('数据库已在灵感生成期间切换。'));
              return;
            }
            if (!isStreamDisconnected(req, res) && !res.writableEnded && !res.destroyed) {
              res.write(`data: ${JSON.stringify({ token })}\n\n`);
            }
          },
          signal,
          novelId: typeof novelId === 'string' ? novelId : undefined,
        });
        if (
          databaseGeneration !== getDatabaseGeneration()
          || isStreamDisconnected(req, res)
          || res.writableEnded
          || res.destroyed
        ) {
          throw new Error('Client disconnected before inspiration completion');
        }
        res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    } catch (e) {
      if (e instanceof LlmExecutionRejectedError && !res.headersSent) {
        return res.status(e.status).json({ error: e.message, code: e.quota.code });
      }
      logger.error('Inspiration SSE error:', e);
      if (isStreamDisconnected(req, res) || res.writableEnded || res.destroyed) {
        return;
      }
      if (!res.headersSent) {
        const failure = safeInspirationError(e, inspirationTraceId);
        return res.status(e instanceof ProviderError ? providerStatusByCode[e.code] : 502).json(failure);
      } else {
        // The response is already an SSE stream. Preserve the failure reason
        // as a structured event so clients do not mistake an empty stream for
        // a successful generation with invalid content.
        if (!res.writableEnded && !res.destroyed) {
          const streamError = { type: 'error', ...safeInspirationError(e, inspirationTraceId) };
          res.write(`data: ${JSON.stringify(streamError)}\n\n`);
        }
        res.end();
      }
    } finally {
      disposeDisconnect();
    }
  });

  app.post('/api/editor-agent', async (req, res) => {
    if (!rateLimit('editor-agent')) return res.status(429).json({ error: '编辑助手请求过于频繁，请稍后再试。', retryAfter: 5 });

    try {
      const parsed = editorAgentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: '编辑助手请求参数无效，请检查章节和作品上下文。' });
      }
      const { userIntent, contextStr, surface, continuationPackId, chain, chapterOrder, novelId, chapterId, styleConfirmationFingerprint, writingStyleFingerprint, sessionCardIds, databaseGeneration } = parsed.data;
      if (databaseGeneration !== getDatabaseGeneration()) {
        return res.status(409).json({ code: 'DATABASE_GENERATION_STALE', error: '数据库已变化，请刷新后重试' });
      }
      if (continuationPackId) {
        const pack = db.getContinuationPack(continuationPackId);
        if (!pack) {
          return res.status(404).json({ error: '导入资料不存在或已失效，请重新选择。' });
        }
        if (pack.novelId !== novelId) {
          return res.status(409).json({ error: '导入资料不属于当前作品，请重新选择。' });
        }
      }
      let writingStyle;
      try {
        writingStyle = resolveWritingStyleRequest(novelId, { chapterId, databaseGeneration, continuationPackId, sessionCardIds });
        const requiresConfirmation = surface === 'workspace-draft'
          || surface === 'chapter-polish'
          || Boolean(chain?.some((module) => WRITER_CHAIN_MODULES.has(module)));
        if (requiresConfirmation) requireWritingStyleConfirmation(writingStyle, styleConfirmationFingerprint ?? writingStyleFingerprint);
      } catch (error) {
        if (error instanceof WritingStyleRequestError) {
          return res.status(error.status).json({ code: error.code, error: error.message, ...(writingStyle ? { resolution: writingStyle.resolution, candidates: writingStyle.candidates } : {}) });
        }
        throw error;
      }
      const jobController = new AbortController();
      const execution = await createLlmExecution({
        operation: 'editor-agent',
        novelId,
        quotaType: 'generateProse',
        accessContext: 'basic-byok',
        timeoutMs: 60_000,
        concurrency: 2,
        signal: jobController.signal,
        databaseGeneration,
      });

      const jobId = createJob(databaseGeneration);
      jobAbortControllers.set(jobId, jobController);
      res.json({ jobId, traceId: execution.traceId, databaseGeneration });

      // Run actual LLM generation in the background
      (async () => {
        try {
          updateJob(jobId, { status: 'running', progress: 50 });
          const result = await execution.run(async ({ signal }) => {
            const packContext = writingStyle.executionSnapshot.canon.pack?.context || '';

            const budgetGuidelines = chapterOrder ? getPlotBudgetGuidelines(Number(chapterOrder)) : '';
            const serverContextStr = await buildServerStoryContextWithSemantic({
              novelId,
              chapterId,
              clientContext: contextStr,
            });

            const effectiveContextStr = (packContext
              ? `${serverContextStr}\n\n${packContext}`
              : serverContextStr) + (budgetGuidelines ? `\n\n${budgetGuidelines}` : '');

            const { planner: plannerSkillsInfo, writer: writerSkillsInfo, critic: criticSkillsInfo } = writingStyle.executionSnapshot.stagePrompts;

            // Chain mode: run focused sub-prompts instead of monolithic template
            if (chain && chain.length > 0) {
              const results: Array<{ module: string; pass: boolean; text: string }> = [];
              for (const module of chain) {
                try {
                  const skillsInfo = PLANNER_CHAIN_MODULES.has(module)
                    ? plannerSkillsInfo
                    : WRITER_CHAIN_MODULES.has(module) ? writerSkillsInfo : criticSkillsInfo;
                  const { prompt } = resolveChainPrompt(module, {
                    contextStr: effectiveContextStr,
                    sceneBeats: '',
                    draftContent: '',
                    userIntent: wrapUserInput(userIntent),
                    ideaSeed: wrapUserInput(userIntent),
                    concept: wrapUserInput(userIntent),
                    skillsInfo,
                    expectedWordCount: '180000',
                    seedOutline: serverContextStr,
                  });
                  const text = await generateText(getConfig(), {
                    prompt,
                    timeoutMs: 8_000,
                    maxAttempts: 1,
                    maxTokens: 1024,
                    novelId,
                    signal,
                  });
                  results.push({ module, pass: text.includes('PASS'), text });
                } catch (chainErr) {
                  if (signal.aborted) throw chainErr;
                  logger.warn(`Chain module ${module} failed`, chainErr);
                  results.push({ module, pass: false, text: '' });
                }
              }
              if (!results.some((entry) => entry.text.trim())) {
                throw new Error('Editor-agent chain produced no result');
              }
              return { chainResults: results, text: results.map(r => r.text).filter(Boolean).join('\n---\n') };
            }

            const promptAsset = resolvePromptAssetForSurface({
              surface,
              promptTemplates: getConfig().promptTemplates,
              preferredTemplateKey: 'editorAgent',
            });
            const prompt = renderPromptTemplate(promptAsset.template, {
              PLANNER_SOUL,
              contextStr: effectiveContextStr,
              skillsInfo: surface === 'workspace-beats'
                ? plannerSkillsInfo
                : surface === 'chapter-review' ? criticSkillsInfo : writerSkillsInfo,
              userIntent: wrapUserInput(userIntent),
            });
            const text = await (async () => {
              try {
                return await generateText(getConfig(), {
                  prompt,
                  timeoutMs: 8_000,
                  maxAttempts: 1,
                  maxTokens: 1600,
                  novelId,
                  signal,
                });
              } catch (error) {
                if (signal.aborted) throw error;
                logger.warn('Editor agent fell back', error);
                return buildFallbackSceneBeats(userIntent);
              }
            })();
            return { text };
          });
          updateJob(jobId, { status: 'completed', progress: 100, result });
        } catch (e) {
          logger.error('Background editor-agent error:', e);
          const failure = safeEditorAgentError(e, execution.traceId);
          updateJob(jobId, {
            status: 'failed', progress: 100, error: failure.error, code: failure.code,
            traceId: failure.traceId, retriable: failure.retriable, finishReason: failure.finishReason,
          });
        } finally {
          jobAbortControllers.delete(jobId);
        }
      })();
    } catch (e) {
      if (e instanceof LlmExecutionRejectedError) {
        return res.status(e.status).json({ error: e.message, code: e.quota.code });
      }
      logger.error(String(e));
      res.status(500).json({ error: '编辑助手暂不可用，请稍后重试。' });
    }
  });

  app.post('/api/orchestrate', validate(orchestrateSchema), async (req, res) => {
    if (!rateLimit('orchestrate')) return res.status(429).json({ error: '正文协作请求过于频繁，请稍后再试。', retryAfter: 5 });
    const {
      novelId,
      contextStr,
      sceneBeats,
      maxIterations = 2,
      draftContent = "",
      includeCritic = true,
      draftingSurface = 'workspace-draft',
      reviewSurface = 'chapter-review',
      styleConfirmationFingerprint,
      writingStyleFingerprint,
      continuationPackId,
      sessionCardIds,
      chapterId,
      databaseGeneration,
    } = req.body;

    // This endpoint has no user-declared length target; keep the full-chapter standard.
    const targetChars = resolveEffectiveMinDraftChars(undefined);

    let writingStyle;
    try {
      if (!novelId) throw new WritingStyleRequestError(400, 'NOVEL_ID_REQUIRED', '必须绑定作品');
      writingStyle = resolveWritingStyleRequest(novelId, { chapterId, databaseGeneration, continuationPackId, sessionCardIds });
      requireWritingStyleConfirmation(writingStyle, styleConfirmationFingerprint ?? writingStyleFingerprint);
    } catch (error) {
      if (error instanceof WritingStyleRequestError) {
        return res.status(error.status).json({
          code: error.code,
          error: error.message,
          ...(writingStyle ? { resolution: writingStyle.resolution, candidates: writingStyle.candidates } : {}),
        });
      }
      throw error;
    }

    // Quota Gate — atomic reserve before any LLM work
    const reserve = await reserveQuota(novelId, 'generateProse', 'basic-byok');
    if (!reserve.allowed) {
      return res.status(quotaFailureHttpStatus(reserve)).json({
        quotaExceeded: true,
        limitType: 'generateProse',
        count: reserve.count,
        max: reserve.max,
        error: reserve.error,
        limitDetails: {
          limitType: 'generateProse',
          count: reserve.count,
          max: reserve.max,
          error: reserve.error,
        }
      });
    }

    const reservationId = reserve.reservationId;
    const maxIter = Math.min(Math.max(1, Number(maxIterations) || 2), 5);
    let orchestrateHeartbeat: ReturnType<typeof setInterval> | null = null;
    const clientAbortController = new AbortController();
    let contentDelivered = false;
    let disposeDisconnect = () => {};
    let streamCleanedUp = false;
    const cleanupStream = () => {
      if (streamCleanedUp) return;
      streamCleanedUp = true;
      if (orchestrateHeartbeat) {
        clearInterval(orchestrateHeartbeat);
        orchestrateHeartbeat = null;
      }
      disposeDisconnect();
    };

    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      req.socket.setTimeout(0);
      orchestrateHeartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          try {
            res.write(':ping\n\n');
          } catch {
            cleanupStream();
          }
        }
      }, 30_000);

      disposeDisconnect = bindClientDisconnect(req, res, () => {
        clientAbortController.abort();
        cleanupStream();
      });

      const { writer: writerSkillsInfo, critic: criticSkillsInfo } = writingStyle.executionSnapshot.stagePrompts;
      let currentDraft = draftContent || "";
      let criticFeedback = "";
      let isValid = false;
      let criticStatus: 'pass' | 'fail' | 'unknown' = 'unknown';
      let writerSource: 'model' | 'fallback' = 'model';

      for (let iteration = 0; iteration < maxIter; iteration++) {
        writerSource = 'model';
        const writerAsset = resolvePromptAssetForSurface({
          surface: draftingSurface,
          promptTemplates: getConfig().promptTemplates,
          preferredTemplateKey: 'orchestrateWriter',
        });
        const writerPrompt = renderPromptTemplate(writerAsset.template, {
          WRITER_SOUL,
          contextStr,
          skillsInfo: writerSkillsInfo,
          sceneBeats,
          criticFeedback: criticFeedback || '初稿阶段，请全力输出。',
        });

        if (!res.writableEnded && !res.destroyed) {
          res.write(`data: ${JSON.stringify({ type: 'status', message: 'Writer Agent 正在生成正文…' })}\n\n`);
        }
        try {
          currentDraft = await generateText(getConfig(), {
            prompt: writerPrompt,
            ...ORCHESTRATE_WRITER_LLM_OPTIONS,
            signal: clientAbortController.signal,
            novelId,
          }, {
            operation: 'orchestrate',
            novelId,
            timeoutMs: ORCHESTRATE_WRITER_LLM_OPTIONS.timeoutMs,
            concurrency: 2,
            signal: clientAbortController.signal,
          });
          currentDraft = ensureMinimumDraftLength(currentDraft, sceneBeats, contextStr, targetChars);
        } catch (error) {
          if (clientAbortController.signal.aborted) throw error;
          logger.warn('Writer generation fell back to local draft', error);
          currentDraft = buildFallbackDraft(sceneBeats, contextStr, targetChars);
          writerSource = 'fallback';
          if (!res.writableEnded && !res.destroyed) {
            res.write(`data: ${JSON.stringify({
              type: 'status',
              source: writerSource,
              message: '模型响应过慢，已切换到本地保底草稿，建议稍后重试以获得更完整版本。',
            })}\n\n`);
          }
        }
        const draftQuality = validateCompleteChapterDraftQuality(currentDraft, undefined, { minChars: targetChars });
        if (!draftQuality.ok) throw new Error(`DRAFT_QUALITY_GATE_FAILED: ${draftQuality.violations.join('；')}`);
        if (isStreamDisconnected(req, res) || res.writableEnded || res.destroyed) {
          throw new Error('Client disconnected before draft delivery');
        }
        await emitTextAsTokens(res, currentDraft, {
          signal: clientAbortController.signal,
          onFirstWrite: () => {
            contentDelivered = true;
          },
        });
        if (!res.writableEnded && !res.destroyed) {
          res.write(`data: ${JSON.stringify({ type: 'writer_done', source: writerSource })}\n\n`);
        }

        if (!includeCritic) {
          break;
        }

        const criticAsset = resolvePromptAssetForSurface({
          surface: reviewSurface,
          promptTemplates: getConfig().promptTemplates,
          preferredTemplateKey: 'orchestrateCritic',
        });
        const criticPrompt = renderPromptTemplate(criticAsset.template, {
          CRITIC_SOUL,
          contextStr,
          skillsInfo: criticSkillsInfo,
          sceneBeats,
          currentDraft,
        });

        let classification: ReturnType<typeof classifyCriticFeedback>;
        try {
          criticFeedback = await generateText(getConfig(), {
            prompt: criticPrompt,
            ...ORCHESTRATE_CRITIC_LLM_OPTIONS,
            signal: clientAbortController.signal,
            novelId,
            outputMode: 'audit-json',
            responseMimeType: 'application/json',
          }, {
            operation: 'orchestrate',
            novelId,
            timeoutMs: ORCHESTRATE_CRITIC_LLM_OPTIONS.timeoutMs,
            concurrency: 2,
            signal: clientAbortController.signal,
          });
          classification = classifyCriticFeedback(criticFeedback);
          if (classification.status === 'unknown') criticFeedback = UNKNOWN_CRITIC_FEEDBACK;
        } catch (error) {
          if (clientAbortController.signal.aborted || isStreamDisconnected(req, res) || res.writableEnded || res.destroyed) {
            throw error;
          }
          logger.warn('Critic generation unavailable; preserving draft', error);
          criticFeedback = UNKNOWN_CRITIC_FEEDBACK;
          classification = classifyCriticFeedback(criticFeedback, false);
        }
        criticStatus = classification.status;
        isValid = criticStatus === 'pass';
        if (!res.writableEnded && !res.destroyed) {
          res.write(`data: ${JSON.stringify({
            type: 'critic_done',
            feedback: criticFeedback,
            isValid,
            status: criticStatus,
            ...(criticStatus === 'unknown' ? { retriable: true } : {}),
            ...(classification.score === undefined ? {} : { score: classification.score }),
          })}\n\n`);
        }

        if (criticStatus === 'pass' || criticStatus === 'unknown') break;
      }
      commitQuotaReservation(reservationId);
      if (!res.writableEnded && !res.destroyed) {
        res.write(`data: ${JSON.stringify({ type: 'done', status: criticStatus })}\n\n`);
        res.end();
      }
    } catch (err) {
      await settleQuotaReservation(reservationId, contentDelivered);
      logger.error(String(err));
      if (!isStreamDisconnected(req, res) && !res.writableEnded && !res.destroyed) {
        const qualityFailure = err instanceof Error && err.message.startsWith('DRAFT_QUALITY_GATE_FAILED:')
          ? err.message.slice('DRAFT_QUALITY_GATE_FAILED:'.length).trim().split('；').filter(Boolean)
          : undefined;
        res.write(`data: ${JSON.stringify({
          type: 'error',
          code: qualityFailure ? 'DRAFT_QUALITY_GATE_FAILED' : 'ORCHESTRATE_STREAM_FAILED',
          message: qualityFailure ? '正文候选未通过质量门禁，请重试或调整写法。' : '正文协作暂不可用，请稍后重试',
          ...(qualityFailure ? { violations: qualityFailure, retriable: true } : {}),
        })}\n\n`);
        res.end();
      }
    } finally {
      cleanupStream();
    }
  });

  app.post('/api/orchestrate-draft', validate(orchestrateDraftSchema), async (req, res) => {
    if (!rateLimit('orchestrate-draft')) {
      return res.status(429).json({ error: '正文生成请求过于频繁，请稍后再试。', retryAfter: 5 });
    }
    let orchestrateHeartbeat: NodeJS.Timeout | null = null;
    const clientAbortController = new AbortController();
    const { novelId } = req.body;
    const targetChars = resolveEffectiveMinDraftChars((req.body as { userIntent?: string }).userIntent);
    let reservationId: string | undefined;
    let contentDelivered = false;
    let disposeDisconnect = () => {};
    let streamCleanedUp = false;
    const cleanupStream = () => {
      if (streamCleanedUp) return;
      streamCleanedUp = true;
      if (orchestrateHeartbeat) {
        clearInterval(orchestrateHeartbeat);
        orchestrateHeartbeat = null;
      }
      disposeDisconnect();
    };

    try {
      const {
        contextStr = '',
        sceneBeats = '',
        draftContent = '',
        draftingSurface = 'workspace-draft',
        chapterOrder,
        styleConfirmationFingerprint,
        writingStyleFingerprint,
        continuationPackId,
        sessionCardIds,
        chapterId,
        databaseGeneration: requestDatabaseGeneration,
      } = req.body;

      let writingStyle;
      try {
        if (!novelId) throw new WritingStyleRequestError(400, 'NOVEL_ID_REQUIRED', '必须绑定作品');
        if (typeof chapterId !== 'string' || typeof requestDatabaseGeneration !== 'number') throw new WritingStyleRequestError(400, 'SCOPED_CONTEXT_REQUIRED', '章节与数据库版本不能为空');
        writingStyle = resolveWritingStyleRequest(novelId, { chapterId, databaseGeneration: requestDatabaseGeneration, continuationPackId, sessionCardIds });
        requireWritingStyleConfirmation(writingStyle, styleConfirmationFingerprint ?? writingStyleFingerprint);
      } catch (error) {
        if (error instanceof WritingStyleRequestError) {
          return res.status(error.status).json({
            code: error.code,
            error: error.message,
            ...(writingStyle ? { resolution: writingStyle.resolution, candidates: writingStyle.candidates } : {}),
          });
        }
        throw error;
      }

      // ================================================================
      // Quota Gate — atomic reserve before any LLM work
      // ================================================================
      const reserve = await reserveQuota(novelId, 'generateProse', 'basic-byok');
      if (!reserve.allowed) {
        return res.status(quotaFailureHttpStatus(reserve)).json({
          quotaExceeded: true,
          limitType: 'generateProse',
          count: reserve.count,
          max: reserve.max,
          error: reserve.error,
        });
      }

      reservationId = reserve.reservationId;
      const executionDatabaseGeneration = reserve.databaseGeneration ?? requestDatabaseGeneration;
      if (executionDatabaseGeneration !== getDatabaseGeneration()) {
        await settleQuotaReservation(reservationId, false);
        reservationId = undefined;
        return res.status(409).json({ error: '数据库已在正文生成前切换，请刷新后重试。' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-InkFlow-Database-Generation', String(executionDatabaseGeneration));
      res.flushHeaders();

      req.socket.setTimeout(0);
      orchestrateHeartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          try {
            res.write(':ping\n\n');
          } catch {
            cleanupStream();
          }
        }
      }, 30_000);

      disposeDisconnect = bindClientDisconnect(req, res, () => {
        clientAbortController.abort();
        cleanupStream();
      });

      const budgetGuidelines = chapterOrder ? getPlotBudgetGuidelines(Number(chapterOrder)) : '';
      let adaptiveWritingGuidelines = '';
      if (novelId) {
        const novel = db.getNovel(novelId);
        if (novel) {
          const signals = getActiveDimensionSignals(novel);
          if (signals.extraWritingConstraints.length > 0) {
            adaptiveWritingGuidelines = `\n\n【动态维度系统追加写作约束 (Adaptive Writing Constraints)】\n${signals.extraWritingConstraints.map(c => `- ${c}`).join('\n')}`;
          }
        }
      }
      const effectiveContextStr = contextStr +
        (budgetGuidelines ? `\n\n${budgetGuidelines}` : '') +
        (adaptiveWritingGuidelines ? `\n\n${adaptiveWritingGuidelines}` : '');

      const writerAsset = resolvePromptAssetForSurface({
        surface: draftingSurface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'orchestrateWriter',
      });
      const writerPrompt = renderPromptTemplate(writerAsset.template, {
        WRITER_SOUL,
        contextStr: effectiveContextStr,
        skillsInfo: writingStyle.executionSnapshot.stagePrompts.writer,
        sceneBeats,
        criticFeedback: draftContent
          ? `请在已有正文基础上继续扩写，保持承接自然。\n\n【已有正文】\n${draftContent}`
          : '初稿阶段，请全力输出。',
      });

      let text = '';
      let draftSource: 'model' | 'fallback' = 'model';
      try {
        text = await generateText(getConfig(), {
          prompt: writerPrompt,
          ...ORCHESTRATE_WRITER_LLM_OPTIONS,
          signal: clientAbortController.signal,
          novelId,
        }, {
          operation: 'orchestrate-draft',
          novelId,
          timeoutMs: ORCHESTRATE_WRITER_LLM_OPTIONS.timeoutMs,
          concurrency: 2,
          signal: clientAbortController.signal,
        });
        text = ensureMinimumDraftLength(text, sceneBeats, effectiveContextStr, targetChars);
      } catch (error) {
        if (clientAbortController.signal.aborted) throw error;
        logger.warn('Writer generation fell back to local draft', error);
        text = buildFallbackDraft(sceneBeats, effectiveContextStr, targetChars);
        draftSource = 'fallback';
        if (!res.writableEnded && !res.destroyed) {
          res.write(`data: ${JSON.stringify({
            type: 'status',
            source: draftSource,
            message: '模型响应过慢，已切换到本地保底草稿，建议稍后重试以获得更完整版本。',
          })}\n\n`);
        }
      }

      const draftQuality = validateCompleteChapterDraftQuality(text, undefined, { minChars: targetChars });
      if (!draftQuality.ok) throw new Error(`DRAFT_QUALITY_GATE_FAILED: ${draftQuality.violations.join('；')}`);

      if (
        executionDatabaseGeneration !== getDatabaseGeneration()
        || isStreamDisconnected(req, res)
        || res.writableEnded
        || res.destroyed
      ) {
        throw new Error('Client disconnected before draft delivery');
      }
      await emitTextAsTokens(res, text, {
        signal: clientAbortController.signal,
        onFirstWrite: () => {
          contentDelivered = true;
        },
      });

      if (executionDatabaseGeneration !== getDatabaseGeneration()) {
        throw new Error('数据库已在正文生成完成前切换。');
      }

      commitQuotaReservation(reservationId);
      if (!res.writableEnded && !res.destroyed) {
        res.write(`data: ${JSON.stringify({
          type: 'done',
          source: draftSource,
          text,
          wordCount: countDraftChars(text),
        })}\n\n`);
        res.end();
      }
    } catch (error) {
      await settleQuotaReservation(reservationId, contentDelivered);
      logger.error(String(error));
      if (!isStreamDisconnected(req, res) && !res.writableEnded && !res.destroyed) {
        const qualityFailure = error instanceof Error && error.message.startsWith('DRAFT_QUALITY_GATE_FAILED:')
          ? error.message.slice('DRAFT_QUALITY_GATE_FAILED:'.length).trim().split('；').filter(Boolean)
          : undefined;
        res.write(`data: ${JSON.stringify({
          type: 'error',
          code: qualityFailure ? 'DRAFT_QUALITY_GATE_FAILED' : 'ORCHESTRATE_DRAFT_STREAM_FAILED',
          message: qualityFailure ? '正文候选未通过质量门禁，请重试或调整写法。' : '正文草稿暂不可用，请稍后重试',
          ...(qualityFailure ? { violations: qualityFailure, retriable: true } : {}),
        })}\n\n`);
        res.end();
      }
    } finally {
      cleanupStream();
    }
  });
}
