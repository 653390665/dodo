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
  source?: 'model' | 'fallback';
};

export async function readDraftStream(
  response: Response,
  handlers: {
    onStatus?: (message: string) => void;
    onToken?: (token: string) => void;
    onSource?: (source: 'model' | 'fallback') => void;
  } = {},
): Promise<string> {
  let accumulated = '';
  let finalText: string | undefined;
  let sawTypedDone = false;
  await readSseEvents<DraftStreamEvent>(response, (event) => {
    if (event.source) handlers.onSource?.(event.source);
    if (event.type === 'status' && event.message) handlers.onStatus?.(event.message);
    if (event.type === 'token' && event.content) {
      accumulated += event.content;
      handlers.onToken?.(event.content);
    }
    if (event.type === 'done') {
      sawTypedDone = true;
      finalText = typeof event.text === 'string' ? event.text : accumulated;
      return 'done';
    }
  });

  if (!sawTypedDone) throw new IncompleteDraftStreamError();
  return finalText ?? accumulated;
}
