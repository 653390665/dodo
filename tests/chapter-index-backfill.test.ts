import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  closeDb,
  createChapter,
  createNovel,
  deleteChapter,
  getChapter,
  initDb,
  updateChapter,
} from '../server/lib/db';
import { advanceDatabaseGeneration } from '../server/lib/db-instance';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit';
import {
  __chapterIndexTestHooks,
  scheduleChapterIndexBackfill,
  scheduleChapterIndexRemoval,
} from '../server/lib/chapter-index';
import { addChunk, getChapterChunkText, getChunkCount } from '../server/vector-store';
import { DEFAULT_QUOTA_MAX } from '../server/helpers/quota-guard';
import { getConfig } from '../server/lib/config';
import type { Novel } from '../shared/types';
import {
  captureEnv,
  createTestWorkspace,
  restoreEnv,
  type EnvSnapshot,
} from './helpers/test-environment';

const originalFetch = globalThis.fetch;
const config = getConfig();
const envKeys = ['INKFLOW_INDEX_BACKFILL_DEBOUNCE_MS', 'INKFLOW_INDEX_BACKFILL_MIN_CHARS'] as const;

function mockNovel(id: string): Novel {
  const now = Date.now();
  return {
    id,
    title: 'Plan 201 backfill test',
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

function createChapterFixture(novelId: string, chapterId: string, content: string): void {
  createChapter({
    id: chapterId,
    novelId,
    title: '第一章',
    content,
    order: 1,
    wordCount: content.length,
    createdAt: 1,
    updatedAt: 1,
  });
}

let workspace: ReturnType<typeof createTestWorkspace> | undefined;
let envSnapshot: EnvSnapshot | undefined;

function setupTestDb(name: string): void {
  workspace = createTestWorkspace(`chapter-index-${name}`);
  envSnapshot = captureEnv([...envKeys]);
  // 窗口设短仅作保险（测试通过 flushNow 显式排干）；阈值放低让短测试正文可入索引
  process.env.INKFLOW_INDEX_BACKFILL_DEBOUNCE_MS = '10';
  process.env.INKFLOW_INDEX_BACKFILL_MIN_CHARS = '4';
  config.apiKey = config.apiKey || 'sk-mock-key-for-test-12345';
  config.baseUrl = 'https://api.deepseek.com';
  config.model = 'text-embedding-3-small';
  initDb(workspace.path('chapter-index.test.db'));
}

afterEach(() => {
  __chapterIndexTestHooks.reset();
  globalThis.fetch = originalFetch;
  // LLM fallback 走 embedding 令牌桶（5 令牌/文件进程），逐测试清空防止跨用例限流污染
  __rateLimitTestHooks.reset();
  restoreEnv(envSnapshot ?? {});
  envSnapshot = undefined;
  if (workspace) {
    closeDb();
    workspace.cleanup();
    workspace = undefined;
  }
});

const LONG_CONTENT_A = '少年在山门前拔剑，剑光如秋水般掠过整座演武场，惊起檐下白鸽。';
const LONG_CONTENT_B = '多年之后他重回旧地，演武场早已荒草丛生，只有那柄断剑还插在山门之前。';

test('章级回填：updateChapter 内容变化后经防抖队列入索引且可命中', async () => {
  mockEmbeddingFetch();
  setupTestDb('upsert');
  const novelId = 'novel-backfill';
  const chapterId = 'chap-backfill';
  createNovel(mockNovel(novelId));
  createChapterFixture(novelId, chapterId, '占位');

  // 手写正文保存（内容变化触发挂点）
  const saved = updateChapter(chapterId, {
    content: LONG_CONTENT_A,
    wordCount: LONG_CONTENT_A.length,
  });
  assert.equal(saved, true);
  assert.ok(__chapterIndexTestHooks.pendingCount() >= 1);

  await __chapterIndexTestHooks.flushNow();

  assert.equal(getChunkCount(novelId), 1);
  assert.equal(getChapterChunkText(novelId, chapterId, 0), LONG_CONTENT_A);

  // 幂等：同内容再次保存不入队、flush 后仍只有 1 条 chunk
  updateChapter(chapterId, { content: LONG_CONTENT_A, wordCount: LONG_CONTENT_A.length });
  assert.equal(__chapterIndexTestHooks.pendingCount(), 0);
  await __chapterIndexTestHooks.flushNow();
  assert.equal(getChunkCount(novelId), 1);
  assert.equal(getChapterChunkText(novelId, chapterId, 0), LONG_CONTENT_A);

  // 内容更新：旧 chunk 被替换而不是追加
  updateChapter(chapterId, { content: LONG_CONTENT_B, wordCount: LONG_CONTENT_B.length });
  await __chapterIndexTestHooks.flushNow();
  assert.equal(getChunkCount(novelId), 1);
  assert.equal(getChapterChunkText(novelId, chapterId, 0), LONG_CONTENT_B);
});

test('章级回填：upsertChapterChunk 编排对重复调度幂等', async () => {
  mockEmbeddingFetch();
  setupTestDb('idempotent');
  const novelId = 'novel-idempotent';
  const chapterId = 'chap-idempotent';
  createNovel(mockNovel(novelId));
  createChapterFixture(novelId, chapterId, LONG_CONTENT_A);

  const reader = () => {
    const chapter = getChapter(chapterId);
    return chapter && chapter.novelId === novelId ? chapter : undefined;
  };
  // 同章重复调度只保留一份意图（去重），flush 后单条 chunk
  scheduleChapterIndexBackfill(novelId, chapterId, reader);
  scheduleChapterIndexBackfill(novelId, chapterId, reader);
  assert.equal(__chapterIndexTestHooks.pendingCount(), 1);
  await __chapterIndexTestHooks.flushNow();
  assert.equal(getChunkCount(novelId), 1);
  assert.equal(getChapterChunkText(novelId, chapterId, 0), LONG_CONTENT_A);

  // 清理调度：remove 覆盖同一章的 pending upsert
  scheduleChapterIndexRemoval(novelId, chapterId);
  await __chapterIndexTestHooks.flushNow();
  assert.equal(getChunkCount(novelId), 0);
});

test('章级回填：deleteChapter 后清理该章 chunk（此前仅 deleteNovel 级联）', async () => {
  mockEmbeddingFetch();
  setupTestDb('delete-cleanup');
  const novelId = 'novel-delete';
  const chapterId = 'chap-delete';
  createNovel(mockNovel(novelId));
  createChapterFixture(novelId, chapterId, LONG_CONTENT_A);
  await addChunk(novelId, chapterId, 0, LONG_CONTENT_A);
  assert.equal(getChunkCount(novelId), 1);

  assert.equal(deleteChapter(chapterId), true);
  await __chapterIndexTestHooks.flushNow();
  assert.equal(getChunkCount(novelId), 0);
});

test('章级回填：embedding 失败不影响正文保存且不抛出', async () => {
  mockEmbeddingFetch();
  setupTestDb('embed-failure');
  // 无 apiKey → embedWithMetadata 抛 EmbeddingUnavailableError（确定性失败路径，不依赖网络）
  const originalKey = config.apiKey;
  config.apiKey = '';
  try {
    const novelId = 'novel-embed-fail';
    const chapterId = 'chap-embed-fail';
    createNovel(mockNovel(novelId));
    createChapterFixture(novelId, chapterId, LONG_CONTENT_A);

    const saved = updateChapter(chapterId, {
      content: LONG_CONTENT_B,
      wordCount: LONG_CONTENT_B.length,
    });
    // 正文保存本身必须成功
    assert.equal(saved, true);
    assert.equal(getChapter(chapterId)?.content, LONG_CONTENT_B);

    // 回填失败被编排层吞掉：flush 正常完成、不向调用方抛错
    await __chapterIndexTestHooks.flushNow();
    // delete-first 语义：旧 chunk 已清除，该章诚实处于未索引状态
    assert.equal(getChunkCount(novelId), 0);

    // 后续保存不受影响
    assert.equal(
      updateChapter(chapterId, { content: LONG_CONTENT_A, wordCount: LONG_CONTENT_A.length }),
      true
    );
    assert.equal(getChapter(chapterId)?.content, LONG_CONTENT_A);
  } finally {
    config.apiKey = originalKey;
  }
});

test('章级回填：数据库代际更替时静默降级（VectorIndexGenerationMismatchError 被吞掉）', async () => {
  mockEmbeddingFetch();
  setupTestDb('generation');
  const novelId = 'novel-generation';
  const chapterId = 'chap-generation';
  createNovel(mockNovel(novelId));
  createChapterFixture(novelId, chapterId, LONG_CONTENT_A);
  await addChunk(novelId, chapterId, 0, LONG_CONTENT_A);
  assert.equal(getChunkCount(novelId), 1);

  // embed 期间推进数据库代际（模拟导入替换），旧代际写入被丢弃
  globalThis.fetch = (async () => {
    advanceDatabaseGeneration();
    return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
  }) as typeof fetch;

  updateChapter(chapterId, { content: LONG_CONTENT_B, wordCount: LONG_CONTENT_B.length });
  // 关键断言：flushNow 正常 resolve，无未处理 rejection，进程不崩溃
  await __chapterIndexTestHooks.flushNow();
  // delete-first 已清旧 chunk，新代际写入被丢弃 → 该章无残留索引
  assert.equal(getChunkCount(novelId), 0);
});

test('章级回填：短于长度阈值的内容不入索引', async () => {
  mockEmbeddingFetch();
  setupTestDb('threshold');
  const novelId = 'novel-threshold';
  const chapterId = 'chap-threshold';
  createNovel(mockNovel(novelId));
  createChapterFixture(novelId, chapterId, '占位');

  // 非空白字符 2 < 阈值 4 → 跳过
  updateChapter(chapterId, { content: '草稿', wordCount: 2 });
  await __chapterIndexTestHooks.flushNow();
  assert.equal(getChunkCount(novelId), 0);

  // 达到阈值后正常入索引
  updateChapter(chapterId, { content: LONG_CONTENT_A, wordCount: LONG_CONTENT_A.length });
  await __chapterIndexTestHooks.flushNow();
  assert.equal(getChunkCount(novelId), 1);
});
