import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { extractSkill } from '../src/lib/prompt-client';
import { registerSkillsRoutes } from '../server/routes/skills';
import { skillExtractionJobAbortControllers, skillExtractionJobs } from '../server/helpers/skill-extraction';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit';

test('extractSkill surfaces rejected reason from input gate', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: false,
      json: async () => ({
        rejected: true,
        reason: '中文内容仅 32 字，不足以提炼写作风格。请上传至少 200 字的小说正文片段。',
      }),
    } as Response);

  try {
    await assert.rejects(
      () => extractSkill('太短了'),
      /中文内容仅 32 字/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extract-skill job routes use author-facing Chinese errors', async () => {
  const app = express();
  app.use(express.json());
  registerSkillsRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const controller = new AbortController();
  skillExtractionJobs.set('job-pending', { status: 'pending', createdAt: Date.now() });
  skillExtractionJobAbortControllers.set('job-pending', controller);

  try {
    const missing = await fetch(`${baseUrl}/api/extract-skill/jobs/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: '拆书任务不存在或已过期，请重新提交。' });

    const cancel = await fetch(`${baseUrl}/api/extract-skill/jobs/job-pending/cancel`, { method: 'POST' });
    assert.equal(cancel.status, 200);
    assert.equal(controller.signal.aborted, true);

    const cancelled = await fetch(`${baseUrl}/api/extract-skill/jobs/job-pending`);
    assert.deepEqual(await cancelled.json(), { status: 'failed', error: '拆书任务已取消。' });
  } finally {
    skillExtractionJobs.clear();
    skillExtractionJobAbortControllers.clear();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('extract-skill rate limit uses author-facing Chinese error', async () => {
  const app = express();
  app.use(express.json());
  registerSkillsRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  __rateLimitTestHooks.reset();
  try {
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${baseUrl}/api/extract-skill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          novelId: 'rate-skill',
          text: '夜雨中的剑客追踪失落账本，冲突持续升级并揭开旧案真相。',
        }),
      });
      assert.equal(response.status, 400);
    }

    const blocked = await fetch(`${baseUrl}/api/extract-skill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'rate-skill',
        text: '夜雨中的剑客追踪失落账本，冲突持续升级并揭开旧案真相。',
      }),
    });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: '拆书请求过于频繁，请稍后再试。', retryAfter: 5 });
  } finally {
    __rateLimitTestHooks.reset();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('extract-skill unknown failures use a stable safe error response', async () => {
  const app = express();
  app.use(express.json());
  registerSkillsRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  __rateLimitTestHooks.reset();
  try {
    const response = await fetch(`${baseUrl}/api/extract-skill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'safe-error-novel',
        text: [
          '夜雨中的剑客追踪失落账本，冲突持续升级并揭开旧案真相。',
          '北城钟楼忽然停摆，守夜人发现墙缝藏着一枚刻有潮汐纹的铜钥匙。',
          '药师穿过集市寻找失踪学徒，沿途听见商贩谈论昨夜燃烧的旧船。',
          '荒原尽头的驿站亮起蓝灯，旅客们交换姓名，却都刻意避开西侧房间。',
          '年轻的书记员翻开族谱，在被撕去的页面背面读到一行陌生的预言。',
          '城门外传来马蹄和弓弦声，巡逻队改变路线，将密信交给沉默的车夫。',
          '雪岭上的观测台记录到异常星光，研究者决定在黎明前封存全部仪器。',
          '河湾村民打捞出青铜面具，面具上的裂痕与古墓入口完全吻合。',
        ].join(''),
        skills: [null],
      }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      code: 'SKILL_EXTRACTION_FAILED',
      error: '拆书失败，请稍后重试。',
    });
  } finally {
    __rateLimitTestHooks.reset();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
