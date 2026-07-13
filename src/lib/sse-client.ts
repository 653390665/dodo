export class SseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SseParseError';
  }
}

export async function readSseStream(
  response: Response,
  onToken: (token: string) => void,
): Promise<{ text: string; done: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', done: false };

  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let sawDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === 'data: [DONE]') {
        sawDone = true;
        break;
      }
      if (!trimmed.startsWith('data: ')) continue;

      const dataStr = trimmed.slice(6);
      let parsed: { token?: string; error?: string };
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        throw new SseParseError('Invalid SSE payload');
      }

      if (parsed.error) {
        throw new Error(parsed.error);
      }
      if (parsed.token) {
        accumulated += parsed.token;
        onToken(parsed.token);
      }
    }
    if (sawDone) break;
  }

  return { text: accumulated, done: sawDone };
}
