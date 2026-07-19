import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStoryStateLedger,
  summarizeStoryStateLedger,
  buildLedgerPromptFacts,
} from '../src/lib/story-state-ledger';
import type {
  Chapter,
  Character,
  Foreshadowing,
  Item,
  Novel,
  TimelineEvent,
} from '../shared/types';

const now = 1_778_000_000_000;

const novel: Novel = {
  id: 'novel-1',
  title: '雨夜玄令',
  authorId: 'local-user',
  summary: '沉默刀客卷入玄铁令争夺。',
  status: 'ongoing',
  worldRules: '江湖势力围绕玄铁令争斗，刀法讲究时机与代价。',
  globalOutline: '第一卷围绕玄铁令失窃展开。',
  createdAt: now,
  updatedAt: now,
};

const chapters: Chapter[] = [
  {
    id: 'chapter-1',
    novelId: 'novel-1',
    title: '第一章',
    content: '林砚在雨夜入酒馆。',
    order: 1,
    wordCount: 10,
    sceneBeats: '雨夜酒馆，掌柜试探。',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'chapter-2',
    novelId: 'novel-1',
    title: '第二章',
    content: '玄铁令第一次露面。',
    order: 2,
    wordCount: 12,
    sceneBeats: '追兵逼近，玄铁令显形。',
    createdAt: now,
    updatedAt: now,
  },
];

const characters: Character[] = [
  {
    id: 'char-1',
    novelId: 'novel-1',
    name: '林砚',
    role: 'protagonist',
    summary: '寡言刀客，持有玄铁令。',
    traits: ['克制', '后发制人'],
    bio: '过去不明。',
    createdAt: now,
    updatedAt: now,
  },
];

const items: Item[] = [
  {
    id: 'item-1',
    novelId: 'novel-1',
    name: '玄铁令',
    type: '信物',
    description: '可号令旧盟的铁令，目前在林砚手中。',
    createdAt: now,
    updatedAt: now,
  },
];

const timelineEvents: TimelineEvent[] = [
  {
    id: 'time-1',
    novelId: 'novel-1',
    title: '玄铁令失窃',
    description: '各方势力开始追索玄铁令。',
    timestamp: '三日前',
    statusTag: '已发生',
    order: 1,
    createdAt: now,
    updatedAt: now,
  },
];

const foreshadowings: Foreshadowing[] = [
  {
    id: 'foreshadow-1',
    novelId: 'novel-1',
    title: '掌柜认识玄铁令',
    description: '掌柜看见玄铁令时没有惊讶。',
    status: 'planted',
    plantedChapterId: 'chapter-1',
    relatedCharacterIds: ['char-1'],
    createdAt: now,
    updatedAt: now,
  },
];

test('buildStoryStateLedger collects durable long-form state for one novel', () => {
  const ledger = buildStoryStateLedger({
    novel,
    chapters,
    characters,
    items,
    timelineEvents,
    foreshadowings,
  });

  assert.equal(ledger.novelId, 'novel-1');
  assert.equal(ledger.recentChapters.length, 2);
  assert.equal(ledger.entityStates.characters[0].name, '林砚');
  assert.equal(ledger.entityStates.items[0].name, '玄铁令');
  assert.equal(ledger.openForeshadowings.length, 1);
  assert.equal(ledger.timeline[0].title, '玄铁令失窃');
});

test('summarizeStoryStateLedger produces compact continuity context', () => {
  const ledger = buildStoryStateLedger({
    novel,
    chapters,
    characters,
    items,
    timelineEvents,
    foreshadowings,
  });

  const summary = summarizeStoryStateLedger(ledger);
  assert.match(summary, /雨夜玄令/);
  assert.match(summary, /林砚/);
  assert.match(summary, /玄铁令/);
  assert.match(summary, /掌柜认识玄铁令/);
  assert.equal(summary.length < 3000, true);
});

test('buildLedgerPromptFacts keeps facts grouped for continuity critic prompts', () => {
  const ledger = buildStoryStateLedger({
    novel,
    chapters,
    characters,
    items,
    timelineEvents,
    foreshadowings,
  });

  const facts = buildLedgerPromptFacts(ledger);
  assert.equal(facts.characters.includes('林砚'), true);
  assert.equal(facts.items.includes('玄铁令'), true);
  assert.equal(facts.foreshadowings.includes('掌柜认识玄铁令'), true);
  assert.equal(facts.recentChapters.includes('第二章'), true);
});
