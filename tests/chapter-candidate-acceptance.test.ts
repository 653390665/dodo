import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptChapterContentCandidate,
  closeDb,
  createChapter,
  createNovel,
  getChapter,
  initDb,
  listChapterVersions,
} from '../server/lib/db.js';
import { computeChapterWorkflowHash } from '../shared/lib/chapter-workflow.js';

function setup() {
  closeDb();
  initDb(':memory:');
  createNovel({ id: 'candidate-novel', title: '候选测试', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createChapter({
    id: 'candidate-chapter', novelId: 'candidate-novel', title: '第一章', content: '原始正文', sceneBeats: '进入城门',
    order: 1, wordCount: 4, createdAt: 1, updatedAt: 1,
  });
}

test.after(() => closeDb());

test('accepting a chapter candidate writes the version and content atomically', () => {
  setup();
  const accepted = acceptChapterContentCandidate({
    chapterId: 'candidate-chapter', novelId: 'candidate-novel',
    baselineHash: computeChapterWorkflowHash('原始正文', '进入城门'),
    content: '精修后的正文', wordCount: 6,
    workflowMeta: { version: 1 },
    version: { id: 'before-candidate', chapterId: 'candidate-chapter', content: '原始正文', wordCount: 4, author: 'editor-agent', createdAt: 2 },
  });

  assert.equal(accepted, true);
  assert.equal(getChapter('candidate-chapter')?.content, '精修后的正文');
  assert.equal(getChapter('candidate-chapter')?.wordCount, '精修后的正文'.replace(/\s/g, '').length);
  assert.deepEqual(listChapterVersions('candidate-chapter').map((version) => version.content), ['原始正文']);
  assert.equal(listChapterVersions('candidate-chapter')[0]?.wordCount, '原始正文'.replace(/\s/g, '').length);
});

test('stale or mismatched candidate acceptance leaves content and versions unchanged', () => {
  setup();
  assert.throws(() => acceptChapterContentCandidate({
    chapterId: 'candidate-chapter', novelId: 'candidate-novel',
    baselineHash: computeChapterWorkflowHash('过期正文', '进入城门'),
    content: '不应写入', wordCount: 4,
    version: { id: 'stale-version', chapterId: 'candidate-chapter', content: '原始正文', wordCount: 4, author: 'editor-agent', createdAt: 2 },
  }), /CHAPTER_CANDIDATE_STALE/);
  assert.throws(() => acceptChapterContentCandidate({
    chapterId: 'candidate-chapter', novelId: 'candidate-novel',
    baselineHash: computeChapterWorkflowHash('原始正文', '进入城门'),
    content: '不应写入', wordCount: 4,
    version: { id: 'wrong-version', chapterId: 'other-chapter', content: '原始正文', wordCount: 4, author: 'editor-agent', createdAt: 3 },
  }), /CHAPTER_CANDIDATE_SCOPE_MISMATCH/);

  assert.equal(getChapter('candidate-chapter')?.content, '原始正文');
  assert.equal(listChapterVersions('candidate-chapter').length, 0);
});

test('quality failures are rejected before a candidate can change the chapter', () => {
  setup();
  assert.throws(() => acceptChapterContentCandidate({
    chapterId: 'candidate-chapter', novelId: 'candidate-novel',
    baselineHash: computeChapterWorkflowHash('原始正文', '进入城门'),
    content: '正文如下：\n\n问题：请继续写。', wordCount: 999,
    version: { id: 'invalid-quality-version', chapterId: 'candidate-chapter', content: '原始正文', wordCount: 4, author: 'editor-agent', createdAt: 2 },
  }), /CHAPTER_CANDIDATE_QUALITY_FAILED/);
  assert.equal(getChapter('candidate-chapter')?.content, '原始正文');
  assert.equal(listChapterVersions('candidate-chapter').length, 0);
});

test('draft candidates must meet the complete chapter length contract at the persistence boundary', () => {
  setup();
  const shortDraft = Array.from({ length: 20 }, () => '林舟沿着城门阴影向前走，记住门后的脚步。').join('\n\n');
  assert.ok(shortDraft.replace(/\s/g, '').length < 4000);
  assert.throws(() => acceptChapterContentCandidate({
    chapterId: 'candidate-chapter', novelId: 'candidate-novel',
    baselineHash: computeChapterWorkflowHash('原始正文', '进入城门'),
    content: shortDraft, wordCount: shortDraft.replace(/\s/g, '').length, operation: 'draft',
    version: { id: 'short-draft-version', chapterId: 'candidate-chapter', content: '原始正文', wordCount: 4, author: 'editor-agent', createdAt: 2 },
  }), /CHAPTER_CANDIDATE_QUALITY_FAILED/);
  assert.equal(getChapter('candidate-chapter')?.content, '原始正文');
  assert.equal(listChapterVersions('candidate-chapter').length, 0);
});
