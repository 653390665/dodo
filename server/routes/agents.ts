import type { Express } from 'express';
import { generateText } from '../lib/server-llm';
import { getConfig } from '../lib/config';
import { resolvePromptAssetForSurface } from '../../shared/lib/prompt-runtime';
import { renderPromptTemplate, buildSkillsPrompt, resolveChainPrompt, wrapUserInput } from '../helpers/prompt-helpers';
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
import { buildContinuationContext } from '../../shared/lib/continuation-pack';
import { validate, orchestrateSchema } from '../validation';
import { reserveQuota, refundQuota, commitQuotaReservation } from '../helpers/quota-guard.js';
import { getPlotBudgetGuidelines } from '../helpers/plot-budget';
import { getActiveDimensionSignals } from '../../shared/lib/prompt-assets-governed.js';

const ORCHESTRATE_WRITER_LLM_OPTIONS = {
  timeoutMs: 90_000,
  maxAttempts: 1,
  maxTokens: 8192,
} as const;

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
}

const jobs = new Map<string, Job>();
const JOB_TTL = 15 * 60 * 1000; // 15 minutes TTL

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > JOB_TTL) {
      jobs.delete(id);
    }
  }
}

// Prune old jobs periodically
setInterval(pruneJobs, 60 * 1000).unref();

function createJob(): string {
  pruneJobs();
  const id = 'job_' + Math.random().toString(36).substring(2, 15);
  jobs.set(id, {
    id,
    status: 'queueing',
    progress: 10,
    createdAt: Date.now(),
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
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  });

  app.post('/api/inspiration', async (req, res) => {
    if (!rateLimit('inspiration')) return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    try {
      const { prompt = '', surface = 'workspace-draft' } = req.body;
      if (!prompt.trim()) {
        return res.status(400).json({ error: 'Prompt is required' });
      }
      const promptAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'inspirationSystem',
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      req.socket.setTimeout(0);

      const controller = new AbortController();
      req.on('close', () => {
        controller.abort();
      });

      await generateText(getConfig(), {
        prompt,
        systemInstruction: promptAsset.template,
        timeoutMs: 90_000,
        maxAttempts: 2,
        maxTokens: 2048,
        onToken: (token) => {
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        },
        signal: controller.signal
      });

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (e) {
      logger.error('Inspiration SSE error:', e);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      } else {
        res.end();
      }
    }
  });

  app.post('/api/editor-agent', (req, res) => {
    if (!rateLimit('editor-agent')) return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    
    try {
      const { userIntent = '', contextStr = '', surface = 'workspace-beats', continuationPackId, chain, chapterOrder, novelId, skills } = req.body;
      if (!userIntent.trim()) {
        return res.status(400).json({ error: 'userIntent is required' });
      }

      const jobId = createJob();
      res.json({ jobId });

      // Run actual LLM generation in the background
      (async () => {
        try {
          updateJob(jobId, { status: 'running', progress: 50 });

          // Load continuation pack context if provided
          let packContext = '';
          if (continuationPackId) {
            const pack = db.getContinuationPack(continuationPackId);
            if (pack) {
              packContext = buildContinuationContext(pack);
            }
          }

          const budgetGuidelines = chapterOrder ? getPlotBudgetGuidelines(Number(chapterOrder)) : '';

          const effectiveContextStr = (packContext
            ? `${contextStr}\n\n${packContext}`
            : contextStr) + (budgetGuidelines ? `\n\n${budgetGuidelines}` : '');

          let activeSkills = skills || [];
          if ((!activeSkills || activeSkills.length === 0) && novelId) {
            const novel = db.getNovel(novelId);
            if (novel && novel.mountedSkillLoadout) {
              activeSkills = novel.mountedSkillLoadout
                .map((item: { skillId: string }) => db.getSkill(item.skillId))
                .filter(Boolean);
            }
          }
          const skillsInfo = buildSkillsPrompt(activeSkills);

          // Chain mode: run focused sub-prompts instead of monolithic template
          if (chain && Array.isArray(chain) && chain.length > 0) {
            const results: Array<{ module: string; pass: boolean; text: string }> = [];
            for (const module of chain) {
              try {
                const { prompt } = resolveChainPrompt(module, {
                  contextStr: effectiveContextStr,
                  sceneBeats: '',
                  draftContent: '',
                  userIntent: wrapUserInput(userIntent),
                  ideaSeed: wrapUserInput(userIntent),
                  concept: wrapUserInput(userIntent),
                  expectedWordCount: '180000',
                  seedOutline: contextStr,
                });
                const text = await generateText(getConfig(), {
                  prompt,
                  timeoutMs: 8_000,
                  maxAttempts: 1,
                  maxTokens: 1024,
                  novelId,
                });
                results.push({ module, pass: text.includes('PASS'), text });
              } catch (chainErr) {
                logger.warn(`Chain module ${module} failed`, chainErr);
                results.push({ module, pass: false, text: '' });
              }
            }
            const finalResult = { chainResults: results, text: results.map(r => r.text).filter(Boolean).join('\n---\n') };
            updateJob(jobId, { status: 'completed', progress: 100, result: finalResult });
            return;
          }

          const promptAsset = resolvePromptAssetForSurface({
            surface,
            promptTemplates: getConfig().promptTemplates,
            preferredTemplateKey: 'editorAgent',
          });
          const prompt = renderPromptTemplate(promptAsset.template, {
            PLANNER_SOUL,
            contextStr: effectiveContextStr,
            skillsInfo,
            userIntent: wrapUserInput(userIntent),
          });
          let text = '';
          try {
            text = await generateText(getConfig(), {
              prompt,
              timeoutMs: 8_000,
              maxAttempts: 1,
              maxTokens: 1600,
              novelId,
            });
          } catch (error) {
            logger.warn('Editor agent fell back', error);
            text = buildFallbackSceneBeats(userIntent);
          }
          updateJob(jobId, { status: 'completed', progress: 100, result: { text } });
        } catch (e) {
          logger.error('Background editor-agent error:', e);
          updateJob(jobId, { status: 'failed', progress: 100, error: String(e) });
        }
      })();
    } catch (e) {
      logger.error(String(e));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post('/api/orchestrate', validate(orchestrateSchema), async (req, res) => {
    if (!rateLimit('orchestrate')) return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    const {
      novelId,
      contextStr,
      sceneBeats,
      maxIterations = 2,
      draftContent = "",
      skills = [],
      includeCritic = true,
      draftingSurface = 'workspace-draft',
      reviewSurface = 'chapter-review',
    } = req.body;

    // Quota Gate — atomic reserve before any LLM work
    const reserve = await reserveQuota(novelId, 'generateProse');
    if (!reserve.allowed) {
      return res.status(403).json({
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

    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      req.socket.setTimeout(0);
      orchestrateHeartbeat = setInterval(() => {
        if (!res.writableEnded) {
          res.write(':ping\n\n');
        }
      }, 30_000);

      req.on('close', () => {
        clientAbortController.abort();
        if (orchestrateHeartbeat) {
          clearInterval(orchestrateHeartbeat);
          orchestrateHeartbeat = null;
        }
      });

      let activeSkills = skills || [];
      if ((!activeSkills || activeSkills.length === 0) && novelId) {
        const novel = db.getNovel(novelId);
        if (novel && novel.mountedSkillLoadout) {
          activeSkills = novel.mountedSkillLoadout
            .map((item: { skillId: string }) => db.getSkill(item.skillId))
            .filter(Boolean);
        }
      }
      const skillsInfo = buildSkillsPrompt(activeSkills);
      let currentDraft = draftContent || "";
      let criticFeedback = "";
      let isValid = false;

      for (let iteration = 0; iteration < maxIter; iteration++) {
        const writerAsset = resolvePromptAssetForSurface({
          surface: draftingSurface,
          promptTemplates: getConfig().promptTemplates,
          preferredTemplateKey: 'orchestrateWriter',
        });
        const writerPrompt = renderPromptTemplate(writerAsset.template, {
          WRITER_SOUL,
          contextStr,
          skillsInfo,
          sceneBeats,
          criticFeedback: criticFeedback || '初稿阶段，请全力输出。',
        });

        res.write(`data: ${JSON.stringify({ type: 'status', message: 'Writer Agent 正在生成正文…' })}\n\n`);
        try {
          currentDraft = await generateText(getConfig(), {
            prompt: writerPrompt,
            ...ORCHESTRATE_WRITER_LLM_OPTIONS,
            signal: clientAbortController.signal,
            novelId,
          });
          currentDraft = ensureMinimumDraftLength(currentDraft, sceneBeats, contextStr);
        } catch (error) {
          logger.warn('Writer generation fell back to local draft', error);
          currentDraft = buildFallbackDraft(sceneBeats, contextStr);
          res.write(`data: ${JSON.stringify({
            type: 'status',
            message: '模型响应过慢，已切换到本地保底草稿，建议稍后重试以获得更完整版本。',
          })}\n\n`);
        }
        contentDelivered = true;
        await emitTextAsTokens(res, currentDraft);
        res.write(`data: ${JSON.stringify({ type: 'writer_done' })}\n\n`);

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
          skillsInfo,
          sceneBeats,
          currentDraft,
        });

        criticFeedback = await generateText(getConfig(), {
          prompt: criticPrompt,
          ...ORCHESTRATE_CRITIC_LLM_OPTIONS,
          signal: clientAbortController.signal,
        });
        isValid = criticFeedback.includes("PASS");
        res.write(`data: ${JSON.stringify({ type: 'critic_done', feedback: criticFeedback, isValid })}\n\n`);

        if (isValid) break;
      }
      if (orchestrateHeartbeat) {
        clearInterval(orchestrateHeartbeat);
        orchestrateHeartbeat = null;
      }

      commitQuotaReservation(reservationId);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err) {
      if (orchestrateHeartbeat) {
        clearInterval(orchestrateHeartbeat);
        orchestrateHeartbeat = null;
      }
      if (!contentDelivered) {
        await refundQuota(reservationId);
      }
      logger.error(String(err));
      res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
      res.end();
    }
  });

  app.post('/api/orchestrate-draft', async (req, res) => {
    let orchestrateHeartbeat: NodeJS.Timeout | null = null;
    const clientAbortController = new AbortController();
    const { novelId } = req.body;
    let reservationId: string | undefined;
    let contentDelivered = false;

    try {
      const {
        contextStr = '',
        sceneBeats = '',
        draftContent = '',
        skills = [],
        draftingSurface = 'workspace-draft',
        chapterOrder,
      } = req.body;

      // ================================================================
      // Quota Gate — atomic reserve before any LLM work
      // ================================================================
      const reserve = await reserveQuota(novelId, 'generateProse');
      if (!reserve.allowed) {
        return res.status(403).json({
          quotaExceeded: true,
          limitType: 'generateProse',
          count: reserve.count,
          max: reserve.max,
          error: reserve.error,
        });
      }

      reservationId = reserve.reservationId;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      req.socket.setTimeout(0);
      orchestrateHeartbeat = setInterval(() => {
        if (!res.writableEnded) {
          res.write(':ping\n\n');
        }
      }, 30_000);

      req.on('close', () => {
        clientAbortController.abort();
        if (orchestrateHeartbeat) {
          clearInterval(orchestrateHeartbeat);
          orchestrateHeartbeat = null;
        }
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

      let activeSkills = skills || [];
      if ((!activeSkills || activeSkills.length === 0) && novelId) {
        const novel = db.getNovel(novelId);
        if (novel && novel.mountedSkillLoadout) {
          activeSkills = novel.mountedSkillLoadout
            .map((item: { skillId: string }) => db.getSkill(item.skillId))
            .filter(Boolean);
        }
      }

      const writerAsset = resolvePromptAssetForSurface({
        surface: draftingSurface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'orchestrateWriter',
      });
      const writerPrompt = renderPromptTemplate(writerAsset.template, {
        WRITER_SOUL,
        contextStr: effectiveContextStr,
        skillsInfo: buildSkillsPrompt(activeSkills),
        sceneBeats,
        criticFeedback: draftContent
          ? `请在已有正文基础上继续扩写，保持承接自然。\n\n【已有正文】\n${draftContent}`
          : '初稿阶段，请全力输出。',
      });

      let text = '';
      try {
        text = await generateText(getConfig(), {
          prompt: writerPrompt,
          ...ORCHESTRATE_WRITER_LLM_OPTIONS,
          signal: clientAbortController.signal,
        });
        text = ensureMinimumDraftLength(text, sceneBeats, effectiveContextStr);
      } catch (error) {
        logger.warn('Writer generation fell back to local draft', error);
        text = buildFallbackDraft(sceneBeats, effectiveContextStr);
        res.write(`data: ${JSON.stringify({
          type: 'status',
          message: '模型响应过慢，已切换到本地保底草稿，建议稍后重试以获得更完整版本。',
        })}\n\n`);
      }

      contentDelivered = true;
      await emitTextAsTokens(res, text);

      if (orchestrateHeartbeat) {
        clearInterval(orchestrateHeartbeat);
        orchestrateHeartbeat = null;
      }

      commitQuotaReservation(reservationId);
      res.write(`data: ${JSON.stringify({
        type: 'done',
        text,
        wordCount: countDraftChars(text),
      })}\n\n`);
      res.end();
    } catch (error) {
      if (orchestrateHeartbeat) {
        clearInterval(orchestrateHeartbeat);
        orchestrateHeartbeat = null;
      }
      if (!contentDelivered) {
        await refundQuota(reservationId);
      }
      logger.error(String(error));
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })}\n\n`);
      res.end();
    }
  });
}
