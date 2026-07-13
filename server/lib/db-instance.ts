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

  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(async () => {
      return fn();
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async drain(): Promise<void> {
    await this.queue;
  }

  reset(): void {
    this.queue = Promise.resolve();
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
