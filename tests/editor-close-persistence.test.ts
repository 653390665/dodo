import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeDb, createChapter, createNovel, getChapter, initDb, updateChapter } from '../server/lib/db';
import { flushEditorWritesForClose } from '../src/lib/editor-close-handshake';
import { __editorWriteQueueTestHooks, queueEditorWrite } from '../src/lib/editor-write-queue';

test('desktop close persists the last input before restart using an isolated SQLite database', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-editor-close-'));
  const dbPath = path.join(dir, 'close.test.db');
  try {
    closeDb();
    initDb(dbPath);
    createNovel({
      id: 'novel-close', title: '关闭测试', authorId: 'local-user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1,
    });
    createChapter({
      id: 'chapter-close', novelId: 'novel-close', title: '第一章', content: '旧正文', order: 1,
      wordCount: 3, createdAt: 1, updatedAt: 1,
    });
    queueEditorWrite('chapter:chapter-close:content', async () => updateChapter('chapter-close', {
      content: '退出前最后一次输入', wordCount: 9, updatedAt: Date.now(),
    }));

    let ready = false;
    assert.equal(await flushEditorWritesForClose(() => { ready = true; }), true);
    assert.equal(ready, true);

    closeDb();
    initDb(dbPath);
    assert.equal(getChapter('chapter-close')?.content, '退出前最后一次输入');
  } finally {
    __editorWriteQueueTestHooks.reset();
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
