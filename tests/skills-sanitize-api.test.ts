import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { registerSkillsRoutes } from '../server/routes/skills';
import * as db from '../server/lib/db';
import { initDb } from '../server/lib/db';
import { PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog';
import { sanitizeWhiteLabelText } from '../shared/lib/prompt-sanitizer';

// 与仓库其余 DB 测试一致：显式内存库，单跑本文件也绝不触碰生产库。
initDb(':memory:');

function buildApp() {
  const app = express();
  app.use(express.json());
  registerSkillsRoutes(app);
  return app;
}

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = buildApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('sanitize endpoint rejects unknown and non-candidate assets', async () => {
  await withServer(async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/api/skills/sanitize/does-not-exist`, { method: 'POST' });
    assert.equal(missing.status, 404);

    // active 的核心资产不是待消毒候选
    const active = PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.runtimeStatus === 'active');
    assert.ok(active);
    const conflict = await fetch(`${baseUrl}/api/skills/sanitize/${active.id}`, { method: 'POST' });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, 'ASSET_NOT_SANITIZABLE');
  });
});

test('sanitize endpoint persists a runtime-ready clone for a candidate asset', async () => {
  const candidate = PROMPT_GOVERNANCE_CATALOG.find((asset) => (
    asset.placementTier === 'sanitize-required'
    && asset.runtimeStatus === 'candidate'
    && asset.sanitizationStatus === 'needs-sanitization'
    && asset.sourceGroup !== 'test-fixture'
  ));
  assert.ok(candidate, 'catalog should expose a sanitize-required candidate');

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/skills/sanitize/${candidate.id}`, { method: 'POST' });
    assert.equal(response.status, 200);
    const body = await response.json() as { skillId: string; runtimeStatus: string; alreadySanitized: boolean };
    assert.equal(body.skillId, `sanitized-${candidate.id}`);
    assert.equal(body.runtimeStatus, 'active');
    assert.equal(body.alreadySanitized, false);

    // 落库副本已脱敏并标记可运行
    const stored = db.getSkill(body.skillId);
    assert.ok(stored);
    assert.equal(stored.parentSkillId, candidate.id);
    assert.equal(stored.runtimeStatus, 'active');
    assert.equal(stored.sanitizationStatus, 'runtime-ready');
    assert.equal(stored.name, sanitizeWhiteLabelText(candidate.title));

    // 幂等：重复消毒不再新建
    const repeat = await fetch(`${baseUrl}/api/skills/sanitize/${candidate.id}`, { method: 'POST' });
    assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).alreadySanitized, true);
  });
});
