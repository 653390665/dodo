import { logger } from '../logger';
import * as db from '../lib/db';
import { isDbInitialized, runInSerializedWriteForGeneration } from '../lib/db-instance';
import type { SyncExtractionResult } from '../../shared/lib/sync-extract-prompt';
import type { OutputDiagnostic } from '../lib/server-llm';

/**
 * Phase-1 home of the entity-extraction job lifecycle state previously kept in
 * four module-level containers inside server/routes/continuation.ts. The class
 * owns the in-memory maps/set and concentrates every memory+database dual-write
 * through create/touch; parse-doc, pending-import and import-session containers
 * intentionally stay in the route file (phase 2).
 */
export interface EntityExtractionJob {
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

export const ENTITY_EXTRACTION_JOB_TTL_MS = 30 * 60 * 1000;

function buildEntityExtractionCheckpoint(job: EntityExtractionJob): Record<string, unknown> {
  return {
    completedResults: job.completedResults || [], completedChunkIndexes: job.completedChunkIndexes || [], splitCheckpoint: job.splitCheckpoint,
    failedChunk: job.failedChunk, schemaIssues: job.schemaIssues, warnings: job.warnings, chunkMeta: job.chunkMeta, outputDiagnostic: job.outputDiagnostic,
    traceId: job.traceId,
  };
}

export class EntityExtractionJobManager {
  private readonly jobs = new Map<string, EntityExtractionJob>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly rerunners = new Map<string, () => void>();
  private readonly activeRuns = new Set<string>();

  /** Persist the initial job row and cache the in-memory job (dual-write). */
  create(job: EntityExtractionJob): void {
    db.createContinuationExtractionJob({
      id: job.id, packId: job.packId, novelId: job.novelId, status: job.status,
      progress: job.progress, stageText: job.stageText, batchCursor: job.currentChunk, totalBatches: job.totalChunks,
      checkpointJson: JSON.stringify(buildEntityExtractionCheckpoint(job)),
      databaseGeneration: job.databaseGeneration, createdAt: job.createdAt, updatedAt: job.lastActivityAt,
    });
    this.jobs.set(job.id, job);
  }

  get(jobId: string): EntityExtractionJob | undefined {
    return this.jobs.get(jobId);
  }

  /** Cache an in-memory job, e.g. one hydrated from the persisted row. */
  set(job: EntityExtractionJob): void {
    this.jobs.set(job.id, job);
  }

  isActive(jobId: string): boolean {
    return this.activeRuns.has(jobId);
  }

  abort(jobId: string, reason: string): void {
    this.abortControllers.get(jobId)?.abort(new Error(reason));
  }

  /**
   * Mark a job as running exactly once and hand back its abort controller.
   * Returns undefined when a run is already active for this job.
   */
  beginRun(jobId: string): AbortController | undefined {
    if (this.activeRuns.has(jobId)) return undefined;
    this.activeRuns.add(jobId);
    const controller = new AbortController();
    this.abortControllers.set(jobId, controller);
    return controller;
  }

  clearRuntimeHandles(jobId: string, status?: EntityExtractionJob['status'], onCleared?: (jobId: string) => void): void {
    this.activeRuns.delete(jobId);
    this.abortControllers.delete(jobId);
    if (status === 'completed') {
      this.rerunners.delete(jobId);
      onCleared?.(jobId);
    }
  }

  /** Cancel-route helper: abort the run and drop controller/rerunner handles. */
  abortAndDetach(jobId: string, reason: string, onDetached?: (jobId: string) => void): void {
    this.abort(jobId, reason);
    this.abortControllers.delete(jobId);
    this.rerunners.delete(jobId);
    onDetached?.(jobId);
  }

  registerRerunner(jobId: string, runner: () => void): void {
    this.rerunners.set(jobId, runner);
  }

  /** Invoke the registered rerunner; returns false when none is registered. */
  rerun(jobId: string): boolean {
    const rerunner = this.rerunners.get(jobId);
    if (!rerunner) return false;
    rerunner();
    return true;
  }

  /** Evict jobs idle past the TTL and prune their persisted counterparts. */
  prune(cutoff: number, onEvict?: (jobId: string) => void): void {
    if (isDbInitialized()) {
      db.pruneStaleContinuationExtractionJobs(cutoff);
    }
    for (const [id, job] of this.jobs) {
      if (job.lastActivityAt < cutoff) {
        this.abortControllers.get(id)?.abort(new Error('Entity extraction job expired'));
        this.abortControllers.delete(id);
        this.rerunners.delete(id);
        onEvict?.(id);
        this.jobs.delete(id);
      }
    }
  }

  /**
   * Single synchronization point for in-memory job state and its persisted
   * row. `persist:false` only refreshes the in-memory activity time; see the
   * in-body comment for the checkpoint granularity contract.
   */
  async touch(job: EntityExtractionJob, reason = 'state-change', options?: { persist?: boolean }): Promise<void> {
    job.lastActivityAt = Date.now();
    // persist:false 仅刷新内存活动时间（TTL 依赖 lastActivityAt），不序列化 checkpoint、不写库。
    // 断点粒度由 batch-completed 落盘的 completedChunkIndexes 决定，收窄后恢复语义不变。
    if (options?.persist === false) return;
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
}

export const extractionJobs = new EntityExtractionJobManager();
