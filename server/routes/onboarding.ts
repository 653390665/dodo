import type { Express } from 'express';
import { generateText } from '../lib/server-llm';
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
  createStoryCardJob,
  parseStoryCardsFromModel,
  buildFallbackStoryCards,
} from '../helpers/story-cards';
import { validate, storyCardsSchema } from '../validation';

export function registerOnboardingRoutes(app: Express) {
  app.post('/api/story-cards', validate(storyCardsSchema), async (req, res) => {
    if (!rateLimit('story-cards')) return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    try {
      const { ideaSeed: rawSeed = '', chatContext = '', planning = {}, surface = 'welcome', previousHookTexts = [], batchIndex = 0 } = req.body;
      const ideaSeed = sanitizeIdeaSeed(rawSeed) || rawSeed.trim();

      if (!ideaSeed.trim()) {
        return res.status(400).json({ error: 'ideaSeed is required' });
      }
      const seedQuality = assessStorySeedQuality(ideaSeed);
      if (seedQuality.status === 'needs_clarification') {
        return res.status(400).json({
          status: 'needs_clarification',
          error: seedQuality.error,
          questions: seedQuality.questions,
        });
      }
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
      const modelTask = generateText(getConfig(), {
        prompt,
        timeoutMs: STORY_CARD_MODEL_TIMEOUT_MS,
        maxAttempts: 2,
        maxTokens: 2048,
      }).then((raw) => parseStoryCardsFromModel(raw, ideaSeed));

      const jobId = createStoryCardJob(modelTask);

      // Return fallback immediately; model result arrives via job polling
      res.json({
        cards: buildFallbackStoryCards(ideaSeed, planning, batchIndex, previousHookTexts),
        source: 'fallback',
        jobId,
        warnings: ['模型响应较慢，已先生成本地保底开坑方向，后台仍在等待模型版。'],
      });
    } catch (e) {
      logger.error(String(e));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get('/api/story-cards/jobs/:jobId', (req, res) => {
    const job = storyCardJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Story card job not found' });
    }
    res.json(job);
  });

  app.post('/api/setup-task-refine', async (req, res) => {
    try {
      const { taskTitle = '', currentDraft = '', userRequest = '', storyContext = '', surface = 'world-onboarding' } = req.body;
      if (!taskTitle.trim()) {
        return res.status(400).json({ error: 'taskTitle is required' });
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
      const text = await generateText(getConfig(), { prompt, timeoutMs: 90_000, maxAttempts: 2, maxTokens: 2048 });
      try {
        const parsed = JSON.parse(text);
        res.json({ text: parsed.result || text, changedFields: parsed.changedFields, reason: parsed.reason });
      } catch {
        res.json({ text });
      }
    } catch (e) {
      logger.error(String(e));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  interface WorldSetupJob {
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    stageText: string;
    result?: unknown;
    error?: string;
    createdAt: number;
  }

  const worldSetupJobs = new Map<string, WorldSetupJob>();
  const WORLD_SETUP_JOB_TTL_MS = 15 * 60_000; // 15 minutes

  async function runExtractWorldSetupJob(jobId: string, documentText: string) {
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

      const raw = await generateText(getConfig(), {
        prompt,
        timeoutMs: 90_000,
        maxAttempts: 2,
        maxTokens: 4096,
        responseMimeType: 'application/json',
        disableThinking: true,
      });

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
        error: String(e)
      });
    }
  }

  app.get('/api/extract-world-setup/jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = worldSetupJobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  });

  app.post('/api/extract-world-setup', async (req, res) => {
    try {
      const { documentText = '' } = req.body;
      if (!documentText.trim()) {
        return res.status(400).json({ error: 'documentText is required' });
      }

      const jobId = `world-setup-${generateId()}`;
      worldSetupJobs.set(jobId, {
        status: 'pending',
        progress: 10,
        stageText: '正在队列中，准备解析文档...',
        createdAt: Date.now()
      });

      runExtractWorldSetupJob(jobId, documentText).catch(e => {
        logger.error(`Unhandled error in background runExtractWorldSetupJob: ${e}`);
      });

      // TTL cleanup
      setTimeout(() => worldSetupJobs.delete(jobId), WORLD_SETUP_JOB_TTL_MS);

      res.json({ jobId });
    } catch (e) {
      logger.error(String(e));
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
