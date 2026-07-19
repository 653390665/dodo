export type EditorWrite = () => Promise<boolean | void>;

interface WriteEntry {
  timer: ReturnType<typeof setTimeout> | null;
  pending: EditorWrite | null;
  inFlight: Promise<void> | null;
  failed: boolean;
  snapshot: unknown;
}

export interface PendingEditorWriteSnapshot {
  key: string;
  snapshot: unknown;
  failed: boolean;
}

const writes = new Map<string, WriteEntry>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function getOrCreateEntry(key: string): WriteEntry {
  const existing = writes.get(key);
  if (existing) return existing;
  const entry: WriteEntry = {
    timer: null,
    pending: null,
    inFlight: null,
    failed: false,
    snapshot: null,
  };
  writes.set(key, entry);
  return entry;
}

async function runPendingWrite(key: string): Promise<void> {
  const entry = writes.get(key);
  if (!entry) return;
  if (entry.inFlight) {
    await entry.inFlight;
    if (entry.pending) await runPendingWrite(key);
    return;
  }

  const writer = entry.pending;
  if (!writer) return;
  entry.pending = null;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.failed = false;

  const operation = (async () => {
    try {
      const saved = await writer();
      if (saved === false) throw new Error(`Editor write did not update a row: ${key}`);
    } catch (error) {
      if (!entry.pending) entry.pending = writer;
      entry.failed = true;
      throw error;
    } finally {
      entry.inFlight = null;
      if (!entry.pending) writes.delete(key);
      notify();
    }
  })();

  entry.inFlight = operation;
  notify();
  await operation;
}

export function queueEditorWrite(
  key: string,
  writer: EditorWrite,
  delayMs = 1000,
  snapshot: unknown = null,
): void {
  const entry = getOrCreateEntry(key);
  if (entry.timer) clearTimeout(entry.timer);
  entry.pending = writer;
  entry.failed = false;
  entry.snapshot = snapshot;
  entry.timer = setTimeout(() => {
    void runPendingWrite(key).catch((error) => {
      console.error('[editor-write-queue] Background save failed:', error);
    });
  }, delayMs);
  notify();
}

export function getPendingEditorWriteSnapshots(): PendingEditorWriteSnapshot[] {
  return [...writes.entries()].map(([key, entry]) => ({
    key,
    snapshot: entry.snapshot,
    failed: entry.failed,
  }));
}

export async function flushPendingEditorWrites(): Promise<void> {
  // Writes scheduled while an earlier write is in flight are included before
  // this boundary resolves.
  while (writes.size > 0) {
    const keys = [...writes.keys()];
    const results = await Promise.allSettled(keys.map((key) => runPendingWrite(key)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
}

export function hasPendingEditorWrites(): boolean {
  return writes.size > 0;
}

export function hasFailedEditorWrites(): boolean {
  return [...writes.values()].some((entry) => entry.failed);
}

export function subscribeToEditorWrites(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasPendingWriteForExactKey(exactKey: string): boolean {
  const entry = writes.get(exactKey);
  if (!entry) return false;
  return entry.pending !== null || entry.inFlight !== null || entry.failed;
}

export const __editorWriteQueueTestHooks = {
  reset(): void {
    for (const entry of writes.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    writes.clear();
    listeners.clear();
  },
};
