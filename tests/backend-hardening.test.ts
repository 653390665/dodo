import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { expandFragmentSchema } from '../server/routes/simple-llm';

test('auth rebuilds malformed persisted tokens and protects database events', () => {
  const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-auth-'));
  const tokenDir = path.join(testHome, '.inkflow');
  const tokenPath = path.join(tokenDir, '.auth-token');
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(tokenPath, 'malformed-token', { mode: 0o644 });

  const probe = `
    const { authMiddleware, getAuthToken, issueDbEventToken } = await import('./server/middleware/auth.ts');
    let status = 0;
    const response = { status(code) { status = code; return this; }, json() { return this; } };
    authMiddleware({ headers: {}, query: {}, path: '/db/events' }, response, () => { throw new Error('unexpected auth bypass'); });
    let eventAccess = false;
    const { token: eventToken } = issueDbEventToken();
    authMiddleware({ headers: {}, query: { token: eventToken }, path: '/db/events' }, response, () => { eventAccess = true; });
    const token = getAuthToken();
    console.log(JSON.stringify({ valid: /^[0-9a-f]{64}$/.test(token), status, eventAccess }));
  `;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', probe], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: testHome },
    encoding: 'utf8',
  });

  try {
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout.trim()), { valid: true, status: 401, eventAccess: true });
    assert.match(fs.readFileSync(tokenPath, 'utf8'), /^[0-9a-f]{64}$/);
    assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(testHome, { recursive: true, force: true });
  }
});

test('development token bootstrap is opt-in and loopback-only', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  assert.match(source, /INKFLOW_ENABLE_DEV_AUTH_TOKEN === 'true'/);
  assert.match(source, /remoteAddress !== '127\.0\.0\.1' && remoteAddress !== '::1'/);
});

test('fragment expansion rejects type confusion and oversized cost input', () => {
  assert.equal(expandFragmentSchema.safeParse({ novelId: 'novel', content: 42 }).success, false);
  assert.equal(expandFragmentSchema.safeParse({ novelId: 'novel', content: 'idea', extra: true }).success, false);
  assert.equal(expandFragmentSchema.safeParse({
    novelId: 'novel',
    content: 'x'.repeat(15_001),
    context: 'y'.repeat(15_000),
  }).success, false);
  assert.equal(expandFragmentSchema.safeParse({ novelId: 'novel', text: 'legacy input' }).success, true);
});

test('agent SSE failures use stable generic codes without exposing thrown messages', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server/routes/agents.ts'), 'utf8');
  assert.match(source, /ORCHESTRATE_STREAM_FAILED/);
  assert.match(source, /ORCHESTRATE_DRAFT_STREAM_FAILED/);
  assert.doesNotMatch(source, /type: 'error', message: String\(err\)/);
});

test('startup snapshot runs after schema and indexes and publishes through atomic rename', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server/lib/db-init.ts'), 'utf8');
  const indexPosition = source.indexOf('CREATE INDEX IF NOT EXISTS idx_product_events_event_name');
  const applicationIdPosition = source.indexOf('application_id =');
  const backupPosition = source.indexOf('createValidatedStartupBackup(_db, targetPath)');
  assert.ok(indexPosition >= 0 && applicationIdPosition > indexPosition && backupPosition > applicationIdPosition);
  assert.match(source, /renameSync\(tempBackupPath, backupPath\)/);
  assert.match(source, /unlinkSync\(candidate\)/);
});
