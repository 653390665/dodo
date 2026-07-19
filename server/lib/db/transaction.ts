import { getDb } from '../db-instance.js';

export function runInTransaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}
