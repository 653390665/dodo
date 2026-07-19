import fs from 'node:fs';
import path from 'node:path';

/**
 * Playwright global setup.
 *
 * Runs once before the test suite starts. The isolated e2e DB path is fixed in
 * playwright.config.ts (INKFLOW_DB_PATH=test-results/inkflow-e2e.db). Here we
 * scrub any leftover DB + WAL + SHM from a previous run so each E2E run begins
 * from a clean state. This must NEVER touch ~/.inkflow/data.db.
 *
 * Also writes an offline test config under test-results/e2e-config so E2E
 * never reads real ~/.inkflow credentials.
 */
const E2E_DB = path.resolve(process.cwd(), 'test-results/inkflow-e2e.db');
const E2E_CONFIG_DIR = path.resolve(process.cwd(), 'test-results/e2e-config');

function scrubE2eDb(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = E2E_DB + suffix;
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    } catch {
      // Best-effort: ignore transient rm failures (e.g. file locked by server).
    }
  }
}

function writeOfflineE2eConfig(): void {
  fs.mkdirSync(E2E_CONFIG_DIR, { recursive: true });
  const configPath = path.join(E2E_CONFIG_DIR, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    apiKey: '',
    baseUrl: 'http://127.0.0.1:9/offline-e2e',
    model: 'offline-e2e-stub',
    hasApiKey: false,
    promptGuardLevel: 'disabled',
  }, null, 2));
}

export default function globalSetup(): void {
  scrubE2eDb();
  writeOfflineE2eConfig();
}

// Exported so the global teardown module can reuse the exact same scrub logic.
export { scrubE2eDb };
