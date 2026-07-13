import type { ChapterProductionRun } from '../../shared/types';
import type { PromptSurface } from './prompt-stage-routing';
import { readSseEvents, SseParseError } from './sse-client';

export class IncompleteProductionStreamError extends Error {
  constructor() {
    super('正文生成流在完成事件前中断');
    this.name = 'IncompleteProductionStreamError';
  }
}

export async function startChapterProductionRun(payload: {
  novelId: string;
  targetChapterId?: string;
  userIntent: string;
  continuationPackId?: string;
  surface?: PromptSurface;
}, signal?: AbortSignal): Promise<ChapterProductionRun> {
  const res = await fetch('/api/chapter-production-runs/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const data = await res.json();
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
  | { type: 'model_audit'; content: string; isValid?: boolean }
  | { type: 'model_continuity'; report: ChapterProductionRun['continuityReport'] }
  | { type: 'model_score'; score: number; attempts: number }
  | { type: 'done'; run: ChapterProductionRun }
  | { type: 'error'; message: string };

export async function startChapterProductionRunStream(
  payload: {
    novelId: string;
    targetChapterId?: string;
    userIntent: string;
    continuationPackId?: string;
    surface?: PromptSurface;
    activeEntityNames?: string[];
  },
  onEvent: (event: ProductionRunSSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chapter-production-runs/start-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  if (!res.body) throw new Error('No response body');
  const allowedTypes = new Set<ProductionRunSSEEvent['type']>([
    'run_created', 'status', 'fallback_beats', 'fallback_draft_token',
    'fallback_draft_done', 'fallback_audit', 'fallback_continuity',
    'model_beats', 'model_draft_start', 'model_draft_token', 'model_draft_done', 'model_audit',
    'model_continuity', 'model_score', 'done', 'error',
  ]);
  const result = await readSseEvents<Record<string, unknown>>(res, (data) => {
    if (typeof data.type !== 'string' || !allowedTypes.has(data.type as ProductionRunSSEEvent['type'])) {
      throw new SseParseError('Invalid production SSE event type');
    }
    if (data.type === 'done' && (!data.run || typeof data.run !== 'object')) {
      throw new SseParseError('Production done event is missing its run');
    }
    onEvent(data as ProductionRunSSEEvent);
    if (data.type === 'done') return 'done';
  });
  if (!result.done) throw new IncompleteProductionStreamError();
}

export async function applyChapterProductionRun(runId: string): Promise<{ chapterId: string }> {
  const res = await fetch(`/api/chapter-production-runs/${runId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to apply chapter production run');
  return { chapterId: data.chapterId };
}
