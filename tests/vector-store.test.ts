import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../server/lib/db';
import { addChunk, searchSimilar, deleteNovel, getChunkCount } from '../server/vector-store';

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
    const results = searchSimilar([0.1, 0.2, 0.3], novelId);
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
