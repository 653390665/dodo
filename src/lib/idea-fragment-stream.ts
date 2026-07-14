import { readSseStream } from './sse-client';

export class IncompleteIdeaFragmentStreamError extends Error {
  constructor() {
    super('Idea fragment stream ended before [DONE]');
    this.name = 'IncompleteIdeaFragmentStreamError';
  }
}

export async function streamIdeaFragment(options: {
  response: Response;
  originalExpansion: string;
  isCurrent: () => boolean;
  onPreview: (text: string) => void;
  onCommit: (text: string) => Promise<void>;
}): Promise<boolean> {
  const { response, originalExpansion, isCurrent, onPreview, onCommit } = options;
  let preview = '';
  try {
    const result = await readSseStream(response, (token) => {
      preview += token;
      if (isCurrent()) onPreview(preview);
    });
    if (!result.done) throw new IncompleteIdeaFragmentStreamError();
    if (!result.text.trim()) throw new Error('Idea fragment expansion was empty');
    if (!isCurrent()) return false;
    await onCommit(result.text);
    return true;
  } catch (error) {
    if (isCurrent()) onPreview(originalExpansion);
    throw error;
  }
}
