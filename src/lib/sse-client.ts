export class SseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SseParseError';
  }
}

export type SseEventDirective = 'done' | void;

export async function readSseEvents<T extends Record<string, unknown>>(
  response: Response,
  onEvent: (event: T) => SseEventDirective,
): Promise<{ done: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { done: false };

  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;

  try {
    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') {
          sawDone = true;
          break;
        }
        if (!trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.slice(5).trimStart();
        let parsed: T;
        try {
          const candidate = JSON.parse(dataStr) as unknown;
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            throw new SseParseError('Invalid SSE event payload');
          }
          parsed = candidate as T;
        } catch (error) {
          if (error instanceof SseParseError) throw error;
          throw new SseParseError('Invalid SSE payload');
        }

        const errorMessage = typeof parsed.error === 'string'
          ? parsed.error
          : parsed.type === 'error' && typeof parsed.message === 'string'
            ? parsed.message
            : null;
        if (errorMessage) throw new Error(errorMessage);
        if (onEvent(parsed) === 'done') {
          sawDone = true;
          break;
        }
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  return { done: sawDone };
}

export async function readSseStream(
  response: Response,
  onToken: (token: string) => void,
): Promise<{ text: string; done: boolean }> {
  let accumulated = '';
  const result = await readSseEvents<{ token?: string; error?: string }>(response, (parsed) => {
    if (parsed.token) {
      accumulated += parsed.token;
      onToken(parsed.token);
    }
  });
  return { text: accumulated, done: result.done };
}
