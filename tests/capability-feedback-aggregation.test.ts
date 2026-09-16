import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closeDb,
  createChapter,
  createNovel,
  createSkill,
  createSkillUsageRecord,
  getSkill,
  initDb,
  syncSkillFeedbackScores,
} from '../server/lib/db';
import type { Chapter, Novel, Skill } from '../shared/types';
import { getSkillScoreChannels } from '../shared/lib/skill-model.js';

function baseSkill(overrides: Partial<Skill> = {}): Skill {
  const now = Date.now();
  return {
    id: 'skill-fb-1',
    name: '冷冽武侠',
    description: '反馈环用例卡',
    style: '冷峻',
    pacing: '快慢结合',
    vocabulary: [],
    imagery: [],
    bannedWords: [],
    fewShots: [],
    corePatterns: [],
    bannedElements: [],
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 1,
    createdAt: now,
    lineageRootId: 'skill-fb-1',
    dimensionTags: ['style'],
    ...overrides,
  } as Skill;
}

function baseNovel(): Novel {
  return {
    id: 'n1',
    title: 'N',
    authorId: 'local',
    summary: '',
    status: 'ongoing',
    createdAt: 1,
    updatedAt: 1,
  } as Novel;
}

function baseChapter(): Chapter {
  return {
    id: 'c1',
    novelId: 'n1',
    title: 'Test Chapter',
    content: '',
    order: 1,
    wordCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as Chapter;
}

test('capability feedback record flows into usageStats and feedbackScore (plan 241)', () => {
  closeDb();
  initDb(':memory:');
  try {
    createNovel(baseNovel());
    createChapter(baseChapter());
    createSkill(baseSkill());

    // 章节完成时点的轻量反馈：👎 → userAction rejected
    createSkillUsageRecord({
      id: 'feedback-c1-1',
      novelId: 'n1',
      chapterId: 'c1',
      mountedSkillIds: ['skill-fb-1'],
      fitScore: 15,
      userAction: 'rejected',
      createdAt: Date.now(),
    });
    // syncSkillFeedbackScores 返回扁平 skill（附 usageStats/feedbackScore）
    const updated = syncSkillFeedbackScores().find((entry) => entry.id === 'skill-fb-1');
    assert.ok(updated, 'sync 应返回该卡');
    assert.equal(updated.usageStats?.mountedCount, 1);
    assert.equal(updated.usageStats?.rejectedCount, 1);

    const stored = getSkill('skill-fb-1');
    assert.ok(stored);
    // 聚合反馈分已写回 skill 记录
    assert.equal(stored.feedbackScore, updated.feedbackScore);
    // score channels：observedPerformance 从 null 激活（能力卡地图/适合度消费口）
    const channels = getSkillScoreChannels(stored);
    assert.ok(channels.observedPerformance, '有样本后 observedPerformance 应激活');
    assert.equal(channels.observedPerformance?.sampleSize, 1);
  } finally {
    closeDb();
  }
});

test('repeat completion appends rows; client-side dedupe is the idempotency boundary (plan 241 v1)', () => {
  closeDb();
  initDb(':memory:');
  try {
    createNovel(baseNovel());
    createChapter(baseChapter());
    createSkill(baseSkill());
    // 同章重完成会 append 新记录（服务端 append-only 语义）；客户端以
    // capability-feedback-done:<chapterId> 保证只问一次（241 v1 幂等边界）。
    for (const id of ['feedback-c1-1', 'feedback-c1-2']) {
      createSkillUsageRecord({
        id,
        novelId: 'n1',
        chapterId: 'c1',
        mountedSkillIds: ['skill-fb-1'],
        fitScore: 85,
        userAction: 'accepted',
        createdAt: Date.now(),
      });
    }
    const updated = syncSkillFeedbackScores().find((entry) => entry.id === 'skill-fb-1');
    assert.equal(updated?.usageStats?.mountedCount, 2);
    assert.equal(updated?.usageStats?.acceptedCount, 2);
    assert.ok((updated?.feedbackScore ?? 0) > 50, '两次 👍 的卡反馈分应高于中位');
  } finally {
    closeDb();
  }
});
