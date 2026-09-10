import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  closeDb,
  createChapter,
  createNovel,
  initDb,
} from '../server/lib/db.ts';
import { getDb } from '../server/lib/db-instance.ts';
import { buildServerStoryContext } from '../server/helpers/story-context.ts';

let dbPath = '';

afterEach(() => {
  closeDb();
  if (!dbPath) return;
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  dbPath = '';
});

test('buildServerStoryContext loads only the recent chapter window, never the whole book', () => {
  dbPath = path.join(os.tmpdir(), `inkflow-story-context-scope-${Date.now()}.db`);
  initDb(dbPath);
  createNovel({
    id: 'novel-scope',
    title: '长篇',
    authorId: 'local-user',
    summary: '长篇加载范围测试。',
    status: 'ongoing',
    createdAt: 1,
    updatedAt: 1,
  });
  for (let order = 1; order <= 30; order++) {
    createChapter({
      id: `chapter-scope-${order}`,
      novelId: 'novel-scope',
      title: `第 ${order} 章`,
      content: `第${order}章正文标记。`,
      sceneBeats: `第${order}章节拍`,
      order,
      wordCount: 12,
      createdAt: 1,
      updatedAt: 1,
    });
  }

  // Wrap better-sqlite3 prepare to observe how the chapters table is read.
  const db = getDb();
  const originalPrepare = db.prepare.bind(db) as (...args: any[]) => any;
  const chapterReads: string[] = [];
  type PrepareFn = typeof db.prepare;
  const wrappedPrepare: any = (sql: string, ...rest: any[]) => {
    if (/FROM chapters\b/.test(sql)) chapterReads.push(sql.replace(/\s+/g, ' '));
    return originalPrepare(sql, ...rest);
  };
  (db as { prepare: PrepareFn }).prepare = wrappedPrepare;

  try {
    const context = buildServerStoryContext({ novelId: 'novel-scope', chapterId: 'chapter-scope-30' });

    // Guard: no unbounded full-content list of the chapters table may run.
    // Allowed shapes: `WHERE id = ?` single-row reads and `LIMIT ?` recent reads.
    const unboundedChapterScans = chapterReads.filter(
      (sql) => /WHERE novel_id = \?/.test(sql) && !/\bLIMIT\b/.test(sql),
    );
    assert.deepEqual(unboundedChapterScans, []);

    // The recent-chapters projection must be the bounded read in use.
    assert.ok(
      chapterReads.some((sql) => /\bLIMIT\b/.test(sql)),
      'expected a bounded recent-chapters read, got: ' + JSON.stringify(chapterReads),
    );

    // The 【近期章节】 ledger window holds at most the last 5 chapters.
    const recentSection = context.match(/【近期章节】\n([\s\S]*?)\n\n/);
    const recentEntries = recentSection
      ? recentSection[1].split('\n').filter((line) => line.startsWith('- '))
      : [];
    assert.ok(
      recentEntries.length > 0 && recentEntries.length <= 5,
      `expected 1..5 recent ledger entries, got ${recentEntries.length}`,
    );
    // Chapter 1 is far outside the window and must never surface.
    assert.doesNotMatch(context, /第1章节拍/);
    // The current chapter (30) is still reported.
    assert.match(context, /第30章节拍/);
  } finally {
    (db as { prepare: PrepareFn }).prepare = originalPrepare;
  }
});
