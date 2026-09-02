import type { Express } from 'express';
import { z } from 'zod';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import { generateId } from '../id';
import { resolvePromptAssetForSurface } from '../../shared/lib/prompt-runtime';
import { renderPromptTemplate, wrapUserInput } from '../helpers/prompt-helpers';
import { rateLimit } from '../middleware/rate-limit';
import { logger } from '../logger';
import { assessStorySeedQuality, sanitizeIdeaSeed } from '../../shared/lib/story-seed';
import {
  STORY_CARD_MODEL_TIMEOUT_MS,
  storyCardJobs,
  storyCardJobAbortControllers,
  createStoryCardJob,
  parseStoryCardsFromModel,
  buildFallbackStoryCards,
} from '../helpers/story-cards';
import {
  validate,
  setupTaskRefineSchema,
  storyCardsSchema,
  worldSetupExtractSchema,
} from '../validation';
import { createLlmExecution, LlmExecutionRejectedError, type LlmExecutionSession } from '../helpers/llm-execution-gate';
import { bindClientDisconnect } from '../helpers/stream-disconnect';
import { consumeOnboardingLlmSession, issueOnboardingLlmSession } from '../helpers/onboarding-llm-session';
import { getDatabaseGeneration } from '../lib/db-instance';
import { safeJobError } from '../helpers/job-error';

const storyCardsRequestSchema = storyCardsSchema.extend({
  databaseGeneration: z.number().int().nonnegative(),
});
const setupTaskRefineRequestSchema = setupTaskRefineSchema.extend({
  databaseGeneration: z.number().int().nonnegative(),
});

export function registerOnboardingRoutes(app: Express) {
  app.post('/api/onboarding/llm-session', (_req, res) => {
    if (!rateLimit('onboarding-llm-session')) return res.status(429).json({ error: '新手引导请求过于频繁，请稍后再试。', retryAfter: 5 });
    const operation = _req.body?.operation;
    if (operation !== 'story-cards' && operation !== 'inspiration') {
      return res.status(400).json({ error: '新手引导模型操作无效，请重新打开当前流程。' });
    }
    const grant = issueOnboardingLlmSession(operation);
    if (!grant.allowed) return res.status(grant.status).json({ error: grant.error });
    return res.status(201).json(grant);
  });

  app.post('/api/story-cards', validate(storyCardsRequestSchema), async (req, res) => {
    if (!rateLimit('story-cards')) return res.status(429).json({ error: '故事卡生成请求过于频繁，请稍后再试。', retryAfter: 5 });
    try {
      const { onboardingSessionId, ideaSeed: rawSeed = '', chatContext = '', planning = {}, surface = 'welcome', previousHookTexts = [], batchIndex = 0, databaseGeneration: requestedGeneration } = req.body;
      const ideaSeed = sanitizeIdeaSeed(rawSeed) || rawSeed.trim();

      if (!ideaSeed.trim()) {
        return res.status(400).json({ error: '请先输入故事创意，再生成故事卡。' });
      }
      const seedQuality = assessStorySeedQuality(ideaSeed);
      if (seedQuality.status === 'needs_clarification') {
        return res.status(400).json({
          status: 'needs_clarification',
          error: seedQuality.error,
          questions: seedQuality.questions,
        });
      }
      const databaseGeneration = requestedGeneration;
      if (databaseGeneration !== getDatabaseGeneration()) {
        return res.status(409).json({ error: '数据库已切换，请刷新后重试', code: 'DATABASE_GENERATION_MISMATCH' });
      }
      const session = consumeOnboardingLlmSession(onboardingSessionId, 'story-cards');
      if (!session.allowed) return res.status(session.status).json({ error: session.error });
      const promptAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'storyCards',
      });
      const prompt = renderPromptTemplate(promptAsset.template, {
        ideaSeed: wrapUserInput(ideaSeed),
        chatContext,
        expectedWordCount: planning.expectedWordCount || 180000,
        storyFocus:
          planning.storyFocus === 'character'
            ? '人物关系'
            : planning.storyFocus === 'world'
              ? '世界设定'
              : '剧情推进',
        pacingPreference:
          planning.pacingPreference === 'slow-burn'
            ? '慢热铺陈'
            : planning.pacingPreference === 'balanced'
              ? '均衡推进'
              : '紧推进',
      });
      // Story cards are created before a novel exists. Keep this explicit
      // non-quota exception inside the same cancellation/concurrency gate.
      const jobController = new AbortController();
      const execution = await createLlmExecution({
        operation: 'onboarding-story-cards',
        novelId: undefined,
        timeoutMs: STORY_CARD_MODEL_TIMEOUT_MS,
        concurrency: 2,
        signal: jobController.signal,
        databaseGeneration,
      });
      const modelTask = execution.run(({ signal }) =>
        generateText(getConfig(), {
          prompt,
          signal,
          timeoutMs: STORY_CARD_MODEL_TIMEOUT_MS,
          maxAttempts: 2,
          maxTokens: 2048,
        }).then((raw) => parseStoryCardsFromModel(raw, ideaSeed)));

      const jobId = createStoryCardJob(modelTask, jobController);

      // Return fallback immediately; model result arrives via job polling
      res.json({
        cards: buildFallbackStoryCards(ideaSeed, planning, batchIndex, previousHookTexts),
        source: 'fallback',
        jobId,
        warnings: ['模型响应较慢，已先生成本地保底开坑方向，后台仍在等待模型版。'],
      });
    } catch (e) {
      logger.error(String(e));
      res.status(500).json({ error: '故事卡生成失败，请稍后重试。' });
    }
  });

  app.get('/api/story-cards/jobs/:jobId', (req, res) => {
    const job = storyCardJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: '故事卡任务不存在或已过期，请重新生成。' });
    }
    res.json(job);
  });

  app.post('/api/story-cards/jobs/:jobId/cancel', (req, res) => {
    const job = storyCardJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: '故事卡任务不存在或已过期，请重新生成。' });
    const controller = storyCardJobAbortControllers.get(req.params.jobId);
    if (!controller || job.status !== 'pending') return res.status(409).json({ error: '当前故事卡任务不能取消。' });
    controller.abort(new Error('故事卡任务已取消。'));
    storyCardJobAbortControllers.delete(req.params.jobId);
    storyCardJobs.set(req.params.jobId, { status: 'failed', createdAt: Date.now(), error: '故事卡任务已取消。' });
    return res.json({ cancelled: true });
  });

  app.post('/api/setup-task-refine', validate(setupTaskRefineRequestSchema), async (req, res) => {
    const controller = new AbortController();
    const disposeDisconnect = bindClientDisconnect(req, res, () => controller.abort());
    try {
      const { novelId, taskTitle = '', currentDraft = '', userRequest = '', storyContext = '', surface = 'world-onboarding', databaseGeneration: requestedGeneration } = req.body;
      if (!taskTitle.trim()) {
        return res.status(400).json({ error: '请先选择要完善的设定任务。' });
      }
      const databaseGeneration = requestedGeneration;
      if (databaseGeneration !== getDatabaseGeneration()) {
        return res.status(409).json({ error: '数据库已切换，请刷新后重试', code: 'DATABASE_GENERATION_MISMATCH' });
      }
      const promptAsset = resolvePromptAssetForSurface({
        surface,
        promptTemplates: getConfig().promptTemplates,
        preferredTemplateKey: 'setupTaskRefine',
      });
      const prompt = renderPromptTemplate(promptAsset.template, {
        taskTitle,
        currentDraft,
        userRequest: wrapUserInput(userRequest),
        storyContext,
      });
      const execution = await createLlmExecution({
        operation: 'onboarding-setup-task-refine',
        novelId,
        quotaType: 'generateProse',
        accessContext: 'basic-byok',
        timeoutMs: 90_000,
        concurrency: 2,
        signal: controller.signal,
        databaseGeneration,
      });
      const text = await execution.run(({ signal }) =>
        generateText(getConfig(), {
          prompt,
          signal,
          timeoutMs: 90_000,
          maxAttempts: 2,
          // Refine returns JSON that gets parsed; pin thinking off and give
          // headroom so reasoning-heavy models don't truncate the payload.
          maxTokens: 4000,
          disableThinking: true,
        }));
      try {
        const parsed = JSON.parse(text);
        res.json({ text: parsed.result || text, changedFields: parsed.changedFields, reason: parsed.reason });
      } catch {
        res.json({ text });
      }
    } catch (e) {
      if (e instanceof LlmExecutionRejectedError && !res.headersSent) {
        return res.status(e.status).json({ error: e.message, code: e.quota.code });
      }
      logger.error(String(e));
      if (!res.writableEnded) res.status(500).json({ error: '设定任务润色失败，请稍后重试。' });
    } finally {
      disposeDisconnect();
    }
  });

  interface WorldSetupJob {
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    stageText: string;
    result?: unknown;
    error?: string;
    createdAt: number;
    databaseGeneration: number;
  }

  const worldSetupJobs = new Map<string, WorldSetupJob>();
  const worldSetupJobAbortControllers = new Map<string, AbortController>();
  const WORLD_SETUP_JOB_TTL_MS = 15 * 60_000; // 15 minutes

  async function runExtractWorldSetupJob(
    jobId: string,
    documentText: string,
    novelId: string,
    execution: LlmExecutionSession,
  ) {
    const updateJob = (updates: Partial<WorldSetupJob>) => {
      const current = worldSetupJobs.get(jobId);
      if (current) {
        worldSetupJobs.set(jobId, { ...current, ...updates });
      }
    };

    try {
      updateJob({
        status: 'processing',
        progress: 30,
        stageText: '正在分析设定并提取关键名词元素...'
      });

      // Limit characters to avoid API contextual window blowup or slow processing
      const slicedText = documentText.slice(0, 80000);

      const prompt = `
你是一个世界观与设定提取分析师。
请阅读下面用户上传的小说设定文档/大纲，并提取出标准化的结构数据。
必须输出为合法的 JSON 格式，不要包含任何 json 代码块标记（如 \`\`\`json ），直接输出纯 JSON 字符串。

期望的 JSON 结构如下：
{
  "globalOutline": "提取的整体故事大纲（如果没有，则根据已有线索总结，如果完全没有则为空字符串）",
  "worldRules": "提取的世界观法则、力量体系等（如果没有则为空字符串）",
  "characters": [
    {
      "name": "角色名",
      "role": "protagonist" | "antagonist" | "supporting" | "extra",
      "summary": "一句话简介",
      "bio": "详细背景设定、性格",
      "traits": ["词条1", "词条2"]
    }
  ],
  "locations": [
    {
      "name": "地点名",
      "region": "所属势力/区域",
      "description": "详细描述"
    }
  ],
  "items": [
    {
      "name": "道具/物品名",
      "type": "类型(如法宝、科技造物等)",
      "description": "功能与外貌描述"
    }
  ],
  "timelineEvents": [
    {
      "title": "事件名称",
      "timestamp": "发生时间",
      "description": "事件详情",
      "statusTag": "已发生",
      "order": 1
    }
  ]
}

【设定文档内容】：
${slicedText}
      `;

      updateJob({
        progress: 50,
        stageText: 'AI 正在结构化生成世界观、角色与时间线卡片...'
      });

      // World setup extraction also happens before the project is persisted.
      const raw = await execution.run(({ signal }) =>
        generateText(getConfig(), {
          prompt,
          signal,
          timeoutMs: 90_000,
          maxAttempts: 2,
          maxTokens: 4096,
          responseMimeType: 'application/json',
          disableThinking: true,
          novelId,
        }));

      updateJob({
        progress: 85,
        stageText: '正在校验并融合设定集合数据...'
      });

      const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      const resultJson = JSON.parse(cleaned);

      updateJob({
        status: 'completed',
        progress: 100,
        stageText: '设定提取完成！',
        result: resultJson
      });
    } catch (e) {
      logger.error(`Error in runExtractWorldSetupJob: ${e}`);
      updateJob({
        status: 'failed',
        progress: 100,
        stageText: '设定提取失败',
        error: `WORLD_SETUP_FAILED: ${safeJobError(e, '设定提取失败，请稍后重试。')}`
      });
    } finally {
      worldSetupJobAbortControllers.delete(jobId);
    }
  }

  app.get('/api/extract-world-setup/jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = worldSetupJobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: '设定提取任务不存在或已过期，请重新提交。' });
    }
    const requestedGeneration = Number(req.query.databaseGeneration);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration !== job.databaseGeneration) {
      return res.status(409).json({ error: '设定提取任务状态已过期，请重新提交。' });
    }
    if (job.databaseGeneration !== getDatabaseGeneration()) {
      worldSetupJobAbortControllers.get(jobId)?.abort(new Error('数据库已在设定提取任务期间切换。'));
      worldSetupJobAbortControllers.delete(jobId);
      worldSetupJobs.set(jobId, {
        ...job,
        status: 'failed',
        progress: 100,
        stageText: '数据库已切换',
        error: '数据库已在设定提取任务期间切换，请重新提交。',
      });
      return res.status(409).json({ error: '数据库已在设定提取任务期间切换，请重新提交。' });
    }
    res.json(job);
  });

  app.post('/api/extract-world-setup/jobs/:jobId/cancel', (req, res) => {
    const job = worldSetupJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: '设定提取任务不存在或已过期，请重新提交。' });
    const requestedGeneration = Number(req.query.databaseGeneration);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration !== job.databaseGeneration) {
      return res.status(409).json({ error: '设定提取任务状态已过期，请重新提交。' });
    }
    const controller = worldSetupJobAbortControllers.get(req.params.jobId);
    if (!controller || job.status === 'completed' || job.status === 'failed') {
      return res.status(409).json({ error: '当前设定提取任务不能取消。' });
    }
    controller.abort(new Error('设定提取任务已取消。'));
    worldSetupJobAbortControllers.delete(req.params.jobId);
    worldSetupJobs.set(req.params.jobId, { ...job, status: 'failed', progress: 100, stageText: '已取消', error: '设定提取任务已取消。' });
    return res.json({ cancelled: true });
  });

  app.post('/api/extract-world-setup', validate(worldSetupExtractSchema), async (req, res) => {
    try {
      const { novelId, documentText = '' } = req.body;
      if (!documentText.trim()) {
        return res.status(400).json({ error: '请先粘贴或上传设定资料，再开始提取。' });
      }

      const jobController = new AbortController();
      const databaseGeneration = getDatabaseGeneration();
      const execution = await createLlmExecution({
        operation: 'onboarding-world-setup',
        novelId,
        quotaType: 'advancedAudit',
        timeoutMs: 90_000,
        concurrency: 1,
        signal: jobController.signal,
        databaseGeneration,
      });
      const jobId = `world-setup-${generateId()}`;
      worldSetupJobs.set(jobId, {
        status: 'pending',
        progress: 10,
        stageText: '正在队列中，准备解析文档...',
        createdAt: Date.now(),
        databaseGeneration,
      });
      worldSetupJobAbortControllers.set(jobId, jobController);

      runExtractWorldSetupJob(jobId, documentText, novelId, execution).catch(e => {
        logger.error(`Unhandled error in background runExtractWorldSetupJob: ${e}`);
      });

      // TTL cleanup
      const cleanupTimer = setTimeout(() => {
        worldSetupJobAbortControllers.get(jobId)?.abort(new Error('设定提取任务已过期，请重新提交。'));
        worldSetupJobAbortControllers.delete(jobId);
        worldSetupJobs.delete(jobId);
      }, WORLD_SETUP_JOB_TTL_MS);
      cleanupTimer.unref();

      res.json({ jobId, databaseGeneration });
    } catch (e) {
      if (e instanceof LlmExecutionRejectedError) {
        return res.status(e.status).json({ error: e.message, code: e.quota.code });
      }
      logger.error(String(e));
      res.status(500).json({ error: '设定提取启动失败，请稍后重试。' });
    }
  });
}
