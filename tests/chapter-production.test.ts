import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChapterProductionTitle,
  buildProductionPlannerContext,
  buildProductionPromptContexts,
  buildProductionWriterContext,
  buildProductionExecutionReceipt,
  getNextChapterOrder,
  normalizeProductionIntent,
} from '../src/lib/chapter-production';
import type { Chapter, StoryStateLedger } from '../shared/types';

describe("production", () => {
test('getNextChapterOrder preserves a unique order after legacy and sparse chapters', () => {
  assert.equal(getNextChapterOrder([]), 1);
  assert.equal(getNextChapterOrder([{ order: 0 }] as Chapter[]), 2);
  assert.equal(getNextChapterOrder([{ order: 1 }] as Chapter[]), 2);
  assert.equal(getNextChapterOrder([{ order: 1 }, { order: 3 }] as Chapter[]), 4);
  assert.equal(getNextChapterOrder([{ order: 1 }, { order: 1 }] as Chapter[]), 3);
  assert.equal(getNextChapterOrder([{ order: Number.NaN }] as Chapter[]), 2);
});

test('buildChapterProductionTitle formats next chapter title', () => {
  assert.equal(buildChapterProductionTitle(4), '第 4 章');
});

test('normalizeProductionIntent keeps empty intent out of prose context', () => {
  assert.equal(normalizeProductionIntent(''), '');
  assert.equal(normalizeProductionIntent('延续上一章剧情，生成下一章分镜、正文和连续性审计。'), '');
  assert.equal(normalizeProductionIntent('  追兵入城  '), '追兵入城');
});

test('buildProductionPromptContexts injects continuation pack context into planner and writer prompts', () => {
  const contexts = buildProductionPromptContexts({
    layeredContext: '【世界观】城池将倾',
    plannerContext: '近期章节：主角刚拿到账本',
    writerContext: '关键人物：林照',
    continuationPackContext: '【资料包续写任务】逼问掌柜，保住账本。',
  });

  assert.match(contexts.planner, /资料包续写任务/);
  assert.match(contexts.planner, /近期章节/);
  assert.match(contexts.writer, /资料包续写任务/);
  assert.match(contexts.writer, /关键人物/);
  assert.match(contexts.critic, /资料包续写任务/);
  assert.match(contexts.critic, /关键人物/);
});

test('buildProductionPromptContexts deduplicates repeated sources and enforces a hard budget', () => {
  const contexts = buildProductionPromptContexts({
    layeredContext: '重复资料',
    plannerContext: '规划上下文',
    writerContext: '写作上下文',
    continuationPackContext: '重复资料',
  }, 24);

  assert.equal(contexts.planner.length <= 24, true);
  assert.equal(contexts.writer.length <= 24, true);
  assert.equal(contexts.planner.indexOf('重复资料'), contexts.planner.lastIndexOf('重复资料'));
});

test('buildProductionExecutionReceipt records source entity ids and versions', () => {
  const receipt = buildProductionExecutionReceipt({
    capabilityRefs: ['writer-card'],
    writingStyleFingerprint: 'style-1',
    resolvedAtGeneration: 7,
  }, {
    novelId: 'n1', title: 'N', summary: '', worldRules: '规则', globalOutline: '', recentChapters: [], timeline: [],
    entityStates: {
      characters: [{ id: 'char-1', name: '林照', kind: 'character', summary: '', statusNote: '', updatedAt: 11 }],
      locations: [], items: [{ id: 'item-1', name: '账本', kind: 'item', summary: '', statusNote: '', updatedAt: 12 }], factions: [], powerLevels: [],
    },
    openForeshadowings: [{ id: 'hook-1', title: '旧印记', description: '', status: 'planted', updatedAt: 13 }],
  });

  assert.deepEqual(receipt.contextRefs, [
    { dimension: 'world', id: 'n1', version: 7 },
    { dimension: 'character', id: 'char-1', version: 11 },
    { dimension: 'item', id: 'item-1', version: 12 },
    { dimension: 'foreshadowing', id: 'hook-1', version: 13 },
  ]);
});

test('writer context renders planned promise action and reveal constraint', () => {
  const context = buildProductionWriterContext({
    novelId: 'n1', title: 'N', summary: '', worldRules: '', globalOutline: '', recentChapters: [], timeline: [],
    entityStates: { characters: [], locations: [], items: [], factions: [], powerLevels: [] },
    openForeshadowings: [{
      id: 'f1', title: '旧戒指', description: '纹章线索', status: 'planted',
      plannedAction: 'hint', revealConstraint: '不能揭示父亲身份', impactStatus: 'due',
    }],
  });
  assert.match(context, /本章hint/);
  assert.match(context, /不能揭示父亲身份/);
});

test('planner context renders open promise action, payoff range, and reveal constraint', () => {
  const ledger: StoryStateLedger = {
    novelId: 'n1', title: 'N', summary: '', worldRules: '', globalOutline: '', recentChapters: [], timeline: [],
    entityStates: { characters: [], locations: [], items: [], factions: [], powerLevels: [] },
    openForeshadowings: [{
      id: 'f1', title: '旧戒指', description: '纹章线索', status: 'planted',
      plannedAction: 'payoff', revealConstraint: '不能揭示父亲身份', impactStatus: 'due',
      plannedPayoffRange: { from: 4, to: 6 },
    }],
  };
  const context = buildProductionPlannerContext(ledger);
  assert.match(context, /本章payoff/);
  assert.match(context, /计划回收区间：4-6/);
  assert.match(context, /不能揭示父亲身份/);
});

});
