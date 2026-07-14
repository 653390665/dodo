import type { Express } from 'express';
import { z } from 'zod';
import { generateText } from '../lib/server-llm';
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
  runInSerializedWriteForGeneration,
} from '../lib/db-instance';

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
  createdAt: number;
  databaseGeneration: number;
}

const parseDocJobs = new Map<string, ParseDocJob>();
const PARSE_DOC_JOB_TTL_MS = 30 * 60 * 1000;
const pendingContinuationImports = new Map<string, {
  pack: ContinuationPack;
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
});

function pruneParseDocJobs(): void {
  const cutoff = Date.now() - PARSE_DOC_JOB_TTL_MS;
  for (const [id, job] of parseDocJobs) {
    if (job.createdAt < cutoff) parseDocJobs.delete(id);
  }
  for (const [id, pending] of pendingContinuationImports) {
    if (pending.createdAt < cutoff) pendingContinuationImports.delete(id);
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

async function extractUploadedText(filename: string, filedata: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.json')) {
    return Buffer.from(filedata, 'base64').toString('utf8');
  }
  if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const buffer = Buffer.from(filedata, 'base64');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  throw new Error('Unsupported file type.');
}

async function parseWorldDocument(filename: string, filedata: string): Promise<unknown> {
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
    responseMimeType: 'application/json',
    timeoutMs: 90_000,
    maxAttempts: 2,
  });
  return parseModelJsonPayload<unknown>(rawText);
}

export function registerContinuationRoutes(app: Express) {
  app.post('/api/parse-doc', validate(parseDocSchema), async (req, res) => {
    pruneParseDocJobs();
    const jobId = `parse-doc-${generateId()}`;
    const databaseGeneration = getDatabaseGeneration();
    parseDocJobs.set(jobId, {
      status: 'queued',
      progress: 10,
      stageText: '正在读取并提取文档内容...',
      createdAt: Date.now(),
      databaseGeneration,
    });
    res.status(202).json({ jobId, databaseGeneration });

    void (async () => {
      const job = parseDocJobs.get(jobId);
      if (!job) return;
      try {
        Object.assign(job, { status: 'running', progress: 35, stageText: 'AI 正在解析设定结构...' });
        const result = await parseWorldDocument(req.body.filename, req.body.filedata);
        if (databaseGeneration !== getDatabaseGeneration()) {
          Object.assign(job, { status: 'failed', progress: 100, stageText: '数据库已切换，请重新导入' });
          return;
        }
        job.result = result;
        Object.assign(job, { status: 'completed', progress: 100, stageText: '解析完成' });
      } catch (error) {
        logger.error('设定文档解析失败:', error);
        Object.assign(job, { status: 'failed', progress: 100, stageText: '解析失败' });
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

  app.post('/api/continuation-packs/parse', validate(continuationParseSchema), async (req, res) => {
    try {
      const databaseGeneration = getDatabaseGeneration();
      const novelId = stringValue(req.body.novelId);
      const title = stringValue(req.body.title);
      const documents = asArray(req.body.documents) as UploadedDocument[];
      if (!novelId.trim()) return res.status(400).json({ error: 'novelId is required' });
      if (!documents.length) return res.status(400).json({ error: 'At least one document is required' });

      const parsedDocs: ParsedUploadedDocument[] = await Promise.all(
        documents.map(async (doc) => {
          const text = await extractUploadedText(doc.filename, doc.filedata);
          const trimmed = text.slice(0, 60000);
          const chineseChars = trimmed.replace(/[^一-鿿]/g, '');
          if (chineseChars.length < 20) {
            throw new Error(`"${doc.filename}" 内容过短或无可识别中文文本，请检查文件。`);
          }
          return { filename: doc.filename, text: trimmed };
        })
      );

      const llmConfig = getConfig();
      const buildDocumentsForPrompt = (maxCharsPerDocument: number) =>
        parsedDocs.map((d) =>
          `【${d.filename}】\n${d.text.slice(0, maxCharsPerDocument)}\n`
        ).join('\n---\n');

      const shouldRetryWithShorterPrompt = (message: string) =>
        /only thinking\/reasoning content|empty response|可解析的 JSON|不完整的 JSON|LLM returned empty response/i.test(message);
      const promptAttempts = buildContinuationPackParseAttempts(llmConfig.baseUrl);

      let parsed: unknown = null;
      let lastParseError: unknown = null;
      for (const attempt of promptAttempts) {
        try {
          const raw = await generateText(llmConfig, {
            prompt: buildContinuationPackPrompt(
              buildDocumentsForPrompt(attempt.maxCharsPerDocument),
              attempt.compactMode,
            ),
            timeoutMs: 90_000,
            maxAttempts: 3,
            maxTokens: attempt.maxTokens,
            responseMimeType: 'application/json',
            disableThinking: true,
          });
          parsed = parseModelJsonPayload<unknown>(raw);
          break;
        } catch (error) {
          lastParseError = error;
          const message = error instanceof Error ? error.message : String(error);
          if (!shouldRetryWithShorterPrompt(message) || attempt === promptAttempts[promptAttempts.length - 1]) {
            throw error;
          }
        }
      }
      if (!parsed) {
        throw lastParseError instanceof Error ? lastParseError : new Error(String(lastParseError || '模型未返回可用 JSON，请重试。'));
      }

      const parsedRecord = asRecord(parsed);
      const now = Date.now();
      const packId = `cont-pack-${generateId()}`;
      const pack = {
        id: packId,
        novelId,
        title: title || '续写资料包',
        status: 'draft' as const,
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
        sourceBadge: 'user-uploaded' as const,
        createdAt: now,
        updatedAt: now,
      };

      if (novelId.startsWith('continuation-import-draft-')) {
        if (databaseGeneration !== getDatabaseGeneration()) {
          return res.status(409).json({ error: '数据库已在解析期间切换，请重新导入资料' });
        }
        pruneParseDocJobs();
        pendingContinuationImports.set(pack.id, {
          pack,
          createdAt: Date.now(),
          databaseGeneration,
        });
      } else {
        const writeResult = await runInSerializedWriteForGeneration(
          databaseGeneration,
          () => db.createContinuationPack(pack),
        );
        if (!writeResult.executed) {
          return res.status(409).json({ error: '数据库已在解析期间切换，请重新导入资料' });
        }
      }
      res.json({ pack });
    } catch (e) {
      logger.error(String(e));
      const message = e instanceof Error ? e.message : String(e);

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

        approvedPack = {
          ...sourcePack,
          novelId: approvedNovel.id,
          status: 'approved',
          updatedAt: Date.now(),
        };
        if (pending) {
          db.createContinuationPack(approvedPack);
        } else if (!db.updateContinuationPack(sourcePack.id, {
          novelId: approvedNovel.id,
          status: 'approved',
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
}
