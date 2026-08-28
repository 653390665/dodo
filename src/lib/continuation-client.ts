import type { ContinuationConflictResolution, ContinuationPack, ContinuationSyncState, Novel } from '../../shared/types';
import type { SyncExtractionResult } from '../../shared/lib/sync-extract-prompt';
import type { RelationshipRecommendation, RelationshipRepairInput, RelationshipEntityType } from '../../shared/lib/relationship-repair';
import { call, getDatabaseGenerationSnapshot } from './db-transport';
import { recordProductEvent } from './product-events-client';

export type RelationshipRepairRecommendation = RelationshipRecommendation;

function getContinuationImportErrorMessage(code?: string, error?: string): string {
  if (
    code === 'CONTINUATION_IMPORT_SESSION_EXPIRED'
    || code === 'CONTINUATION_IMPORT_GENERATION_CHANGED'
    || code === 'CONTINUATION_IMPORT_PACK_EXPIRED'
  ) {
    return '续写资料导入已失效，请重新导入资料。';
  }
  return error || '确认续写资料导入失败';
}

export async function recommendRelationshipRepairs(payload: {
  packId: string;
  novelId: string;
  databaseGeneration: number;
  relationships: RelationshipRepairInput[];
  candidates: Record<RelationshipEntityType, string[]>;
}): Promise<{ recommendations: RelationshipRepairRecommendation[] }> {
  const response = await fetch('/api/continuation-packs/recommend-relationship-repairs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as { recommendations?: RelationshipRepairRecommendation[]; error?: string };
  if (!response.ok || !Array.isArray(data.recommendations)) throw new Error(data.error || `推荐失败（HTTP ${response.status}）`);
  return { recommendations: data.recommendations };
}

export async function listContinuationPacks(novelId: string): Promise<ContinuationPack[]> {
  return call('listContinuationPacks', novelId);
}

export async function updateContinuationPack(id: string, data: { continuationTask?: string }): Promise<boolean> {
  return call('updateContinuationPack', id, data);
}

export async function deleteContinuationPack(id: string): Promise<boolean> {
  return call('deleteContinuationPack', id);
}

export async function approveContinuationImport(payload: {
  packId: string;
  mode: 'existing' | 'new';
  existingNovelId?: string;
  newNovel?: { title: string; summary: string };
  conflictResolutions: ContinuationConflictResolution[];
}): Promise<{ novel: Novel; pack: ContinuationPack }> {
  const startedAt = Date.now();
  const response = await fetch('/api/continuation-packs/approve-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as {
    novel?: Novel;
    pack?: ContinuationPack;
    error?: string;
    code?: string;
  };
  if (!response.ok || !data.novel || !data.pack) {
    void recordProductEvent({
      eventName: 'continuation_confirm', stage: 'review', result: 'failure',
      durationMs: Date.now() - startedAt, errorCode: data.code || `HTTP_${response.status}`,
      novelId: payload.existingNovelId, objectId: payload.packId,
    }).catch(() => undefined);
    throw new Error(getContinuationImportErrorMessage(data.code, data.error));
  }
  void recordProductEvent({
    eventName: 'continuation_confirm', stage: 'review', result: 'success',
    durationMs: Date.now() - startedAt, novelId: data.novel.id, objectId: data.pack.id,
  }).catch(() => undefined);
  return { novel: data.novel, pack: data.pack };
}

export async function resolveContinuationPackConflicts(payload: {
  packId: string;
  novelId: string;
  conflictResolutions: ContinuationConflictResolution[];
}): Promise<ContinuationPack> {
  const databaseGeneration = await getDatabaseGenerationSnapshot();
  const response = await fetch('/api/continuation-packs/resolve-conflicts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, databaseGeneration }),
  });
  const data = await response.json().catch(() => ({})) as { pack?: ContinuationPack; error?: string };
  if (!response.ok || !data.pack) {
    throw new Error(data.error || `保存冲突裁决失败（HTTP ${response.status}）`);
  }
  return data.pack;
}

export interface SyncToWorldRequest {
  packId: string;
  novelId: string;
  databaseGeneration: number;
  characters: Array<{ name: string; role: string; summary: string; bio: string; traits: string[]; sourceDocumentIds?: string[] }>;
  locations: Array<{ name: string; region: string; description: string }>;
  items: Array<{ name: string; type: string; description: string }>;
  factions: Array<{ name: string; leader: string; territory: string; description: string }>;
  powerLevels: Array<{ name: string; tier: number; characteristics: string; description: string }>;
  timelineEvents: Array<{ title: string; timestamp: string; description: string; order: number }>;
  relationships: Array<{ sourceName: string; sourceType: string; targetName: string; targetType: string; relationshipType: string; description: string }>;
  globalOutline?: string;
  worldRules?: string;
}

export interface SyncResult {
  created: { characters: number; locations: number; items: number; factions: number; powerLevels: number; timelineEvents: number; relationships: number };
  skipped: { characters: number; locations: number; items: number; factions: number; relationships: number };
  syncState: ContinuationSyncState;
  pendingCharacterFacts?: Array<{
    characterName: string;
    sourceDocumentIds: string[];
    fields: Array<{ path: 'summary' | 'bio' | 'traits'; value: string | string[]; sourceDocumentIds: string[] }>;
    canonFacts: Array<{ id: string; text: string; sourceDocumentId?: string; evidence: string }>;
  }>;
}

export async function syncPackToWorld(data: SyncToWorldRequest): Promise<SyncResult> {
  const startedAt = Date.now();
  let recorded = false;
  const record = (result: 'success' | 'failure' | 'unknown', errorCode?: string) => {
    if (recorded) return;
    recorded = true;
    void recordProductEvent({
      eventName: 'world_sync', stage: 'sync', result,
      durationMs: Date.now() - startedAt, errorCode,
      novelId: data.novelId, objectId: data.packId,
    }).catch(() => undefined);
  };
  try {
    const res = await fetch('/api/continuation-packs/sync-to-world', {
      method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      let err: { error?: string } = {};
      try { err = await res.json() as { error?: string }; } catch { /* use HTTP fallback */ }
      record('failure', `HTTP_${res.status}`);
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    let result: SyncResult;
    try { result = await res.json() as SyncResult; } catch {
      record('failure', 'MALFORMED_JSON');
      throw new Error('同步服务返回异常，请重试。');
    }
    record('success');
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') record('unknown', 'OPERATION_CANCELLED');
    else if (!recorded) record('failure', 'LOCAL_SERVICE_UNAVAILABLE');
    throw error;
  }
}

export interface ExtractionSnapshot {
  packId: string;
  novelId: string;
  databaseGeneration: number;
  extraction: SyncExtractionResult;
}

export interface ExtractionProgress {
  progress: number;
  stageText: string;
  status: string;
}

export type OutputDiagnostic = {
  provider?: 'deepseek' | 'minimax' | 'google' | 'openai-compatible';
  responseFormatMode?: 'json_object' | 'plain_fallback' | 'none';
  thinkingMode?: 'disabled' | 'provider_default';
  finishReason?: string;
  contentLength?: number;
  sanitizedLength?: number;
  reasoningContentPresent?: boolean;
  thinkTagState?: 'none' | 'closed_removed' | 'unclosed';
  parserStage?: 'no_candidate' | 'strict_parse' | 'quote_repair';
  candidateRoot?: 'object' | 'array' | 'none';
  candidateStart?: number;
  candidateLength?: number;
  balanced?: boolean;
  parseOffset?: number;
  providerHttpStatus?: number;
  rejectedParameter?: 'response_format' | 'thinking' | 'unknown';
  providerErrorCode?: string;
  compatibilityMode?: 'none' | 'omit_thinking' | 'plain_fallback';
  providerRequestCount?: number;
};

export class ContinuationClientError extends Error {
  constructor(message: string, public readonly code = 'CONTINUATION_REQUEST_FAILED', public readonly batch?: number, public readonly totalBatches?: number, public readonly traceId?: string, public readonly jobId?: string, public readonly databaseGeneration?: number, public readonly issues?: Array<{ path: string; code: string; message: string }>, public readonly attempt?: number, public readonly outputDiagnostic?: OutputDiagnostic, public readonly detailMessage?: string, public readonly httpStatus?: number) {
    super(message);
    this.name = 'ContinuationClientError';
  }
}

type ExtractionJobResponse = {
  status?: string;
  progress?: number;
  stageText?: string;
  currentChunk?: number;
  totalChunks?: number;
  result?: ExtractionSnapshot;
  error?: string;
  code?: string;
  traceId?: string;
  databaseGeneration?: number;
  outputDiagnostic?: OutputDiagnostic;
  schemaIssues?: Array<{ path: string; code: string; message: string }>;
  failedChunk?: { attempt?: number; index?: number; code?: string; traceId?: string; providerRequestCount?: number };
};

function isExtractionSnapshot(value: unknown): value is ExtractionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.packId === 'string'
    && typeof record.novelId === 'string'
    && typeof record.databaseGeneration === 'number'
    && !!record.extraction && typeof record.extraction === 'object';
}

async function readJson(response: Response, context?: { jobId?: string; databaseGeneration?: number }): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ContinuationClientError('提取服务返回了无法读取的响应。', 'EXTRACTION_PROTOCOL_ERROR', undefined, undefined, undefined, context?.jobId, context?.databaseGeneration, undefined, undefined, undefined, undefined, response.status);
  }
}

async function pollExtractionJob(jobId: string, databaseGeneration: number, signal?: AbortSignal, onProgress?: (progress: ExtractionProgress) => void): Promise<ExtractionSnapshot> {
  let completed = false;
  let pollFailures = 0;
  let cancelRequested = false;
  const cancel = () => {
    if (completed || cancelRequested) return;
    cancelRequested = true;
    void fetch(`/api/continuation-packs/jobs/${encodeURIComponent(jobId)}/cancel?databaseGeneration=${databaseGeneration}`, { method: 'POST' }).catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      let jobRes: Response;
      try {
        jobRes = await fetch(`/api/continuation-packs/jobs/${encodeURIComponent(jobId)}?databaseGeneration=${databaseGeneration}`, { signal });
        if (!jobRes.ok && jobRes.status >= 500) throw new Error(`polling HTTP ${jobRes.status}`);
        pollFailures = 0;
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        pollFailures += 1;
        if (pollFailures > 4) throw new ContinuationClientError('暂时无法读取提取进度，请稍后续跑。', 'EXTRACTION_POLLING_UNAVAILABLE', undefined, undefined, undefined, jobId, databaseGeneration);
        await new Promise(resolve => setTimeout(resolve, 500 * pollFailures));
        continue;
      }
      const job = await readJson(jobRes, { jobId, databaseGeneration }) as ExtractionJobResponse;
      if (!jobRes.ok) throw new ContinuationClientError(job.error || `无法查询提取任务（HTTP ${jobRes.status}）`, job.code || `HTTP_${job.status}`, job.currentChunk, job.totalChunks, job.traceId, jobId, databaseGeneration);
      if (!['queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled'].includes(job.status || '')) {
        throw new ContinuationClientError('提取任务返回了未知状态，请重新查询。', 'EXTRACTION_PROTOCOL_ERROR', job.currentChunk, job.totalChunks, job.traceId, jobId, databaseGeneration);
      }
      onProgress?.({ progress: job.progress ?? 0, stageText: job.stageText || '正在提取设定...', status: job.status || 'running' });
      if (job.status === 'completed' && job.result) { completed = true; return job.result; }
      if (job.status === 'completed') throw new ContinuationClientError('提取任务已完成但缺少预览结果。', 'EXTRACTION_PROTOCOL_ERROR', job.currentChunk, job.totalChunks, job.traceId, jobId, databaseGeneration);
      if (job.status === 'failed') throw new ContinuationClientError(job.error || '提取任务失败，请重试。', job.code || 'EXTRACTION_FAILED', job.currentChunk, job.totalChunks, job.traceId, jobId, databaseGeneration, job.schemaIssues, job.failedChunk?.attempt, job.outputDiagnostic, job.error, jobRes.status);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        };
        const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); resolve(); } }, 1500);
        const onAbort = () => { if (!settled) { settled = true; cleanup(); reject(signal?.reason || new DOMException('Aborted', 'AbortError')); } };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

export async function extractPackEntities(
  packId: string,
  novelId: string,
  signal?: AbortSignal,
  onProgress?: (progress: ExtractionProgress) => void,
): Promise<ExtractionSnapshot> {
  const databaseGeneration = await getDatabaseGenerationSnapshot();
  const res = await fetch('/api/continuation-packs/extract-entities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId, novelId, databaseGeneration }),
    signal,
  });
  const data = await readJson(res) as {
    jobId?: string;
    databaseGeneration?: number;
    packId?: string;
    novelId?: string;
    extraction?: SyncExtractionResult;
    error?: string;
    code?: string;
    traceId?: string;
  };
  if (!res.ok) {
    throw new ContinuationClientError(data.error || `提取失败（HTTP ${res.status}）`, data.code || `HTTP_${res.status}`, undefined, undefined, data.traceId);
  }
  if (!data.jobId) {
    if (!isExtractionSnapshot(data)) throw new ContinuationClientError('提取服务返回了不完整的任务响应。', 'EXTRACTION_PROTOCOL_ERROR', undefined, undefined, data.traceId);
    return data;
  }

  const jobId = data.jobId;
  const jobGeneration = typeof data.databaseGeneration === 'number' && Number.isInteger(data.databaseGeneration) ? data.databaseGeneration : databaseGeneration;
  return pollExtractionJob(jobId, jobGeneration, signal, onProgress);
}

export async function resumePackEntityExtraction(jobId: string, databaseGeneration: number, signal?: AbortSignal, onProgress?: (progress: ExtractionProgress) => void): Promise<ExtractionSnapshot> {
  const response = await fetch(`/api/continuation-packs/jobs/${encodeURIComponent(jobId)}/resume`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ databaseGeneration }), signal,
  });
  const data = await readJson(response, { jobId, databaseGeneration }) as { error?: string; code?: string; traceId?: string; databaseGeneration?: number; jobId?: string };
  if (!response.ok) throw new ContinuationClientError(data.error || '该任务无法续跑，请从头重新提取。', data.code || `HTTP_${response.status}`, undefined, undefined, data.traceId, jobId, databaseGeneration);
  if (data.jobId !== jobId || typeof data.databaseGeneration !== 'number' || data.databaseGeneration !== databaseGeneration) {
    throw new ContinuationClientError('续跑响应不完整，任务未被继续执行。', 'EXTRACTION_PROTOCOL_ERROR', undefined, undefined, data.traceId, jobId, databaseGeneration);
  }
  return pollExtractionJob(jobId, data.databaseGeneration, signal, onProgress);
}

export async function getPackEntityExtractionJob(jobId: string, databaseGeneration: number, signal?: AbortSignal): Promise<ExtractionJobResponse> {
  const response = await fetch(`/api/continuation-packs/jobs/${encodeURIComponent(jobId)}?databaseGeneration=${databaseGeneration}`, { signal });
  const data = await readJson(response, { jobId, databaseGeneration }) as ExtractionJobResponse;
  if (!response.ok) throw new ContinuationClientError(data.error || `无法查询提取任务（HTTP ${response.status}）`, data.code || `HTTP_${response.status}`, data.currentChunk, data.totalChunks, data.traceId, jobId, databaseGeneration);
  if (!['queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled'].includes(data.status || '')) throw new ContinuationClientError('提取任务返回了未知状态，请重新查询。', 'EXTRACTION_PROTOCOL_ERROR', undefined, undefined, data.traceId, jobId, databaseGeneration);
  return data;
}

export async function requeryPackEntityExtraction(jobId: string, databaseGeneration: number, signal?: AbortSignal, onProgress?: (progress: ExtractionProgress) => void): Promise<ExtractionSnapshot> {
  const job = await getPackEntityExtractionJob(jobId, databaseGeneration, signal);
  if (job.status === 'failed') throw new ContinuationClientError(job.error || '提取任务失败，请重试。', job.code || 'EXTRACTION_FAILED', job.currentChunk, job.totalChunks, job.traceId, jobId, databaseGeneration, job.schemaIssues, job.failedChunk?.attempt, job.outputDiagnostic, job.error);
  if (job.status === 'completed') {
    if (!job.result) throw new ContinuationClientError('提取任务已完成但缺少预览结果。', 'EXTRACTION_PROTOCOL_ERROR', job.currentChunk, job.totalChunks, job.traceId, jobId, databaseGeneration);
    return job.result;
  }
  return pollExtractionJob(jobId, databaseGeneration, signal, onProgress);
}
