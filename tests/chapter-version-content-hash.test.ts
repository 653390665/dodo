/**
 * Plan 263 D3 · 章节版本正文指纹（chapter_versions.content_hash）。
 *
 * 覆盖：
 * ① 手动快照写入的版本行带 sha256 指纹，且指纹实现与判定同源（hashChapterContent）；
 * ② 章节正文变化后，同一快照的 matchesCurrentContent 由 true 转 false；
 * ③ 迁移前的旧行（content_hash NULL）→ contentHash null + matchesCurrentContent null（界面显示「来源未知」）；
 * ④ accept 前置快照路径（旧文本入版本表）同样带指纹；
 * ⑤ 指纹口径 = 原文逐字节（不做空白归一化），固化语义避免日后被「顺手」改掉。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import {
  acceptChapterContentCandidate,
  closeDb,
  createChapter,
  createChapterVersion,
  createNovel,
  initDb,
  listChapterVersionMetas,
  listChapterVersions,
  updateChapter,
} from '../server/lib/db.js';
import { getDb } from '../server/lib/db-instance.js';
import { hashChapterContent } from '../server/lib/db-mappers.js';
import { computeChapterWorkflowHash } from '../shared/lib/chapter-workflow.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function setup(content = '第一版正文'): void {
  closeDb();
  initDb(':memory:');
  createNovel({
    id: 'd3-novel',
    title: 'D3 测试',
    authorId: 'local',
    summary: '',
    status: 'ongoing',
    createdAt: 1,
    updatedAt: 1,
  });
  createChapter({
    id: 'd3-chapter',
    novelId: 'd3-novel',
    title: '第一章',
    content,
    order: 1,
    wordCount: content.replace(/\s/g, '').length,
    createdAt: 1,
    updatedAt: 1,
  });
}

test.after(() => closeDb());

test('手动快照写入 sha256 指纹，且与当前正文一致时判为「当前正文」', () => {
  setup();
  createChapterVersion({
    id: 'v-same',
    chapterId: 'd3-chapter',
    content: '第一版正文',
    wordCount: 5,
    author: 'user',
    createdAt: 2,
  });

  assert.equal(hashChapterContent('第一版正文'), sha256('第一版正文'));
  assert.equal(listChapterVersions('d3-chapter')[0]?.contentHash, sha256('第一版正文'));

  const [meta] = listChapterVersionMetas('d3-chapter');
  assert.equal(meta?.contentHash, sha256('第一版正文'));
  assert.equal(meta?.matchesCurrentContent, true);
});

test('正文更新后同一快照判为「与当前正文不同」', () => {
  setup();
  createChapterVersion({
    id: 'v-old',
    chapterId: 'd3-chapter',
    content: '第一版正文',
    wordCount: 5,
    author: 'user',
    createdAt: 2,
  });
  updateChapter('d3-chapter', { content: '第二版正文', wordCount: 5, updatedAt: 3 });

  const [meta] = listChapterVersionMetas('d3-chapter');
  assert.equal(meta?.matchesCurrentContent, false);
});

test('迁移前旧行（content_hash NULL）判为「来源未知」，不当作一致', () => {
  setup();
  getDb()
    .prepare(
      'INSERT INTO chapter_versions (id, chapter_id, content, word_count, author, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run('v-legacy', 'd3-chapter', '第一版正文', 5, 'user', 2);

  const [meta] = listChapterVersionMetas('d3-chapter');
  assert.equal(meta?.id, 'v-legacy');
  assert.equal(meta?.contentHash, null);
  assert.equal(meta?.matchesCurrentContent, null);
});

test('accept 前置快照（旧文本入版本表）同样带指纹', () => {
  setup();
  acceptChapterContentCandidate({
    chapterId: 'd3-chapter',
    novelId: 'd3-novel',
    baselineHash: computeChapterWorkflowHash('第一版正文'),
    content: '精修后的正文',
    wordCount: 6,
    workflowMeta: { version: 1 },
    version: {
      id: 'v-before-accept',
      chapterId: 'd3-chapter',
      content: '第一版正文',
      wordCount: 5,
      author: 'editor-agent',
      createdAt: 2,
    },
  });

  const [meta] = listChapterVersionMetas('d3-chapter');
  assert.equal(meta?.contentHash, sha256('第一版正文'));
  assert.equal(meta?.matchesCurrentContent, false);
});

test('指纹口径 = 原文逐字节（不做空白归一化）', () => {
  assert.notEqual(hashChapterContent('正文\n'), hashChapterContent('正文'));
  assert.equal(hashChapterContent('正文\n'), sha256('正文\n'));
});
