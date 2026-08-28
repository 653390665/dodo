import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Novel, ProjectPreferenceProfile } from '../shared/types';

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-db-entitlement-'));
const databasePath = path.join(testDirectory, 'test.db');
process.env.INKFLOW_DB_PATH = databasePath;

const db = await import('../server/lib/db');
const { registerDbRoutes } = await import('../server/routes/db');

const profile = (commercialMode?: 'free' | 'paid' | 'strict', quotaLimits?: Record<string, number>): ProjectPreferenceProfile => ({
  tags: [],
  weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
  acceptedDimensions: [],
  rejectedDimensions: [],
  notes: [],
  evidenceCount: 0,
  ...(commercialMode ? { commercialMode } : {}),
  ...(quotaLimits ? { quotaLimits } : {}),
});

const novel = (id: string, projectPreferenceProfile?: ProjectPreferenceProfile): Novel => ({
  id,
  title: id,
  authorId: 'local',
  summary: '',
  status: 'ongoing' as const,
  ...(projectPreferenceProfile ? { projectPreferenceProfile } : {}),
  createdAt: 1,
  updatedAt: 1,
});

db.initDb(databasePath);
const app = express();
app.use(express.json());
registerDbRoutes(app);
const server = app.listen(0);
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

async function call(method: string, args: unknown[], databaseGeneration?: number) {
  return fetch(`${baseUrl}/api/db`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args, ...(databaseGeneration === undefined ? {} : { databaseGeneration }) }),
  });
}

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.closeDb();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('DB HTTP boundary returns a stable generation conflict contract', async () => {
  const response = await call('listNovels', [], Number.MAX_SAFE_INTEGER);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    code: 'DB_GENERATION_CONFLICT',
    message: '数据库已变化，请刷新后重试',
    error: '数据库已变化，请刷新后重试',
  });
});

test('DB HTTP boundary rejects client paid and quota entitlements on create', async () => {
  const paid = await call('createNovel', [novel('client-paid', profile('paid'))]);
  assert.equal(paid.status, 403);
  assert.equal((await paid.json()).code, 'DB_ENTITLEMENT_FORBIDDEN');

  const quota = await call('createNovel', [novel('client-quota', profile('free', { generateProseMax: 1 }))]);
  assert.equal(quota.status, 403);
  assert.equal((await quota.json()).code, 'DB_ENTITLEMENT_FORBIDDEN');

  assert.equal((await call('createNovel', [novel('client-free', profile('free'))])).status, 200);
  assert.equal((await call('createNovel', [novel('client-strict', profile('strict'))])).status, 200);
});

test('DB HTTP boundary protects paid and free update entitlements', async () => {
  db.createNovel(novel('paid-existing', profile('paid', { generateProseMax: 10 })));
  db.createNovel(novel('free-existing', profile('free')));
  db.createNovel(novel('strict-existing', profile('strict')));

  const paidDowngrade = await call('updateNovel', ['paid-existing', { projectPreferenceProfile: profile('free') }]);
  assert.equal(paidDowngrade.status, 403);
  assert.equal((await paidDowngrade.json()).code, 'DB_ENTITLEMENT_FORBIDDEN');

  const freeUpgrade = await call('updateNovel', ['free-existing', { projectPreferenceProfile: profile('paid') }]);
  assert.equal(freeUpgrade.status, 403);
  assert.equal((await freeUpgrade.json()).code, 'DB_ENTITLEMENT_FORBIDDEN');

  const freeQuota = await call('updateNovel', ['free-existing', { projectPreferenceProfile: profile('free', { generateProseMax: 10 }) }]);
  assert.equal(freeQuota.status, 403);

  const paidTags = await call('updateNovel', ['paid-existing', { projectPreferenceProfile: { tags: ['updated'] } }]);
  assert.equal(paidTags.status, 200);
  const persisted = db.getNovel('paid-existing');
  assert.deepEqual(persisted?.projectPreferenceProfile?.tags, ['updated']);
  assert.equal(persisted?.projectPreferenceProfile?.commercialMode, 'paid');
  assert.deepEqual(persisted?.projectPreferenceProfile?.quotaLimits, { generateProseMax: 10 });

  db.updateNovel('paid-existing', { projectPreferenceProfile: {
    ...profile('paid', { generateProseMax: 10 }),
    weights: { styleWeight: 0.9, characterWeight: 0.8, worldWeight: 0.7, plotWeight: 0.6, pacingWeight: 0.4 },
    evidenceCount: 12,
    writingStyleConfirmation: { mode: 'default', fingerprint: 'fp', confirmedAt: 4 },
  } });
  const partialProfile = await call('updateNovel', ['paid-existing', { projectPreferenceProfile: { tags: ['partial'] } }]);
  assert.equal(partialProfile.status, 200);
  const partialPersisted = db.getNovel('paid-existing')?.projectPreferenceProfile;
  assert.deepEqual(partialPersisted?.weights, { styleWeight: 0.9, characterWeight: 0.8, worldWeight: 0.7, plotWeight: 0.6, pacingWeight: 0.4 });
  assert.equal(partialPersisted?.evidenceCount, 12);
  assert.deepEqual(partialPersisted?.writingStyleConfirmation, { mode: 'default', fingerprint: 'fp', confirmedAt: 4 });

  const partialWeights = await call('updateNovel', ['paid-existing', {
    projectPreferenceProfile: { weights: { styleWeight: 0.3 } },
  }]);
  assert.equal(partialWeights.status, 200);
  assert.deepEqual(db.getNovel('paid-existing')?.projectPreferenceProfile?.weights, {
    styleWeight: 0.3,
    characterWeight: 0.8,
    worldWeight: 0.7,
    plotWeight: 0.6,
    pacingWeight: 0.4,
  });

  const paidRoundTrip = await call('updateNovel', ['paid-existing', {
    projectPreferenceProfile: profile('paid', { generateProseMax: 10 }),
  }]);
  assert.equal(paidRoundTrip.status, 200);
  const paidQuotaOverwrite = await call('updateNovel', ['paid-existing', {
    projectPreferenceProfile: profile('paid', { generateProseMax: 11 }),
  }]);
  assert.equal(paidQuotaOverwrite.status, 403);

  const freeToStrict = await call('updateNovel', ['free-existing', { projectPreferenceProfile: profile('strict') }]);
  assert.equal(freeToStrict.status, 200);
  const strictToFree = await call('updateNovel', ['free-existing', { projectPreferenceProfile: profile('free') }]);
  assert.equal(strictToFree.status, 200);
  const strictToPaid = await call('updateNovel', ['free-existing', { projectPreferenceProfile: profile('paid') }]);
  assert.equal(strictToPaid.status, 403);

  db.updateNovel('free-existing', { projectPreferenceProfile: profile('free', { generateProseMax: 7, generateProseCount: 2 }) });
  const freeRoundTrip = await call('updateNovel', ['free-existing', {
    projectPreferenceProfile: profile('free', { generateProseCount: 2, generateProseMax: 7 }),
  }]);
  assert.equal(freeRoundTrip.status, 200);
  const freeQuotaBeforeReject = db.getNovel('free-existing')?.projectPreferenceProfile?.quotaLimits;
  const freeQuotaChange = await call('updateNovel', ['free-existing', {
    projectPreferenceProfile: profile('free', { generateProseCount: 3, generateProseMax: 7 }),
  }]);
  assert.equal(freeQuotaChange.status, 403);
  assert.deepEqual(db.getNovel('free-existing')?.projectPreferenceProfile?.quotaLimits, freeQuotaBeforeReject);
  const freeTags = await call('updateNovel', ['free-existing', { projectPreferenceProfile: { tags: ['free-updated'] } }]);
  assert.equal(freeTags.status, 200);
  const freePersisted = db.getNovel('free-existing');
  assert.deepEqual(freePersisted?.projectPreferenceProfile?.tags, ['free-updated']);
  assert.equal(freePersisted?.projectPreferenceProfile?.commercialMode, 'free');
  assert.deepEqual(freePersisted?.projectPreferenceProfile?.quotaLimits, { generateProseMax: 7, generateProseCount: 2 });

  db.updateNovel('strict-existing', { projectPreferenceProfile: profile('strict', { generateProseMax: 8, generateProseCount: 3 }) });
  const strictTags = await call('updateNovel', ['strict-existing', { projectPreferenceProfile: { tags: ['strict-updated'] } }]);
  assert.equal(strictTags.status, 200);
  const strictPersisted = db.getNovel('strict-existing');
  assert.deepEqual(strictPersisted?.projectPreferenceProfile?.tags, ['strict-updated']);
  assert.equal(strictPersisted?.projectPreferenceProfile?.commercialMode, 'strict');
  assert.deepEqual(strictPersisted?.projectPreferenceProfile?.quotaLimits, { generateProseMax: 8, generateProseCount: 3 });
});
