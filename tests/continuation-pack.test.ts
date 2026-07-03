import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContinuationContext,
  buildCreationIntentDraft,
  classifyContinuationSource,
} from '../src/lib/continuation-pack';
import type { ContinuationPack } from '../shared/types';

describe("continuation", () => {
test('classifyContinuationSource detects common project document kinds', () => {
  assert.equal(classifyContinuationSource('世界观设定.docx', '灵气复苏，宗门割据'), 'world');
  assert.equal(classifyContinuationSource('第一卷大纲.md', '第一章主角入城'), 'outline');
  assert.equal(classifyContinuationSource('人物小传.txt', '主角 林照'), 'characters');
  assert.equal(classifyContinuationSource('正文.txt', '第一章 雨夜酒馆'), 'manuscript');
});

test('buildContinuationContext prioritizes hard canon and current plot state', () => {
  const pack: ContinuationPack = {
    id: 'pack-1', novelId: 'novel-1', title: '测试资料包', status: 'approved',
    sourceDocuments: [],
    canonFacts: [
      { id: 'f1', priority: 'hard', category: 'world', text: '死者不能复生。', evidence: '设定原文' },
      { id: 'f2', priority: 'soft', category: 'style', text: '可以慢热。', evidence: '风格原文' },
    ],
    characterStates: [{
      name: '林照', role: '主角', currentGoal: '找出雨夜酒馆凶手',
      emotionalState: '压抑且戒备', secrets: ['曾见过凶器'],
      relationshipNotes: ['不信任掌柜'], evidence: '人物卡原文',
    }],
    plotState: {
      currentTimeline: '第一卷第二章后', latestScene: '林照发现酒馆密室',
      unresolvedHooks: ['黑伞是谁留下的'],
      immediateConflict: '掌柜试图销毁账本', nextLikelyMove: '林照逼问掌柜',
    },
    styleProfile: {
      pov: '第三人称有限视角', tense: '过去时', pacing: '紧推进',
      dialogueDensity: '中等', proseTraits: ['冷峻', '动作清晰'],
      avoidTraits: ['上帝视角解释'], sampleEvidence: '样章原文',
    },
    contradictions: [], continuationTask: '续写下一章开场。',
    createdAt: 1, updatedAt: 1,
  };

  const context = buildContinuationContext(pack);
  assert.match(context, /死者不能复生/);
  assert.match(context, /林照发现酒馆密室/);
  assert.match(context, /第三人称有限视角/);
  assert.doesNotMatch(context, /可以慢热/);
});

test('buildCreationIntentDraft returns empty for null pack', () => {
  assert.equal(buildCreationIntentDraft(null), '');
});

test('buildCreationIntentDraft composes from continuationTask + plotState', () => {
  const pack: ContinuationPack = {
    id: 'p1', novelId: 'n1', title: 'T', status: 'draft',
    sourceDocuments: [], canonFacts: [], characterStates: [],
    plotState: {
      currentTimeline: '', latestScene: '酒馆密室',
      immediateConflict: '掌柜销毁账本', nextLikelyMove: '逼问掌柜',
      unresolvedHooks: [],
    },
    styleProfile: { pov: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], tense: '', sampleEvidence: '' },
    contradictions: [], continuationTask: '续写下一章',
    createdAt: 1, updatedAt: 1,
  };
  const draft = buildCreationIntentDraft(pack);
  assert.match(draft, /续写下一章/);
  assert.match(draft, /酒馆密室/);
  assert.match(draft, /掌柜销毁账本/);
  assert.match(draft, /逼问掌柜/);
});

test('buildCreationIntentDraft falls back to plotState when task is empty', () => {
  const pack: ContinuationPack = {
    id: 'p1', novelId: 'n1', title: 'T', status: 'draft',
    sourceDocuments: [], canonFacts: [], characterStates: [],
    plotState: {
      currentTimeline: '', latestScene: '城门',
      immediateConflict: '守卫盘查', nextLikelyMove: '', unresolvedHooks: [],
    },
    styleProfile: { pov: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], tense: '', sampleEvidence: '' },
    contradictions: [], continuationTask: '',
    createdAt: 1, updatedAt: 1,
  };
  const draft = buildCreationIntentDraft(pack);
  assert.match(draft, /城门/);
  assert.match(draft, /守卫盘查/);
  assert.equal(draft.includes('续写'), false);
});

test('buildCreationIntentDraft includes high-severity gaps', () => {
  const pack: ContinuationPack = {
    id: 'p1', novelId: 'n1', title: 'T', status: 'draft',
    sourceDocuments: [], canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', immediateConflict: '', nextLikelyMove: '', unresolvedHooks: [] },
    styleProfile: { pov: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], tense: '', sampleEvidence: '' },
    contradictions: [], continuationTask: '',
    continuationGaps: [
      { id: 'g1', severity: 'high', description: '缺少结局', suggestedDirection: '安排反派伏笔揭晓', relatedFacts: [] },
      { id: 'g2', severity: 'low', description: '次要角色', suggestedDirection: '可选', relatedFacts: [] },
    ],
    createdAt: 1, updatedAt: 1,
  };
  const draft = buildCreationIntentDraft(pack);
  assert.match(draft, /安排反派伏笔揭晓/);
  assert.equal(draft.includes('可选'), false);
});

test('buildCreationIntentDraft returns empty when all sources absent', () => {
  const pack: ContinuationPack = {
    id: 'p1', novelId: 'n1', title: 'T', status: 'draft',
    sourceDocuments: [], canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', immediateConflict: '', nextLikelyMove: '', unresolvedHooks: [] },
    styleProfile: { pov: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], tense: '', sampleEvidence: '' },
    contradictions: [], continuationTask: '',
    createdAt: 1, updatedAt: 1,
  };
  assert.equal(buildCreationIntentDraft(pack), '');
});

test('buildContinuationContext handles pack with missing styleProfile and plotState fields', () => {
  const pack = {
    id: 'pack-old',
    novelId: 'novel-1',
    title: '旧资料包',
    status: 'approved',
    sourceDocuments: [],
    canonFacts: [{ id: 'f1', priority: 'hard', category: 'world', text: '旧设定', evidence: '' }],
    characterStates: [{
      name: '主角',
      role: '主角',
      currentGoal: '活下来',
      emotionalState: '紧张',
      secrets: [],
    }],
    plotState: {
      currentTimeline: '第一章后',
      latestScene: '城门',
      immediateConflict: '守卫盘查',
      nextLikelyMove: '',
    },
    styleProfile: {
      pov: '第三人称',
      pacing: '',
      dialogueDensity: '',
    },
    contradictions: [],
    continuationTask: '继续写。',
    createdAt: 1,
    updatedAt: 1,
  } as any;

  const context = buildContinuationContext(pack);
  assert.match(context, /旧设定/);
  assert.match(context, /第三人称/);
  assert.match(context, /城门/);
  assert.match(context, /未设定/);
});

test('buildCreationIntentDraft handles missing plotState fields gracefully', () => {
  const pack = {
    id: 'p1',
    novelId: 'n1',
    title: 'T',
    status: 'draft',
    sourceDocuments: [],
    canonFacts: [],
    characterStates: [],
    plotState: {},
    styleProfile: {},
    contradictions: [],
    continuationTask: '续写任务',
    createdAt: 1,
    updatedAt: 1,
  } as any;

  const draft = buildCreationIntentDraft(pack);
  assert.match(draft, /续写任务/);
});
});
