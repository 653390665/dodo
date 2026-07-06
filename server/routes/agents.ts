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
import { checkQuota, consumeQuota } from '../helpers/quota-guard.js';
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

export function registerAgentsRoutes(app: Express) {
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
      const text = await generateText(getConfig(), {
        prompt,
        systemInstruction: promptAsset.template,
        timeoutMs: 90_000,
        maxAttempts: 2,
        maxTokens: 2048,
      });
      res.json({ text });
    } catch (e) {
      logger.error(String(e));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post('/api/editor-agent', async (req, res) => {
    if (!rateLimit('editor-agent')) return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    try {
      const { userIntent = '', contextStr = '', surface = 'workspace-beats', continuationPackId, chain, chapterOrder } = req.body;
      if (!userIntent.trim()) {
        return res.status(400).json({ error: 'userIntent is required' });
      }

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
            });
            results.push({ module, pass: text.includes('PASS'), text });
          } catch (chainErr) {
            logger.warn(`Chain module ${module} failed`, chainErr);
            results.push({ module, pass: false, text: '' });
          }
        }
        return res.json({ chainResults: results, text: results.map(r => r.text).filter(Boolean).join('\n---\n') });
      }

      const promptAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'editorAgent',
      });
      const prompt = renderPromptTemplate(promptAsset.template, {
        PLANNER_SOUL,
        contextStr: effectiveContextStr,
        userIntent: wrapUserInput(userIntent),
      });
      let text = '';
      try {
        text = await generateText(getConfig(), {
          prompt,
          timeoutMs: 8_000,
          maxAttempts: 1,
          maxTokens: 1600,
        });
      } catch (error) {
        logger.warn('Editor agent fell back', error);
        text = buildFallbackSceneBeats(userIntent);
      }
      res.json({ text });
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

    // Quota Gate — verify free-tier limitations before starting SSE
    const quotaCheck = checkQuota(novelId, 'generateProse');
    if (!quotaCheck.allowed) {
      return res.status(403).json({
        quotaExceeded: true,
        limitType: 'generateProse',
        count: quotaCheck.count,
        max: quotaCheck.max,
        error: quotaCheck.error,
        limitDetails: {
          limitType: 'generateProse',
          count: quotaCheck.count,
          max: quotaCheck.max,
          error: quotaCheck.error,
        }
      });
    }

    const maxIter = Math.min(Math.max(1, Number(maxIterations) || 2), 5);
    let orchestrateHeartbeat: ReturnType<typeof setInterval> | null = null;
    const clientAbortController = new AbortController();

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

      const skillsInfo = buildSkillsPrompt(skills || []);
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
      // 成功生成，消费 1 次额度 (Consume quota count)
      consumeQuota(novelId, 'generateProse');

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err) {
      if (orchestrateHeartbeat) {
        clearInterval(orchestrateHeartbeat);
        orchestrateHeartbeat = null;
      }
      logger.error(String(err));
      res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
      res.end();
    }
  });

  app.post('/api/orchestrate-draft', async (req, res) => {
    try {
      const {
        contextStr = '',
        sceneBeats = '',
        draftContent = '',
        skills = [],
        draftingSurface = 'workspace-draft',
        novelId,
        chapterOrder,
      } = req.body;

      // ================================================================
      // Quota Gate — verify free-tier limitations before LLM run
      // ================================================================
      const quotaCheck = checkQuota(novelId, 'generateProse');
      if (!quotaCheck.allowed) {
        return res.status(403).json({
          quotaExceeded: true,
          limitType: 'generateProse',
          count: quotaCheck.count,
          max: quotaCheck.max,
          error: quotaCheck.error,
        });
      }

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
        skillsInfo: buildSkillsPrompt(skills || []),
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
        });
        text = ensureMinimumDraftLength(text, sceneBeats, effectiveContextStr);
      } catch (error) {
        logger.warn('Writer generation fell back to local draft', error);
        text = buildFallbackDraft(sceneBeats, effectiveContextStr);
      }

      // 成功生成，消费 1 次额度 (Consume quota count)
      consumeQuota(novelId, 'generateProse');

      res.json({
        text,
        wordCount: countDraftChars(text),
      });
    } catch (error) {
      logger.error(String(error));
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
