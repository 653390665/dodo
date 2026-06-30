/**
 * Single-writer dispatch for SQLite.
 *
 * All write calls route through a serial queue here.  That means there is
 * exactly one writer at any point in time — concurrent writes are queued
 * and serialised, preventing SQLITE_BUSY / database-locked crashes while
 * keeping the code ergonomic (just call `write.run(task)`).
 */

type WriteTask<T> = () => Promise<T>;

class DbWriteDispatcher {
  private queue: Array<{
    task: WriteTask<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  private running = false;

  run<T>(task: WriteTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject } as typeof this.queue[number]);
      if (!this.running) this.drain();
    });
  }

  private async drain() {
    this.running = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        const result = await item.task();
        item.resolve(result);
      } catch (e) {
        item.reject(e);
      }
    }
    this.running = false;
  }
}

export const write = new DbWriteDispatcher();
