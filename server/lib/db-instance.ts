/**
 * db-instance.ts
 * Database singleton holder. All modules that need the active DB connection
 * import from here instead of from db.ts, breaking the circular dependency
 * between initDb (which creates the instance) and CRUD functions (which use it).
 */
import type BetterSqlite3 from 'better-sqlite3';
import { logger } from '../logger';

/** The SQLite database singleton. Undefined until initDb() is called. */
let db: BetterSqlite3.Database | undefined;

/**
 * Monotonic identity of the logical database currently mounted at DB_PATH.
 * Async work captures this value before it leaves the database boundary and
 * must re-check it before writing. An import advances the generation before
 * the active connection is closed, invalidating work started against the old
 * database.
 */
let databaseGeneration = 0;
const databaseGenerationListeners = new Set<(generation: number) => void>();

/**
 * Returns the active database instance.
 * Throws if initDb() has not been called yet.
 */
export function getDb(): BetterSqlite3.Database {
  if (!db) throw new Error('[db] Database not initialized — call initDb() before use.');
  return db;
}

/**
 * Registers the database instance. Called exclusively by initDb().
 */
export function setDb(instance: BetterSqlite3.Database): void {
  db = instance;
}

/**
 * Executes a callback within a SQLite transaction.
 * better-sqlite3 transactions automatically rollback on exception and commit on success.
 * It supports nested transactions via automatic SAVEPOINT generation.
 */
export function runInTransaction<T>(fn: () => T): T {
  const activeDb = getDb();
  return activeDb.transaction(fn)();
}

/**
 * A FIFO Promise queue to serialize asynchronous database write transactions or routines.
 */
class WriteQueue {
  private queue: Promise<unknown> = Promise.resolve();
  private latch: Promise<void> | null = null;
  private enqueuedSinceHold = 0;
  private queuedWaiters: Array<{ count: number; resolve: () => void }> = [];

  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.latch) {
      this.enqueuedSinceHold += 1;
      for (const waiter of this.queuedWaiters) {
        if (this.enqueuedSinceHold >= waiter.count) waiter.resolve();
      }
      this.queuedWaiters = this.queuedWaiters.filter(({ count }) => this.enqueuedSinceHold < count);
    }
    const next = this.queue.then(async () => {
      if (this.latch) await this.latch;
      return fn();
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async drain(): Promise<void> {
    await this.queue;
  }

  /** Test-only: hold the queue until released, with a signal for queued items. */
  hold(): { release: () => void; waitForQueued: (count: number) => Promise<void> } {
    if (this.latch) throw new Error('[db] Write queue is already held.');
    this.enqueuedSinceHold = 0;
    let resolver: () => void;
    this.latch = new Promise<void>((resolve) => { resolver = resolve; });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.latch = null;
      this.queuedWaiters = [];
      resolver();
    };
    const waitForQueued = (count: number) => {
      if (this.enqueuedSinceHold >= count) return Promise.resolve();
      return new Promise<void>((resolve) => this.queuedWaiters.push({ count, resolve }));
    };
    return { release, waitForQueued };
  }
}

const writeQueue = new WriteQueue();

/**
 * Run a database writing task in a serialized async FIFO queue.
 * This guarantees no concurrent database locked issues occur when multiple
 * asynchronous router transactions interleave.
 */
export async function runInSerializedWrite<T>(fn: () => Promise<T> | T): Promise<T> {
  return writeQueue.run(fn);
}

export function getDatabaseGeneration(): number {
  return databaseGeneration;
}

/** Only the serialized database replacement task may call this function. */
export function advanceDatabaseGeneration(): number {
  databaseGeneration += 1;
  for (const listener of databaseGenerationListeners) {
    try {
      listener(databaseGeneration);
    } catch (error) {
      logger.error('db: generation listener error', error);
    }
  }
  return databaseGeneration;
}

export function subscribeDatabaseGeneration(listener: (generation: number) => void): () => void {
  databaseGenerationListeners.add(listener);
  return () => { databaseGenerationListeners.delete(listener); };
}

/**
 * Serialize a delayed write and discard it if a database replacement happened
 * while the caller was awaiting external work.
 */
export async function runInSerializedWriteForGeneration<T>(
  generation: number,
  fn: () => Promise<T> | T,
): Promise<{ executed: true; result: T } | { executed: false }> {
  return writeQueue.run(async () => {
    if (generation !== databaseGeneration) return { executed: false };
    return { executed: true, result: await fn() };
  });
}


/** Returns true if the database singleton has been initialized. */
export function isDbInitialized(): boolean {
  return db !== undefined;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Wait for all pending serialized writes to finish. */
export async function drainWriteQueue(): Promise<void> {
  await writeQueue.drain();
}

/** Test-only: hold the write queue until released. */
export function holdWriteQueue(): { release: () => void; waitForQueued: (count: number) => Promise<void> } {
  if (process.env.NODE_ENV !== 'test') throw new Error('[db] holdWriteQueue is only available in test environment.');
  return writeQueue.hold();
}

/** Closes the database connection and clears the singleton. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}

// ---------------------------------------------------------------------------
// Change-notification pub/sub
// ---------------------------------------------------------------------------

const listeners = new Set<(initiatorId?: string) => void>();

/** Subscribe to database mutation events. Returns an unsubscribe function. */
export function subscribe(fn: (initiatorId?: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

let currentInitiator: string | undefined;

export function getCurrentInitiator(): string | undefined {
  return currentInitiator;
}

export function setCurrentInitiator(val: string | undefined): void {
  currentInitiator = val;
}

/** Notify all registered listeners. Called after every write operation. */
export function notify(): void {
  const initiator = currentInitiator;
  for (const fn of listeners) {
    try {
      fn(initiator);
    } catch (e) {
      logger.error('db: listener error', e);
    }
  }
}
