export interface JobStatus<T = unknown> {
  id: string;
  status: 'queueing' | 'running' | 'completed' | 'failed';
  progress: number;
  result?: T;
  error?: string;
}

export interface PollJobOptions {
  onProgress?: (progress: number, status: string) => void;
  intervalMs?: number;
}

/**
 * Reusable utility to poll an asynchronous background job until completion or failure.
 * Fetches status repeatedly (defaulting to 1.5s steps) and invokes onProgress callbacks.
 *
 * @param url The exact endpoint to fetch job status from.
 * @param options Configuration for polling, including the onProgress hook.
 * @returns The final result of the job.
 */
export async function pollJob<T = unknown>(
  url: string,
  options: PollJobOptions = {},
  signal?: AbortSignal
): Promise<T> {
  const { onProgress, intervalMs = 1500 } = options;
  const maxRetries = 120;
  let retries = 0;

  while (retries < maxRetries) {
    if (signal?.aborted) throw new Error('Polling aborted');
    retries++;
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Failed to query job status: HTTP ${response.status}`);
    }

    const data: JobStatus<T> = await response.json();

    if (onProgress) {
      onProgress(data.progress, data.status);
    }

    if (data.status === 'completed') {
      return data.result as T;
    }

    if (data.status === 'failed') {
      throw new Error(data.error || 'Job failed in background execution');
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Polling exceeded maximum retries");
}
