import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb } from '../server/lib/db-init.js';
import { closeDb } from '../server/lib/db-instance.js';
import { createNovel } from '../server/lib/db/novels.js';
import { createChapter, createChapterVersion, getChapterVersion, listChapterVersionMetas } from '../server/lib/db/chapters.js';
import type { Novel } from '../shared/types';

// 持久层投影测试（Plan 183）：版本列表投影不含整章 content，
// 单条 getChapterVersion 才返回正文（供回滚按 id 取全文）。

describe('chapter version metas projection', () => {
  const dbPath = path.join(os.tmpdir(), `test-version-metas-${Date.now()}.db`);
  const now = Date.now();

  test('metas omit full content, keep preview/ordering; single get returns content', () => {
    initDb(dbPath);

    const novel: Novel = {
      id: 'version-metas-novel',
      title: '版本投影测试小说',
      authorId: 'local-user',
      summary: 'listChapterVersionMetas 投影测试',
      status: 'ongoing',
      createdAt: now,
      updatedAt: now,
    };
    createNovel(novel);
    createChapter({
      id: 'version-metas-chapter',
      novelId: novel.id,
      title: '第一章',
      content: '当前正文',
      order: 1,
      wordCount: 4,
      createdAt: now,
      updatedAt: now,
    });

    const longContent = '长'.repeat(500);
    createChapterVersion({
      id: 'version-old',
      chapterId: 'version-metas-chapter',
      content: longContent,
      wordCount: 500,
      author: 'writer-agent',
      createdAt: now - 1000,
    });
    createChapterVersion({
      id: 'version-new',
      chapterId: 'version-metas-chapter',
      content: '短正文',
      wordCount: 3,
      author: 'user',
      createdAt: now + 1000,
    });

    const metas = listChapterVersionMetas('version-metas-chapter');
    assert.equal(metas.length, 2);
    // created_at DESC：新版本在前
    assert.equal(metas[0].id, 'version-new');
    assert.equal(metas[1].id, 'version-old');
    // 投影不含 content / chapterId，preview 截断到 150 字符
    for (const meta of metas) {
      assert.ok(!('content' in meta), 'meta must not carry full content');
      assert.ok(!('chapterId' in meta), 'meta must not carry chapterId');
      assert.ok(meta.preview.length <= 150);
    }
    assert.equal(metas[1].preview, '长'.repeat(150));
    assert.equal(metas[0].preview, '短正文');
    assert.equal(metas[0].wordCount, 3);
    assert.equal(metas[0].author, 'user');

    // 单条读取返回完整正文（回滚路径）
    const full = getChapterVersion('version-old');
    assert.ok(full);
    assert.equal(full.content, longContent);
    assert.equal(full.chapterId, 'version-metas-chapter');
    assert.equal(getChapterVersion('missing-version'), undefined);

    closeDb();
    fs.rmSync(dbPath, { force: true });
    for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  });

  test('metas path resolves relative to tmpdir os.tmpdir only', () => {
    assert.ok(dbPath.startsWith(os.tmpdir()));
    assert.ok(!fs.existsSync(dbPath), 'temp db cleaned up');
  });
});
