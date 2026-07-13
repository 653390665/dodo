import { readSseStream } from './sse-client';

export class IncompleteBioStreamError extends Error {
  constructor() {
    super('Character bio stream ended before [DONE]');
    this.name = 'IncompleteBioStreamError';
  }
}

interface StreamCharacterBioOptions {
  response: Response;
  originalBio: string;
  isCurrent: () => boolean;
  onPreview: (bio: string) => void;
  onCommit: (bio: string) => Promise<void>;
  previewIntervalMs?: number;
}

export async function enqueueLatestCharacterBioCommit(
  commitChains: Map<string, Promise<void>>,
  characterId: string,
  isCurrent: () => boolean,
  commit: () => Promise<void>,
): Promise<void> {
  const previousCommit = commitChains.get(characterId) ?? Promise.resolve();
  const queuedCommit = previousCommit
    .catch(() => undefined)
    .then(async () => {
      if (isCurrent()) await commit();
    });

  commitChains.set(characterId, queuedCommit);
  try {
    await queuedCommit;
  } finally {
    if (commitChains.get(characterId) === queuedCommit) {
      commitChains.delete(characterId);
    }
  }
}

/**
 * Streams a character bio into local preview state and persists only the final,
 * complete value. Stale requests neither commit nor restore over a newer run.
 */
export async function streamCharacterBio({
  response,
  originalBio,
  isCurrent,
  onPreview,
  onCommit,
  previewIntervalMs = 75,
}: StreamCharacterBioOptions): Promise<boolean> {
  let previewText = '';
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  const clearPreviewTimer = () => {
    if (previewTimer !== undefined) {
      clearTimeout(previewTimer);
      previewTimer = undefined;
    }
  };

  const publishPreview = () => {
    previewTimer = undefined;
    if (isCurrent()) onPreview(previewText);
  };

  const schedulePreview = () => {
    if (previewTimer === undefined) {
      previewTimer = setTimeout(publishPreview, previewIntervalMs);
    }
  };

  try {
    const result = await readSseStream(response, (token) => {
      previewText += token;
      schedulePreview();
    });

    if (!result.done) throw new IncompleteBioStreamError();
    if (!isCurrent()) return false;

    clearPreviewTimer();
    previewText = result.text;
    onPreview(previewText);
    await onCommit(previewText);
    return true;
  } catch (error) {
    clearPreviewTimer();
    if (isCurrent()) onPreview(originalBio);
    throw error;
  } finally {
    clearPreviewTimer();
  }
}
