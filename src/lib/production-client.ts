import type { ChapterProductionRun } from '../../shared/types';
import type { PromptSurface } from './prompt-stage-routing';

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

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || '';

      for (const msg of messages) {
        if (!msg.startsWith('data: ')) continue;
        const dataStr = msg.slice(6);
        try {
          const data = JSON.parse(dataStr);
          if (data && typeof data.type === 'string') {
            onEvent(data as ProductionRunSSEEvent);
          }
        } catch {
          // Skip unparseable chunks
        }
      }
    }

    if (buffer.trim().startsWith('data: ')) {
      try {
        const data = JSON.parse(buffer.trim().slice(6));
        if (data && typeof data.type === 'string') {
          onEvent(data as ProductionRunSSEEvent);
        }
      } catch {
        // Skip
      }
    }
  } finally {
    reader.releaseLock();
  }
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
