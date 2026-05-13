import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDb,
  createChapter,
  createChapterProductionRun,
  createNovel,
  getChapterProductionRun,
  initDb,
  listChapterProductionRuns,
  updateChapterProductionRun,
} from '../src/lib/db';
import type { Chapter, ChapterProductionRun, Novel } from '../src/types';

function baseNovel(): Novel {
  const now = Date.now();
  return {
    id: 'novel-prod-1',
    title: '生产测试',
    authorId: 'local-user',
    summary: '测试单章生产 run',
    status: 'ongoing',
    createdAt: now,
    updatedAt: now,
  };
}

function baseChapter(): Chapter {
  const now = Date.now();
  return {
    id: 'chapter-1',
    novelId: 'novel-prod-1',
    title: '第一章',
    content: '旧巷的雨声。',
    order: 1,
    wordCount: 8,
    createdAt: now,
    updatedAt: now,
  };
}

function baseRun(): ChapterProductionRun {
  const now = Date.now();
  return {
    id: 'run-1',
    novelId: 'novel-prod-1',
    targetChapterId: 'chapter-1',
    status: 'review_required',
    userIntent: '写下一章雨夜追杀。',
    sceneBeats: '1. 追兵入城。2. 林砚逃入旧巷。',
    draftContent: '雨水压低了旧巷的檐声。',
    styleAudit: 'PASS：节奏稳定。',
    continuityReport: {
      score: 88,
      issues: [],
      proposedPatch: {
        characterUpdates: [],
        itemUpdates: [],
        foreshadowingUpdates: [],
        timelineEventsToCreate: [
          {
            title: '林砚入旧巷',
            timestamp: '第一卷第二夜',
            description: '林砚被追兵逼入旧巷。',
            statusTag: '已发生',
          },
        ],
        foreshadowingsToCreate: [],
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

test('chapter production run persists JSON report and status updates', () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-prod-run-${Date.now()}.db`);

  try {
    initDb(dbPath);
    createNovel(baseNovel());
    createChapter(baseChapter());
    createChapterProductionRun(baseRun());

    const read = getChapterProductionRun('run-1');
    assert.ok(read);
    assert.equal(read!.status, 'review_required');
    assert.equal(read!.continuityReport.score, 88);
    assert.equal(read!.continuityReport.proposedPatch.timelineEventsToCreate[0].title, '林砚入旧巷');

    updateChapterProductionRun('run-1', {
      status: 'applied',
      styleAudit: 'PASS：已接受。',
    });

    const updated = getChapterProductionRun('run-1');
    assert.ok(updated);
    assert.equal(updated!.status, 'applied');
    assert.equal(updated!.styleAudit, 'PASS：已接受。');

    const runs = listChapterProductionRuns('novel-prod-1');
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, 'run-1');
  } finally {
    closeDb();
    fs.rmSync(dbPath, { force: true });
  }
});
