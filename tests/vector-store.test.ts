import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../server/lib/db';
import { getDb } from '../server/lib/db-instance';
import { addChunk, searchSimilar, deleteNovel, getChunkCount } from '../server/vector-store';
import { getConfig } from '../server/lib/config';

// Ensure standard mock configuration is populated for hermetic CI tests
const config = getConfig();
config.apiKey = config.apiKey || 'sk-mock-key-for-test-12345';
config.baseUrl = 'https://api.deepseek.com'; // Unconditionally force non-Google API to use fetch mock
config.model = 'text-embedding-3-small';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('vectorStore operations add, search, count, and delete correctly', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2, 0.3] }]
    }));
  };

  const dbPath = path.join(__dirname, 'test-vector-store.db');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  initDb(dbPath);

  try {
    const novelId = 'test-novel-123';
    const initialCount = getChunkCount(novelId);

    // Add chunks
    await addChunk(novelId, 'chap-1', 0, 'first chunk text');
    await addChunk(novelId, 'chap-1', 1, 'second chunk text');

    assert.equal(getChunkCount(novelId), initialCount + 2);

    // Search similar
    const results = searchSimilar(
      [0.1, 0.2, 0.3],
      novelId,
      'openai-compatible:text-embedding-3-small',
    );
    assert.ok(results.length > 0);
    assert.equal(results[0].text, 'first chunk text');

    // Delete novel chunks
    deleteNovel(novelId);
    assert.equal(getChunkCount(novelId), 0);
  } finally {
    globalThis.fetch = originalFetch;
    closeDb();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  }
});

test('vectorStore rejects legacy and different-model vectors even when dimensions match', async () => {
  const originalFetch = globalThis.fetch;
  const dbPath = path.join(__dirname, 'test-vector-store-model.db');
  fs.rmSync(dbPath, { force: true });
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{ embedding: [0.1, 0.2, 0.3] }],
  }));
  initDb(dbPath);

  try {
    const novelId = 'model-bound-novel';
    config.model = 'embedding-model-a';
    await addChunk(novelId, 'chap-a', 0, 'model a chunk');
    config.model = 'embedding-model-b';
    await addChunk(novelId, 'chap-b', 0, 'model b chunk');
    getDb().prepare(`
      INSERT INTO vector_chunks (id, novel_id, chapter_id, chunk_index, text, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('legacy-vector', novelId, 'chap-legacy', 0, 'legacy chunk', JSON.stringify([0.1, 0.2, 0.3]));

    const results = searchSimilar(
      [0.1, 0.2, 0.3],
      novelId,
      'openai-compatible:embedding-model-a',
    );
    assert.deepEqual(results.map((result) => result.text), ['model a chunk']);
  } finally {
    config.model = 'text-embedding-3-small';
    globalThis.fetch = originalFetch;
    closeDb();
    fs.rmSync(dbPath, { force: true });
  }
});
