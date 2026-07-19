import type { Express } from 'express';
import { z } from 'zod';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import { logger } from '../logger';
import { generateId } from '../id';
import {
  buildContinuationPackParseAttempts,
  buildContinuationPackPrompt,
} from '../../shared/lib/continuation-pack-parse';
import { parseModelJsonPayload } from '../../shared/lib/model-json';
import * as db from '../lib/db';
import { classifyContinuationSource } from '../../shared/lib/continuation-pack';
import { validate, parseDocSchema, continuationParseSchema } from '../validation';
import type {
  ContinuationCanonFact,
  ContinuationCharacterState,
  ContinuationPlotState,
  ContinuationStyleProfile,
  ContinuationContradiction,
  ContinuationSourceMap,
  ContinuationReadingQuestion,
  ContinuationGap,
  ContinuationPack,
} from '../../shared/types';
import {
  getDatabaseGeneration,
  getDb,
  runInSerializedWriteForGeneration,
} from '../lib/db-instance';
import {
  createLlmExecution,
  LlmExecutionRejectedError,
} from '../helpers/llm-execution-gate';
import { rateLimit } from '../middleware/rate-limit';
import { bindClientDisconnect } from '../helpers/stream-disconnect';
import {
  CONTINUATION_DOCUMENTS_MAX_TOTAL_UNCOMPRESSED_BYTES,
  DOCX_ARCHIVE_LIMITS,
  validateArchiveManifest,
} from '../../shared/lib/archive-limits';
import {
  applyContinuationConflictResolutions,
  canApproveContinuationImportPack,
  isContinuationContradictionResolved,
} from '../../shared/lib/continuation-import-flow';
import { buildSyncExtractionPrompt } from '../../shared/lib/sync-extract-prompt';


interface UploadedDocument {
  filename: string;
  filedata: string;
}

interface ParsedUploadedDocument {
  filename: string;
  text: string;
}

interface ParseDocJob {
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  stageText: string;
  result?: unknown;
  error?: string;
  createdAt: number;
  databaseGeneration: number;
}

const parseDocJobs = new Map<string, ParseDocJob>();
const parseDocJobAbortControllers = new Map<string, AbortController>();
const PARSE_DOC_JOB_TTL_MS = 30 * 60 * 1000;
const pendingContinuationImports = new Map<string, {
  pack: ContinuationPack;
  createdAt: number;
  databaseGeneration: number;
}>();
const continuationImportSessions = new Map<string, {
  createdAt: number;
  databaseGeneration: number;
}>();

const approveContinuationImportSchema = z.object({
  packId: z.string().min(1).max(300),
  mode: z.enum(['existing', 'new']),
  existingNovelId: z.string().min(1).max(300).optional(),
  newNovel: z.object({
    title: z.string().min(1).max(500),
    summary: z.string().max(20_000).default(''),
  }).optional(),
  conflictResolutions: z.array(z.object({
    contradictionId: z.string().min(1).max(300),
    resolution: z.string().trim().min(1).max(1_000),
  })).max(10).default([]),
});

const syncToWorldSchema = z.object({
  packId: z.string().min(1).max(300),
  novelId: z.string().min(1).max(300),
  databaseGeneration: z.number().int().nonnegative(),
  characters: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    role: z.string().max(100).default('supporting'),
    summary: z.string().max(2000).default(''),
    bio: z.string().max(5000).default(''),
    traits: z.array(z.string().max(100)).max(20).default([]),
  })).max(50).default([]),
  locations: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    region: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
  })).max(50).default([]),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    type: z.string().max(100).default('other'),
    description: z.string().max(2000).default(''),
  })).max(50).default([]),
  factions: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    leader: z.string().max(200).default(''),
    territory: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
  })).max(50).default([]),
  powerLevels: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    tier: z.number().int().min(0).max(100).default(0),
    characteristics: z.string().max(2000).default(''),
    description: z.string().max(2000).default(''),
  })).max(30).default([]),
  timelineEvents: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    timestamp: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
    order: z.number().int().min(0).max(10000).default(0),
  })).max(50).default([]),
  relationships: z.array(z.object({
    sourceName: z.string().trim().min(1).max(200),
    sourceType: z.enum(['character', 'location', 'item', 'faction']),
    targetName: z.string().trim().min(1).max(200),
    targetType: z.enum(['character', 'location', 'item', 'faction']),
    relationshipType: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default(''),
  })).max(100).default([]),
  globalOutline: z.string().max(50_000).optional(),
  worldRules: z.string().max(50_000).optional(),
});

const extractionResultSchema = z.object({
  characters: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    role: z.string().max(100).default('supporting'),
    summary: z.string().max(2000).default(''),
    bio: z.string().max(5000).default(''),
    traits: z.array(z.string().max(100)).max(20).default([]),
  })).max(50).default([]),
  locations: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    region: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
  })).max(50).default([]),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    type: z.string().max(100).default('other'),
    description: z.string().max(2000).default(''),
  })).max(50).default([]),
  factions: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    leader: z.string().max(200).default(''),
    territory: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
  })).max(50).default([]),
  powerLevels: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    tier: z.number().int().min(0).max(100).default(0),
    characteristics: z.string().max(2000).default(''),
    description: z.string().max(2000).default(''),
  })).max(30).default([]),
  timelineEvents: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    timestamp: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
    order: z.number().int().min(0).max(10000).default(0),
  })).max(50).default([]),
  relationships: z.array(z.object({
    sourceName: z.string().trim().min(1).max(200),
    sourceType: z.enum(['character', 'location', 'item', 'faction']),
    targetName: z.string().trim().min(1).max(200),
    targetType: z.enum(['character', 'location', 'item', 'faction']),
    relationshipType: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default(''),
  })).max(100).default([]),
  globalOutline: z.string().max(50_000).default(''),
  worldRules: z.string().max(50_000).default(''),
});

function pruneParseDocJobs(): void {
  const cutoff = Date.now() - PARSE_DOC_JOB_TTL_MS;
  for (const [id, job] of parseDocJobs) {
    if (job.createdAt < cutoff) {
      parseDocJobAbortControllers.get(id)?.abort(new Error('Parse-doc job expired'));
      parseDocJobAbortControllers.delete(id);
      parseDocJobs.delete(id);
    }
  }
  for (const [id, pending] of pendingContinuationImports) {
    if (pending.createdAt < cutoff) pendingContinuationImports.delete(id);
  }
  for (const [id, session] of continuationImportSessions) {
    if (session.createdAt < cutoff) continuationImportSessions.delete(id);
  }
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

export function mapCanonFact(f: unknown, packId: string, i: number): ContinuationCanonFact {
  const r = asRecord(f);
  const priority = r.priority === 'hard' || r.priority === 'soft' ? r.priority : 'soft';
  const category = ['world', 'character', 'plot', 'timeline', 'relationship', 'style'].includes(r.category as string)
    ? (r.category as ContinuationCanonFact['category'])
    : 'world';
  return {
    id: `${packId}-fact-${i}`,
    priority,
    category,
    text: stringValue(r.text),
    sourceDocumentId: r.sourceDocumentId ? stringValue(r.sourceDocumentId) : undefined,
    evidence: stringValue(r.evidence),
  };
}

export function mapCharacterState(c: unknown): ContinuationCharacterState {
  const r = asRecord(c);
  return {
    name: stringValue(r.name),
    role: stringValue(r.role),
    currentGoal: stringValue(r.currentGoal),
    emotionalState: stringValue(r.emotionalState),
    secrets: asArray(r.secrets).map(stringValue),
    relationshipNotes: asArray(r.relationshipNotes).map(stringValue),
    evidence: stringValue(r.evidence),
  };
}

export function mapPlotState(p: unknown): ContinuationPlotState {
  const r = asRecord(p);
  return {
    currentTimeline: stringValue(r.currentTimeline),
    latestScene: stringValue(r.latestScene),
    unresolvedHooks: asArray(r.unresolvedHooks).map(stringValue),
    immediateConflict: stringValue(r.immediateConflict),
    nextLikelyMove: stringValue(r.nextLikelyMove),
  };
}

export function mapStyleProfile(s: unknown): ContinuationStyleProfile {
  const r = asRecord(s);
  return {
    pov: stringValue(r.pov),
    tense: stringValue(r.tense),
    pacing: stringValue(r.pacing),
    dialogueDensity: stringValue(r.dialogueDensity),
    proseTraits: asArray(r.proseTraits).map(stringValue),
    avoidTraits: asArray(r.avoidTraits).map(stringValue),
    sampleEvidence: stringValue(r.sampleEvidence),
  };
}

export function mapContradiction(c: unknown, packId: string, i: number): ContinuationContradiction {
  const r = asRecord(c);
  const severity = r.severity === 'low' || r.severity === 'medium' || r.severity === 'high' ? r.severity : 'medium';
  return {
    id: `${packId}-contra-${i}`,
    severity,
    summary: stringValue(r.summary),
    conflictingEvidence: asArray(r.conflictingEvidence).map(stringValue),
    suggestedResolution: stringValue(r.suggestedResolution),
  };
}

export function mapSourceMap(s: unknown): ContinuationSourceMap {
  const r = asRecord(s);
  const sections = asArray(r.sections).map((sec) => {
    const sr = asRecord(sec);
    return {
      title: stringValue(sr.title),
      summary: stringValue(sr.summary),
      sourceIds: asArray(sr.sourceIds).map(stringValue),
    };
  });
  const keyConflicts = asArray(r.keyConflicts).map(stringValue);
  return { sections, keyConflicts };
}

export function mapReadingQuestion(q: unknown, packId: string, i: number): ContinuationReadingQuestion {
  const r = asRecord(q);
  const category = ['world', 'character', 'plot', 'style', 'continuity'].includes(r.category as string)
    ? (r.category as ContinuationReadingQuestion['category'])
    : 'continuity';
  return {
    id: `${packId}-question-${i}`,
    question: stringValue(r.question),
    context: stringValue(r.context),
    category,
  };
}

export function mapContinuationGap(g: unknown, packId: string, i: number): ContinuationGap {
  const r = asRecord(g);
  const severity = r.severity === 'low' || r.severity === 'medium' || r.severity === 'high' ? r.severity : 'medium';
  return {
    id: `${packId}-gap-${i}`,
    description: stringValue(r.description),
    severity,
    suggestedDirection: stringValue(r.suggestedDirection),
    relatedFacts: asArray(r.relatedFacts).map(stringValue),
  };
}

async function extractUploadedText(filename: string, filedata: string, prevalidatedBuffer?: Buffer): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.json')) {
    return Buffer.from(filedata, 'base64').toString('utf8');
  }
  if (lower.endsWith('.docx')) {
    const buffer = prevalidatedBuffer ?? Buffer.from(filedata, 'base64');
    if (!prevalidatedBuffer) await validateDocxArchive(buffer);
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  throw new Error('Unsupported file type.');
}

type ZipEntryMetadata = {
  compressedSize?: number;
  uncompressedSize?: number;
};

export async function validateDocxArchive(buffer: Buffer): Promise<number> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  return validateArchiveManifest(Object.values(zip.files).map((entry) => {
    const metadata = (entry as unknown as { _data?: ZipEntryMetadata })._data;
    return {
      name: entry.name,
      directory: entry.dir,
      compressedSize: metadata?.compressedSize,
      uncompressedSize: metadata?.uncompressedSize,
    };
  }), DOCX_ARCHIVE_LIMITS);
}

export async function preflightUploadedDocumentArchives(
  documents: UploadedDocument[],
  maxTotalUncompressedBytes = CONTINUATION_DOCUMENTS_MAX_TOTAL_UNCOMPRESSED_BYTES,
): Promise<Map<number, Buffer>> {
  const docxBuffers = new Map<number, Buffer>();
  let totalUncompressedBytes = 0;
  for (const [index, document] of documents.entries()) {
    const buffer = Buffer.from(document.filedata, 'base64');
    const expandedBytes = document.filename.toLowerCase().endsWith('.docx')
      ? await validateDocxArchive(buffer)
      : buffer.length;
    if (document.filename.toLowerCase().endsWith('.docx')) docxBuffers.set(index, buffer);
    totalUncompressedBytes += expandedBytes;
    if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > maxTotalUncompressedBytes) {
      throw new Error('文档解压后总大小超出安全上限');
    }
  }
  return docxBuffers;
}

async function parseWorldDocument(
  filename: string,
  filedata: string,
  signal: AbortSignal,
): Promise<unknown> {
  const text = await extractUploadedText(filename, filedata);
  const prompt = `
你是一个小说世界观设定解析专家。用户上传了一份设定文档（内容在下方）。
请提取其中的世界观设定、角色信息、大纲、以及时间线等。

【提取要求】:
1. "globalOutline" (全局大纲): 一段概括性的长文。
2. "worldRules" (世界观设定): 一段概括性的长文。
3. "characters" (角色): name, role(protagonist|antagonist|supporting|extra), summary, bio(长文字), traits(数组)
4. "locations" (地点/地域): name, region, description
5. "items" (物品/法宝): name, type, description
6. "factions" (势力): name, leader, territory, description
7. "powerLevels" (境界等级): name, tier(数字), characteristics(特征描述), description
8. "timelineEvents" (时间线): title, timestamp, description, order(数字)

文档内容：
"""
${text.substring(0, 30000)}
"""

请严格以JSON格式输出上述字段。`;

  const rawText = await generateText(getConfig(), {
    prompt,
    signal,
    responseMimeType: 'application/json',
    timeoutMs: 90_000,
    maxAttempts: 2,
  });
  return parseModelJsonPayload<unknown>(rawText);
}

export function registerContinuationRoutes(app: Express) {
  app.post('/api/continuation-packs/import-session', (_req, res) => {
    if (!rateLimit('continuation-import-session')) {
      return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    }
    pruneParseDocJobs();
    const novelId = `continuation-import-draft-${generateId()}`;
    continuationImportSessions.set(novelId, {
      createdAt: Date.now(),
      databaseGeneration: getDatabaseGeneration(),
    });
    return res.status(201).json({ novelId });
  });

  app.post('/api/parse-doc', validate(parseDocSchema), async (req, res) => {
    if (!rateLimit('parse-world-document')) {
      return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    }
    pruneParseDocJobs();
    const jobId = `parse-doc-${generateId()}`;
    const jobController = new AbortController();
    const databaseGeneration = getDatabaseGeneration();
    let execution: Awaited<ReturnType<typeof createLlmExecution>>;
    try {
      execution = await createLlmExecution({
        operation: 'parse-world-document',
        novelId: req.body.novelId,
        quotaType: 'advancedAudit',
        timeoutMs: 90_000,
        concurrency: 1,
        signal: jobController.signal,
      });
    } catch (error) {
      if (error instanceof LlmExecutionRejectedError) {
        return res.status(error.status).json({ error: error.message, quota: error.quota });
      }
      throw error;
    }
    parseDocJobs.set(jobId, {
      status: 'queued',
      progress: 10,
      stageText: '正在读取并提取文档内容...',
      createdAt: Date.now(),
      databaseGeneration,
    });
    parseDocJobAbortControllers.set(jobId, jobController);
    res.status(202).json({ jobId, databaseGeneration });

    void (async () => {
      const job = parseDocJobs.get(jobId);
      if (!job) return;
      try {
        Object.assign(job, { status: 'running', progress: 35, stageText: 'AI 正在解析设定结构...' });
        const result = await execution.run(async ({ signal }) => {
          const parsed = await parseWorldDocument(req.body.filename, req.body.filedata, signal);
          if (databaseGeneration !== getDatabaseGeneration()) {
            throw new Error('数据库已切换，请重新导入');
          }
          return parsed;
        });
        job.result = result;
        Object.assign(job, { status: 'completed', progress: 100, stageText: '解析完成' });
      } catch (error) {
        logger.error('设定文档解析失败:', error);
        Object.assign(job, {
          status: 'failed',
          progress: 100,
          stageText: '解析失败',
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        parseDocJobAbortControllers.delete(jobId);
      }
    })();
  });

  app.get('/api/parse-doc/jobs/:jobId', (req, res) => {
    pruneParseDocJobs();
    const job = parseDocJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: '解析任务不存在或已过期' });
    const requestedGeneration = Number(req.query.databaseGeneration);
    if (!Number.isInteger(requestedGeneration) || requestedGeneration !== job.databaseGeneration) {
      return res.status(409).json({ error: '解析任务代际无效，请重新导入设定文档' });
    }
    if (job.databaseGeneration !== getDatabaseGeneration()) {
      parseDocJobs.delete(req.params.jobId);
      return res.status(409).json({ error: '数据库已在解析期间切换，请重新导入设定文档' });
    }
    return res.json(job);
  });

  app.post('/api/parse-doc/jobs/:jobId/cancel', (req, res) => {
    pruneParseDocJobs();
    const job = parseDocJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: '解析任务不存在或已过期' });
    const controller = parseDocJobAbortControllers.get(req.params.jobId);
    if (!controller || job.status === 'completed' || job.status === 'failed') {
      return res.status(409).json({ error: '解析任务不可取消' });
    }
    controller.abort(new Error('Parse-doc job cancelled'));
    parseDocJobAbortControllers.delete(req.params.jobId);
    Object.assign(job, { status: 'failed', progress: 100, stageText: '已取消', error: 'Cancelled' });
    return res.json({ cancelled: true });
  });

  app.post('/api/continuation-packs/parse', validate(continuationParseSchema), async (req, res) => {
    const controller = new AbortController();
    const disposeDisconnect = bindClientDisconnect(req, res, () => controller.abort());
    try {
      if (!rateLimit('continuation-packs-parse')) {
        return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
      }
      const databaseGeneration = getDatabaseGeneration();
      const novelId = stringValue(req.body.novelId);
      const title = stringValue(req.body.title);
      const documents = asArray(req.body.documents) as UploadedDocument[];
      if (!novelId.trim()) return res.status(400).json({ error: 'novelId is required' });
      if (!documents.length) return res.status(400).json({ error: 'At least one document is required' });

      const isPendingNovelImport = novelId.startsWith('continuation-import-draft-');
      if (isPendingNovelImport) {
        const session = continuationImportSessions.get(novelId);
        continuationImportSessions.delete(novelId);
        if (!session || session.databaseGeneration !== databaseGeneration) {
          return res.status(400).json({ error: '续写导入会话无效或已过期，请重新开始导入' });
        }
      }
      if (!isPendingNovelImport && !db.getNovel(novelId)) {
        return res.status(404).json({ error: '指定作品不存在' });
      }

      const docxBuffers = await preflightUploadedDocumentArchives(documents);
      const parsedDocs: ParsedUploadedDocument[] = [];
      for (const [index, doc] of documents.entries()) {
        const text = await extractUploadedText(doc.filename, doc.filedata, docxBuffers.get(index));
        const trimmed = text.slice(0, 60000);
        const chineseChars = trimmed.replace(/[^一-鿿]/g, '');
        if (chineseChars.length < 20) {
          throw new Error(`"${doc.filename}" 内容过短或无可识别中文文本，请检查文件。`);
        }
        parsedDocs.push({ filename: doc.filename, text: trimmed });
      }

      const llmConfig = getConfig();
      const buildDocumentsForPrompt = (maxCharsPerDocument: number) =>
        parsedDocs.map((d) =>
          `【${d.filename}】\n${d.text.slice(0, maxCharsPerDocument)}\n`
        ).join('\n---\n');

      const shouldRetryWithShorterPrompt = (message: string) =>
        /only thinking\/reasoning content|empty response|可解析的 JSON|不完整的 JSON|LLM returned empty response/i.test(message);
      const promptAttempts = buildContinuationPackParseAttempts(llmConfig.baseUrl);
      const execution = await createLlmExecution({
        operation: 'parse-continuation-pack',
        novelId: isPendingNovelImport ? undefined : novelId,
        quotaType: isPendingNovelImport ? undefined : 'advancedAudit',
        timeoutMs: 180_000,
        concurrency: 1,
        signal: controller.signal,
      });

      const pack = await execution.run(async ({ signal }) => {
        let modelResult: unknown = null;
        let lastParseError: unknown = null;
        for (const attempt of promptAttempts) {
          try {
            const raw = await generateText(llmConfig, {
              prompt: buildContinuationPackPrompt(
                buildDocumentsForPrompt(attempt.maxCharsPerDocument),
                attempt.compactMode,
              ),
              signal,
              timeoutMs: 90_000,
              maxAttempts: 3,
              maxTokens: attempt.maxTokens,
              responseMimeType: 'application/json',
              disableThinking: true,
            });
            modelResult = parseModelJsonPayload<unknown>(raw);
            break;
          } catch (error) {
            lastParseError = error;
            const message = error instanceof Error ? error.message : String(error);
            if (!shouldRetryWithShorterPrompt(message) || attempt === promptAttempts[promptAttempts.length - 1]) {
              throw error;
            }
          }
        }
        if (!modelResult) {
          throw lastParseError instanceof Error
            ? lastParseError
            : new Error(String(lastParseError || '模型未返回可用 JSON，请重试。'));
        }
        const parsedRecord = asRecord(modelResult);
        const now = Date.now();
        const packId = `cont-pack-${generateId()}`;
        const nextPack: ContinuationPack = {
          id: packId,
          novelId,
          title: title || '续写资料包',
          status: 'draft',
          sourceDocuments: parsedDocs.map((d, i: number) => ({
            id: `${packId}-doc-${i}`,
            packId,
            filename: d.filename,
            kind: classifyContinuationSource(d.filename, d.text),
            text: d.text,
            excerpt: d.text.slice(0, 500),
            createdAt: now,
          })),
          canonFacts: asArray(parsedRecord.canonFacts).map((f, i: number) => mapCanonFact(f, packId, i)),
          characterStates: asArray(parsedRecord.characterStates).map(mapCharacterState),
          plotState: mapPlotState(parsedRecord.plotState ?? { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' }),
          styleProfile: mapStyleProfile(parsedRecord.styleProfile ?? { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' }),
          contradictions: asArray(parsedRecord.contradictions).map((c, i: number) => mapContradiction(c, packId, i)),
          sourceMap: mapSourceMap(parsedRecord.sourceMap ?? { sections: [], keyConflicts: [] }),
          readingQuestions: asArray(parsedRecord.readingQuestions).map((q, i: number) => mapReadingQuestion(q, packId, i)),
          continuationGaps: asArray(parsedRecord.continuationGaps).map((g, i: number) => mapContinuationGap(g, packId, i)),
          continuationTask: stringValue(parsedRecord.continuationTask) || '',
          sourceBadge: 'user-uploaded',
          createdAt: now,
          updatedAt: now,
        };

        if (isPendingNovelImport) {
          if (databaseGeneration !== getDatabaseGeneration()) {
            throw new Error('DATABASE_GENERATION_CHANGED');
          }
          pruneParseDocJobs();
          pendingContinuationImports.set(nextPack.id, {
            pack: nextPack,
            createdAt: Date.now(),
            databaseGeneration,
          });
        } else {
          const writeResult = await runInSerializedWriteForGeneration(
            databaseGeneration,
            () => db.createContinuationPack(nextPack),
          );
          if (!writeResult.executed) {
            throw new Error('DATABASE_GENERATION_CHANGED');
          }
        }
        return nextPack;
      });

      res.json({ pack });
    } catch (e) {
      logger.error(String(e));
      const message = e instanceof Error ? e.message : String(e);

      if (e instanceof LlmExecutionRejectedError) {
        return res.status(e.status).json({ error: e.message, quota: e.quota });
      }
      if (message === 'DATABASE_GENERATION_CHANGED') {
        return res.status(409).json({ error: '数据库已在解析期间切换，请重新导入资料' });
      }

      // Classify the error for better user feedback
      if (/内容过短|无可识别中文|too short/i.test(message)) {
        return res.status(400).json({ error: message });
      }
      if (/only thinking\/reasoning content/i.test(message)) {
        return res.status(502).json({ error: 'AI 模型仅返回思考内容，未生成可用结果。请重试。' });
      }
      if (/empty response|LLM returned empty/i.test(message)) {
        return res.status(502).json({ error: 'AI 模型返回空内容，请减少资料文件数量后重试。' });
      }
      if (/不完整的 JSON|missing.*JSON|incomplete/i.test(message)) {
        return res.status(502).json({ error: 'AI 返回的数据不完整，请重试或减少文件数量。' });
      }
      if (/可解析的 JSON/i.test(message)) {
        return res.status(502).json({ error: 'AI 返回的数据无法解析，请重试。' });
      }
      if (/timeout|超时|timed out/i.test(message)) {
        return res.status(502).json({ error: 'AI 解析超时，请减少资料文件数量后重试。' });
      }
      if (/API.?[Kk]ey|未配置|unauthorized/i.test(message)) {
        return res.status(401).json({ error: '未配置 AI API Key，请在设置中配置后重试。' });
      }
      return res.status(500).json({ error: '解析服务异常，请稍后重试。' });
    } finally {
      disposeDisconnect();
    }
  });

  app.post('/api/continuation-packs/approve-import', (req, res) => {
    const parsed = approveContinuationImportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '确认导入参数无效' });
    const input = parsed.data;
    const pending = pendingContinuationImports.get(input.packId);
    if (pending && pending.databaseGeneration !== getDatabaseGeneration()) {
      pendingContinuationImports.delete(input.packId);
      return res.status(409).json({ error: '数据库已在解析后切换，请重新导入资料' });
    }
    const storedPack = db.getContinuationPack(input.packId);
    const sourcePack = pending?.pack || storedPack;
    if (!sourcePack) return res.status(404).json({ error: '续写资料包不存在或已过期' });
    if (sourcePack.status === 'approved') {
      return res.status(409).json({ error: '续写资料包已批准，不能重复修改冲突裁决' });
    }

    let resolvedPack: ContinuationPack;
    try {
      resolvedPack = applyContinuationConflictResolutions(sourcePack, input.conflictResolutions);
    } catch (error) {
      logger.warn('续写资料包冲突裁决无效:', error);
      return res.status(400).json({ error: '冲突裁决无效，请检查冲突 ID 与方案内容' });
    }
    if (!canApproveContinuationImportPack(resolvedPack)) {
      const error = resolvedPack.canonFacts.length === 0
        ? '资料包缺少可确认的事实，无法批准'
        : '资料包仍有未解决的高风险冲突，无法批准';
      return res.status(409).json({ error });
    }
    if (resolvedPack.contradictions.filter(isContinuationContradictionResolved).length > 10) {
      return res.status(409).json({ error: '冲突裁决数量超过上限，请精简后重试' });
    }

    try {
      let approvedNovel: ReturnType<typeof db.getNovel>;
      let approvedPack: ContinuationPack | undefined;
      db.runInTransaction(() => {
        if (input.mode === 'existing') {
          approvedNovel = input.existingNovelId ? db.getNovel(input.existingNovelId) : undefined;
          if (!approvedNovel) throw new Error('Target novel not found');
        } else {
          if (!input.newNovel) throw new Error('New novel data missing');
          const now = Date.now();
          approvedNovel = {
            id: generateId(),
            title: input.newNovel.title,
            authorId: 'local-user',
            summary: input.newNovel.summary,
            status: 'ongoing',
            createdAt: now,
            updatedAt: now,
          };
          db.createNovel(approvedNovel);
        }

        if (!pending && sourcePack.novelId !== approvedNovel.id) {
          throw new Error('Stored continuation pack belongs to another novel');
        }

        approvedPack = {
          ...resolvedPack,
          novelId: approvedNovel.id,
          status: 'approved',
          updatedAt: Date.now(),
        };
        if (pending) {
          db.createContinuationPack(approvedPack);
        } else if (!db.updateContinuationPack(sourcePack.id, {
          contradictions: approvedPack.contradictions,
          status: 'approved',
          updatedAt: approvedPack.updatedAt,
        })) {
          throw new Error('Continuation pack disappeared during approval');
        }
      });
      pendingContinuationImports.delete(input.packId);
      return res.json({ novel: approvedNovel, pack: approvedPack });
    } catch (error) {
      logger.error('确认续写资料导入失败:', error);
      return res.status(409).json({ error: '确认导入失败，未写入作品或资料包' });
    }
  });

  app.post('/api/continuation-packs/extract-entities', async (req, res) => {
    if (!rateLimit('continuation-packs-extract')) {
      return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    }
    const { packId, novelId: reqNovelId, databaseGeneration: reqGeneration } = req.body;
    if (!packId || typeof packId !== 'string') {
      return res.status(400).json({ error: 'packId is required' });
    }
    const pack = db.getContinuationPack(packId);
    if (!pack) {
      return res.status(404).json({ error: '资料包不存在' });
    }
    if (pack.status !== 'approved') {
      return res.status(400).json({ error: '仅已批准的资料包可以同步' });
    }

    const novelId = pack.novelId;
    if (reqNovelId && reqNovelId !== novelId) {
      return res.status(403).json({ error: '资料包不属于当前作品' });
    }

    const databaseGeneration = getDatabaseGeneration();
    if (Number.isInteger(reqGeneration) && reqGeneration !== databaseGeneration) {
      return res.status(409).json({ error: '数据已变更，请刷新后重试', code: 'GENERATION_MISMATCH' });
    }

    const sourceTexts = pack.sourceDocuments
      .filter(doc => doc.text && doc.text.trim().length > 0)
      .map(doc => `【${doc.filename}】\n${doc.text.slice(0, 30000)}`);

    if (sourceTexts.length === 0) {
      return res.status(400).json({ error: '资料包无有效文本内容' });
    }

    const llmConfig = getConfig();
    const controller = new AbortController();
    const disposeDisconnect = bindClientDisconnect(req, res, () => controller.abort());
    const timeout = setTimeout(() => controller.abort(new Error('extract-entities timeout')), 120_000);
    let execution: Awaited<ReturnType<typeof createLlmExecution>>;
    try {
      execution = await createLlmExecution({
        operation: 'extract-pack-entities',
        novelId: pack.novelId,
        quotaType: 'advancedAudit',
        timeoutMs: 120_000,
        concurrency: 1,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof LlmExecutionRejectedError) {
        return res.status(error.status).json({ error: error.message, quota: error.quota });
      }
      throw error;
    }

    try {
      const result = await execution.run(async ({ signal }) => {
        if (databaseGeneration !== getDatabaseGeneration()) {
          throw new Error('GENERATION_MISMATCH');
        }
        const raw = await generateText(llmConfig, {
          prompt: buildSyncExtractionPrompt(sourceTexts),
          signal,
          timeoutMs: 90_000,
          maxAttempts: 3,
          maxTokens: 8000,
          responseMimeType: 'application/json',
          disableThinking: true,
        });
        const parsed = parseModelJsonPayload<unknown>(raw);
        const validated = extractionResultSchema.safeParse(parsed);
        if (!validated.success) {
          throw new Error('EXTRACTION_VALIDATION_FAILED');
        }
        return validated.data;
      });
      res.json({ packId, novelId, databaseGeneration, extraction: result });
    } catch (error) {
      logger.error('资料包实体提取失败:', error);
      if (error instanceof LlmExecutionRejectedError) {
        return res.status(error.status).json({ error: error.message, quota: error.quota });
      }
      if (error instanceof Error && error.message === 'GENERATION_MISMATCH') {
        return res.status(409).json({ error: '数据已变更，请刷新后重试', code: 'GENERATION_MISMATCH' });
      }
      if (error instanceof Error && error.message === 'EXTRACTION_VALIDATION_FAILED') {
        return res.status(422).json({ error: '提取结果校验失败，请重试' });
      }
      res.status(500).json({ error: '提取失败，请稍后重试' });
    } finally {
      clearTimeout(timeout);
      disposeDisconnect();
    }
  });

  app.post('/api/continuation-packs/sync-to-world', async (req, res) => {
    if (!rateLimit('continuation-packs-sync')) {
      return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    }

    const parsed = syncToWorldSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '参数校验失败', details: parsed.error.flatten().fieldErrors });
    }

    const { packId, novelId, databaseGeneration, characters, locations, items, factions, powerLevels, timelineEvents, relationships, globalOutline, worldRules } = parsed.data;

    if (databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据已变更，请刷新后重试', code: 'GENERATION_MISMATCH' });
    }

    const normalizeName = (name: string): string => name.trim().normalize('NFC').toLowerCase();
    const now = Date.now();
    const sqliteDb = getDb();

    const created = { characters: 0, locations: 0, items: 0, factions: 0, powerLevels: 0, timelineEvents: 0, relationships: 0 };
    const skipped = { characters: 0, locations: 0, items: 0, factions: 0, relationships: 0 };

    try {
      const syncResult = await runInSerializedWriteForGeneration(databaseGeneration, () => {
        return sqliteDb.transaction(() => {
        // ── All reads inside the same transaction as writes ──
        const pack = db.getContinuationPack(packId);
        if (!pack) throw new Error('PACK_NOT_FOUND');
        if (pack.status !== 'approved') throw new Error('PACK_NOT_APPROVED');
        if (pack.novelId !== novelId) throw new Error('PACK_NOVEL_MISMATCH');

        const novel = db.getNovel(novelId);
        if (!novel) throw new Error('NOVEL_NOT_FOUND');

        const existingChars = db.listCharacters(novelId);
        const existingLocs = db.listLocations(novelId);
        const existingItems = db.listItems(novelId);
        const existingFactions = db.listFactions(novelId);
        const existingPowerLevels = db.listPowerLevels(novelId);
        const existingTimelineEvents = db.listTimelineEvents(novelId);

        const existingCharNames = new Set(existingChars.map(c => normalizeName(c.name)));
        const existingLocNames = new Set(existingLocs.map(l => normalizeName(l.name)));
        const existingItemNames = new Set(existingItems.map(i => normalizeName(i.name)));
        const existingFactionNames = new Set(existingFactions.map(f => normalizeName(f.name)));
        const existingPowerLevelNames = new Set(existingPowerLevels.map(p => normalizeName(p.name)));
        const existingTimelineTitles = new Set(existingTimelineEvents.map(t => normalizeName(t.title)));

        const seenCharNames = new Set<string>();
        const seenLocNames = new Set<string>();
        const seenItemNames = new Set<string>();
        const seenFactionNames = new Set<string>();
        const seenPowerLevelNames = new Set<string>();
        const seenTimelineTitles = new Set<string>();

        const nameToId = new Map<string, { id: string; type: string }>();
        for (const c of existingChars) {
          nameToId.set(`character:${normalizeName(c.name)}`, { id: c.id, type: 'character' });
        }
        for (const l of existingLocs) {
          nameToId.set(`location:${normalizeName(l.name)}`, { id: l.id, type: 'location' });
        }
        for (const i of existingItems) {
          nameToId.set(`item:${normalizeName(i.name)}`, { id: i.id, type: 'item' });
        }
        for (const f of existingFactions) {
          nameToId.set(`faction:${normalizeName(f.name)}`, { id: f.id, type: 'faction' });
        }

        // ── novel fields: only write if still empty at transaction time ──
        if (globalOutline && !novel.globalOutline) {
          sqliteDb.prepare('UPDATE novels SET global_outline = ? WHERE id = ?').run(globalOutline, novelId);
        }
        if (worldRules && !novel.worldRules) {
          sqliteDb.prepare('UPDATE novels SET world_rules = ? WHERE id = ?').run(worldRules, novelId);
        }

        for (const c of characters || []) {
          const key = normalizeName(c.name);
          if (existingCharNames.has(key) || seenCharNames.has(key)) { skipped.characters++; continue; }
          seenCharNames.add(key);
          const id = generateId();
          sqliteDb.prepare('INSERT INTO characters (id, novel_id, name, role, summary, traits, bio, current_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            id, novelId, c.name, c.role || 'supporting', c.summary || '', JSON.stringify(c.traits || []), c.bio || '', '', now, now
          );
          nameToId.set(`character:${key}`, { id, type: 'character' });
          created.characters++;
        }

        for (const l of locations || []) {
          const key = normalizeName(l.name);
          if (existingLocNames.has(key) || seenLocNames.has(key)) { skipped.locations++; continue; }
          seenLocNames.add(key);
          const id = generateId();
          sqliteDb.prepare('INSERT INTO locations (id, novel_id, name, region, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            id, novelId, l.name, l.region || '', l.description || '', now, now
          );
          nameToId.set(`location:${key}`, { id, type: 'location' });
          created.locations++;
        }

        for (const i of items || []) {
          const key = normalizeName(i.name);
          if (existingItemNames.has(key) || seenItemNames.has(key)) { skipped.items++; continue; }
          seenItemNames.add(key);
          const id = generateId();
          sqliteDb.prepare('INSERT INTO items (id, novel_id, name, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            id, novelId, i.name, i.type || 'other', i.description || '', now, now
          );
          nameToId.set(`item:${key}`, { id, type: 'item' });
          created.items++;
        }

        for (const f of factions || []) {
          const key = normalizeName(f.name);
          if (existingFactionNames.has(key) || seenFactionNames.has(key)) { skipped.factions++; continue; }
          seenFactionNames.add(key);
          const id = generateId();
          sqliteDb.prepare('INSERT INTO factions (id, novel_id, name, leader, territory, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
            id, novelId, f.name, f.leader || '', f.territory || '', f.description || '', now, now
          );
          nameToId.set(`faction:${key}`, { id, type: 'faction' });
          created.factions++;
        }

        for (const p of powerLevels || []) {
          const key = normalizeName(p.name);
          if (existingPowerLevelNames.has(key) || seenPowerLevelNames.has(key)) continue;
          seenPowerLevelNames.add(key);
          const id = generateId();
          sqliteDb.prepare('INSERT INTO power_levels (id, novel_id, name, tier, characteristics, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
            id, novelId, p.name, p.tier ?? 0, p.characteristics || '', p.description || '', now, now
          );
          created.powerLevels++;
        }

        for (const t of timelineEvents || []) {
          const key = normalizeName(t.title);
          if (existingTimelineTitles.has(key) || seenTimelineTitles.has(key)) continue;
          seenTimelineTitles.add(key);
          const id = generateId();
          sqliteDb.prepare('INSERT INTO timeline_events (id, novel_id, title, description, timestamp, status_tag, "order", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            id, novelId, t.title, t.description || '', t.timestamp || '', null, t.order ?? 0, now, now
          );
          created.timelineEvents++;
        }

        const seenRelKeys = new Set<string>();
        const existingRels = sqliteDb.prepare('SELECT sourceType, sourceId, targetType, targetId, relationshipType FROM entity_relationships WHERE novelId = ?').all(novelId) as { sourceType: string; sourceId: string; targetType: string; targetId: string; relationshipType: string }[];
        for (const rel of existingRels) {
          seenRelKeys.add(`${rel.sourceType}:${rel.sourceId}:${rel.targetType}:${rel.targetId}:${rel.relationshipType || ''}`);
        }

        for (const r of relationships || []) {
          const srcKey = `${r.sourceType}:${normalizeName(r.sourceName)}`;
          const tgtKey = `${r.targetType}:${normalizeName(r.targetName)}`;
          const srcEntry = nameToId.get(srcKey);
          const tgtEntry = nameToId.get(tgtKey);
          if (!srcEntry || !tgtEntry) {
            skipped.relationships++;
            continue;
          }
          if (srcEntry.type === tgtEntry.type && srcEntry.id === tgtEntry.id) {
            skipped.relationships++;
            continue;
          }

          const relKey = `${srcEntry.type}:${srcEntry.id}:${tgtEntry.type}:${tgtEntry.id}:${r.relationshipType || ''}`;
          if (seenRelKeys.has(relKey)) {
            skipped.relationships++;
            continue;
          }
          seenRelKeys.add(relKey);

          const relId = generateId();
          sqliteDb.prepare('INSERT INTO entity_relationships (id, novelId, sourceType, sourceId, targetType, targetId, relationshipType, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            relId, novelId, srcEntry.type, srcEntry.id, tgtEntry.type, tgtEntry.id, r.relationshipType || '', r.description || '', now
          );
          created.relationships++;
        }
        return { created, skipped };
      })();
      });

      if (!syncResult.executed) {
        return res.status(409).json({ error: '数据已变更，请刷新后重试', code: 'GENERATION_MISMATCH' });
      }

      // Translate server errors to HTTP status codes
      const result = syncResult.result;
      res.json(result);
    } catch (error) {
      logger.error('同步写入失败:', error);
      if (error instanceof Error) {
        if (error.message === 'PACK_NOT_FOUND') return res.status(404).json({ error: '资料包不存在' });
        if (error.message === 'PACK_NOT_APPROVED') return res.status(400).json({ error: '仅已批准的资料包可以同步' });
        if (error.message === 'PACK_NOVEL_MISMATCH') return res.status(403).json({ error: '资料包不属于当前作品' });
        if (error.message === 'NOVEL_NOT_FOUND') return res.status(404).json({ error: '作品不存在' });
      }
      res.status(500).json({ error: '同步写入失败，请稍后重试' });
    }
  });
}
