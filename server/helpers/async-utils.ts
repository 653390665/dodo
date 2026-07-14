import type { Response } from 'express';

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  options: { controller?: AbortController } = {},
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const timeoutError = new Error(message);
          options.controller?.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function emitTextAsTokens(
  res: Response,
  text: string,
  options: { signal?: AbortSignal; onFirstWrite?: () => void } = {},
) {
  const chunks = text.match(/.{1,24}/gs) || [];
  let hasWritten = false;
  for (const chunk of chunks) {
    if (options.signal?.aborted || res.writableEnded || res.destroyed) {
      throw new Error('Client disconnected during draft delivery');
    }
    res.write(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`);
    if (!hasWritten) {
      hasWritten = true;
      options.onFirstWrite?.();
    }
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}
