import { readSseEvents } from './sse-client';

export class IncompleteDraftStreamError extends Error {
  constructor() {
    super('Draft stream ended before done');
    this.name = 'IncompleteDraftStreamError';
  }
}

type DraftStreamEvent = {
  type?: 'status' | 'token' | 'done' | 'error';
  message?: string;
  content?: string;
  text?: string;
};

export async function readDraftStream(
  response: Response,
  handlers: {
    onStatus?: (message: string) => void;
    onToken?: (token: string) => void;
  } = {},
): Promise<string> {
  let accumulated = '';
  let finalText: string | undefined;
  const result = await readSseEvents<DraftStreamEvent>(response, (event) => {
    if (event.type === 'status' && event.message) handlers.onStatus?.(event.message);
    if (event.type === 'token' && event.content) {
      accumulated += event.content;
      handlers.onToken?.(event.content);
    }
    if (event.type === 'done') {
      finalText = typeof event.text === 'string' ? event.text : accumulated;
      return 'done';
    }
  });

  if (!result.done) throw new IncompleteDraftStreamError();
  return finalText ?? accumulated;
}
