import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContinuationContext,
  classifyContinuationSource,
} from '../src/lib/continuation-pack';
import type { ContinuationPack } from '../src/types';

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
