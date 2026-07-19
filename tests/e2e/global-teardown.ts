import { scrubE2eDb } from './global-setup';

/**
 * Playwright global teardown.
 *
 * Runs once after the whole suite finishes. Removes the isolated e2e DB and
 * its WAL/SHM sidecar files so no test artifacts leak between runs and nothing
 * is ever left pointing at the production database.
 */
export default function globalTeardown(): void {
  scrubE2eDb();
}
