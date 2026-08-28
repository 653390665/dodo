import type { ChapterProductionRun } from '../../shared/types';
import type { PromptSurface } from './prompt-stage-routing';
import { readSseEvents, SseParseError } from './sse-client';
import type { WritingStyleResolution, WritingStyleCandidate } from './writing-style-client';

export class ProductionStyleConfirmationRequiredError extends Error {
  readonly code = 'STYLE_CONFIRMATION_REQUIRED';
  constructor(readonly resolution?: WritingStyleResolution, readonly candidates?: WritingStyleCandidate[]) {
    super('Writing style confirmation is required');
    this.name = 'ProductionStyleConfirmationRequiredError';
  }
}

export class IncompleteProductionStreamError extends Error {
  constructor() {
    super('正文生成流在完成事件前中断');
    this.name = 'IncompleteProductionStreamError';
  }
}

type ScopedProductionPayload = {
  novelId: string;
  chapterId: string;
  databaseGeneration: number;
  targetChapterId?: string;
  userIntent: string;
  continuationPackId?: string;
  writingStyleFingerprint?: string;
  sessionCardIds?: string[];
  surface?: PromptSurface;
};

function requireProductionContext(payload: ScopedProductionPayload): void {
  if (!payload.chapterId || !Number.isInteger(payload.databaseGeneration) || payload.databaseGeneration < 0) {
    throw new Error('章节与数据库版本是正文生成的必需上下文');
  }
}

export async function startChapterProductionRun(payload: ScopedProductionPayload, signal?: AbortSignal): Promise<ChapterProductionRun> {
  requireProductionContext(payload);
  const { writingStyleFingerprint, ...requestPayload } = payload;
  const res = await fetch('/api/chapter-production-runs/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestPayload, styleConfirmationFingerprint: writingStyleFingerprint }),
    signal,
  });
  const data = await res.json();
  if (res.status === 409 && data.code === 'STYLE_CONFIRMATION_REQUIRED') {
    throw new ProductionStyleConfirmationRequiredError(data.resolution, data.candidates);
  }
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to start chapter production run');
  return data.run;
}

export type ProductionRunSSEEvent =
  | { type: 'run_created'; runId: string }
  | { type: 'status'; message: string }
  | { type: 'fallback_beats'; content: string }
  | { type: 'fallback_draft_token'; content: string }
  | { type: 'fallback_draft_done' }
  | { type: 'fallback_audit'; content: string }
  | { type: 'fallback_continuity'; report: ChapterProductionRun['continuityReport'] }
  | { type: 'model_beats'; content: string }
  | { type: 'model_draft_start' }
  | { type: 'model_draft_token'; content: string }
  | { type: 'model_draft_done' }
  | { type: 'model_audit'; content: string; isValid?: boolean; status?: 'pass' | 'fail' | 'unknown'; score?: number }
  | { type: 'model_continuity'; report: ChapterProductionRun['continuityReport'] }
  | { type: 'model_score'; score: number; attempts: number; status?: 'pass' | 'fail' | 'unknown' }
  | { type: 'done'; run: ChapterProductionRun }
  | { type: 'error'; message: string };

const PRODUCTION_RUN_STATUSES: ReadonlySet<string> = new Set([
  'running',
  'review_required',
  'applied',
  'rejected',
  'failed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isContinuityReport(value: unknown): value is ChapterProductionRun['continuityReport'] {
  if (
    !isRecord(value)
    || (value.score !== undefined && (typeof value.score !== 'number' || !Number.isFinite(value.score)))
    || !Array.isArray(value.issues)
  ) {
    return false;
  }
  const patch = value.proposedPatch;
  return isRecord(patch)
    && Array.isArray(patch.characterUpdates)
    && Array.isArray(patch.itemUpdates)
    && Array.isArray(patch.foreshadowingUpdates)
    && Array.isArray(patch.timelineEventsToCreate)
    && Array.isArray(patch.foreshadowingsToCreate);
}

function isChapterProductionRun(value: unknown): value is ChapterProductionRun {
  if (!isRecord(value)) return false;
  const hasReviewVersion = value.reviewVersionId !== undefined
    || value.reviewVersionHash !== undefined
    || value.reviewVersionSource !== undefined;
  const hasValidReviewVersion = !hasReviewVersion
    || (typeof value.reviewVersionId === 'string' && value.reviewVersionId.length > 0
      && typeof value.reviewVersionHash === 'string' && value.reviewVersionHash.length > 0
      && (value.reviewVersionSource === 'fallback' || value.reviewVersionSource === 'model'));
  return hasValidReviewVersion
    && typeof value.id === 'string'
    && typeof value.novelId === 'string'
    && typeof value.status === 'string'
    && PRODUCTION_RUN_STATUSES.has(value.status)
    && typeof value.userIntent === 'string'
    && typeof value.sceneBeats === 'string'
    && typeof value.draftContent === 'string'
    && typeof value.styleAudit === 'string'
    && isContinuityReport(value.continuityReport)
    && typeof value.createdAt === 'number'
    && Number.isFinite(value.createdAt)
    && typeof value.updatedAt === 'number'
    && Number.isFinite(value.updatedAt)
    && (value.targetChapterId === undefined || typeof value.targetChapterId === 'string')
    && (value.errorMessage === undefined || typeof value.errorMessage === 'string');
}

export async function startChapterProductionRunStream(
  payload: ScopedProductionPayload & {
    activeEntityNames?: string[];
  },
  onEvent: (event: ProductionRunSSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  requireProductionContext(payload);
  const { writingStyleFingerprint, ...requestPayload } = payload;
  const res = await fetch('/api/chapter-production-runs/start-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestPayload, styleConfirmationFingerprint: writingStyleFingerprint }),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Unknown error' }));
    if (res.status === 409 && data.code === 'STYLE_CONFIRMATION_REQUIRED') {
      throw new ProductionStyleConfirmationRequiredError(data.resolution, data.candidates);
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  if (!res.body) throw new Error('No response body');
  const allowedTypes = new Set<ProductionRunSSEEvent['type']>([
    'run_created', 'status', 'fallback_beats', 'fallback_draft_token',
    'fallback_draft_done', 'fallback_audit', 'fallback_continuity',
    'model_beats', 'model_draft_start', 'model_draft_token', 'model_draft_done', 'model_audit',
    'model_continuity', 'model_score', 'done', 'error',
  ]);
  let receivedTypedDone = false;
  await readSseEvents<Record<string, unknown>>(res, (data) => {
    if (typeof data.type !== 'string' || !allowedTypes.has(data.type as ProductionRunSSEEvent['type'])) {
      throw new SseParseError('Invalid production SSE event type');
    }
    if (data.type === 'done' && !isChapterProductionRun(data.run)) {
      throw new SseParseError('Production done event contains an invalid run');
    }
    onEvent(data as ProductionRunSSEEvent);
    if (data.type === 'done') {
      receivedTypedDone = true;
      return 'done';
    }
  });
  if (!receivedTypedDone) throw new IncompleteProductionStreamError();
}

export type ProductionApplyContext = {
  novelId: string;
  chapterId: string;
  databaseGeneration: number;
};

export async function applyChapterProductionRun(
  runId: string,
  context: ProductionApplyContext,
  version?: { versionId: string; versionHash: string },
  acceptUnreviewed = false,
): Promise<{ chapterId: string }> {
  requireProductionContext({ ...context, userIntent: '' });
  const res = await fetch(`/api/chapter-production-runs/${runId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...context, ...(version || {}), ...(acceptUnreviewed ? { acceptUnreviewed: true } : {}) }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to apply chapter production run');
  return { chapterId: data.chapterId };
}
