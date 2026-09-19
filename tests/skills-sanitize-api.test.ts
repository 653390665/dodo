import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { registerSkillsRoutes, finalizeExtractedCard } from '../server/routes/skills';
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

test('finalizeExtractedCard strips contacts/brands from card text and records hits', () => {
  const card = finalizeExtractedCard(
    {
      name: '墨流写作助手 风格卡',
      // 说明：sanitizeWhiteLabelText 预清洗会先剥微信号/竞品词（既有管线顺序），
      // analyzeAndSanitize 统计到的是预清洗覆盖不到的模式：裸手机号、水印、裸作者名。
      description: '想要了解更多，请联系微信号：abc12345，欢迎交流。备用电话 13812345678。',
      style: '冷峻短句。证据：加我微信 vx_abc12345 领取完整资料。',
      pacing: '节奏偏紧',
      fewShots: ['夜雨拍窗，他按刀而立。图片右下角带水印。墨流编辑器出品。'],
      deconstructionCardType: 'style-card',
    },
    'deck-skill-1'
  ) as Record<string, unknown>;

  // 联系方式与竞品词被物理剥除
  const text = JSON.stringify(card);
  assert.equal(text.includes('abc12345'), false);
  assert.equal(text.includes('墨流'), false);
  assert.equal(text.includes('vx_abc12345'), false);
  assert.equal(text.includes('13812345678'), false);
  assert.equal(text.includes('水印'), false);
  assert.ok(String(card.name).includes('风格卡'));

  // 命中统计落库：analyzeAndSanitize 层面的命中非空
  const hits = card.sanitizationHits as Record<string, number>;
  assert.ok(hits && typeof hits === 'object');
  assert.ok(hits.contacts > 0, 'contacts hits should be recorded');
  assert.ok(hits.watermarks > 0, 'watermark hits should be recorded');

  // 三旗标语义保持不变
  assert.equal(card.isRuntimeReady, true);
  assert.equal(card.sanitizationStatus, 'runtime-ready');
  assert.equal(card.runtimeStatus, 'active');
});

test('finalizeExtractedCard records a zero-hit scan object for clean cards', () => {
  const card = finalizeExtractedCard(
    {
      name: '冷峻刀锋',
      description: '冷峻短句的风格卡。',
      style: '冷峻短句，动作清晰。',
      pacing: '节奏偏紧',
      deconstructionCardType: 'style-card',
    },
    'deck-skill-1'
  ) as Record<string, unknown>;

  assert.equal(String(card.name), '冷峻刀锋');
  const hits = card.sanitizationHits as Record<string, number>;
  assert.ok(hits && typeof hits === 'object');
  assert.ok(Object.keys(hits).length > 0, 'scan record must exist even with zero hits');
});

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
