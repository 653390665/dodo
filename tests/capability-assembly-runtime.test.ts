/**
 * P0-①：装配三字段（projectCards / chapterCards / singleRunCard）的运行时接线用例。
 *
 * 验收口径（对应 scratch 侦察结论）：
 * - 三通道：projectCards 按 manifest kind 分流到卡组 / 技法 / 护栏；未声明时旧通道逐项不变。
 * - chapterCards 只在带 chapterId 时生效（章节作用域），无效 id 宽松忽略、不阻断请求。
 * - singleRunCard 作为请求期回退，显式 sessionCardIds（含显式空数组）优先。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import { createChapter } from '../server/lib/db/chapters.js';
import { resolveWritingStyleRequest } from '../server/helpers/writing-style-service.js';
import type { Chapter, Novel, Skill } from '../shared/types.js';

const WRITER_SKILL_ID = 'writer-skill';
const CHAPTER_ID = 'chapter-1';

function skill(id: string): Skill {
  return {
    id,
    name: id,
    description: `${id} 描述`,
    style: `${id} 文风`,
    pacing: `${id} 节奏`,
    stabilityScore: 90,
    evaluationFeedback: '',
    version: 1,
    createdAt: 1,
  } as Skill;
}

function v3Novel(profile: Record<string, unknown>): Novel {
  return {
    id: 'novel-1',
    title: '测试作品',
    authorId: 'author',
    summary: '',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [{ slot: 0, skillId: WRITER_SKILL_ID, weight: 1, lockedDimensions: [] }],
    projectPreferenceProfile: {
      tags: [],
      weights: {
        styleWeight: 1,
        characterWeight: 1,
        worldWeight: 1,
        plotWeight: 1,
        pacingWeight: 1,
      },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
        ...profile,
      },
    },
    createdAt: 1,
    updatedAt: 1,
  } as Novel;
}

function seed(profile: Record<string, unknown> = {}, withChapter = false): void {
  closeDb();
  initDb(':memory:');
  db.createSkill(skill(WRITER_SKILL_ID));
  db.createNovel(v3Novel(profile));
  if (withChapter) {
    const chapter: Chapter = {
      id: CHAPTER_ID,
      novelId: 'novel-1',
      title: '第一章',
      content: '已有正文。',
      order: 1,
      wordCount: 5,
      createdAt: 1,
      updatedAt: 1,
    };
    createChapter(chapter);
  }
}

function techniqueIdsOf(
  snapshot: ReturnType<typeof resolveWritingStyleRequest>['executionSnapshot']
): string[] {
  return [
    ...snapshot.techniques.planner,
    ...snapshot.techniques.writer,
    ...snapshot.techniques.critic,
  ].map((technique) => technique.id);
}

test('未声明三字段时三通道逐项不变（回归基线）', () => {
  seed();
  try {
    const resolved = resolveWritingStyleRequest('novel-1');
    const snapshot = resolved.executionSnapshot;
    assert.equal(snapshot.skillStack.mainCard, null);
    assert.deepEqual(snapshot.skillStack.chapterCards, []);
    assert.deepEqual(techniqueIdsOf(snapshot), []);
    // 基线护栏仍只来自 core-default（存量行为）
    assert.ok(snapshot.guardrails.length > 0);
    assert.ok(!snapshot.guardrails.some((guardrail) => guardrail.id === 'de-ai-tells-guard'));
  } finally {
    closeDb();
  }
});

test('projectCards 卡组面：kind=skill-card 走既有卡组通道成为主卡', () => {
  seed({ projectCards: ['deconstruct-suspense-hook'] });
  try {
    const snapshot = resolveWritingStyleRequest('novel-1').executionSnapshot;
    assert.equal(snapshot.skillStack.mainCard?.id, 'deconstruct-suspense-hook');
    assert.equal(snapshot.skillStack.mainCard?.type, 'hook-card');
  } finally {
    closeDb();
  }
});

test('projectCards 技法面：kind=technique 注入技法并加长 writer 提示词', () => {
  seed();
  try {
    const before = resolveWritingStyleRequest('novel-1').executionSnapshot;
    assert.deepEqual(techniqueIdsOf(before), []);
    db.updateNovel('novel-1', {
      projectPreferenceProfile: v3Novel({ projectCards: ['de-ai-slop-shield'] })
        .projectPreferenceProfile,
    });
    const after = resolveWritingStyleRequest('novel-1').executionSnapshot;
    assert.ok(techniqueIdsOf(after).includes('de-ai-slop-shield'));
    assert.ok(after.stagePrompts.writer.length > before.stagePrompts.writer.length);
  } finally {
    closeDb();
  }
});

test('projectCards 护栏面：kind=guardrail 进护栏且旧 guardrailIds 仍生效', () => {
  seed({ projectCards: ['de-ai-tells-guard'], guardrailIds: ['private-100'] });
  try {
    const snapshot = resolveWritingStyleRequest('novel-1').executionSnapshot;
    const ids = snapshot.guardrails.map((guardrail) => guardrail.id);
    assert.ok(ids.includes('de-ai-tells-guard'));
    assert.ok(ids.includes('private-100'));
  } finally {
    closeDb();
  }
});

test('chapterCards 技法面遵守章节作用域（无 chapterId 不生效）', () => {
  seed({ chapterCards: ['de-ai-slop-shield'] }, true);
  try {
    const withoutChapter = resolveWritingStyleRequest('novel-1').executionSnapshot;
    assert.ok(!techniqueIdsOf(withoutChapter).includes('de-ai-slop-shield'));
    const withChapter = resolveWritingStyleRequest('novel-1', { chapterId: CHAPTER_ID })
      .executionSnapshot;
    assert.ok(techniqueIdsOf(withChapter).includes('de-ai-slop-shield'));
  } finally {
    closeDb();
  }
});

test('chapterCards 能力卡面经本章使用卡解析（治理货架资产）', () => {
  seed({ chapterCards: ['deconstruct-card-hook'] }, true);
  try {
    const withoutChapter = resolveWritingStyleRequest('novel-1').executionSnapshot;
    assert.deepEqual(withoutChapter.skillStack.chapterCards, []);
    const withChapter = resolveWritingStyleRequest('novel-1', { chapterId: CHAPTER_ID })
      .executionSnapshot;
    assert.deepEqual(
      withChapter.skillStack.chapterCards.map((card) => card.id),
      ['deconstruct-card-hook']
    );
  } finally {
    closeDb();
  }
});

test('singleRunCard 作为请求期回退；显式 sessionCardIds（含空数组）优先', () => {
  seed({ singleRunCard: 'knowledge-extract' }, true);
  try {
    const fallback = resolveWritingStyleRequest('novel-1', { chapterId: CHAPTER_ID })
      .executionSnapshot;
    assert.deepEqual(
      fallback.skillStack.chapterCards.map((card) => card.id),
      ['knowledge-extract']
    );
    const explicitEmpty = resolveWritingStyleRequest('novel-1', {
      chapterId: CHAPTER_ID,
      sessionCardIds: [],
    }).executionSnapshot;
    assert.deepEqual(explicitEmpty.skillStack.chapterCards, []);
    const explicitOther = resolveWritingStyleRequest('novel-1', {
      chapterId: CHAPTER_ID,
      sessionCardIds: ['deconstruct-card-pacing'],
    }).executionSnapshot;
    assert.deepEqual(
      explicitOther.skillStack.chapterCards.map((card) => card.id),
      ['deconstruct-card-pacing']
    );
  } finally {
    closeDb();
  }
});

test('chapterCards 中无效 id 被忽略且不阻断请求（宽松语义）', () => {
  seed({ chapterCards: ['not-a-real-card', 'de-ai-slop-shield'] }, true);
  try {
    const snapshot = resolveWritingStyleRequest('novel-1', { chapterId: CHAPTER_ID })
      .executionSnapshot;
    assert.ok(techniqueIdsOf(snapshot).includes('de-ai-slop-shield'));
    assert.ok(!techniqueIdsOf(snapshot).includes('not-a-real-card'));
  } finally {
    closeDb();
  }
});
