import assert from 'node:assert/strict';
import express from 'express';
import test, { afterEach } from 'node:test';
import { registerSearchRoutes } from '../server/routes/search';
import { closeDb, createNovel, initDb } from '../server/lib/db';
import { getDb } from '../server/lib/db-instance';
import { addChunk } from '../server/vector-store';
import { embedWithMetadata } from '../server/embedding';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit';
import { DEFAULT_QUOTA_MAX } from '../server/helpers/quota-guard';
import { getConfig } from '../server/lib/config';
import type { Novel } from '../shared/types';
import { createTestWorkspace } from './helpers/test-environment';

const originalFetch = globalThis.fetch;
const config = getConfig();

function mockNovel(id: string): Novel {
  const now = Date.now();
  return {
    id,
    title: 'Plan 201 search contract test',
    authorId: 'local-user',
    summary: '',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    projectPreferenceProfile: {
      tags: [],
      weights: {
        styleWeight: 1,
        characterWeight: 1,
        worldWeight: 1,
        plotWeight: 1,
        pacingWeight: 1,
      },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      commercialMode: 'free',
      quotaLimits: { advancedAuditCount: 0, advancedAuditMax: DEFAULT_QUOTA_MAX.advancedAudit },
    },
    createdAt: now,
    updatedAt: now,
  };
}

function mockEmbeddingFetch(): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }))) as typeof fetch;
}

function insertLegacyChunk(novelId: string, chapterId: string, text: string): void {
  // 旧格式 chunk（裸数组 → legacy:unknown）：检索时被兼容过滤静默排除
  getDb()
    .prepare(
      `INSERT INTO vector_chunks (id, novel_id, chapter_id, chunk_index, text, embedding)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(`${novelId}_${chapterId}_0`, novelId, chapterId, 0, text, JSON.stringify([0.1, 0.2, 0.3]));
}

interface SearchResponseBody {
  available: boolean;
  indexed: boolean;
  stale?: boolean;
  staleExcluded?: number;
  hits: Array<{ text: string; chapterId: string }>;
}

/** 用模块加载期捕获的真实 fetch 发请求：测试内 globalThis.fetch 已被 embedding mock 替换 */
const postSearch = (
  port: number,
  novelId: string
): Promise<{ status: number; body: SearchResponseBody }> =>
  originalFetch(`http://127.0.0.1:${port}/api/search-similar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId, query: '演武场的剑光' }),
  }).then(async (response) => ({
    status: response.status,
    body: (await response.json()) as SearchResponseBody,
  }));

let workspace: ReturnType<typeof createTestWorkspace> | undefined;

function setupTestDb(name: string): void {
  workspace = createTestWorkspace(`search-contract-${name}`);
  config.apiKey = config.apiKey || 'sk-mock-key-for-test-12345';
  config.baseUrl = 'https://api.deepseek.com';
  config.model = 'text-embedding-3-small';
  initDb(workspace.path('search-contract.test.db'));
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  // LLM fallback 走 embedding 令牌桶（5 令牌/文件进程），逐测试清空防止跨用例限流污染
  __rateLimitTestHooks.reset();
  if (workspace) {
    closeDb();
    workspace.cleanup();
    workspace = undefined;
  }
});

// 注意：embedding 模块状态在文件内跨测试持续（无重置钩子），
// 「unavailable」用例必须最先执行（进程冷启动时 status 即 unavailable）。
test('POST /api/search-similar：embedding 不可用路径同样携带 stale:false 的诚实契约', async () => {
  setupTestDb('unavailable');
  const originalKey = config.apiKey;
  config.apiKey = '';
  try {
    const novelId = 'novel-unavailable';
    createNovel(mockNovel(novelId));

    const app = express();
    app.use(express.json()); // 生产环境由 server.ts 全局挂载，测试 app 需自带 JSON body 解析
    registerSearchRoutes(app);
    const server = app.listen(0);
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const { status, body } = await postSearch(address.port, novelId);
      assert.equal(status, 200);
      assert.equal(body.available, false);
      assert.equal(body.stale, false);
      assert.equal(body.staleExcluded, 0);
      assert.deepEqual(body.hits, []);
    } finally {
      server.close();
    }
  } finally {
    config.apiKey = originalKey;
  }
});

test('POST /api/search-similar：旧代际 chunk 排除比例 > 50% 时 stale:true 附排除计数', async () => {
  mockEmbeddingFetch();
  setupTestDb('stale');
  const novelId = 'novel-stale';
  createNovel(mockNovel(novelId));

  // 预热 embedding（本地管线在测试环境不可用 → fetch mock 走 LLM fallback，置 status=fallback）
  await embedWithMetadata('预热', novelId);

  // 1 条兼容代际 chunk + 2 条 legacy chunk → 排除比例 2/3 > 50%
  await addChunk(novelId, 'chap-current', 0, '少年在演武场拔剑，剑光如秋水掠过。');
  insertLegacyChunk(novelId, 'chap-legacy-a', '旧代际正文甲。');
  insertLegacyChunk(novelId, 'chap-legacy-b', '旧代际正文乙。');

  const app = express();
  app.use(express.json()); // 生产环境由 server.ts 全局挂载，测试 app 需自带 JSON body 解析
  registerSearchRoutes(app);
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const { status, body } = await postSearch(address.port, novelId);
    assert.equal(status, 200);
    assert.equal(body.available, true);
    assert.equal(body.indexed, true);
    assert.equal(body.stale, true);
    assert.equal(body.staleExcluded, 2);
    assert.deepEqual(
      body.hits.map((hit) => hit.chapterId),
      ['chap-current']
    );
  } finally {
    server.close();
  }
});

test('POST /api/search-similar：索引新鲜时 stale:false', async () => {
  mockEmbeddingFetch();
  setupTestDb('fresh');
  const novelId = 'novel-fresh';
  createNovel(mockNovel(novelId));
  await embedWithMetadata('预热', novelId);
  await addChunk(novelId, 'chap-fresh', 0, '山门前的白鸽被剑气惊起。');

  const app = express();
  app.use(express.json()); // 生产环境由 server.ts 全局挂载，测试 app 需自带 JSON body 解析
  registerSearchRoutes(app);
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const { status, body } = await postSearch(address.port, novelId);
    assert.equal(status, 200);
    assert.equal(body.available, true);
    assert.equal(body.indexed, true);
    assert.equal(body.stale, false);
    assert.equal(body.staleExcluded, 0);
    assert.equal(body.hits.length, 1);
  } finally {
    server.close();
  }
});
