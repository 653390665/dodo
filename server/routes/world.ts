import type { Express, Response } from 'express';
import { z } from 'zod';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import { resolvePromptAssetForSurface } from '../../shared/lib/prompt-runtime';
import { renderPromptTemplate, wrapUserInput } from '../helpers/prompt-helpers';
import * as db from '../lib/db';
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
import { resolveProjectExecutionContract, WritingStyleRequestError } from '../helpers/writing-style-service.js';
import { capabilityManifestFor } from '../capabilities/manifest.js';
import { selectOutlineSource, OutlineSourceSelectionError } from '../capabilities/outline-source.js';
import type { OutlineSourceSelection } from '../../shared/types/outline-source.js';
import { resolveCuratedTechniquePrompt } from '../helpers/curated-skill-runtime.js';
import { previewArtifactCandidate } from '../helpers/creative-artifact-candidates.js';
import { buildCharacterCandidateInput } from '../helpers/character-candidates.js';
import { fingerprintCreativeArtifact } from '../../shared/lib/creative-artifact-fingerprint.js';
import { emptyWorldCore, normalizeWorldCore } from '../../shared/lib/world-core.js';
import { buildNarrativePromiseImpacts } from '../../shared/lib/narrative-promise.js';
import { safeJobError } from '../helpers/job-error';

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

const outlineGenerationSchema = z.object({
  novelId: z.string().min(1).max(200),
  continuationPackId: z.string().min(1).max(200).optional(),
  databaseGeneration: z.number().int().nonnegative(),
  title: z.string().max(500).default(''),
  worldRules: z.string().max(100_000).default(''),
  seedOutline: z.string().max(100_000).default(''),
  expectedWordCount: z.coerce.number().int().min(1).max(3_000_000).default(180_000),
  surface: z.enum([
    'welcome',
    'world-onboarding',
    'workspace-beats',
    'workspace-draft',
    'chapter-polish',
    'chapter-review',
  ]).default('workspace-beats'),
  chapterOrder: z.coerce.number().int().min(0).max(1_000_000).optional(),
  sessionCardIds: z.array(z.string().min(1).max(200)).max(6).default([]),
  techniqueId: z.string().min(1).max(200).optional(),
  characterId: z.string().min(1).max(200).optional(),
  outlineSourceSelection: z.object({
    continuationPackId: z.string().min(1).max(200),
    primaryDocumentId: z.string().min(1).max(200),
    referenceDocumentIds: z.array(z.string().min(1).max(200)).max(5).default([]),
  }).optional(),
});

const OUTLINE_DOCUMENT_CHAR_BUDGET = 100_000;
const OUTLINE_TOTAL_CHAR_BUDGET = 180_000;
const ACTIVE_OUTLINE_CHAR_BUDGET = 60_000;
const OUTLINE_MAX_TOKENS = 8_192;

type WorldExecutionStage = 'planner' | 'writer' | 'critic';
type WorldExecutionContract = ReturnType<typeof resolveProjectExecutionContract>;

function worldLlmRejectionMessage(operation: string, error: LlmExecutionRejectedError): string {
  if (error.quota.code !== 'RATE_LIMITED') return error.message;
  switch (operation) {
    case 'generate-bio':
      return '人物小传生成请求过于频繁，请稍后再试。';
    case 'generate-outline':
      return '大纲生成请求过于频繁，请稍后再试。';
    case 'extract-entities':
      return '实体嗅探请求过于频繁，请稍后再试。';
    case 'detect-foreshadowing':
      return '伏笔检测请求过于频繁，请稍后再试。';
    case 'analyze-pacing':
      return '节奏分析请求过于频繁，请稍后再试。';
    case 'generate-entity-details':
      return '设定详情生成请求过于频繁，请稍后再试。';
    case 'update-character-state':
      return '角色状态更新请求过于频繁，请稍后再试。';
    default:
      return '世界观能力请求过于频繁，请稍后再试。';
  }
}

function withExecutionStagePrompt(contract: WorldExecutionContract, stage: WorldExecutionStage, prompt: string): string {
  const stagePrompt = contract.stagePrompts[stage];
  return stagePrompt
    ? `【InkFlow ${stage} 阶段执行合同】\n${stagePrompt}\n\n${prompt}`
    : prompt;
}

function buildOutlineContext(seedOutline: string, worldRules: string, continuationPackContext: string) {
  let remaining = OUTLINE_TOTAL_CHAR_BUDGET;
  const take = (text: string) => {
    const bounded = text.slice(0, OUTLINE_DOCUMENT_CHAR_BUDGET);
    const selected = bounded.slice(0, remaining);
    remaining -= selected.length;
    return selected;
  };

  const selectedOutline = take(seedOutline);
  const world = take(worldRules);
  const pack = take(continuationPackContext);
  return {
    seedOutline: selectedOutline,
    worldRules: [world, pack].filter(Boolean).join('\n\n'),
  };
}

function buildOpenForeshadowingContext(novelId: string, chapterOrder?: number): string {
  const entries = db.listForeshadowings(novelId).filter((entry) => entry.status !== 'payoff');
  if (!entries.length) return '';
  return entries.map((entry) => {
    const narrativeCore = entry.narrativeCore;
    const plan = narrativeCore?.plan;
    const impacts = narrativeCore && chapterOrder !== undefined
      ? buildNarrativePromiseImpacts(narrativeCore, chapterOrder)
      : [];
    const plannedAction = impacts.find((impact) => impact.status === 'due')?.action
      || impacts.find((impact) => impact.status === 'overdue')?.action
      || '';
    const payoff = plan?.plannedPayoffRange
      ? `计划回收区间：${plan.plannedPayoffRange.from}-${plan.plannedPayoffRange.to}`
      : '';
    const hint = plan?.plannedHintRanges?.length
      ? `计划提示区间：${plan.plannedHintRanges.map((range) => `${range.from}-${range.to}`).join(',')}`
      : '';
    const constraint = plan?.revealConstraint || '';
    return `- ${entry.title}（${entry.id}）${plannedAction ? `；plannedAction=${plannedAction}` : ''}：${entry.description}${plan?.intent ? `；意图：${plan.intent}` : ''}${hint ? `；${hint}` : ''}${payoff ? `；${payoff}` : ''}${constraint ? `；揭示约束：${constraint}` : ''}`;
  }).join('\n');
}

function buildActiveOutlineContext(novelId: string, chapterOrder?: number): string {
  const active = db.listOutlineArtifacts(novelId, { status: 'active' });
  const chapter = chapterOrder === undefined
    ? undefined
    : db.listChaptersMetadata(novelId).find((item) => item.order === chapterOrder);
  const seen = new Set<string>();
  let remaining = ACTIVE_OUTLINE_CHAR_BUDGET;
  const sections: string[] = [];
  for (const artifact of active) {
    const matches = artifact.level === 'master'
      || (artifact.level === 'chapter' && chapterOrder !== undefined
        && artifact.scope.chapterStart !== undefined
        && artifact.scope.chapterEnd !== undefined
        && chapterOrder >= artifact.scope.chapterStart
        && chapterOrder <= artifact.scope.chapterEnd)
      || (artifact.level === 'volume' && chapter?.volumeName
        && artifact.scope.volumeName === chapter.volumeName);
    if (!matches || !artifact.content || seen.has(artifact.content) || remaining <= 0) continue;
    seen.add(artifact.content);
    const selected = artifact.content.slice(0, remaining);
    remaining -= selected.length;
    sections.push(`【当前作品生效${artifact.level === 'master' ? '主' : artifact.level === 'volume' ? '卷' : '章节'}纲】\n${selected}`);
  }
  return sections.join('\n\n');
}

function isLikelyTruncatedOutline(text: string): boolean {
  return /[,:;，；：、([{【]$/.test(text) || /```[^`]*$/.test(text);
}

function outlineFailure(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function parseCandidateObject(raw: string): Record<string, unknown> | undefined {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned.startsWith('{')) return undefined;
  try {
    const value: unknown = JSON.parse(cleaned);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function worldCandidateInput(novelId: string, rawOutput: string) {
  const current = db.getArtifactCore(novelId, 'world', novelId);
  const parsed = parseCandidateObject(rawOutput);
  const core = normalizeWorldCore(parsed?.core ?? parsed ?? emptyWorldCore());
  const content = parsed && typeof parsed.proposedContent === 'string'
    ? parsed.proposedContent.trim()
    : parsed ? undefined : rawOutput.trim();
  const outlines = db.listOutlineArtifacts(novelId, { status: 'active' }).map((artifact) => ({
    kind: artifact.level === 'master' ? 'master-outline' as const : artifact.level === 'volume' ? 'volume-outline' as const : 'chapter-outline' as const,
    id: artifact.id,
    version: artifact.version ?? 1,
  }));
  const relationships = db.listEntityRelationships(novelId);
  const promises = db.listForeshadowings(novelId);
  const manifest = capabilityManifestFor('bible-world-builder');
  return {
    novelId,
    target: { kind: 'world' as const, id: novelId, version: current?.version ?? 0 },
    operation: 'generate' as const,
    goal: '完善世界观结构化设定并保留作者可读内容',
    baseFingerprint: fingerprintCreativeArtifact({
      kind: 'world', version: current?.version ?? 0, core: current?.core, content: current?.readableContent,
    }),
    sourceCapabilityVersions: [{ capabilityId: 'bible-world-builder', version: manifest?.version ?? '3' }],
    proposedCore: core as unknown as Record<string, unknown>,
    ...(content ? { proposedContent: content } : {}),
    impactReport: {
      downstream: outlines,
      reviewRequired: [
        ...outlines,
        ...promises.map((item) => ({ kind: 'narrative-promise' as const, id: item.id, version: item.coreVersion ?? 1 })),
      ],
      affectedEntities: [
        ...relationships.map((item) => ({ kind: 'relationship' as const, id: item.id, reviewRequired: true })),
        ...promises.map((item) => ({ kind: 'narrative-promise' as const, id: item.id, reviewRequired: true })),
      ],
      manuscriptConflict: false,
      reasons: [
        'world changes can affect active outline nodes',
        relationships.length ? 'world changes can affect existing relationships' : 'no existing relationship is available',
        promises.length ? 'world changes can affect narrative promises' : 'no narrative promise is available',
      ],
    },
  };
}

function governedBibleOutputPrompt(kind: 'world' | 'character' | undefined): string {
  if (kind === 'world') {
    return '只输出 JSON 对象：{"core":{"schemaVersion":1,"hardRules":[{"id":"rule-1","statement":"明确规则"}],"powerConstraints":[{"id":"power-1","statement":"力量限制","cost":"代价"}],"prohibitions":[{"id":"ban-1","statement":"禁止事项"}],"factionConstraints":[{"id":"faction-1","factionId":"已有势力ID或名称","statement":"势力约束"}]},"proposedContent":"作者可读的世界观说明"}。只写输入中有依据的字段；无依据使用空数组或空字符串，不得输出 Markdown。';
  }
  if (kind === 'character') {
    return '只输出 JSON 对象：{"core":{"schemaVersion":1,"desire":"","externalGoal":"","internalNeed":"","fear":"","woundOrFalseBelief":"","strengths":[],"flaws":[],"contradictions":[],"speechPattern":"","habitualActions":[],"decisionPattern":"","relationshipTensions":[],"arc":{"start":"","turns":[],"target":""},"immutableFacts":[]},"proposedContent":"作者可读的人物设定说明"}。只写输入中有依据的字段；无依据保持空值，不得输出 Markdown。';
  }
  return '';
}

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

// Per-route payload schemas: these fields were previously read ad hoc inside
// background jobs where a malformed type could only fail late (after quota
// reservation). novelId/databaseGeneration keep their dedicated checks so the
// existing error contracts stay unchanged.
const extractEntitiesPayloadSchema = z.object({
  text: z.string().optional().default(''),
  existingNames: z.array(z.string()).optional().default([]),
});

const detectForeshadowingPayloadSchema = z.object({
  chapterContent: z.string().trim().min(1),
  chapterTitle: z.string().optional().default(''),
  existingForeshadowings: z.array(z.unknown()).optional(),
});

const pacingChapterSchema = z.object({
  order: z.number().optional(),
  title: z.string().optional(),
  wordCount: z.number().optional(),
  content: z.string().optional(),
});
const analyzePacingPayloadSchema = z.object({
  chapters: z.array(pacingChapterSchema).min(1),
});

const generateEntityDetailsPayloadSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  context: z.string().optional().default(''),
});

const updateCharacterStatePayloadSchema = z.object({
  novelId: z.string().min(1),
  chapterContent: z.string().min(1),
});

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
      jobAbortControllers.get(id)?.abort(new Error('世界观任务已过期，请重新提交。'));
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
  options: { signal?: AbortSignal; timeoutMs?: number; databaseGeneration?: number; executionContract?: WorldExecutionContract } = {},
): Promise<(LlmExecutionSession & { executionContract: WorldExecutionContract }) | null> {
  if (typeof novelId !== 'string' || !novelId.trim()) {
    res.status(400).json({ error: '请先选择作品，再使用世界观能力。' });
    return null;
  }
  try {
    if (options.databaseGeneration !== undefined && options.databaseGeneration !== getDatabaseGeneration()) {
      throw new WritingStyleRequestError(409, 'DATABASE_GENERATION_MISMATCH', '数据库已切换，请刷新后重试');
    }
    // Resolve the immutable prompt contract before quota reservation and reuse it for the request.
    const executionContract = options.executionContract
      || resolveProjectExecutionContract(novelId, { databaseGeneration: options.databaseGeneration });
    const execution = await createLlmExecution({
      operation,
      novelId,
      quotaType,
      timeoutMs: options.timeoutMs ?? 90_000,
      signal: options.signal,
      concurrency: 2,
      databaseGeneration: options.databaseGeneration,
    });
    return Object.assign(execution, { executionContract });
  } catch (error) {
    if (error instanceof WritingStyleRequestError) {
      res.status(error.status).json({ code: error.code, error: error.message });
      return null;
    }
    if (error instanceof LlmExecutionRejectedError) {
      res.status(error.status).json({
        error: worldLlmRejectionMessage(operation, error),
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
      return res.status(404).json({ error: '世界观任务不存在或已过期，请重新提交。' });
    }
    const requestedGeneration = Number(req.query.databaseGeneration);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration !== job.databaseGeneration) {
      return res.status(409).json({ error: '世界观任务状态已过期，请重新提交。' });
    }
    if (job.databaseGeneration !== getDatabaseGeneration()) {
      jobAbortControllers.get(job.id)?.abort(new Error('数据库已在世界观任务期间切换。'));
      updateJob(job.id, { status: 'failed', progress: 100, error: '数据库已在世界观任务期间切换，请重新提交。' });
      return res.status(409).json({ error: '数据库已在世界观任务期间切换，请重新提交。' });
    }
    res.json(job);
  });

  app.post('/api/world/jobs/:jobId/cancel', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: '世界观任务不存在或已过期，请重新提交。' });
    const requestedGeneration = Number(req.query.databaseGeneration);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration !== job.databaseGeneration) {
      return res.status(409).json({ error: '世界观任务状态已过期，请重新提交。' });
    }
    const controller = jobAbortControllers.get(req.params.jobId);
    if (!controller || job.status === 'completed' || job.status === 'failed') {
      return res.status(409).json({ error: '当前世界观任务不能取消。' });
    }
    controller.abort(new Error('世界观任务已取消。'));
    updateJob(req.params.jobId, { status: 'failed', progress: 100, error: '世界观任务已取消。' });
    return res.json({ cancelled: true });
  });

  app.post('/api/generate-bio', async (req, res) => {
    if (!rateLimit('generate-bio')) {
      return res.status(429).json({ error: '人物小传生成请求过于频繁，请稍后再试。', retryAfter: 5 });
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
      concealGender: z.boolean().optional().default(false),
      databaseGeneration: z.number().int().nonnegative(),
    });

    try {
      const parsed = generateBioSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: '请求参数校验失败', details: parsed.error.format() });
      }
      const { novelId, name, role, summary, traits, background, features, habits, personality, inventory, abilities, globalOutline, worldRules, concealGender, databaseGeneration: requestedGeneration } = parsed.data;
      const controller = new AbortController();
      const databaseGeneration = requestedGeneration;
      if (databaseGeneration !== getDatabaseGeneration()) {
        return res.status(409).json({ error: '数据库已切换，请刷新后重试', code: 'DATABASE_GENERATION_MISMATCH' });
      }
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

      const prompt = withExecutionStagePrompt(execution.executionContract, 'writer', `
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
      `);

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
              controller.abort(new Error('数据库已在人物小传生成期间切换。'));
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
        res.status(500).json({ error: '人物小传生成失败，请稍后重试。' });
      } else {
        res.end();
      }
    } finally {
      disposeDisconnect();
    }
  });

  app.post('/api/generate-outline', async (req, res) => {
    if (!rateLimit('generate-outline')) {
      return res.status(429).json({ error: '大纲生成请求过于频繁，请稍后再试。', retryAfter: 5 });
    }
    const parsed = outlineGenerationSchema.safeParse(req.body);
    if (!parsed.success) {
      const hasOversizedContext = parsed.error.issues.some((issue) =>
        issue.path[0] === 'seedOutline' || issue.path[0] === 'worldRules');
      return res.status(400).json({
        error: hasOversizedContext ? '输入资料过长，请缩短大纲或资料后重试' : '大纲生成参数无效',
      });
    }
    const input = parsed.data;
    const { novelId, continuationPackId, databaseGeneration, sessionCardIds, techniqueId, outlineSourceSelection } = input;
    if (databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据库已切换，请重新生成大纲', code: 'DATABASE_GENERATION_MISMATCH' });
    }
    const governedBibleKind = techniqueId === 'bible-world-builder'
      ? 'world'
      : techniqueId === 'bible-character-arc' ? 'character' : undefined;
    let selectedCharacter: ReturnType<typeof db.getCharacter>;
    if (governedBibleKind === 'character') {
      selectedCharacter = input.characterId ? db.getCharacter(input.characterId) : undefined;
      if (selectedCharacter && selectedCharacter.novelId !== novelId) selectedCharacter = undefined;
      if (!selectedCharacter && !input.characterId) {
        const characters = db.listCharacters(novelId);
        selectedCharacter = characters.length === 1 ? characters[0] : undefined;
      }
      if (!selectedCharacter) {
        return res.status(400).json({
          code: 'CHARACTER_REQUIRED',
          error: input.characterId ? '指定角色不存在或不属于当前作品。' : '请先选择一个角色，再生成人物弧光候选。',
        });
      }
    }
    let selectedOutlineSource: OutlineSourceSelection | undefined;
    if (outlineSourceSelection) {
      try {
        selectedOutlineSource = selectOutlineSource({ novelId, ...outlineSourceSelection });
      } catch (error) {
        if (error instanceof OutlineSourceSelectionError) {
          return res.status(400).json({ code: error.code, error: error.message });
        }
        throw error;
      }
    }
    let techniquePrompt = '';
    if (techniqueId) {
      const manifest = capabilityManifestFor(techniqueId);
      if (!manifest || manifest.runtimeStatus !== 'active' || manifest.kind !== 'technique'
        || !manifest.stages.includes('planner') || !manifest.allowedScopes.includes('project')
        || manifest.input !== 'outline-source' || (!governedBibleKind && !['outline-candidate', 'artifact-candidate'].includes(manifest.output))) {
        return res.status(400).json({ code: 'OUTLINE_TECHNIQUE_INVALID', error: '这张规划能力卡不能用于项目大纲生成。' });
      }
      techniquePrompt = resolveCuratedTechniquePrompt(techniqueId) || '';
      if (!techniquePrompt) {
        return res.status(400).json({ code: 'OUTLINE_TECHNIQUE_NOT_READY', error: '这张规划能力卡暂未准备好，请换一张再试。' });
      }
    }
    const governedOutputPrompt = governedBibleOutputPrompt(governedBibleKind);
    let executionContract;
    try {
      executionContract = resolveProjectExecutionContract(novelId, { continuationPackId, sessionCardIds, databaseGeneration });
    } catch (error) {
      if (error instanceof WritingStyleRequestError) {
        return res.status(error.status).json({ code: error.code, error: error.message });
      }
      throw error;
    }
    let continuationPackContext = '';
    if (continuationPackId && !selectedOutlineSource) {
      const pack = executionContract.canon.pack;
      if (!pack || pack.status !== 'approved') {
        return res.status(400).json({ error: '只能使用已确认的导入资料生成大纲。' });
      }
      continuationPackContext = pack.context;
    }
    // Freeze all database-backed outline context before creating the job. The
    // background worker must not reread active outlines after the generation
    // check or it could mix two database generations in one prompt.
    const frozenActiveOutlineContext = buildActiveOutlineContext(novelId, input.chapterOrder);
    const frozenOpenForeshadowingContext = buildOpenForeshadowingContext(novelId, input.chapterOrder);
    const frozenSelectedOutlineSource = selectedOutlineSource?.content || '';
    if (databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据库已切换，请重新生成大纲', code: 'DATABASE_GENERATION_MISMATCH' });
    }
    const jobController = new AbortController();
    const execution = await prepareWorldLlmExecution(res, novelId, 'generate-outline', 'generateProse', {
      signal: jobController.signal,
      databaseGeneration,
      executionContract,
    });
    if (!execution) return;
    const jobId = createJob(jobController, databaseGeneration);
    res.json({ jobId, databaseGeneration });

    // Silent background execution
    (async () => {
      try {
        updateJob(jobId, { status: 'running', progress: 50 });
        const { title, worldRules, seedOutline, expectedWordCount, chapterOrder } = input;

        const budgetGuidelines = chapterOrder ? getPlotBudgetGuidelines(Number(chapterOrder)) : '';
        const boundedContext = buildOutlineContext(
          frozenSelectedOutlineSource || seedOutline,
          worldRules,
          [continuationPackContext, frozenActiveOutlineContext, frozenOpenForeshadowingContext
            ? `【开放伏笔（规划必须安排）】\n${frozenOpenForeshadowingContext}` : ''].filter(Boolean).join('\n\n'),
        );

        const promptAsset = resolvePromptAssetForSurface({
          surface: 'workspace-beats',
          promptTemplates: getConfig().promptTemplates,
          preferredTemplateKey: 'generateOutline',
        });
        const prompt = renderPromptTemplate(promptAsset.template, {
          expectedWordCount,
          title: title ? `小说名称：${title}` : '',
          skillsInfo: [
            executionContract.stagePrompts.planner,
            techniquePrompt ? `【规划能力卡】\n${techniquePrompt}` : '',
            governedOutputPrompt ? `【结构化候选输出合同】\n${governedOutputPrompt}` : '',
          ].filter(Boolean).join('\n\n'),
          worldRules: [
            executionContract.stagePrompts.planner ? `【规划阶段能力卡与流程】\n${executionContract.stagePrompts.planner}` : '',
            techniquePrompt ? `【规划能力卡】\n${techniquePrompt}` : '',
            governedOutputPrompt ? `【结构化候选输出合同】\n${governedOutputPrompt}` : '',
            boundedContext.worldRules ? `世界观及设定：${boundedContext.worldRules}` : '',
            budgetGuidelines,
          ].filter(Boolean).join('\n\n'),
          seedOutline: boundedContext.seedOutline ? `【选中的大纲原文】\n${boundedContext.seedOutline}` : '',
        });

        const outline = await execution.run(({ signal }) => generateText(getConfig(), {
          prompt,
          signal,
          novelId,
          timeoutMs: 90_000,
          maxTokens: OUTLINE_MAX_TOKENS,
          // Outline is structure, not prose: pin thinking off so reasoning
          // models emit the beats instead of burning budget on reasoning
          // (keeps the truncated-outline detector from firing spuriously).
          disableThinking: true,
        }));
        const normalizedOutline = outline.trim();
        if (!normalizedOutline) {
          throw outlineFailure('OUTLINE_EMPTY', 'LLM returned an empty outline');
        }
        if (isLikelyTruncatedOutline(normalizedOutline)) {
          throw outlineFailure('OUTLINE_TRUNCATED', 'LLM returned a possibly truncated outline');
        }
        if (governedBibleKind) {
          if (databaseGeneration !== getDatabaseGeneration()) {
            throw new Error('DATABASE_GENERATION_MISMATCH: database changed before candidate preview');
          }
          const preview = governedBibleKind === 'character'
            ? buildCharacterCandidateInput({
              novelId,
              character: selectedCharacter!,
              rawOutput: normalizedOutline,
              capabilityId: 'bible-character-arc',
            })
            : worldCandidateInput(novelId, normalizedOutline);
          const candidate = await previewArtifactCandidate(preview);
          updateJob(jobId, { status: 'completed', progress: 100, result: { kind: governedBibleKind, candidate } });
        } else {
          updateJob(jobId, { status: 'completed', progress: 100, result: { outline: normalizedOutline } });
        }
      } catch (e) {
        logger.error('Background generate-outline error:', e);
        const message = e instanceof Error ? e.message : String(e);
        const code = /timeout|timed out|超时|aborted/i.test(message)
          ? 'OUTLINE_TIMEOUT'
          : /empty response|空结果|empty outline/i.test(message)
            ? 'OUTLINE_EMPTY'
            : /truncated|截断/i.test(message)
              ? 'OUTLINE_TRUNCATED'
              : undefined;
        updateJob(jobId, { status: 'failed', progress: 100, error: `${code || 'OUTLINE_FAILED'}: ${safeJobError(e, '大纲生成失败，请稍后重试。')}` });
      }
    })();
  });

  app.post('/api/extract-entities', async (req, res) => {
    const { novelId, databaseGeneration } = req.body;
    if (!Number.isInteger(databaseGeneration)) {
      return res.status(400).json({ error: '请先刷新写作上下文，再嗅探实体。' });
    }
    if (databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据库已切换，请重新嗅探实体' });
    }
    const payload = extractEntitiesPayloadSchema.safeParse(req.body);
    if (!payload.success) {
      return res.status(400).json({ error: '实体嗅探请求格式无效，请刷新后重试。' });
    }
    const { text, existingNames } = payload.data;
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

        const prompt = withExecutionStagePrompt(execution.executionContract, 'planner', `
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
        `);

        const parsed = await execution.run(async ({ signal }) => {
          let rawText = await generateText(getConfig(), { prompt, signal, novelId, maxTokens: 4000, disableThinking: true });
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
        updateJob(jobId, { status: 'failed', progress: 100, error: `EXTRACT_ENTITIES_FAILED: ${safeJobError(e, '实体提取失败，请稍后重试。')}` });
      }
    })();
  });

  app.post('/api/detect-foreshadowing', async (req, res) => {
    const { novelId, databaseGeneration } = req.body;
    const foreshadowing = detectForeshadowingPayloadSchema.safeParse(req.body);
    if (!foreshadowing.success) {
      return res.status(400).json({ error: '请先提供章节正文，再检测伏笔。' });
    }
    const { chapterContent, chapterTitle, existingForeshadowings } = foreshadowing.data;
    if (!Number.isInteger(databaseGeneration)) {
      return res.status(400).json({ error: '请先刷新写作上下文，再检测伏笔。' });
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
        const prompt = withExecutionStagePrompt(execution.executionContract, 'critic', `你是一个小说伏笔分析专家。请阅读以下章节内容，找出其中可能的伏笔埋设点和伏笔回收点。

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
[{"title": "...", "description": "...", "type": "planted", "relatedTo": ""}]`);

        const parsed = await execution.run(async ({ signal }) => {
          let raw = (await generateText(config, { prompt, signal, novelId, maxTokens: 4000, disableThinking: true })).trim();
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
        updateJob(jobId, { status: 'failed', progress: 100, error: `FORESHADOWING_FAILED: ${safeJobError(e, '伏笔检测失败，请稍后重试。')}` });
      }
    })();
  });

  app.post('/api/analyze-pacing', async (req, res) => {
    const { novelId, databaseGeneration } = req.body;
    const pacing = analyzePacingPayloadSchema.safeParse(req.body);
    if (!pacing.success) {
      return res.status(400).json({ error: '请先提供章节列表，再分析节奏。' });
    }
    if (!Number.isInteger(databaseGeneration)) {
      return res.status(400).json({ error: '请先刷新写作上下文，再分析节奏。' });
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
        const limited = pacing.data.chapters.slice(-MAX_CHAPTERS);
        const chapterList = limited.map((c) =>
          `第${c.order ?? '?'}章「${c.title ?? '无标题'}」(字数:${c.wordCount ?? 0})：${(c.content || '').substring(0, 500)}...`
        ).join('\n---\n');

        const prompt = withExecutionStagePrompt(execution.executionContract, 'critic', `你是一个小说节奏分析专家。请对以下章节列表进行节奏诊断。

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

严格只输出 JSON 数组，不要包含 markdown 标记。`);

        const chapterResults = await execution.run(async ({ signal }) => {
          let raw = (await generateText(config, { prompt, signal, novelId, maxTokens: 4000, disableThinking: true })).trim();
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
        updateJob(jobId, { status: 'failed', progress: 100, error: `PACING_FAILED: ${safeJobError(e, '节奏分析失败，请稍后重试。')}` });
      }
    })();
  });

  app.post('/api/generate-entity-details', async (req, res) => {
    if (!rateLimit('generate-entity-details')) {
      return res.status(429).json({ error: '设定详情生成请求过于频繁，请稍后再试。', retryAfter: 5 });
    }
    const { novelId, databaseGeneration } = req.body;
    if (!Number.isInteger(databaseGeneration)) {
      return res.status(400).json({ error: '请先刷新写作上下文，再生成设定详情。' });
    }
    if (databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据库已切换，请重新嗅探实体' });
    }
    const entityDetails = generateEntityDetailsPayloadSchema.safeParse(req.body);
    if (!entityDetails.success) {
      return res.status(400).json({ error: '实体信息不完整，请重新嗅探实体。' });
    }
    const { name, type, context } = entityDetails.data;
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

        const prompt = withExecutionStagePrompt(execution.executionContract, 'planner', `你是一个网文世界观架构师。系统在一个新章节中扫描到了一个新设定实体，请根据上下文为其生成一份初始的万物词典（World Bible）条目。

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
`);

        const parsed = await execution.run(async ({ signal }) => {
          let rawText = await generateText(getConfig(), { prompt, signal, novelId, maxTokens: 4000, disableThinking: true });
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
        updateJob(jobId, { status: 'failed', progress: 100, error: `ENTITY_DETAILS_FAILED: ${safeJobError(e, '设定详情生成失败，请稍后重试。')}` });
      }
    })();
  });

  // Update character state after chapter write (silently executed in background)
  app.post('/api/update-character-state', async (req, res) => {
    try {
      const { databaseGeneration } = req.body;
      const characterState = updateCharacterStatePayloadSchema.safeParse(req.body);
      if (!characterState.success) {
        return res.status(400).json({ error: '请先选择作品并提供章节正文，再更新角色状态。' });
      }
      const { novelId, chapterContent } = characterState.data;
      if (!Number.isInteger(databaseGeneration)) {
        return res.status(400).json({ error: '请先刷新写作上下文，再更新角色状态。' });
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
      res.json({ success: true, jobId, databaseGeneration, message: '角色状态更新已开始。' });

      // Silent background Promise execution
      (async () => {
        try {
          updateJob(jobId, { status: 'running', progress: 50 });
          const characters = db.listCharacters(novelId);
          const characterSnapshotById = new Map(characters.map((character) => [character.id, {
            updatedAt: character.updatedAt,
            currentState: character.current_state,
          }]));
          const characterByName = new Map(characters.map((character) => [character.name, character]));
          const currentState = characters
            .map((c) => `${c.name}(${c.role}): ${c.current_state || '无记录'}`)
            .join('\n');

          const prompt = withExecutionStagePrompt(execution.executionContract, 'critic', `根据本章内容更新已有角色的当前状态。

【已有角色状态】
${wrapUserInput(currentState)}

【本章内容】
${wrapUserInput(chapterContent.slice(0, 8000))}

严格只输出 JSON，不要包含 Markdown：
{"characters":[{"name":"必须与已有角色姓名完全一致","changes":{"状态字段":"最新状态"}}]}`);

          const updatedCount = await execution.run(async ({ signal }) => {
            const raw = await generateText(getConfig(), { prompt, maxTokens: 4000, disableThinking: true, signal, novelId });
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
                const char = characterByName.get(name);
                const snapshot = char ? characterSnapshotById.get(char.id) : undefined;
                const current = char ? db.getCharacter(char.id) : undefined;
                if (char && snapshot && current
                  && current.updatedAt === snapshot.updatedAt
                  && current.current_state === snapshot.currentState) {
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
          updateJob(jobId, { status: 'failed', progress: 100, error: `CHARACTER_STATE_FAILED: ${safeJobError(bgErr, '角色状态更新失败，请稍后重试。')}` });
        }
      })();
    } catch (e) {
      logger.error('Update character state error:', e);
      res.status(500).json({ error: '角色状态更新失败，请稍后重试。' });
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
