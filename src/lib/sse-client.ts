export class SseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SseParseError';
  }
}

export type SseErrorFields = {
  code?: string;
  traceId?: string;
  retriable?: boolean;
  finishReason?: string;
  reason?: 'no_content' | 'reasoning_only' | 'length_exhausted';
};

export class SseError extends Error {
  readonly code?: string;
  readonly traceId?: string;
  readonly retriable?: boolean;
  readonly finishReason?: string;
  readonly reason?: SseErrorFields['reason'];

  constructor(message: string, fields: SseErrorFields = {}) {
    super(message);
    this.name = 'SseError';
    this.code = fields.code;
    this.traceId = fields.traceId;
    this.retriable = fields.retriable;
    this.finishReason = fields.finishReason;
    this.reason = fields.reason;
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

  const processLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) return;
    if (trimmed === 'data: [DONE]') {
      sawDone = true;
      return;
    }
    if (!trimmed.startsWith('data:')) return;

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
    if (errorMessage) {
      throw new SseError(errorMessage, {
        code: typeof parsed.code === 'string' ? parsed.code : undefined,
        traceId: typeof parsed.traceId === 'string' ? parsed.traceId : undefined,
        retriable: typeof parsed.retriable === 'boolean' ? parsed.retriable : undefined,
        finishReason: typeof parsed.finishReason === 'string' ? parsed.finishReason : undefined,
        reason: parsed.reason === 'no_content' || parsed.reason === 'reasoning_only' || parsed.reason === 'length_exhausted' ? parsed.reason : undefined,
      });
    }
    if (onEvent(parsed) === 'done') sawDone = true;
  };

  try {
    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        processLine(line);
        if (sawDone) break;
      }
    }

    buffer += decoder.decode();
    if (!sawDone && buffer.trim()) processLine(buffer);
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
  let finalText: string | undefined;
  const result = await readSseEvents<{ type?: string; token?: string; content?: string; text?: string; error?: string; code?: string; traceId?: string; retriable?: boolean; finishReason?: string; reason?: SseErrorFields['reason'] }>(response, (parsed) => {
    if (parsed.token) {
      accumulated += parsed.token;
      onToken(parsed.token);
    }
    if (parsed.type === 'token' && parsed.content) {
      accumulated += parsed.content;
      onToken(parsed.content);
    }
    if (parsed.type === 'success' && typeof parsed.text === 'string') {
      finalText = parsed.text;
      if (!accumulated) onToken(parsed.text);
    }
    if (parsed.type === 'done') return 'done';
  });
  return { text: finalText ?? accumulated, done: result.done };
}
