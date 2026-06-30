import type { Response } from 'express';

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function emitTextAsTokens(res: Response, text: string) {
  const chunks = text.match(/.{1,24}/gs) || [];
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`);
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}
