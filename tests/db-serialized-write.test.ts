import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb, closeDb, createNovel } from '../server/lib/db';
import { runInSerializedWrite, getDb } from '../server/lib/db-instance';
import type { Novel } from '../shared/types';

describe('SQLite WAL serialized writes queue', () => {
  test('concurrently runs 20 async writes without lock error', async () => {
    closeDb();
    const dbPath = path.join(os.tmpdir(), `inkflow-serialized-write-${Date.now()}.db`);

    try {
      initDb(dbPath);

      const novel: Novel = {
        id: 'novel-serialized-test-1',
        title: '并发锁测试小说',
        authorId: 'local-user',
        summary: '测试并发异步写',
        status: 'ongoing',
        mountedSkillIds: [],
        mountedSkillLoadout: [],
        projectPreferenceProfile: {
          tags: [],
          weights: {
            styleWeight: 0.5,
            characterWeight: 0.5,
            worldWeight: 0.5,
            plotWeight: 0.5,
            pacingWeight: 0.5,
          },
          acceptedDimensions: [],
          rejectedDimensions: [],
          notes: [],
          evidenceCount: 0,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      createNovel(novel);

      // Spin up 20 concurrent async write promises that modify metadata inside SQLite.
      // Utilizing runInSerializedWrite ensures they queue up and execute sequentially.
      const promises = Array.from({ length: 20 }).map((_, index) => {
        return runInSerializedWrite(async () => {
          // Simulate async task delay to interleave task loop ticks
          await new Promise((resolve) => setTimeout(resolve, 5));
          
          const dbInstance = getDb();
          dbInstance
            .prepare('UPDATE novels SET summary = ? WHERE id = ?')
            .run(`更新第 ${index} 次`, novel.id);
          
          return index;
        });
      });

      const results = await Promise.all(promises);

      // Verify all concurrent tasks completed successfully
      assert.strictEqual(results.length, 20);
      for (let i = 0; i < 20; i++) {
        assert.ok(results.includes(i));
      }

      // Read back final updated value
      const dbInstance = getDb();
      const finalRow = dbInstance
        .prepare('SELECT summary FROM novels WHERE id = ?')
        .get(novel.id) as { summary: string };
      
      assert.ok(finalRow);
      assert.ok(finalRow.summary.startsWith('更新第'));

    } finally {
      closeDb();
      if (fs.existsSync(dbPath)) {
        try {
          fs.unlinkSync(dbPath);
        } catch {
          // ignore cleanup failures
        }
      }
    }
  });
});
