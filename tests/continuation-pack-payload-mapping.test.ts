import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapCanonFact,
  mapCharacterState,
  mapPlotState,
  mapStyleProfile,
  mapContradiction,
  mapSourceMap,
  mapReadingQuestion,
  mapContinuationGap
} from '../server/routes/continuation';

test('continuation mapping - mapCanonFact fallback and id generation', () => {
  const result = mapCanonFact({
    priority: 'invalid_priority',
    category: 'invalid_category',
    text: ' 宗门割据 ',
    evidence: '原文证据'
  }, 'pack-123', 5);

  assert.equal(result.id, 'pack-123-fact-5');
  assert.equal(result.priority, 'soft'); // default priority
  assert.equal(result.category, 'world'); // default category
  assert.equal(result.text, ' 宗门割据 ');
  assert.equal(result.evidence, '原文证据');
});

test('continuation mapping - mapCharacterState handling array properties safely', () => {
  const result = mapCharacterState({
    name: '林照',
    role: '主角',
    secrets: 'not_an_array', // should fall back to empty array
    relationshipNotes: ['与掌柜交好', 123] // non-string should be coerced
  });

  assert.equal(result.name, '林照');
  assert.equal(result.role, '主角');
  assert.deepEqual(result.secrets, []);
  assert.deepEqual(result.relationshipNotes, ['与掌柜交好', '123']);
});

test('continuation mapping - mapPlotState default fallback values', () => {
  const result = mapPlotState({});
  assert.equal(result.currentTimeline, '');
  assert.equal(result.latestScene, '');
  assert.deepEqual(result.unresolvedHooks, []);
  assert.equal(result.immediateConflict, '');
  assert.equal(result.nextLikelyMove, '');
});

test('continuation mapping - mapStyleProfile default fallback values', () => {
  const result = mapStyleProfile({});
  assert.equal(result.pov, '');
  assert.equal(result.tense, '');
  assert.equal(result.pacing, '');
  assert.equal(result.dialogueDensity, '');
  assert.deepEqual(result.proseTraits, []);
  assert.deepEqual(result.avoidTraits, []);
  assert.equal(result.sampleEvidence, '');
});

test('continuation mapping - mapContradiction severity fallback', () => {
  const result = mapContradiction({
    severity: 'critical', // invalid severity
    summary: '前后设定矛盾',
    conflictingEvidence: 'evidence_str' // not an array
  }, 'pack-123', 0);

  assert.equal(result.id, 'pack-123-contra-0');
  assert.equal(result.severity, 'medium'); // default severity
  assert.equal(result.summary, '前后设定矛盾');
  assert.deepEqual(result.conflictingEvidence, []);
});

test('continuation mapping - mapSourceMap empty handling', () => {
  const result = mapSourceMap({});
  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.keyConflicts, []);
});

test('continuation mapping - mapReadingQuestion category mapping', () => {
  const result = mapReadingQuestion({
    category: 'style',
    question: '伏笔是否回收？',
    context: '第三章'
  }, 'pack-123', 1);

  assert.equal(result.id, 'pack-123-question-1');
  assert.equal(result.category, 'style');
  assert.equal(result.question, '伏笔是否回收？');
  assert.equal(result.context, '第三章');
});

test('continuation mapping - mapContinuationGap fallback severity', () => {
  const result = mapContinuationGap({
    severity: 'high',
    description: '伏笔断裂',
    relatedFacts: ['fact-1']
  }, 'pack-123', 2);

  assert.equal(result.id, 'pack-123-gap-2');
  assert.equal(result.severity, 'high');
  assert.equal(result.description, '伏笔断裂');
  assert.deepEqual(result.relatedFacts, ['fact-1']);
});
