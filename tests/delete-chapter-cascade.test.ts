import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb } from '../server/lib/db-init.js';
import { getDb, closeDb } from '../server/lib/db-instance.js';
import { createNovel, getNovel } from '../server/lib/db/novels.js';
import { createChapter, deleteChapter, getChapter } from '../server/lib/db/chapters.js';
import type { Novel } from '../shared/types';

// 持久层特征测试：deleteChapter 的级联语义。
// schema（server/lib/db-init.ts）规定：
//   chapter_versions.chapter_id        → chapters(id) ON DELETE CASCADE（版本随章节删除）
//   chapter_production_runs.target_chapter_id → chapters(id) ON DELETE SET NULL（run 保留、目标悬空）
// 本测试锁定当前 schema 行为，变更需产品决策。

describe('deleteChapter cascade tests', () => {
  const dbPath = path.join(os.tmpdir(), `test-delete-chapter-${Date.now()}.db`);

  test('deleting a chapter cascades versions, keeps the production run with a dangling target, and leaves siblings intact', () => {
    initDb(dbPath);
    const db = getDb();
    const getCount = (sql: string, ...params: any[]): number => {
      const row = db.prepare(sql).get(...params) as { count: number } | undefined;
      return row ? row.count : 0;
    };

    const novelId = 'delete-chapter-novel';
    const now = Date.now();

    const novel: Novel = {
      id: novelId,
      title: '章节级联测试小说',
      authorId: 'local-user',
      summary: 'deleteChapter 级联与完整性测试',
      status: 'ongoing',
      createdAt: now,
      updatedAt: now,
    };
    createNovel(novel);

    createChapter({
      id: 'chapter-target',
      novelId,
      title: '第一章',
      content: '目标章节正文',
      order: 1,
      wordCount: 6,
      createdAt: now,
      updatedAt: now,
    });
    createChapter({
      id: 'chapter-sibling',
      novelId,
      title: '第二章',
      content: '兄弟章节正文',
      order: 2,
      wordCount: 6,
      createdAt: now,
      updatedAt: now,
    });

    db.prepare(`
      INSERT INTO chapter_versions (id, chapter_id, content, word_count, author, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('version-1', 'chapter-target', '目标章节旧版本一', 8, 'user', now);
    db.prepare(`
      INSERT INTO chapter_versions (id, chapter_id, content, word_count, author, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('version-2', 'chapter-target', '目标章节旧版本二', 8, 'user', now + 1);

    db.prepare(`
      INSERT INTO chapter_production_runs (id, novel_id, target_chapter_id, status, user_intent, scene_beats, draft_content, style_audit, continuity_report, error_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('run-1', novelId, 'chapter-target', 'completed', '写一段故事', '分镜大纲', '正文草稿', '审稿报告', '{}', null, now, now);

    // 前置状态确认
    assert.equal(getCount('SELECT COUNT(*) as count FROM chapter_versions WHERE chapter_id = ?', 'chapter-target'), 2);
    assert.equal(getCount('SELECT COUNT(*) as count FROM chapter_production_runs WHERE target_chapter_id = ?', 'chapter-target'), 1);

    // 执行删除
    assert.equal(deleteChapter('chapter-target'), true);

    // chapter_versions ON DELETE CASCADE：版本随之清零
    assert.equal(getCount('SELECT COUNT(*) as count FROM chapter_versions WHERE chapter_id = ?', 'chapter-target'), 0);
    assert.equal(getChapter('chapter-target'), undefined);

    // chapter_production_runs.target_chapter_id ON DELETE SET NULL：run 保留、target 悬空（合法现状）
    assert.equal(getCount('SELECT COUNT(*) as count FROM chapter_production_runs WHERE id = ?', 'run-1'), 1);
    const run = db.prepare('SELECT target_chapter_id FROM chapter_production_runs WHERE id = ?').get('run-1') as { target_chapter_id: string | null };
    assert.equal(run.target_chapter_id, null);

    // 兄弟章节与所属小说不受影响
    const sibling = getChapter('chapter-sibling');
    assert.ok(sibling);
    assert.equal(sibling.content, '兄弟章节正文');
    assert.ok(getNovel(novelId));

    // 删除不存在的章节返回 false
    assert.equal(deleteChapter('chapter-missing'), false);

    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
      } catch {
        // Ignored
      }
    }
  });
});
