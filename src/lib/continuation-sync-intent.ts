export interface ContinuationSyncIntent {
  intentId: string;
  createdAt: number;
  novelId: string;
  packId: string;
}

const STORAGE_KEY = 'inkflow-world-bible-sync-intent';

export function writeContinuationSyncIntent(intent: ContinuationSyncIntent): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...intent, intentId: intent.intentId || `${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt: intent.createdAt || Date.now() }));
  } catch {
    // Storage may be unavailable in private or restricted browsing contexts.
  }
}

export function readContinuationSyncIntent(): ContinuationSyncIntent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as ContinuationSyncIntent).intentId !== 'string' ||
      typeof (parsed as ContinuationSyncIntent).createdAt !== 'number' ||
      Date.now() - (parsed as ContinuationSyncIntent).createdAt > 30 * 60 * 1000 ||
      typeof (parsed as ContinuationSyncIntent).novelId !== 'string' ||
      typeof (parsed as ContinuationSyncIntent).packId !== 'string' ||
      !(parsed as ContinuationSyncIntent).novelId ||
      !(parsed as ContinuationSyncIntent).packId
    ) return null;
    return parsed as ContinuationSyncIntent;
  } catch {
    return null;
  }
}

export function clearContinuationSyncIntent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable in private or restricted browsing contexts.
  }
}
