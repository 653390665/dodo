import { pollJob, type PollJobOptions } from './poll-client';
import { getDatabaseGenerationSnapshot } from './db-transport';

export async function startWorldJob<T>(
  route: string,
  body: unknown,
  options: PollJobOptions = {},
  signal?: AbortSignal,
): Promise<{ result: T; databaseGeneration: number }> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('World job body must be an object');
  }
  const bodyRecord = body as Record<string, unknown>;
  const requestedGeneration = Number.isInteger(bodyRecord.databaseGeneration)
    ? bodyRecord.databaseGeneration as number
    : await getDatabaseGenerationSnapshot(signal);
  const startResponse = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bodyRecord, databaseGeneration: requestedGeneration }),
    signal,
  });
  const startData = await startResponse.json().catch(() => ({})) as { jobId?: string; databaseGeneration?: number; error?: string };
  if (!startResponse.ok || startData.error) {
    throw new Error(startData.error || `Server returned ${startResponse.status}`);
  }
  if (!startData.jobId) throw new Error('Server did not return a world job ID');
  if (!Number.isInteger(startData.databaseGeneration)) throw new Error('Server did not return a world job database generation');

  const jobId = startData.jobId;
  const databaseGeneration = startData.databaseGeneration as number;
  let completed = false;
  let cancelRequested = false;
  const cancel = () => {
    if (completed || cancelRequested) return;
    cancelRequested = true;
    void fetch(
      `/api/world/jobs/${encodeURIComponent(jobId)}/cancel?databaseGeneration=${databaseGeneration}`,
      { method: 'POST' },
    ).catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await pollJob<T>(
      `/api/world/jobs/${encodeURIComponent(jobId)}?databaseGeneration=${databaseGeneration}`,
      options,
      signal,
    );
    completed = true;
    return { result, databaseGeneration };
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!completed) cancel();
  }
}
