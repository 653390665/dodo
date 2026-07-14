import type { Express, Response } from 'express';
import { z } from 'zod';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import { resolvePromptAssetForSurface } from '../../shared/lib/prompt-runtime';
import { renderPromptTemplate, wrapUserInput } from '../helpers/prompt-helpers';
import * as db from '../lib/db';
import { buildContinuationContext } from '../../shared/lib/continuation-pack';
import { logger } from '../logger';
import { getPlotBudgetGuidelines } from '../helpers/plot-budget';
import { bindClientDisconnect, isStreamDisconnected } from '../helpers/stream-disconnect';
import {
  getDatabaseGeneration,
  runInSerializedWriteForGeneration,
} from '../lib/db-instance';
import { generateId } from '../id';
import { rateLimit } from '../middleware/rate-limit';
import {
  createLlmExecution,
  LlmExecutionRejectedError,
  type LlmExecutionSession,
} from '../helpers/llm-execution-gate';
import type { QuotaLimitType } from '../helpers/quota-guard';

const shortText = z.string().max(200).default('');
const longText = z.string().max(100_000).default('');
const worldExtractionImportSchema = z.object({
  databaseGeneration: z.number().int().nonnegative(),
  novelId: z.string().min(1).max(200),
  globalOutline: longText,
  worldRules: longText,
  characters: z.array(z.object({
    name: z.string().min(1).max(200),
    role: z.enum(['protagonist', 'antagonist', 'supporting', 'extra']).default('supporting'),
    summary: z.string().max(10_000).default(''),
    bio: longText,
    traits: z.array(z.string().max(200)).max(100).default([]),
  })).max(1000).default([]),
  locations: z.array(z.object({
    name: z.string().min(1).max(200),
    region: shortText,
    description: longText,
  })).max(1000).default([]),
  items: z.array(z.object({
    name: z.string().min(1).max(200),
    type: shortText,
    description: longText,
  })).max(1000).default([]),
  factions: z.array(z.object({
    name: z.string().min(1).max(200),
    leader: shortText,
    territory: shortText,
    description: longText,
  })).max(1000).default([]),
  powerLevels: z.array(z.object({
    name: z.string().min(1).max(200),
    tier: z.coerce.number().int().min(0).max(100_000).default(0),
    characteristics: longText,
    description: longText,
  })).max(1000).default([]),
  timelineEvents: z.array(z.object({
    title: z.string().min(1).max(500),
    timestamp: shortText,
    statusTag: shortText,
    description: longText,
    order: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })).max(5000).default([]),
});

type WorldExtractionImport = z.infer<typeof worldExtractionImportSchema>;
type WorldExtractionContent = Omit<WorldExtractionImport, 'databaseGeneration'>;

export function commitWorldExtraction(
  payload: WorldExtractionContent,
  idFactory: () => string = generateId,
): void {
  const now = Date.now();
  db.runInTransaction(() => {
    if (!db.updateNovel(payload.novelId, {
      globalOutline: payload.globalOutline,
      worldRules: payload.worldRules,
    })) throw new Error('Novel disappeared during world import');

    for (const entity of payload.characters) db.createCharacter({ ...entity, id: idFactory(), novelId: payload.novelId, createdAt: now, updatedAt: now });
    for (const entity of payload.locations) db.createLocation({ ...entity, id: idFactory(), novelId: payload.novelId, createdAt: now, updatedAt: now });
    for (const entity of payload.items) db.createItem({ ...entity, id: idFactory(), novelId: payload.novelId, createdAt: now, updatedAt: now });
    for (const entity of payload.factions) db.createFaction({ ...entity, id: idFactory(), novelId: payload.novelId, createdAt: now, updatedAt: now });
    for (const entity of payload.powerLevels) db.createPowerLevel({ ...entity, id: idFactory(), novelId: payload.novelId, createdAt: now, updatedAt: now });
    for (const entity of payload.timelineEvents) db.createTimelineEvent({ ...entity, id: idFactory(), novelId: payload.novelId, createdAt: now, updatedAt: now });
  });
}

interface PacingInputChapter {
  order?: number;
  title?: string;
  wordCount?: number;
  content?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value != null ? String(value) : '';
}

// ---- Lightweight In-Memory Job Queue / Store ----
interface Job {
  id: string;
  status: 'queueing' | 'running' | 'completed' | 'failed';
  progress: number;
  result?: unknown;
  error?: string;
  createdAt: number;
  databaseGeneration: number;
}

const jobs = new Map<string, Job>();
const jobAbortControllers = new Map<string, AbortController>();
const JOB_TTL = 15 * 60 * 1000; // 15 minutes TTL

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > JOB_TTL) {
      jobAbortControllers.get(id)?.abort(new Error('World job expired'));
      jobAbortControllers.delete(id);
      jobs.delete(id);
    }
  }
}

// Prune old jobs periodically
setInterval(pruneJobs, 60 * 1000).unref();

function createJob(controller: AbortController, databaseGeneration: number): string {
  pruneJobs();
  const id = 'job_' + Math.random().toString(36).substring(2, 15);
  jobs.set(id, {
    id,
    status: 'queueing',
    progress: 10,
    createdAt: Date.now(),
    databaseGeneration,
  });
  jobAbortControllers.set(id, controller);
  return id;
}

function updateJob(id: string, updates: Partial<Omit<Job, 'id' | 'createdAt'>>) {
  const job = jobs.get(id);
  if (job) {
    Object.assign(job, updates);
    if (updates.status === 'completed' || updates.status === 'failed') {
      jobAbortControllers.delete(id);
    }
  }
}

async function prepareWorldLlmExecution(
  res: Response,
  novelId: unknown,
  operation: string,
  quotaType: QuotaLimitType,
  options: { signal?: AbortSignal; timeoutMs?: number; databaseGeneration?: number } = {},
): Promise<LlmExecutionSession | null> {
  if (typeof novelId !== 'string' || !novelId.trim()) {
    res.status(400).json({ error: 'novelId is required' });
    return null;
  }
  try {
    return await createLlmExecution({
      operation,
      novelId,
      quotaType,
      timeoutMs: options.timeoutMs ?? 90_000,
      signal: options.signal,
      concurrency: 2,
      databaseGeneration: options.databaseGeneration,
    });
  } catch (error) {
    if (error instanceof LlmExecutionRejectedError) {
      res.status(error.status).json({
        error: error.message,
        ...(error.status === 429 ? { retryAfter: 5 } : { code: error.quota.code }),
      });
      return null;
    }
    throw error;
  }
}

export function registerWorldRoutes(app: Express) {
  app.post('/api/world/import-extraction', (req, res) => {
    const parsed = worldExtractionImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '导入设定结构无效' });
    }
    const payload = parsed.data;
    if (payload.databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据库已在解析期间切换，请重新导入设定文档' });
    }
    if (!db.getNovel(payload.novelId)) {
      return res.status(404).json({ error: '作品不存在' });
    }
    try {
      commitWorldExtraction(payload);
      return res.json({ success: true });
    } catch (error) {
      logger.error('原子导入设定失败:', error);
      return res.status(500).json({ error: '设定导入失败，未写入任何数据' });
    }
  });

  // GET endpoint to query world background job status
  app.get('/api/world/jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const requestedGeneration = Number(req.query.databaseGeneration);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration !== job.databaseGeneration) {
      return res.status(409).json({ error: 'World job database generation is invalid' });
    }
    if (job.databaseGeneration !== getDatabaseGeneration()) {
      jobAbortControllers.get(job.id)?.abort(new Error('Database replaced during world job'));
      updateJob(job.id, { status: 'failed', progress: 100, error: 'Database replaced during world job' });
      return res.status(409).json({ error: '数据库已在世界任务期间切换，请重试' });
    }
    res.json(job);
  });

  app.post('/api/world/jobs/:jobId/cancel', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const requestedGeneration = Number(req.query.databaseGeneration);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration !== job.databaseGeneration) {
      return res.status(409).json({ error: 'World job database generation is invalid' });
    }
    const controller = jobAbortControllers.get(req.params.jobId);
    if (!controller || job.status === 'completed' || job.status === 'failed') {
      return res.status(409).json({ error: 'Job is not cancellable' });
    }
    controller.abort(new Error('World job cancelled'));
    updateJob(req.params.jobId, { status: 'failed', progress: 100, error: 'Cancelled' });
    return res.json({ cancelled: true });
  });

  app.post('/api/generate-bio', async (req, res) => {
    if (!rateLimit('generate-bio')) {
      return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    }
    let disposeDisconnect = () => {};
    const generateBioSchema = z.object({
      novelId: z.string().trim().min(1).max(200),
      name: z.string().min(1, '角色名称不能为空'),
      role: z.string().optional().default('supporting'),
      summary: z.string().optional().default(''),
      traits: z.array(z.string()).optional().default([]),
      background: z.string().optional(),
      features: z.string().optional(),
      habits: z.string().optional(),
      personality: z.string().optional(),
      inventory: z.string().optional(),
      abilities: z.string().optional(),
      globalOutline: z.string().optional(),
      worldRules: z.string().optional(),
      concealGender: z.boolean().optional().default(false)
    });

    try {
      const parsed = generateBioSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: '请求参数校验失败', details: parsed.error.format() });
      }
      const { novelId, name, role, summary, traits, background, features, habits, personality, inventory, abilities, globalOutline, worldRules, concealGender } = parsed.data;
      const controller = new AbortController();
      const databaseGeneration = getDatabaseGeneration();
      const execution = await prepareWorldLlmExecution(
        res,
        novelId,
        'generate-bio',
        'generateProse',
        { signal: controller.signal, databaseGeneration },
      );
      if (!execution) return;

      const genderConstraint = concealGender
        ? `\n【极其重要的约束：该角色性别为谜，严禁使用"他""她""他的""原她的""他本人""她本人"等任何性别指示代词。一律以角色名"${name}"或"此人""该角色"指代。违反此规则将导致角色设定失败。】\n`
        : '';

      const prompt = `
你是一个专业的创作协助 AI，擅长深度刻画小说角色。
请根据以下碎片的角色信息以及世界观设定，撰写一段富有深度、细节丰富且具有文学色彩的角色背景故事（Biography / 详细背景设定）。

【全局故事大纲】：${wrapUserInput(globalOutline || '无')}
【世界观法则】：${wrapUserInput(worldRules || '无')}

【角色名称】：${wrapUserInput(name)}
【身份定位】：${wrapUserInput(role)}
【核心简介】：${wrapUserInput(summary)}
【性格特质】：${traits?.join('、') || '无'}
${background ? `【背景经历】：${wrapUserInput(background)}` : ''}
${features ? `【外貌特征】：${wrapUserInput(features)}` : ''}
${habits ? `【行为习惯】：${wrapUserInput(habits)}` : ''}
${personality ? `【人格魅力】：${wrapUserInput(personality)}` : ''}
${inventory ? `【随身道具】：${wrapUserInput(inventory)}` : ''}
${abilities ? `【独特能力】：${wrapUserInput(abilities)}` : ''}

${genderConstraint}
要求：
1. 语言精炼且富有张力，适合放在小说设定集中。
2. 不要只是简单罗列信息，要结合"世界观法则"和"主线大纲"通过描述勾勒出一个有血有肉的人物形象，或者为其补充符合世界观的过去经历片段。
3. 重点突出该角色与其身份定位（${role}）相符的独特性。
4. 字数在 200-400 字之间。
5. 直接输出故事内容，不要包含任何前导词（如"好的，这是为您生成的..."）。
      `;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-InkFlow-Database-Generation', String(databaseGeneration));
      req.socket.setTimeout(0);

      disposeDisconnect = bindClientDisconnect(req, res, () => {
        controller.abort();
      });

      await execution.run(async ({ signal }) => {
        await generateText(getConfig(), {
          prompt,
          novelId,
          onToken: (token) => {
            if (databaseGeneration !== getDatabaseGeneration()) {
              controller.abort(new Error('Database changed during bio generation'));
              return;
            }
            if (!isStreamDisconnected(req, res) && !res.writableEnded) {
              res.write(`data: ${JSON.stringify({ token })}\n\n`);
            }
          },
          signal,
        });
        if (
          databaseGeneration !== getDatabaseGeneration()
          || isStreamDisconnected(req, res)
          || res.writableEnded
        ) {
          throw new Error('Client disconnected before bio completion');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    } catch (e) {
      logger.error('Generate bio SSE error:', e);
      if (isStreamDisconnected(req, res) || res.writableEnded) {
        return;
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      } else {
        res.end();
      }
    } finally {
      disposeDisconnect();
    }
  });

  app.post('/api/generate-outline', async (req, res) => {
    if (!rateLimit('generate-outline')) {
      return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    }
    const { novelId, continuationPackId, databaseGeneration } = req.body;
    if (!Number.isInteger(databaseGeneration)) {
      return res.status(400).json({ error: 'databaseGeneration is required' });
    }
    if (databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据库已切换，请重新生成大纲' });
    }
    let continuationPackContext = '';
    if (continuationPackId) {
      const pack = db.getContinuationPack(continuationPackId);
      if (!pack) {
        return res.status(404).json({ error: 'Continuation pack not found' });
      }
      if (pack.novelId !== novelId) {
        return res.status(409).json({ error: 'Continuation pack does not belong to novel' });
      }
      continuationPackContext = buildContinuationContext(pack);
    }
    const jobController = new AbortController();
    const execution = await prepareWorldLlmExecution(res, novelId, 'generate-outline', 'generateProse', {
      signal: jobController.signal,
      databaseGeneration,
    });
    if (!execution) return;
    const jobId = createJob(jobController, databaseGeneration);
    res.json({ jobId, databaseGeneration });

    // Silent background execution
    (async () => {
      try {
        updateJob(jobId, { status: 'running', progress: 50 });
        const { title, worldRules, seedOutline, expectedWordCount, surface = 'workspace-beats', chapterOrder } = req.body;

        const budgetGuidelines = chapterOrder ? getPlotBudgetGuidelines(Number(chapterOrder)) : '';

        const promptAsset = resolvePromptAssetForSurface({
          surface,
          promptTemplates: getConfig().promptTemplates,
          preferredTemplateKey: 'generateOutline',
        });
        const prompt = renderPromptTemplate(promptAsset.template, {
          expectedWordCount,
          title: title ? `小说名称：${title}` : '',
          worldRules: [
            worldRules ? `世界观及设定：${worldRules}` : '',
            continuationPackContext,
            budgetGuidelines,
          ].filter(Boolean).join('\n\n'),
          seedOutline: seedOutline ? `用户的初始构思/种子创意：\n${seedOutline}` : '',
        });

        const outline = await execution.run(({ signal }) => generateText(getConfig(), { prompt, signal, novelId }));
        updateJob(jobId, { status: 'completed', progress: 100, result: { outline } });
      } catch (e) {
        logger.error('Background generate-outline error:', e);
        updateJob(jobId, { status: 'failed', progress: 100, error: String(e) });
      }
    })();
  });

  app.post('/api/extract-entities', async (req, res) => {
    const { novelId, databaseGeneration } = req.body;
    if (!Number.isInteger(databaseGeneration)) {
      return res.status(400).json({ error: 'databaseGeneration is required' });
    }
    if (databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据库已切换，请重新嗅探实体' });
    }
    const jobController = new AbortController();
    const execution = await prepareWorldLlmExecution(res, novelId, 'extract-entities', 'advancedAudit', {
      signal: jobController.signal,
      databaseGeneration,
    });
    if (!execution) return;
    const jobId = createJob(jobController, databaseGeneration);
    res.json({ jobId, databaseGeneration });

    (async () => {
      try {
        updateJob(jobId, { status: 'running', progress: 50 });
        const { text = '', existingNames = [] } = req.body;

        const prompt = `
你是一个极为敏锐的设定集萃取 AI。请阅读下方的网文片段，从中提取所有的专有名词（包括：人物姓名、地点/据点/组织名称、特殊功法/道具/武器名称）。

网文片段：
"""
${text.substring(0, 15000)}
"""

当前数据库中已经存在的实体名称列表（Existing Entities）：
${existingNames && existingNames.length > 0 ? existingNames.join(', ') : '无'}

请仔细比对：
1. 本次片段中出现的名称，如果在"当前存在的实体名称"中，请归入 activeExisting。
2. 本次片段中出现的【新名称】（不在存量列表中），请归入 newEntities，并附带它在文中的简单上下文解释（50字以内）以及猜测的类型（如：character, location, item）。

请严格以 JSON 格式输出，不要包含 markdown 标记：
{
  "activeExisting": ["名字1", "名字2"],
  "newEntities": [
    { "name": "新名字A", "type": "character", "context": "在某酒馆出场的神秘老者大能" }
  ]
}
        `;

        const parsed = await execution.run(async ({ signal }) => {
          let rawText = await generateText(getConfig(), { prompt, signal, novelId });
          rawText = rawText.replace(/```(json)?/g, '').trim();
          try {
            return JSON.parse(rawText) as unknown;
          } catch {
            throw new Error(`AI returned invalid JSON: ${rawText.substring(0, 500)}`);
          }
        });
        updateJob(jobId, { status: 'completed', progress: 100, result: parsed });
      } catch (e) {
        logger.error('Background extract-entities error:', e);
        updateJob(jobId, { status: 'failed', progress: 100, error: String(e) });
      }
    })();
  });

  app.post('/api/detect-foreshadowing', async (req, res) => {
    const { novelId, chapterContent, chapterTitle, existingForeshadowings, databaseGeneration } = req.body;
    if (!chapterContent || typeof chapterContent !== 'string' || !chapterContent.trim()) {
      return res.status(400).json({ error: 'Chapter content is required' });
    }
    if (!Number.isInteger(databaseGeneration)) {
      return res.status(400).json({ error: 'databaseGeneration is required' });
    }
    if (databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据库已切换，请重新检测伏笔' });
    }
    const jobController = new AbortController();
    const execution = await prepareWorldLlmExecution(res, novelId, 'detect-foreshadowing', 'advancedAudit', {
      signal: jobController.signal,
      databaseGeneration,
    });
    if (!execution) return;
    const jobId = createJob(jobController, databaseGeneration);
    res.json({ jobId, databaseGeneration });

    (async () => {
      try {
        updateJob(jobId, { status: 'running', progress: 50 });
        const config = getConfig();
        const prompt = `你是一个小说伏笔分析专家。请阅读以下章节内容，找出其中可能的伏笔埋设点和伏笔回收点。

【已有伏笔列表】：${existingForeshadowings ? JSON.stringify(existingForeshadowings) : '无'}

【章节标题】：${chapterTitle}
【章节内容】：
${chapterContent.substring(0, 15000)}

请分析并输出 JSON 数组，每个元素包含：
- title: 伏笔标题（简短）
- description: 伏笔描述
- type: "planted"（新埋设）或 "payoff"（回收已有伏笔）
- relatedTo: 如果 type 是 payoff，填写对应的已有伏笔标题（或留空）

严格只输出 JSON 数组，不要包含 markdown 标记：
[{"title": "...", "description": "...", "type": "planted", "relatedTo": ""}]`;

        const parsed = await execution.run(async ({ signal }) => {
          let raw = (await generateText(config, { prompt, signal, novelId })).trim();
          raw = raw.replace(/```(json)?/g, '').trim();
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            throw new Error(`AI returned invalid JSON: ${raw.substring(0, 500)}`);
          }
        });
        updateJob(jobId, { status: 'completed', progress: 100, result: parsed });
      } catch (e) {
        logger.error('Background detect-foreshadowing error:', e);
        updateJob(jobId, { status: 'failed', progress: 100, error: String(e) });
      }
    })();
  });

  app.post('/api/analyze-pacing', async (req, res) => {
    const { novelId, chapters, databaseGeneration } = req.body;
    if (!chapters || !Array.isArray(chapters) || chapters.length === 0) {
      return res.status(400).json({ error: 'Chapters array is required' });
    }
    if (!Number.isInteger(databaseGeneration)) {
      return res.status(400).json({ error: 'databaseGeneration is required' });
    }
    if (databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据库已切换，请重新分析节奏' });
    }
    const jobController = new AbortController();
    const execution = await prepareWorldLlmExecution(res, novelId, 'analyze-pacing', 'advancedAudit', {
      signal: jobController.signal,
      databaseGeneration,
    });
    if (!execution) return;
    const jobId = createJob(jobController, databaseGeneration);
    res.json({ jobId, databaseGeneration });

    (async () => {
      try {
        updateJob(jobId, { status: 'running', progress: 50 });
        const config = getConfig();
        const MAX_CHAPTERS = 50;
        const limited = (chapters as PacingInputChapter[]).slice(-MAX_CHAPTERS);
        const chapterList = limited.map((c) =>
          `第${c.order ?? '?'}章「${c.title ?? '无标题'}」(字数:${c.wordCount ?? 0})：${(c.content || '').substring(0, 500)}...`
        ).join('\n---\n');

        const prompt = `你是一个小说节奏分析专家。请对以下章节列表进行节奏诊断。

${chapterList}

请输出 JSON 数组，每个章节一个对象：
[
  {
    "chapterId": "章节 ID",
    "tensionScore": 0-100 的张力评分（冲突强度、悬念密度）,
    "payoffCount": 爽点/爆点数量,
    "emotionLabel": "情绪标签（如：紧张/温馨/压抑/燃/爽/悲）",
    "suggestion": "一句话节奏建议"
  }
]

严格只输出 JSON 数组，不要包含 markdown 标记。`;

        const chapterResults = await execution.run(async ({ signal }) => {
          let raw = (await generateText(config, { prompt, signal, novelId })).trim();
          raw = raw.replace(/```(json)?/g, '').trim();
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            throw new Error(`AI returned invalid JSON: ${raw.substring(0, 500)}`);
          }
        });
        const strandWeave = computeStrandWeave(limited);
        updateJob(jobId, { status: 'completed', progress: 100, result: { chapters: chapterResults, strandWeave } });
      } catch (e) {
        logger.error('Background analyze-pacing error:', e);
        updateJob(jobId, { status: 'failed', progress: 100, error: String(e) });
      }
    })();
  });

  app.post('/api/generate-entity-details', async (req, res) => {
    if (!rateLimit('generate-entity-details')) {
      return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    }
    const { novelId, databaseGeneration } = req.body;
    if (!Number.isInteger(databaseGeneration)) {
      return res.status(400).json({ error: 'databaseGeneration is required' });
    }
    if (databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据库已切换，请重新嗅探实体' });
    }
    const jobController = new AbortController();
    const execution = await prepareWorldLlmExecution(res, novelId, 'generate-entity-details', 'generateProse', {
      signal: jobController.signal,
      databaseGeneration,
    });
    if (!execution) return;
    const jobId = createJob(jobController, databaseGeneration);
    res.json({ jobId, databaseGeneration });

    (async () => {
      try {
        updateJob(jobId, { status: 'running', progress: 50 });
        const { name, type, context } = req.body;

        const prompt = `你是一个网文世界观架构师。系统在一个新章节中扫描到了一个新设定实体，请根据上下文为其生成一份初始的万物词典（World Bible）条目。

实体名称：${name}
初步判断的类型：${type} (可能是人物 character、地点 location、物品 item、概念等，你可以根据上下文自行调整)
提取的上下文：${context}

请严格根据类型输出不同的 JSON 结构（直接输出 JSON，不要 Markdown 标记）：

如果它最可能是【人物 Character】：
{
  "entityType": "character",
  "name": "${name}",
  "role": "supporting",
  "summary": "一句话简介",
  "traits": ["特性1", "特性2"],
  "bio": "根据上下文生成的背景设定补全（100字左右）"
}

如果它最可能是【地点 Location】：
{
  "entityType": "location",
  "name": "${name}",
  "region": "所属区域（根据上下文推理）",
  "description": "详细描述（100字左右）"
}

如果它最可能是【物品/概念 Item/Concept】：
{
  "entityType": "item",
  "name": "${name}",
  "type": "法宝、武器、丹药、功法等",
  "description": "详细描述及功能（100字左右）"
}
`;

        const parsed = await execution.run(async ({ signal }) => {
          let rawText = await generateText(getConfig(), { prompt, signal, novelId });
          rawText = rawText.replace(/```(json)?/g, '').trim();
          try {
            return JSON.parse(rawText) as unknown;
          } catch {
            throw new Error(`AI returned invalid JSON: ${rawText.substring(0, 500)}`);
          }
        });
        updateJob(jobId, { status: 'completed', progress: 100, result: parsed });
      } catch (e) {
        logger.error('Background generate-entity-details error:', e);
        updateJob(jobId, { status: 'failed', progress: 100, error: String(e) });
      }
    })();
  });

  // Update character state after chapter write (silently executed in background)
  app.post('/api/update-character-state', async (req, res) => {
    try {
      const { novelId, chapterContent, databaseGeneration } = req.body;
      if (!novelId || !chapterContent) {
        return res.status(400).json({ error: 'novelId and chapterContent required' });
      }
      if (!Number.isInteger(databaseGeneration)) {
        return res.status(400).json({ error: 'databaseGeneration is required' });
      }
      if (databaseGeneration !== getDatabaseGeneration()) {
        return res.status(409).json({ error: '数据库已切换，请重试角色状态更新' });
      }
      const jobController = new AbortController();
      const execution = await prepareWorldLlmExecution(res, novelId, 'update-character-state', 'advancedAudit', {
        signal: jobController.signal,
        databaseGeneration,
      });
      if (!execution) return;

      const jobId = createJob(jobController, databaseGeneration);

      // Immediately respond with success to unblock client
      res.json({ success: true, jobId, databaseGeneration, message: 'Character state update queued in background' });

      // Silent background Promise execution
      (async () => {
        try {
          updateJob(jobId, { status: 'running', progress: 50 });
          const characters = db.listCharacters(novelId);
          const currentState = characters
            .map((c) => `${c.name}(${c.role}): ${c.current_state || '无记录'}`)
            .join('\n');

          const prompt = `根据本章内容更新已有角色的当前状态。

【已有角色状态】
${wrapUserInput(currentState)}

【本章内容】
${wrapUserInput(chapterContent.slice(0, 8000))}

严格只输出 JSON，不要包含 Markdown：
{"characters":[{"name":"必须与已有角色姓名完全一致","changes":{"状态字段":"最新状态"}}]}`;

          const updatedCount = await execution.run(async ({ signal }) => {
            const raw = await generateText(getConfig(), { prompt, maxTokens: 1024, signal, novelId });
            const cleaned = raw.replace(/```(json)?/g, '').trim();
            let result: unknown;
            try {
              result = JSON.parse(cleaned);
            } catch {
              throw new Error('AI returned invalid character-state JSON');
            }

            const resultRecord = asRecord(result);
            const resultCharacters = asArray(resultRecord.characters);

            const writeResult = await runInSerializedWriteForGeneration(databaseGeneration, () => {
              if (signal.aborted) throw signal.reason || new Error('Character-state job cancelled before write');
              let count = 0;
              for (const updateVal of resultCharacters) {
                const update = asRecord(updateVal);
                const name = stringValue(update.name);
                if (!name) continue;
                const char = characters.find((c) => c.name === name);
                if (char) {
                  db.updateCharacter(char.id, {
                    current_state: JSON.stringify(update.changes),
                  });
                  count++;
                }
              }
              return count;
            });
            if (!writeResult.executed) {
              throw new Error('Character-state write discarded after database replacement');
            }
            return writeResult.result;
          });
          logger.info(`Background update-character-state completed silently. Updated ${updatedCount} characters.`);
          updateJob(jobId, { status: 'completed', progress: 100, result: { updatedCount } });
        } catch (bgErr) {
          logger.error('Background update-character-state task error:', bgErr);
          updateJob(jobId, { status: 'failed', progress: 100, error: String(bgErr) });
        }
      })();
    } catch (e) {
      logger.error('Update character state error:', e);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}

// ---- Strand Weave heuristic ----
export function computeStrandWeave(chapters: PacingInputChapter[]) {
  let questChapters = 0;
  let fireChapters = 0;
  let constellationChapters = 0;
  const breakWarnings: string[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const content = stringValue(chapters[i].content).toLowerCase();
    // Heuristic: keyword-based strand classification
    const hasQuest = /战斗|敌人|追杀|突破|修炼|击败|决斗|秘境/.test(content);
    const hasFire = /感情|拥抱|亲吻|心疼|温柔|微笑|眼神|牵手/.test(content);
    const hasConstellation = /世界|法则|势力|宗门|历史|传说|上古/.test(content);

    if (hasQuest) questChapters++;
    if (hasFire) fireChapters++;
    if (hasConstellation) constellationChapters++;
  }

  const total = chapters.length || 1;
  const questRatio = Math.round((questChapters / total) * 100);
  const fireRatio = Math.round((fireChapters / total) * 100);
  const constellationRatio = Math.round((constellationChapters / total) * 100);

  // Break warnings
  let questStreak = 0;
  let lastFireChapter = -1;
  let lastConstellationChapter = -1;
  for (let i = 0; i < chapters.length; i++) {
    const content = stringValue(chapters[i].content).toLowerCase();
    const hasQuest = /战斗|敌人|追杀|突破/.test(content);
    const hasFire = /感情|拥抱|亲吻|心疼/.test(content);
    const hasConstellation = /世界|法则|势力|历史/.test(content);

    questStreak = hasQuest ? questStreak + 1 : 0;
    if (questStreak === 6) breakWarnings.push(`主线连续 ${questStreak} 章，建议插入感情/世界观线`);

    if (hasFire) lastFireChapter = i;
    if (hasConstellation) lastConstellationChapter = i;

    if (i - lastFireChapter > 10 && lastFireChapter >= 0) {
      breakWarnings.push(`感情线断档超过 10 章（上次出现在第 ${lastFireChapter + 1} 章）`);
      lastFireChapter = i; // reset to avoid repeated warnings
    }
    if (i - lastConstellationChapter > 15 && lastConstellationChapter >= 0) {
      breakWarnings.push(`世界观线断档超过 15 章（上次出现在第 ${lastConstellationChapter + 1} 章）`);
      lastConstellationChapter = i;
    }
  }

  return {
    questRatio,
    fireRatio,
    constellationRatio,
    breakWarnings: [...new Set(breakWarnings)].slice(0, 3),
  };
}
