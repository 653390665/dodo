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
import { parseModelJsonPayload, parseModelJsonPayloadStrict, ModelJsonSyntaxError, ModelJsonTruncatedError } from '../../shared/lib/model-json';
import * as db from '../lib/db';
import { computeContinuationPackContentHash } from '../lib/db-mappers';
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
  isDbInitialized,
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
import type { SyncExtractionResult } from '../../shared/lib/sync-extract-prompt';
import { ProviderError } from '../lib/server-llm';
import type { ProviderErrorCode } from '../lib/server-llm';
import { safeJobError } from '../helpers/job-error';
import { createHash } from 'node:crypto';
import type { OutputDiagnostic } from '../lib/server-llm';
import {
  buildRelationshipRepairPrompt,
  extractRelationshipEvidence,
  normalizeRelationshipRecommendations,
} from '../../shared/lib/relationship-repair';
import type { RelationshipEntityType, RelationshipRepairInput } from '../../shared/lib/relationship-repair';
import {
  buildSyncExtractionChunks,
  mergeSyncExtractionResults,
  SYNC_EXTRACTION_MAX_CHUNKS,
  SyncExtractionChunkLimitError,
} from '../../shared/lib/sync-extraction-chunks';


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
interface EntityExtractionJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  progress: number;
  stageText: string;
  result?: { packId: string; novelId: string; databaseGeneration: number; extraction: SyncExtractionResult };
  error?: string;
  code?: string;
  createdAt: number;
  lastActivityAt: number;
  databaseGeneration: number;
  packId: string;
  novelId: string;
  totalChunks: number;
  currentChunk: number;
  traceId?: string;
  outputDiagnostic?: OutputDiagnostic;
  failedChunk?: { index: number; code: string; traceId?: string; attempt: number; providerRequestCount?: number };
  schemaIssues?: Array<{ path: string; code: string; message: string }>;
  warnings?: string[];
  completedResults?: SyncExtractionResult[];
  completedChunkIndexes?: number[];
  chunkMeta?: Array<{ index: number; filename: string; charCount: number; sha256?: string }>;
  splitCheckpoint?: { chunkIndex: number; splitAt: number; leftResults: SyncExtractionResult[] };
}
const entityExtractionJobs = new Map<string, EntityExtractionJob>();
const entityExtractionAbortControllers = new Map<string, AbortController>();
const entityExtractionRerunners = new Map<string, () => void>();
const entityExtractionResumeContexts = new Map<string, {
  chunkIndex: number;
  schemaIssues?: Array<{ path: string; code: string; message: string }>;
  repairKind?: 'json_syntax' | 'schema';
  splitAt?: number;
  leftResults?: SyncExtractionResult[];
}>();
const entityExtractionActiveRuns = new Set<string>();
const ENTITY_EXTRACTION_JOB_TTL_MS = 30 * 60 * 1000;
const pendingContinuationImports = new Map<string, {
  pack: ContinuationPack;
  createdAt: number;
  databaseGeneration: number;
}>();
const continuationImportSessions = new Map<string, {
  createdAt: number;
  databaseGeneration: number;
}>();
const CONTINUATION_IMPORT_SESSION_EXPIRED = 'CONTINUATION_IMPORT_SESSION_EXPIRED';
const CONTINUATION_IMPORT_GENERATION_CHANGED = 'CONTINUATION_IMPORT_GENERATION_CHANGED';
const CONTINUATION_IMPORT_PACK_EXPIRED = 'CONTINUATION_IMPORT_PACK_EXPIRED';

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

const resolveContinuationPackConflictsSchema = z.object({
  packId: z.string().min(1).max(300),
  novelId: z.string().min(1).max(300),
  databaseGeneration: z.number().int().nonnegative(),
  conflictResolutions: z.array(z.object({
    contradictionId: z.string().min(1).max(300),
    resolution: z.string().trim().min(1).max(1_000),
  })).min(1).max(10),
});

const MAX_SYNC_ENTITY_COUNT = 50 * SYNC_EXTRACTION_MAX_CHUNKS;
const MAX_SYNC_POWER_LEVEL_COUNT = 30 * SYNC_EXTRACTION_MAX_CHUNKS;
const MAX_SYNC_RELATIONSHIP_COUNT = 100 * SYNC_EXTRACTION_MAX_CHUNKS;
const MAX_SYNC_TRAIT_COUNT = 20 * SYNC_EXTRACTION_MAX_CHUNKS;
const MAX_SYNC_TEXT_LENGTH = 50_000 * SYNC_EXTRACTION_MAX_CHUNKS;
const MAX_EXTRACTION_ENTITY_COUNT = 180;

const relationshipRepairSchema = z.object({
  packId: z.string().trim().min(1).max(300),
  novelId: z.string().trim().min(1).max(300),
  databaseGeneration: z.number().int().nonnegative(),
  relationships: z.array(z.object({
    index: z.number().int().nonnegative().max(10_000),
    sourceName: z.string().trim().min(1).max(200),
    sourceType: z.enum(['character', 'location', 'item', 'faction']),
    targetName: z.string().trim().min(1).max(200),
    targetType: z.enum(['character', 'location', 'item', 'faction']),
    relationshipType: z.string().trim().min(1).max(200),
    description: z.string().max(2_000).default(''),
  })).min(1).max(50).superRefine((items, context) => {
    const seen = new Set<number>();
    items.forEach((item, index) => {
      if (seen.has(item.index)) context.addIssue({ code: 'custom', path: [index, 'index'], message: 'index must be unique' });
      seen.add(item.index);
    });
  }),
  candidates: z.object({
    character: z.array(z.string().trim().min(1).max(200)).max(500),
    location: z.array(z.string().trim().min(1).max(200)).max(500),
    item: z.array(z.string().trim().min(1).max(200)).max(500),
    faction: z.array(z.string().trim().min(1).max(200)).max(500),
  }),
});

const syncToWorldSchema = z.object({
  packId: z.string().min(1).max(300),
  novelId: z.string().min(1).max(300),
  databaseGeneration: z.number().int().nonnegative(),
  characters: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    role: z.enum(['protagonist', 'antagonist', 'supporting', 'extra']).default('supporting'),
    summary: z.string().max(2000).default(''),
    bio: z.string().max(5000).default(''),
    traits: z.array(z.string().max(100)).max(MAX_SYNC_TRAIT_COUNT).default([]),
    sourceDocumentIds: z.array(z.string().min(1).max(300)).max(20).default([]),
  })).max(MAX_SYNC_ENTITY_COUNT).default([]),
  locations: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    region: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
  })).max(MAX_SYNC_ENTITY_COUNT).default([]),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(['weapon', 'artifact', 'consumable', 'tool', 'other']).default('other'),
    description: z.string().max(2000).default(''),
  })).max(MAX_SYNC_ENTITY_COUNT).default([]),
  factions: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    leader: z.string().max(200).default(''),
    territory: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
  })).max(MAX_SYNC_ENTITY_COUNT).default([]),
  powerLevels: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    tier: z.number().int().min(0).max(100).default(0),
    characteristics: z.string().max(2000).default(''),
    description: z.string().max(2000).default(''),
  })).max(MAX_SYNC_POWER_LEVEL_COUNT).default([]),
  timelineEvents: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    timestamp: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
    order: z.number().int().min(0).max(10000).default(0),
  })).max(MAX_SYNC_ENTITY_COUNT).default([]),
  relationships: z.array(z.object({
    sourceName: z.string().trim().min(1).max(200),
    sourceType: z.enum(['character', 'location', 'item', 'faction']),
    targetName: z.string().trim().min(1).max(200),
    targetType: z.enum(['character', 'location', 'item', 'faction']),
    relationshipType: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default(''),
  })).max(MAX_SYNC_RELATIONSHIP_COUNT).default([]),
  globalOutline: z.string().max(MAX_SYNC_TEXT_LENGTH).optional(),
  worldRules: z.string().max(MAX_SYNC_TEXT_LENGTH).optional(),
});

const extractionResultSchema = z.object({
  characters: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    role: z.enum(['protagonist', 'antagonist', 'supporting', 'extra']).default('supporting'),
    summary: z.string().max(2000).default(''),
    bio: z.string().max(5000).default(''),
    traits: z.array(z.string().max(100)).max(20).default([]),
    sourceDocumentIds: z.array(z.string().min(1).max(300)).max(20).default([]),
  })).max(MAX_EXTRACTION_ENTITY_COUNT).default([]),
  locations: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    region: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
  })).max(MAX_EXTRACTION_ENTITY_COUNT).default([]),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(['weapon', 'artifact', 'consumable', 'tool', 'other']).default('other'),
    description: z.string().max(2000).default(''),
  })).max(MAX_EXTRACTION_ENTITY_COUNT).default([]),
  factions: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    leader: z.string().max(200).default(''),
    territory: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
  })).max(MAX_EXTRACTION_ENTITY_COUNT).default([]),
  powerLevels: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    tier: z.number().int().min(0).max(100).default(0),
    characteristics: z.string().max(2000).default(''),
    description: z.string().max(2000).default(''),
  })).max(MAX_EXTRACTION_ENTITY_COUNT).default([]),
  timelineEvents: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    timestamp: z.string().max(200).default(''),
    description: z.string().max(2000).default(''),
    order: z.number().int().min(0).max(10000).default(0),
  })).max(MAX_EXTRACTION_ENTITY_COUNT).default([]),
  relationships: z.array(z.object({
    sourceName: z.string().trim().min(1).max(200),
    sourceType: z.enum(['character', 'location', 'item', 'faction']),
    targetName: z.string().trim().min(1).max(200),
    targetType: z.enum(['character', 'location', 'item', 'faction']),
    relationshipType: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default(''),
  })).max(MAX_EXTRACTION_ENTITY_COUNT).default([]),
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
  const extractionCutoff = Date.now() - ENTITY_EXTRACTION_JOB_TTL_MS;
  if (isDbInitialized()) {
    db.pruneStaleContinuationExtractionJobs(extractionCutoff);
  }
  for (const [id, job] of entityExtractionJobs) {
    if (job.lastActivityAt < extractionCutoff) {
      entityExtractionAbortControllers.get(id)?.abort(new Error('Entity extraction job expired'));
      entityExtractionAbortControllers.delete(id);
      entityExtractionRerunners.delete(id);
      entityExtractionResumeContexts.delete(id);
      entityExtractionJobs.delete(id);
    }
  }
  for (const [id, pending] of pendingContinuationImports) {
    if (pending.createdAt < cutoff) pendingContinuationImports.delete(id);
  }
  for (const [id, session] of continuationImportSessions) {
    if (session.createdAt < cutoff) continuationImportSessions.delete(id);
  }
}

function safeEntityExtractionJob(job: EntityExtractionJob): Omit<EntityExtractionJob, 'completedResults' | 'splitCheckpoint' | 'lastActivityAt'> {
  const safeJob = { ...job };
  delete safeJob.completedResults;
  delete safeJob.splitCheckpoint;
  Reflect.deleteProperty(safeJob, 'lastActivityAt');
  return safeJob;
}

function hydratePersistedExtractionJob(stored: ReturnType<typeof db.getContinuationExtractionJob>): EntityExtractionJob | undefined {
  if (!stored) return undefined;
  let checkpoint: Record<string, unknown> = {};
  let result: EntityExtractionJob['result'] | undefined;
  let protocolError = false;
  const markProtocolError = (message: string): void => {
    protocolError = true;
    logger.error(`恢复提取任务 ${stored.id} 的持久化协议校验失败:`, new Error(message));
  };
  const parseSnapshot = (raw: string | undefined, kind: 'checkpoint' | 'result'): unknown => {
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${kind} snapshot must be an object`);
      }
      return parsed;
    } catch (error) {
      protocolError = true;
      logger.error(`恢复提取任务 ${stored.id} 的 ${kind} 快照解析失败:`, error);
      return undefined;
    }
  };
  const parsedCheckpoint = parseSnapshot(stored.checkpointJson, 'checkpoint');
  if (parsedCheckpoint && typeof parsedCheckpoint === 'object' && !Array.isArray(parsedCheckpoint)) {
    checkpoint = parsedCheckpoint as Record<string, unknown>;
    const completedChunkIndexes = checkpoint.completedChunkIndexes;
    if (completedChunkIndexes !== undefined && (!Array.isArray(completedChunkIndexes) || completedChunkIndexes.some(index => !Number.isInteger(index) || (index as number) < 0))) {
      markProtocolError('completedChunkIndexes 字段无效');
      checkpoint.completedChunkIndexes = [];
    }
    const completedResults = checkpoint.completedResults;
    if (completedResults !== undefined && (!Array.isArray(completedResults) || completedResults.some(item => !extractionResultSchema.safeParse(item).success))) {
      markProtocolError('completedResults 字段无效');
      checkpoint.completedResults = [];
    }
    const failedChunk = checkpoint.failedChunk;
    if (failedChunk !== undefined) {
      const failed = failedChunk !== null && typeof failedChunk === 'object' && !Array.isArray(failedChunk) ? failedChunk as Record<string, unknown> : undefined;
      if (!failed || !Number.isInteger(failed.index) || (failed.index as number) < 0 || typeof failed.code !== 'string' || !Number.isInteger(failed.attempt) || (failed.attempt as number) < 1) {
        markProtocolError('failedChunk 字段无效');
        checkpoint.failedChunk = undefined;
      }
    }
    const chunkMeta = checkpoint.chunkMeta;
    if (chunkMeta !== undefined && (!Array.isArray(chunkMeta) || chunkMeta.some(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
      const meta = item as Record<string, unknown>;
      return !Number.isInteger(meta.index) || (meta.index as number) < 0 || typeof meta.filename !== 'string' || !Number.isInteger(meta.charCount) || (meta.charCount as number) < 0 || (meta.sha256 !== undefined && typeof meta.sha256 !== 'string');
    }))) {
      markProtocolError('chunkMeta 字段无效');
      checkpoint.chunkMeta = undefined;
    }
  }
  const parsedResult = parseSnapshot(stored.resultJson, 'result');
  if (parsedResult) {
    const candidate = parsedResult as Record<string, unknown>;
    const extraction = extractionResultSchema.safeParse(candidate.extraction);
    if (typeof candidate.packId !== 'string' || typeof candidate.novelId !== 'string' || !Number.isInteger(candidate.databaseGeneration) || !extraction.success) {
      markProtocolError('result 快照字段无效');
    } else {
      result = { packId: candidate.packId, novelId: candidate.novelId, databaseGeneration: candidate.databaseGeneration as number, extraction: extraction.data };
    }
  }
  if (stored.status === 'completed' && !result) markProtocolError('已完成任务缺少有效结果快照');
  const job: EntityExtractionJob = { id: stored.id, status: protocolError ? 'failed' : stored.status, progress: stored.progress, stageText: protocolError ? '提取任务检查点损坏' : stored.stageText, createdAt: stored.createdAt, lastActivityAt: stored.updatedAt, databaseGeneration: stored.databaseGeneration, packId: stored.packId, novelId: stored.novelId, totalChunks: stored.totalBatches, currentChunk: stored.batchCursor, traceId: typeof checkpoint.traceId === 'string' ? checkpoint.traceId : undefined, completedResults: Array.isArray(checkpoint.completedResults) ? checkpoint.completedResults as SyncExtractionResult[] : [], completedChunkIndexes: Array.isArray(checkpoint.completedChunkIndexes) ? checkpoint.completedChunkIndexes as number[] : [], splitCheckpoint: checkpoint.splitCheckpoint as EntityExtractionJob['splitCheckpoint'], failedChunk: checkpoint.failedChunk as EntityExtractionJob['failedChunk'], schemaIssues: checkpoint.schemaIssues as EntityExtractionJob['schemaIssues'], warnings: checkpoint.warnings as string[], chunkMeta: checkpoint.chunkMeta as EntityExtractionJob['chunkMeta'], outputDiagnostic: checkpoint.outputDiagnostic as OutputDiagnostic, code: protocolError ? 'EXTRACTION_PROTOCOL_ERROR' : stored.errorCode, error: protocolError ? '提取任务检查点损坏，无法恢复，请从头重新提取' : stored.errorMessage, result };
  if (protocolError) {
    void touchEntityExtractionJob(job, 'protocol-recovery').catch(error => {
      logger.error(`协议错误任务 ${job.id} 无法持久化失败状态:`, error);
    });
  }
  return job;
}

function getCachedOrPersistedEntityExtractionJob(jobId: string): EntityExtractionJob | undefined {
  const cached = entityExtractionJobs.get(jobId);
  if (cached) return cached;
  const persisted = hydratePersistedExtractionJob(db.getContinuationExtractionJob(jobId));
  if (persisted) entityExtractionJobs.set(persisted.id, persisted);
  return persisted;
}

function buildEntityExtractionCheckpoint(job: EntityExtractionJob): Record<string, unknown> {
  return {
    completedResults: job.completedResults || [], completedChunkIndexes: job.completedChunkIndexes || [], splitCheckpoint: job.splitCheckpoint,
    failedChunk: job.failedChunk, schemaIssues: job.schemaIssues, warnings: job.warnings, chunkMeta: job.chunkMeta, outputDiagnostic: job.outputDiagnostic,
    traceId: job.traceId,
  };
}

function createEntityExtractionJob(job: EntityExtractionJob): void {
  db.createContinuationExtractionJob({
    id: job.id, packId: job.packId, novelId: job.novelId, status: job.status,
    progress: job.progress, stageText: job.stageText, batchCursor: job.currentChunk, totalBatches: job.totalChunks,
    checkpointJson: JSON.stringify(buildEntityExtractionCheckpoint(job)),
    databaseGeneration: job.databaseGeneration, createdAt: job.createdAt, updatedAt: job.lastActivityAt,
  });
  entityExtractionJobs.set(job.id, job);
}

function clearEntityExtractionRuntimeHandles(jobId: string, status?: EntityExtractionJob['status']): void {
  entityExtractionActiveRuns.delete(jobId);
  entityExtractionAbortControllers.delete(jobId);
  if (status === 'completed') {
    entityExtractionRerunners.delete(jobId);
    entityExtractionResumeContexts.delete(jobId);
  }
}

function extractionCodeForProviderError(error: ProviderError): string {
  const codes: Record<ProviderErrorCode, string> = {
    configuration: 'EXTRACTION_CONFIG',
    authentication: 'EXTRACTION_AUTH',
    billing: 'EXTRACTION_QUOTA',
    parameter_incompatible: 'EXTRACTION_PROVIDER_PARAMETER',
    rate_limit: 'EXTRACTION_RATE_LIMIT',
    service_unavailable: 'EXTRACTION_SERVICE_UNAVAILABLE',
    network: 'EXTRACTION_NETWORK',
    timeout: 'EXTRACTION_TIMEOUT',
    empty_response: 'EXTRACTION_EMPTY_RESPONSE',
    quality_rejected: 'EXTRACTION_QUALITY_REJECTED',
  };
  return codes[error.code];
}

function buildProviderExtractionDiagnostic(error: ProviderError): OutputDiagnostic {
  return {
    provider: error.provider,
    responseFormatMode: error.compatibilityMode === 'plain_fallback' ? 'plain_fallback' : 'json_object',
    thinkingMode: error.compatibilityMode === 'omit_thinking' ? 'provider_default' : 'disabled',
    contentLength: 0,
    sanitizedLength: 0,
    reasoningContentPresent: false,
    thinkTagState: 'none',
    compatibilityMode: error.compatibilityMode,
    providerRequestCount: error.providerRequestCount,
    providerHttpStatus: error.httpStatus,
    rejectedParameter: error.rejectedParameter,
    providerErrorCode: error.providerErrorCode,
    finishReason: error.finishReason,
  };
}

function entityExtractionErrorMessage(code: string): string {
  return code === 'GENERATION_MISMATCH' ? '数据已变更，请刷新后重试'
    : code === 'EXTRACTION_CANCELLED' ? '提取已取消'
      : code === 'EXTRACTION_CHECKPOINT_PERSIST_FAILED' ? '提取进度保存失败，请从头重新提取'
        : code === 'EXTRACTION_CONFIG' || code === 'EXTRACTION_AUTH' ? '模型配置或鉴权不可用，请检查设置后重试'
          : code === 'EXTRACTION_TIMEOUT' ? '模型调用超时，请重试或拆分资料'
            : code === 'EXTRACTION_PROVIDER_PARAMETER' ? '模型服务拒绝当前 JSON 请求参数，请检查模型服务或设置'
              : code === 'EXTRACTION_RATE_LIMIT' ? '模型服务暂时限流，请稍后续跑'
                : code === 'EXTRACTION_SERVICE_UNAVAILABLE' ? '模型服务暂时不可用，请稍后续跑'
                  : code === 'EXTRACTION_NETWORK' ? '模型服务网络异常，请稍后续跑'
                    : code === 'EXTRACTION_EMPTY_RESPONSE' ? '模型返回空结果，请稍后续跑'
                      : code === 'EXTRACTION_INVALID_JSON' ? '模型返回结果无法解析，请重试'
                        : code === 'EXTRACTION_SCHEMA_MISMATCH' ? '模型返回字段不符合要求，可修复并重试本批'
                          : code === 'EXTRACTION_EMPTY_SEMANTIC_RESULT' ? '模型未提取到可用设定，请检查资料内容'
                            : code === 'EXTRACTION_OUTPUT_TRUNCATED' ? '模型输出被截断，请拆分资料后重试'
                              : '提取失败，请重试';
}

async function touchEntityExtractionJob(job: EntityExtractionJob, reason = 'state-change'): Promise<void> {
  job.lastActivityAt = Date.now();
  const checkpoint = buildEntityExtractionCheckpoint(job);
  let checkpointJson: string;
  let resultJson: string | undefined;
  try {
    checkpointJson = JSON.stringify(checkpoint);
    resultJson = job.result ? JSON.stringify(job.result) : undefined;
  } catch (error) {
    logger.error(`提取任务 ${job.id} 检查点序列化失败，保留上一个可靠检查点:`, error);
    throw new Error('EXTRACTION_CHECKPOINT_PERSIST_FAILED');
  }
  const persistedStatus = job.status;
  const persistedCurrentChunk = job.currentChunk;
  const persistedTotalChunks = job.totalChunks;
  const outcome = await runInSerializedWriteForGeneration(job.databaseGeneration, () => db.updateContinuationExtractionJob(job.id, {
    status: job.status, progress: job.progress, stageText: job.stageText, batchCursor: job.currentChunk,
    totalBatches: job.totalChunks, checkpointJson, errorCode: job.code, errorMessage: job.error,
    databaseGeneration: job.databaseGeneration, resultJson,
  }));
  if (!outcome.executed || !outcome.result) {
    throw new Error('EXTRACTION_CHECKPOINT_PERSIST_FAILED');
  }
  logger.info('提取任务检查点已持久化', { jobId: job.id, status: persistedStatus, currentChunk: persistedCurrentChunk, totalChunks: persistedTotalChunks, reason });
}

async function runPersistedExtractionJob(job: EntityExtractionJob, chunks: ReturnType<typeof buildSyncExtractionChunks>, resumeContext: {
  chunkIndex: number;
  splitAt?: number;
  leftResults?: SyncExtractionResult[];
  schemaIssues?: Array<{ path: string; code: string; message: string }>;
  repairKind?: 'json_syntax' | 'schema';
}): Promise<void> {
  if (entityExtractionActiveRuns.has(job.id)) return;
  entityExtractionActiveRuns.add(job.id);
  const controller = new AbortController();
  entityExtractionAbortControllers.set(job.id, controller);
  try {
    job.status = 'running';
    await touchEntityExtractionJob(job, 'started');
    const execution = await createLlmExecution({ operation: 'extract-pack-entities', novelId: job.novelId, timeoutMs: Math.max(120_000, chunks.length * 120_000), concurrency: 1, signal: controller.signal });
    const result = await execution.run(async ({ signal }) => {
      const partials = [...(job.completedResults || [])];
      for (const chunk of chunks) {
        if (job.completedChunkIndexes?.includes(chunk.index)) continue;
        if (job.databaseGeneration !== getDatabaseGeneration()) throw new Error('GENERATION_MISMATCH');
        job.currentChunk = chunk.index + 1;
        job.progress = Math.floor((chunk.index / chunks.length) * 90);
        job.stageText = `正在分析第 ${chunk.index + 1}/${chunks.length} 批`;
        await touchEntityExtractionJob(job, 'batch-start');
        const resumed = resumeContext.chunkIndex === chunk.index;
        const text = resumed && resumeContext.splitAt !== undefined ? chunk.text.slice(resumeContext.splitAt) : chunk.text;
        let parsed: z.infer<typeof extractionResultSchema> | undefined;
        let lastError: unknown;
        for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
          try {
            const raw = await generateText(getConfig(), {
              prompt: buildSyncExtractionPrompt([`【${chunk.filename}】\n[sourceDocumentId:${chunk.sourceDocumentId}]\n${text}`], { repairIssues: resumed ? resumeContext.schemaIssues : undefined, repairKind: resumed ? resumeContext.repairKind : undefined }),
              signal,
              timeoutMs: 90_000,
              maxAttempts: 1,
              maxTokens: 8000,
              traceId: job.traceId,
              responseMimeType: 'application/json',
              disableThinking: true,
            });
            const normalized = normalizeExtractionPayload(parseModelJsonPayloadStrict<unknown>(raw, { expectedRoot: 'object' }));
            const validated = extractionResultSchema.safeParse(normalized.value);
            if (!validated.success) {
              const error = new Error('EXTRACTION_SCHEMA_MISMATCH') as Error & { issues?: unknown };
              error.issues = validated.error.issues;
              throw error;
            }
            job.warnings = [...(job.warnings || []), ...normalized.warnings].slice(0, 50);
            parsed = validated.data;
          } catch (error) {
            lastError = error;
            if (signal.aborted) throw error;
          }
        }
        if (!parsed) throw lastError instanceof Error ? lastError : new Error('EXTRACTION_FAILED');
        if (resumed && resumeContext.leftResults && partials.length === 0) partials.push(...resumeContext.leftResults);
        partials.push(parsed);
        job.completedResults = partials.slice();
        job.completedChunkIndexes = [...(job.completedChunkIndexes || []), chunk.index];
        job.splitCheckpoint = undefined;
        await touchEntityExtractionJob(job, 'batch-completed');
      }
      return mergeSyncExtractionResults(partials);
    });
    if (job.databaseGeneration !== getDatabaseGeneration()) throw new Error('GENERATION_MISMATCH');
    job.result = { packId: job.packId, novelId: job.novelId, databaseGeneration: job.databaseGeneration, extraction: result };
    job.status = 'completed'; job.progress = 100; job.stageText = '提取完成';
    await touchEntityExtractionJob(job, 'completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'EXTRACTION_FAILED';
    job.status = 'failed';
    job.code = error instanceof ProviderError ? extractionCodeForProviderError(error)
      : message === 'GENERATION_MISMATCH' ? 'GENERATION_MISMATCH'
        : message === 'EXTRACTION_SCHEMA_MISMATCH' ? 'EXTRACTION_SCHEMA_MISMATCH'
          : message === 'EXTRACTION_CHECKPOINT_PERSIST_FAILED' ? 'EXTRACTION_CHECKPOINT_PERSIST_FAILED'
            : 'EXTRACTION_FAILED';
    if (error instanceof ProviderError) {
      job.traceId = error.traceId;
      job.outputDiagnostic = buildProviderExtractionDiagnostic(error);
    }
    job.error = entityExtractionErrorMessage(job.code);
    job.failedChunk = {
      index: Math.max(0, job.currentChunk - 1),
      code: job.code,
      traceId: job.traceId,
      attempt: error instanceof ProviderError ? error.attempt : 2,
      providerRequestCount: error instanceof ProviderError ? error.providerRequestCount : job.outputDiagnostic?.providerRequestCount,
    };
    if (error instanceof Error && (error as Error & { issues?: unknown }).issues) {
      job.schemaIssues = ((error as Error & { issues: Array<{ path: (string | number)[]; code: string; message: string }> }).issues || []).slice(0, 20).map(issue => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }));
    }
    if (job.databaseGeneration === getDatabaseGeneration()) {
      try {
        await touchEntityExtractionJob(job, 'failed');
      } catch (persistError) {
        logger.error(`提取任务 ${job.id} 失败状态无法持久化:`, persistError);
      }
    }
  } finally {
    clearEntityExtractionRuntimeHandles(job.id, job.status);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeExtractionPayload(value: unknown): { value: unknown; warnings: string[] } {
  const root = asRecord(value);
  const record = asRecord(root.data ?? root);
  const warnings: string[] = [];
  const numberOrOriginal = (input: unknown): unknown => {
    if (typeof input === 'string' && /^-?\d+(?:\.0+)?$/.test(input.trim())) return Number(input);
    return input;
  };
  const normalizeTier = (input: unknown): unknown => {
    const value = numberOrOriginal(input);
    if (typeof value !== 'number' || !Number.isFinite(value)) return value;
    const normalized = Math.max(0, Math.min(100, Math.round(value)));
    if (normalized !== value) warnings.push(`力量等级 tier「${value}」越界，已修正为 ${normalized}`);
    return normalized;
  };
  const roleAliases: Record<string, string> = {
    '主角': 'protagonist', '主人公': 'protagonist', 'protagonist': 'protagonist',
    '配角': 'supporting', '配角人物': 'supporting', 'supporting': 'supporting',
    '反派': 'antagonist', 'antagonist': 'antagonist',
    '路人': 'extra', '配角以外': 'extra', 'extra': 'extra',
  };
  const entityTypeAliases: Record<string, string> = {
    '人物': 'character', '角色': 'character', 'character': 'character',
    '地点': 'location', '场景': 'location', 'location': 'location',
    '物品': 'item', '道具': 'item', 'item': 'item',
    '势力': 'faction', '组织': 'faction', 'faction': 'faction',
  };
  const itemTypeAliases: Record<string, string> = {
    '武器': 'weapon', 'weapon': 'weapon', '法器': 'artifact', 'artifact': 'artifact',
    '消耗品': 'consumable', 'consumable': 'consumable', '工具': 'tool', 'tool': 'tool', '其他': 'other', 'other': 'other',
  };
  const normalizeRole = (input: unknown): unknown => {
    if (input == null) { warnings.push('人物 role 缺失，已降级为 supporting'); return 'supporting'; }
    if (typeof input !== 'string') { warnings.push('人物 role 类型无效，已降级为 supporting'); return 'supporting'; }
    const normalized = roleAliases[input.trim().toLowerCase()];
    if (normalized) return normalized;
    warnings.push(`人物 role「${input.slice(0, 40)}」未知，已降级为 supporting`);
    return 'supporting';
  };
  const normalizeType = (input: unknown): unknown => typeof input === 'string' ? (entityTypeAliases[input.trim().toLowerCase()] || input) : input;
  const normalizeItemType = (input: unknown): unknown => {
    if (input == null) { warnings.push('道具 type 缺失，已降级为 other'); return 'other'; }
    if (typeof input !== 'string') { warnings.push('道具 type 类型无效，已降级为 other'); return 'other'; }
    const normalized = itemTypeAliases[input.trim().toLowerCase()];
    if (normalized) return normalized;
    warnings.push(`道具 type「${input.slice(0, 40)}」未知，已降级为 other`);
    return 'other';
  };
  const normalizeOptionalString = (input: unknown): string => input == null ? '' : stringValue(input);
  const normalizeStringArray = (input: unknown): string[] => input == null ? [] : Array.isArray(input) ? input.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean) : typeof input === 'string' ? [input.trim()].filter(Boolean) : [];
  const withIdentity = (key: string, input: unknown, identity: 'name' | 'title' | 'sourceName' | 'targetName') => asArray(input).flatMap((item, index) => {
    const itemRecord = asRecord(item);
    if (typeof itemRecord[identity] !== 'string' || !itemRecord[identity].trim()) {
      warnings.push(`${key}[${index}] 缺少 ${identity}，已跳过`);
      return [];
    }
    return [{ ...itemRecord }];
  });
  return { value: {
    ...record,
    characters: withIdentity('characters', record.characters, 'name').map(item => ({ ...item, role: normalizeRole(item.role), summary: normalizeOptionalString(item.summary), bio: normalizeOptionalString(item.bio), traits: normalizeStringArray(item.traits) })),
    locations: withIdentity('locations', record.locations, 'name').map(item => ({ ...item, region: normalizeOptionalString(item.region), description: normalizeOptionalString(item.description) })),
    items: withIdentity('items', record.items, 'name').map(item => ({ ...item, type: normalizeItemType(item.type), description: normalizeOptionalString(item.description) })),
    factions: withIdentity('factions', record.factions, 'name').map(item => ({ ...item, leader: normalizeOptionalString(item.leader), territory: normalizeOptionalString(item.territory), description: normalizeOptionalString(item.description) })),
    powerLevels: withIdentity('powerLevels', record.powerLevels, 'name').map(item => ({ ...item, tier: normalizeTier(item.tier), characteristics: normalizeOptionalString(item.characteristics), description: normalizeOptionalString(item.description) })),
    timelineEvents: withIdentity('timelineEvents', record.timelineEvents, 'title').map(item => ({ ...item, timestamp: normalizeOptionalString(item.timestamp), description: normalizeOptionalString(item.description), order: numberOrOriginal(item.order) })),
    relationships: asArray(record.relationships).flatMap((item, index) => {
      const itemRecord = asRecord(item);
      if (typeof itemRecord.sourceName !== 'string' || !itemRecord.sourceName.trim() || typeof itemRecord.targetName !== 'string' || !itemRecord.targetName.trim()) {
        warnings.push(`relationships[${index}] 缺少实体名称，已跳过`);
        return [];
      }
      return [{
        ...itemRecord,
        sourceType: normalizeType(itemRecord.sourceType), targetType: normalizeType(itemRecord.targetType),
        relationshipType: normalizeOptionalString(itemRecord.relationshipType), description: normalizeOptionalString(itemRecord.description),
      }];
    }),
    globalOutline: typeof record.globalOutline === 'string' ? record.globalOutline : '',
    worldRules: typeof record.worldRules === 'string' ? record.worldRules : '',
  }, warnings };
}

function isEntityPayloadTooDense(value: unknown): boolean {
  const record = asRecord(value);
  return ['characters', 'locations', 'items', 'factions', 'powerLevels', 'timelineEvents', 'relationships']
    .reduce((count, key) => count + asArray(record[key]).length, 0) > MAX_EXTRACTION_ENTITY_COUNT;
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
    // Document extraction must return parseable JSON; pin thinking off and
    // give headroom so reasoning-heavy providers don't truncate it.
    maxTokens: 8000,
    disableThinking: true,
  });
  return parseModelJsonPayload<unknown>(rawText);
}

export function registerContinuationRoutes(app: Express) {
  if (isDbInitialized()) db.markRunningInterrupted();
  app.post('/api/continuation-packs/import-session', (_req, res) => {
    if (!rateLimit('continuation-import-session')) {
      return res.status(429).json({ error: '资料导入请求过于频繁，请稍后再试。', retryAfter: 5 });
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
      return res.status(429).json({ error: '设定文档解析请求过于频繁，请稍后再试。', retryAfter: 5 });
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
          error: `PARSE_DOC_FAILED: ${safeJobError(error, '解析失败，请稍后重试。')}`,
        });
      } finally {
        parseDocJobAbortControllers.delete(jobId);
      }
    })();
  });

  app.get('/api/parse-doc/jobs/:jobId', (req, res) => {
    pruneParseDocJobs();
    const job = parseDocJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: '解析任务不存在或已过期，请重新上传设定文档', code: 'PARSE_DOC_JOB_EXPIRED' });
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
    if (!job) return res.status(404).json({ error: '解析任务不存在或已过期，请重新上传设定文档', code: 'PARSE_DOC_JOB_EXPIRED' });
    const controller = parseDocJobAbortControllers.get(req.params.jobId);
    if (!controller || job.status === 'completed' || job.status === 'failed') {
      return res.status(409).json({ error: '解析任务不可取消' });
    }
    controller.abort(new Error('设定文档解析任务已取消。'));
    parseDocJobAbortControllers.delete(req.params.jobId);
    Object.assign(job, { status: 'failed', progress: 100, stageText: '已取消', error: '设定文档解析任务已取消。' });
    return res.json({ cancelled: true });
  });

  app.post('/api/continuation-packs/parse', validate(continuationParseSchema), async (req, res) => {
    const controller = new AbortController();
    const disposeDisconnect = bindClientDisconnect(req, res, () => controller.abort());
    try {
      if (!rateLimit('continuation-packs-parse')) {
        return res.status(429).json({ error: '续写资料解析请求过于频繁，请稍后再试。', retryAfter: 5 });
      }
      const databaseGeneration = getDatabaseGeneration();
      const novelId = stringValue(req.body.novelId);
      const title = stringValue(req.body.title);
      const documents = asArray(req.body.documents) as UploadedDocument[];
      if (!novelId.trim()) return res.status(400).json({ error: '请先选择作品或重新开始资料导入。' });
      if (!documents.length) return res.status(400).json({ error: '请至少上传一份续写资料。' });

      const isPendingNovelImport = novelId.startsWith('continuation-import-draft-');
      if (isPendingNovelImport) {
        const session = continuationImportSessions.get(novelId);
        continuationImportSessions.delete(novelId);
        if (!session || session.databaseGeneration !== databaseGeneration) {
          return res.status(400).json({
            error: '续写导入会话无效或已过期，请重新开始导入',
            code: CONTINUATION_IMPORT_SESSION_EXPIRED,
          });
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
            sha256: createHash('sha256').update(d.text).digest('hex'),
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
          syncState: {
            status: 'not_started', contentHash: '', pendingRelationshipCount: 0,
            summary: { characters: 0, locations: 0, items: 0, factions: 0, powerLevels: 0, timelineEvents: 0, relationships: 0 },
          },
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
        return res.status(409).json({
          error: '数据库已在解析期间切换，请重新导入资料',
          code: CONTINUATION_IMPORT_GENERATION_CHANGED,
        });
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
      return res.status(409).json({
        error: '数据库已在解析后切换，请重新导入资料',
        code: CONTINUATION_IMPORT_GENERATION_CHANGED,
      });
    }
    const storedPack = db.getContinuationPack(input.packId);
    const sourcePack = pending?.pack || storedPack;
    if (!sourcePack) {
      return res.status(404).json({
        error: '续写资料包不存在或已过期，请重新导入资料',
        code: CONTINUATION_IMPORT_PACK_EXPIRED,
      });
    }
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

  app.post('/api/continuation-packs/resolve-conflicts', async (req, res) => {
    const parsed = resolveContinuationPackConflictsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '冲突裁决参数无效' });
    const input = parsed.data;
    if (input.databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据库已切换，请刷新后重试' });
    }

    try {
      const writeResult = await runInSerializedWriteForGeneration(input.databaseGeneration, () => {
        const sourcePack = db.getContinuationPack(input.packId);
        if (!sourcePack) throw new Error('CONTINUATION_PACK_NOT_FOUND');
        if (sourcePack.status !== 'approved') throw new Error('CONTINUATION_PACK_NOT_APPROVED');
        if (sourcePack.novelId !== input.novelId || !db.getNovel(input.novelId)) {
          throw new Error('CONTINUATION_PACK_NOVEL_MISMATCH');
        }

        const resolvedPack = applyContinuationConflictResolutions(sourcePack, input.conflictResolutions);
        const updatedAt = Date.now();
        db.runInTransaction(() => {
          if (!db.updateContinuationPack(sourcePack.id, {
            contradictions: resolvedPack.contradictions,
            updatedAt,
          })) {
            throw new Error('CONTINUATION_PACK_NOT_FOUND');
          }
        });
        return db.getContinuationPack(sourcePack.id);
      });
      if (!writeResult.executed) return res.status(409).json({ error: '数据库已切换，请刷新后重试' });
      if (!writeResult.result) return res.status(404).json({ error: '续写资料包不存在或已删除' });
      return res.json({ pack: writeResult.result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'CONTINUATION_PACK_NOT_FOUND') return res.status(404).json({ error: '续写资料包不存在或已删除' });
      if (message === 'CONTINUATION_PACK_NOT_APPROVED') return res.status(409).json({ error: '仅已确认的续写资料包可以修改冲突裁决' });
      if (message === 'CONTINUATION_PACK_NOVEL_MISMATCH') return res.status(409).json({ error: '资料包不属于指定作品' });
      if (/冲突裁决/.test(message) || /未知的冲突裁决 ID/.test(message)) {
        return res.status(400).json({ error: '冲突裁决无效，请检查冲突 ID 与方案内容' });
      }
      logger.error('保存续写资料包冲突裁决失败:', error);
      return res.status(409).json({ error: '保存冲突裁决失败，未写入资料包' });
    }
  });

  app.get('/api/continuation-packs/jobs/:jobId', async (req, res) => {
    pruneParseDocJobs();
    const job = getCachedOrPersistedEntityExtractionJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: '提取任务不存在', code: 'EXTRACTION_JOB_NOT_FOUND' });
    if (job.databaseGeneration !== getDatabaseGeneration()) {
      entityExtractionAbortControllers.get(req.params.jobId)?.abort(new Error('GENERATION_MISMATCH'));
      job.status = 'failed';
      job.code = 'GENERATION_MISMATCH';
      job.error = '数据已变更，请刷新后重试';
      job.progress = 100;
      try {
        await touchEntityExtractionJob(job, 'generation-mismatch');
      } catch (error) {
        logger.error(`提取任务 ${job.id} 的代次失败状态无法持久化:`, error);
      }
    }
    return res.json(safeEntityExtractionJob(job));
  });

  app.post('/api/continuation-packs/jobs/:jobId/cancel', async (req, res) => {
    pruneParseDocJobs();
    const job = getCachedOrPersistedEntityExtractionJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: '提取任务不存在', code: 'EXTRACTION_JOB_NOT_FOUND' });
    let cancelled = false;
    if (job.status === 'queued' || job.status === 'running') {
      entityExtractionAbortControllers.get(req.params.jobId)?.abort(new Error('EXTRACTION_CANCELLED'));
      entityExtractionAbortControllers.delete(req.params.jobId);
      entityExtractionRerunners.delete(req.params.jobId);
      entityExtractionResumeContexts.delete(req.params.jobId);
      job.status = 'failed';
      job.code = 'EXTRACTION_CANCELLED';
      job.error = '提取已取消';
      job.progress = 100;
      cancelled = true;
      try {
        await touchEntityExtractionJob(job, 'cancelled');
      } catch (error) {
        logger.error(`提取任务 ${job.id} 的取消状态无法持久化:`, error);
      }
    }
    return res.json({ cancelled, job: safeEntityExtractionJob(job) });
  });

  app.post('/api/continuation-packs/jobs/:jobId/resume', async (req, res) => {
    pruneParseDocJobs();
    const job = getCachedOrPersistedEntityExtractionJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: '提取任务不存在', code: 'EXTRACTION_JOB_NOT_FOUND' });
    if (job.status === 'queued') return res.status(202).json({ jobId: job.id, databaseGeneration: job.databaseGeneration, traceId: job.traceId });
    if (entityExtractionActiveRuns.has(job.id)) return res.status(202).json({ jobId: job.id, databaseGeneration: job.databaseGeneration, traceId: job.traceId });
    const failedCode = job.code;
    if (!['failed', 'interrupted'].includes(job.status) || (job.status === 'failed' && !job.failedChunk) || ['GENERATION_MISMATCH', 'EXTRACTION_CANCELLED', 'EXTRACTION_PROVIDER_PARAMETER', 'EXTRACTION_PROTOCOL_ERROR', 'EXTRACTION_CHECKPOINT_PERSIST_FAILED'].includes(failedCode || '')) {
      return res.status(409).json({ error: '该任务没有可续跑的失败批次，请从头重新提取', code: 'EXTRACTION_RESUME_UNAVAILABLE', traceId: job.traceId });
    }
    if (job.databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ error: '数据已变更，请刷新后重试', code: 'GENERATION_MISMATCH', traceId: job.traceId });
    }
    if (entityExtractionActiveRuns.has(job.id)) {
      return res.status(202).json({ jobId: job.id, databaseGeneration: job.databaseGeneration, traceId: job.traceId });
    }
    const pack = db.getContinuationPack(job.packId);
    if (!pack) return res.status(404).json({ error: '资料包不存在', code: 'EXTRACTION_PACK_NOT_FOUND' });
    let persistedChunks: ReturnType<typeof buildSyncExtractionChunks>;
    try {
      persistedChunks = buildSyncExtractionChunks(pack.sourceDocuments);
    } catch (error) {
      if (error instanceof SyncExtractionChunkLimitError) return res.status(413).json({ error: error.message, code: error.code, chunkCount: error.chunkCount });
      return res.status(400).json({ error: '资料包无法重新分块' });
    }
    const expectedMeta = job.chunkMeta || [];
    const metaMatches = persistedChunks.length === job.totalChunks && expectedMeta.length === persistedChunks.length && expectedMeta.every(meta => {
      const chunk = persistedChunks.find(item => item.index === meta.index);
      return chunk && chunk.filename === meta.filename && chunk.text.length === meta.charCount
        && (!meta.sha256 || createHash('sha256').update(chunk.text).digest('hex') === meta.sha256);
    });
    if (!metaMatches) return res.status(409).json({ error: '资料包内容已变更，请重新提取', code: 'EXTRACTION_CHECKPOINT_MISMATCH' });
    const resumeContext = {
      chunkIndex: job.failedChunk?.index ?? Math.max(0, job.currentChunk - 1),
      schemaIssues: job.schemaIssues,
      repairKind: failedCode === 'EXTRACTION_SCHEMA_MISMATCH' ? 'schema' : ['EXTRACTION_INVALID_JSON', 'EXTRACTION_OUTPUT_TRUNCATED'].includes(failedCode || '') ? 'json_syntax' : undefined,
      splitAt: job.splitCheckpoint?.splitAt,
      leftResults: job.splitCheckpoint?.leftResults,
    } as const;
    job.status = 'queued';
    job.error = undefined;
    job.code = undefined;
    job.schemaIssues = undefined;
    job.splitCheckpoint = undefined;
    job.failedChunk = undefined;
    try {
      await touchEntityExtractionJob(job, 'resume-queued');
    } catch (error) {
      job.status = 'failed';
      job.code = 'EXTRACTION_CHECKPOINT_PERSIST_FAILED';
      job.error = '提取进度保存失败，请从头重新提取';
      logger.error(`提取任务 ${job.id} 的续跑状态无法持久化:`, error);
      return res.status(409).json({ error: job.error, code: job.code, traceId: job.traceId });
    }
    entityExtractionResumeContexts.set(req.params.jobId, resumeContext);
    const rerunner = entityExtractionRerunners.get(req.params.jobId);
    if (rerunner) {
      rerunner();
    } else {
      const context = entityExtractionResumeContexts.get(job.id);
      entityExtractionRerunners.set(job.id, () => { void runPersistedExtractionJob(job, persistedChunks!, context || { chunkIndex: job.failedChunk?.index ?? Math.max(0, job.currentChunk - 1) }); });
      entityExtractionRerunners.get(job.id)?.();
    }
    return res.status(202).json({ jobId: req.params.jobId, databaseGeneration: job.databaseGeneration, traceId: job.traceId });
  });

  app.post('/api/continuation-packs/recommend-relationship-repairs', validate(relationshipRepairSchema), async (req, res) => {
    if (!rateLimit('continuation-packs-recommend-relationship-repairs')) {
      return res.status(429).json({ error: '关系修复推荐请求过于频繁，请稍后再试。', retryAfter: 5 });
    }
    const { packId, novelId, databaseGeneration, relationships, candidates } = req.body as z.infer<typeof relationshipRepairSchema>;
    const currentGeneration = getDatabaseGeneration();
    if (databaseGeneration !== currentGeneration) {
      return res.status(409).json({ error: '数据已变更，请刷新后重试', code: 'GENERATION_MISMATCH' });
    }
    const pack = db.getContinuationPack(packId);
    if (!pack) return res.status(404).json({ error: '资料包不存在' });
    if (pack.status !== 'approved') return res.status(400).json({ error: '仅已批准的资料包可以修复关系' });
    if (pack.novelId !== novelId) return res.status(403).json({ error: '资料包不属于当前作品' });

    const typedRelationships = relationships as RelationshipRepairInput[];
    const evidenceByIndex: Record<number, ReturnType<typeof extractRelationshipEvidence>> = {};
    for (const relationship of typedRelationships) {
      evidenceByIndex[relationship.index] = extractRelationshipEvidence(relationship, pack.sourceDocuments);
    }
    const prompt = buildRelationshipRepairPrompt(typedRelationships, candidates as Record<RelationshipEntityType, string[]>, evidenceByIndex);
    const controller = new AbortController();
    const disposeDisconnect = bindClientDisconnect(req, res, () => controller.abort());
    try {
      const execution = await createLlmExecution({
        operation: 'recommend-relationship-repairs',
        novelId,
        timeoutMs: 90_000,
        concurrency: 1,
        signal: controller.signal,
        databaseGeneration,
      });
      const modelOutput = await execution.run(({ signal, traceId }) => generateText(getConfig(), {
        prompt,
        signal,
        timeoutMs: 90_000,
        maxAttempts: 1,
        maxTokens: 8_000,
        responseMimeType: 'application/json',
        disableThinking: true,
        traceId,
      }).then(raw => parseModelJsonPayloadStrict<unknown>(raw)));
      if (databaseGeneration !== getDatabaseGeneration()) {
        return res.status(409).json({ error: '数据已变更，请刷新后重试', code: 'GENERATION_MISMATCH' });
      }
      return res.json({ recommendations: normalizeRelationshipRecommendations(typedRelationships, candidates as Record<RelationshipEntityType, string[]>, evidenceByIndex, modelOutput) });
    } catch (error) {
      if (error instanceof LlmExecutionRejectedError) {
        const message = error.quota.code === 'RATE_LIMITED'
          ? '关系修复推荐请求过于频繁，请稍后再试。'
          : error.message;
        return res.status(error.status).json({ error: message, quota: error.quota });
      }
      if (error instanceof ProviderError) {
        const statusByCode = {
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
        return res.status(statusByCode[error.code]).json({ error: error.message, code: error.code });
      }
      logger.error('关系修复推荐失败:', error);
      return res.status(502).json({ error: '关系推荐暂时不可用，请稍后重试' });
    } finally {
      disposeDisconnect();
    }
  });

  app.post('/api/continuation-packs/extract-entities', async (req, res) => {
    pruneParseDocJobs();
    if (!rateLimit('continuation-packs-extract')) {
      return res.status(429).json({ error: '资料设定提取请求过于频繁，请稍后再试。', retryAfter: 5 });
    }
    const { packId, novelId: reqNovelId, databaseGeneration: reqGeneration } = req.body;
    if (!packId || typeof packId !== 'string') {
      return res.status(400).json({ error: '请先选择要同步的续写资料包。' });
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

    let chunks;
    try {
      chunks = buildSyncExtractionChunks(pack.sourceDocuments);
    } catch (error) {
      if (error instanceof SyncExtractionChunkLimitError) {
        return res.status(413).json({ error: error.message, code: error.code, chunkCount: error.chunkCount });
      }
      throw error;
    }
    if (chunks.length === 0) {
      return res.status(400).json({ error: '资料包无有效文本内容' });
    }
    const jobId = `extract-entities-${generateId()}`;
    const job: EntityExtractionJob = {
      id: jobId,
      status: 'queued', progress: 0, stageText: '正在准备资料分块...',
      createdAt: Date.now(), lastActivityAt: Date.now(), databaseGeneration, packId, novelId,
      totalChunks: chunks.length, currentChunk: 0,
      traceId: `extract_${generateId()}`,
      completedResults: [],
      completedChunkIndexes: [],
      chunkMeta: chunks.map(chunk => ({ index: chunk.index, filename: chunk.filename, charCount: chunk.text.length, sha256: createHash('sha256').update(chunk.text).digest('hex') })),
    };
    createEntityExtractionJob(job);
    const runEntityExtraction = async () => {
      if (entityExtractionActiveRuns.has(jobId)) return;
      entityExtractionActiveRuns.add(jobId);
      const controller = new AbortController();
      entityExtractionAbortControllers.set(jobId, controller);
      const resumeContext = entityExtractionResumeContexts.get(jobId);
      entityExtractionResumeContexts.delete(jobId);
      let generationChanged = false;
      const generationWatch = setInterval(() => {
        try {
          if (databaseGeneration !== getDatabaseGeneration()) {
            generationChanged = true;
            controller.abort(new Error('GENERATION_MISMATCH'));
          }
        } catch {
          generationChanged = true;
          controller.abort(new Error('GENERATION_MISMATCH'));
        }
      }, 250);
      let lastFinishReason: string | undefined;
      let lastOutputDiagnostic: OutputDiagnostic | undefined;
      try {
        job.status = 'running';
        await touchEntityExtractionJob(job, 'started');
        const execution = await createLlmExecution({
          operation: 'extract-pack-entities', novelId,
          timeoutMs: Math.max(120_000, chunks.length * 120_000), concurrency: 1,
          signal: controller.signal,
        });
        const result = await execution.run(async ({ signal }) => {
          const partials: SyncExtractionResult[] = job.completedResults || [];
          const llmConfig = getConfig();
          const extractChunk = async (text: string, filename: string, sourceDocumentId: string, allowSplit: boolean, initialRepairIssues?: Array<{ path: string; code: string; message: string }>, initialRepairKind?: 'json_syntax' | 'schema'): Promise<z.infer<typeof extractionResultSchema>[]> => {
            let lastError: unknown;
            let firstError: unknown;
            let repairIssues = initialRepairIssues;
            let repairKind: 'json_syntax' | 'schema' | undefined = initialRepairKind || (initialRepairIssues?.length ? 'schema' : undefined);
            let attemptCount = 0;
            const attemptLimit = initialRepairIssues?.length || initialRepairKind ? 1 : 2;
            for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
              try {
                let truncated = false;
                attemptCount += 1;
                lastOutputDiagnostic = undefined;
                const raw = await generateText(llmConfig, {
                  prompt: buildSyncExtractionPrompt([`【${filename}】\n[sourceDocumentId:${sourceDocumentId}]\n${text}`], { repairIssues, repairKind }),
                  signal,
                  timeoutMs: 90_000, maxAttempts: 1, maxTokens: 8000,
                  traceId: job.traceId,
                  responseMimeType: 'application/json', disableThinking: true,
                  onComplete: metadata => {
                    truncated = metadata.truncated;
                    lastFinishReason = metadata.finishReason;
                    lastOutputDiagnostic = metadata.outputDiagnostic;
                  },
                });
                if (truncated) throw new Error('EXTRACTION_OUTPUT_TRUNCATED');
                const normalized = normalizeExtractionPayload(parseModelJsonPayloadStrict<unknown>(raw, { expectedRoot: 'object' }));
                if (isEntityPayloadTooDense(normalized.value)) throw new Error('EXTRACTION_OUTPUT_TRUNCATED');
                const validated = extractionResultSchema.safeParse(normalized.value);
                if (!validated.success) {
                  const error = new Error('EXTRACTION_SCHEMA_MISMATCH') as Error & { issues?: unknown };
                  error.issues = validated.error.issues;
                  repairIssues = validated.error.issues.slice(0, 20).map(issue => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }));
                  repairKind = 'schema';
                  throw error;
                }
                job.warnings = [...(job.warnings || []), ...normalized.warnings].slice(0, 50);
                if (validated.data.characters.length + validated.data.locations.length + validated.data.items.length + validated.data.factions.length + validated.data.powerLevels.length + validated.data.timelineEvents.length + validated.data.relationships.length === 0 && !validated.data.globalOutline.trim() && !validated.data.worldRules.trim()) {
                  throw new Error('EXTRACTION_EMPTY_SEMANTIC_RESULT');
                }
                return [validated.data];
              } catch (error) {
                if (firstError === undefined) firstError = error;
                if (error instanceof Error) (error as Error & { attempt?: number }).attempt = attemptCount;
                lastError = error;
                if (error instanceof ModelJsonSyntaxError) repairKind = 'json_syntax';
                if (signal.aborted) throw error;
                if (error instanceof ProviderError) {
                  (error as ProviderError & { previousError?: unknown }).previousError = firstError === error ? undefined : firstError;
                  throw error;
                }
                if (attempt === 0) continue;
              }
            }
            const code = lastError instanceof ModelJsonTruncatedError ? 'EXTRACTION_OUTPUT_TRUNCATED'
              : lastError instanceof ModelJsonSyntaxError ? 'EXTRACTION_INVALID_JSON'
                : lastError instanceof Error ? lastError.message : 'EXTRACTION_INVALID_JSON';
            if (allowSplit && ['EXTRACTION_OUTPUT_TRUNCATED', 'EXTRACTION_SCHEMA_MISMATCH', 'EXTRACTION_INVALID_JSON'].includes(code) && text.length >= 2_000) {
              const midpoint = Math.floor(text.length / 2);
              const left = await extractChunk(text.slice(0, midpoint), filename, sourceDocumentId, false);
              job.splitCheckpoint = { chunkIndex: job.currentChunk - 1, splitAt: midpoint, leftResults: left };
              try {
                const right = await extractChunk(text.slice(midpoint), filename, sourceDocumentId, false);
                job.splitCheckpoint = undefined;
                return [...left, ...right];
              } catch (error) {
                job.completedResults = [...partials, ...left];
                throw error;
              }
            }
            if (lastError instanceof Error) (lastError as Error & { attempt?: number }).attempt = attemptCount;
            throw lastError instanceof Error ? lastError : new Error('EXTRACTION_INVALID_JSON');
          };
          for (const chunk of chunks) {
            if (job.completedChunkIndexes?.includes(chunk.index)) continue;
            if (signal.aborted || databaseGeneration !== getDatabaseGeneration()) throw new Error(databaseGeneration !== getDatabaseGeneration() ? 'GENERATION_MISMATCH' : 'EXTRACTION_CANCELLED');
            job.currentChunk = chunk.index + 1;
            job.progress = Math.floor((chunk.index / chunks.length) * 90);
            job.stageText = `正在分析第 ${chunk.index + 1}/${chunks.length} 批`;
            await touchEntityExtractionJob(job, 'batch-start');
            const isResumedChunk = resumeContext?.chunkIndex === chunk.index;
            const resumedText = isResumedChunk && resumeContext.splitAt !== undefined ? chunk.text.slice(resumeContext.splitAt) : chunk.text;
            partials.push(...await extractChunk(resumedText, chunk.filename, chunk.sourceDocumentId, !isResumedChunk, isResumedChunk ? resumeContext.schemaIssues : undefined, isResumedChunk ? resumeContext.repairKind : undefined));
            job.completedResults = partials.slice();
            job.completedChunkIndexes = [...(job.completedChunkIndexes || []), chunk.index];
            await touchEntityExtractionJob(job, 'batch-completed');
          }
          job.stageText = '正在准备预览';
          job.progress = 95;
          return mergeSyncExtractionResults(partials);
        });
        if (databaseGeneration !== getDatabaseGeneration()) throw new Error('GENERATION_MISMATCH');
        if (controller.signal.aborted) throw new Error('EXTRACTION_CANCELLED');
        job.result = { packId, novelId, databaseGeneration, extraction: result };
        job.status = 'completed'; job.progress = 100; job.stageText = '提取完成';
        await touchEntityExtractionJob(job, 'completed');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'EXTRACTION_FAILED';
        const code = error instanceof LlmExecutionRejectedError
          ? error.quota.code === 'RATE_LIMITED' ? 'EXTRACTION_RATE_LIMIT'
            : error.quota.code === 'DATABASE_CHANGED' ? 'GENERATION_MISMATCH'
              : error.quota.code === 'QUOTA_EXCEEDED' ? 'EXTRACTION_QUOTA' : 'EXTRACTION_FAILED'
          : generationChanged || message === 'GENERATION_MISMATCH' ? 'GENERATION_MISMATCH'
          : message === 'EXTRACTION_CANCELLED' || controller.signal.aborted ? 'EXTRACTION_CANCELLED'
            : message === 'EXTRACTION_CHECKPOINT_PERSIST_FAILED' ? 'EXTRACTION_CHECKPOINT_PERSIST_FAILED'
            : error instanceof ModelJsonTruncatedError || message === 'EXTRACTION_OUTPUT_TRUNCATED' ? 'EXTRACTION_OUTPUT_TRUNCATED'
              : error instanceof ModelJsonSyntaxError || message === '模型返回的内容不是有效 JSON。' || message === '模型未返回可解析的 JSON。' ? 'EXTRACTION_INVALID_JSON'
                : message === 'EXTRACTION_SCHEMA_MISMATCH' ? 'EXTRACTION_SCHEMA_MISMATCH'
                : message === 'EXTRACTION_EMPTY_SEMANTIC_RESULT' ? 'EXTRACTION_EMPTY_SEMANTIC_RESULT'
              : error instanceof ProviderError ? ({
                configuration: 'EXTRACTION_CONFIG', authentication: 'EXTRACTION_AUTH', billing: 'EXTRACTION_QUOTA', parameter_incompatible: 'EXTRACTION_PROVIDER_PARAMETER',
                rate_limit: 'EXTRACTION_RATE_LIMIT', service_unavailable: 'EXTRACTION_SERVICE_UNAVAILABLE', network: 'EXTRACTION_NETWORK',
                timeout: 'EXTRACTION_TIMEOUT', empty_response: 'EXTRACTION_EMPTY_RESPONSE', quality_rejected: 'EXTRACTION_QUALITY_REJECTED',
              } as Record<ProviderErrorCode, string>)[error.code]
              : /api key|config/i.test(message) ? 'EXTRACTION_CONFIG'
                : /timeout|timed out/i.test(message) ? 'EXTRACTION_TIMEOUT' : 'EXTRACTION_FAILED';
        job.status = 'failed'; job.progress = 100; job.code = code;
        if (error instanceof ProviderError) {
          job.traceId = error.traceId;
        }
        const parserDiagnostic = error instanceof ModelJsonSyntaxError || error instanceof ModelJsonTruncatedError ? error.diagnostic : undefined;
        if (error instanceof ProviderError) {
          job.outputDiagnostic = buildProviderExtractionDiagnostic(error);
        } else if (lastOutputDiagnostic || parserDiagnostic) {
          job.outputDiagnostic = { ...lastOutputDiagnostic, ...parserDiagnostic } as OutputDiagnostic;
        }
        job.failedChunk = {
          index: Math.max(0, job.currentChunk - 1),
          code,
          attempt: error instanceof Error && typeof (error as Error & { attempt?: number }).attempt === 'number'
            ? (error as Error & { attempt: number }).attempt
            : error instanceof ProviderError ? error.attempt : 1,
          traceId: job.traceId,
          providerRequestCount: error instanceof ProviderError ? error.providerRequestCount : job.outputDiagnostic?.providerRequestCount,
        };
        if (error instanceof Error && (error as Error & { issues?: unknown }).issues) {
          job.schemaIssues = ((error as Error & { issues: Array<{ path: (string | number)[]; code: string; message: string }> }).issues || []).slice(0, 20).map(issue => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }));
        }
        const previousError = error instanceof ProviderError ? (error as ProviderError & { previousError?: { issues?: Array<{ path: (string | number)[]; code: string; message: string }> } }).previousError : undefined;
        if (!job.schemaIssues?.length && previousError?.issues) {
          job.schemaIssues = previousError.issues.slice(0, 20).map(issue => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }));
        }
        job.error = code === 'GENERATION_MISMATCH' ? '数据已变更，请刷新后重试'
          : code === 'EXTRACTION_CANCELLED' ? '提取已取消'
            : code === 'EXTRACTION_CHECKPOINT_PERSIST_FAILED' ? '提取进度保存失败，请从头重新提取'
              : code === 'EXTRACTION_CONFIG' || code === 'EXTRACTION_AUTH' ? '模型配置或鉴权不可用，请检查设置后重试'
              : code === 'EXTRACTION_TIMEOUT' ? '模型调用超时，请重试或拆分资料'
                : code === 'EXTRACTION_PROVIDER_PARAMETER' ? '模型服务拒绝当前 JSON 请求参数，请检查模型服务或设置'
                  : code === 'EXTRACTION_RATE_LIMIT' ? '模型服务暂时限流，请稍后续跑'
                    : code === 'EXTRACTION_SERVICE_UNAVAILABLE' ? '模型服务暂时不可用，请稍后续跑'
                      : code === 'EXTRACTION_NETWORK' ? '模型服务网络异常，请稍后续跑'
                        : code === 'EXTRACTION_EMPTY_RESPONSE' ? '模型返回空结果，请稍后续跑'
                          : code === 'EXTRACTION_QUALITY_REJECTED' ? '模型输出未通过质量校验，请重试'
                : code === 'EXTRACTION_INVALID_JSON' ? '模型返回结果无法解析，请重试'
                  : code === 'EXTRACTION_SCHEMA_MISMATCH' ? '模型返回字段不符合要求，可修复并重试本批'
                    : code === 'EXTRACTION_EMPTY_SEMANTIC_RESULT' ? '模型未提取到可用设定，请检查资料内容'
                    : code === 'EXTRACTION_OUTPUT_TRUNCATED' ? '模型输出被截断，请拆分资料后重试' : '提取失败，请重试';
        logger.error('资料包实体提取失败:', {
          traceId: job.traceId,
          batch: job.currentChunk,
          attempt: job.failedChunk?.attempt ?? 1,
          code,
          finishReason: lastFinishReason,
          outputDiagnostic: job.outputDiagnostic,
          issues: job.schemaIssues,
        });
        try {
          await touchEntityExtractionJob(job, 'failed');
        } catch (persistError) {
          logger.error(`提取任务 ${job.id} 的失败状态无法持久化:`, persistError);
        }
      } finally {
        clearInterval(generationWatch);
        clearEntityExtractionRuntimeHandles(jobId, job.status);
      }
    };
    entityExtractionRerunners.set(jobId, () => { void runEntityExtraction(); });
    void runEntityExtraction();
    return res.status(202).json({ jobId, databaseGeneration, traceId: job.traceId });
  });

  app.post('/api/continuation-packs/sync-to-world', async (req, res) => {
    if (!rateLimit('continuation-packs-sync')) {
      return res.status(429).json({ error: '同步到世界观请求过于频繁，请稍后再试。', retryAfter: 5 });
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
        const pendingRelationshipCount = skipped.relationships;
        const syncState = {
          status: pendingRelationshipCount > 0 ? 'partial' : 'synced',
          contentHash: computeContinuationPackContentHash(pack),
          lastSyncedAt: now,
          pendingRelationshipCount,
          summary: {
            characters: created.characters,
            locations: created.locations,
            items: created.items,
            factions: created.factions,
            powerLevels: created.powerLevels,
            timelineEvents: created.timelineEvents,
            relationships: created.relationships,
          },
        } as const;
        sqliteDb.prepare('UPDATE continuation_packs SET sync_state = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(syncState), now, packId);
        const sourceDocumentIds = new Set(pack.sourceDocuments.map((document) => document.id));
        const pendingCharacterFacts = characters.map((character) => {
          const requestedSourceIds = [...new Set(character.sourceDocumentIds.filter((id) => sourceDocumentIds.has(id)))];
          const canonFacts = pack.canonFacts
            .filter((fact) => fact.category === 'character' && (
              fact.text.includes(character.name)
              || (fact.sourceDocumentId !== undefined && requestedSourceIds.includes(fact.sourceDocumentId))
            ))
            .map((fact) => ({
              id: fact.id,
              text: fact.text,
              sourceDocumentId: fact.sourceDocumentId,
              evidence: fact.evidence,
            }));
          const fields = [
            character.summary ? { path: 'summary', value: character.summary, sourceDocumentIds: requestedSourceIds } : undefined,
            character.bio ? { path: 'bio', value: character.bio, sourceDocumentIds: requestedSourceIds } : undefined,
            character.traits.length ? { path: 'traits', value: character.traits, sourceDocumentIds: requestedSourceIds } : undefined,
          ].filter((field): field is NonNullable<typeof field> => Boolean(field));
          return { characterName: character.name, sourceDocumentIds: requestedSourceIds, fields, canonFacts };
        }).filter((fact) => fact.sourceDocumentIds.length > 0 || fact.canonFacts.length > 0);
        return { created, skipped, syncState, pendingCharacterFacts };
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
