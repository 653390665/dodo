import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRelationshipEvidence,
  normalizeRelationshipRecommendations,
} from '../shared/lib/relationship-repair';

const relationship = {
  index: 1,
  sourceName: '林照', sourceType: 'character' as const,
  targetName: '青云宗', targetType: 'faction' as const,
  relationshipType: '效忠', description: '',
};
const candidates = { character: ['林照'], location: [], item: [], faction: ['青云宗', '黑水寨'] };

test('relationship evidence is bounded, named, and stable', () => {
  const docs = [
    { filename: '设定.txt', text: '林照自幼加入青云宗，负责守护山门。' },
    { filename: '大纲.txt', text: '林照离开青云宗后仍与宗门保持联系。' },
  ];
  const first = extractRelationshipEvidence(relationship, docs);
  const second = extractRelationshipEvidence(relationship, docs);
  assert.equal(first.length, 2);
  assert.deepEqual(first, second);
  assert.equal(first[0].filename, '设定.txt');
  assert.match(first[0].quote, /林照/);
});

test('relationship evidence reserves coverage for both names before filling the cap', () => {
  const docs = [{ filename: '资料.txt', text: ['林照出现一次。', 'x'.repeat(300), '林照再次出现。', 'x'.repeat(300), '林照第三次出现。', 'x'.repeat(300), '林照第四次出现。', 'x'.repeat(300), '青云宗在此出现。'].join('') }];
  const evidence = extractRelationshipEvidence(relationship, docs);
  assert.equal(evidence.length, 4);
  assert.match(evidence[0].quote, /林照/);
  assert.ok(evidence.some(item => item.quote.includes('青云宗')));
});

test('valid map recommendation keeps exact candidate and evidence', () => {
  const evidence = extractRelationshipEvidence(relationship, [{ filename: 'a.txt', text: '林照效忠青云宗。' }]);
  const result = normalizeRelationshipRecommendations([relationship], candidates, { 1: evidence }, [{
    index: 1, action: 'map', sourceName: '林照', targetName: '青云宗', confidence: 'high', reason: '原文明确', evidenceIds: [evidence[0].evidenceId],
  }]);
  assert.equal(result[0].action, 'map');
  assert.equal(result[0].confidence, 'high');
  assert.equal(result[0].evidence.length, 1);
});

test('explicit skip keeps valid evidence and confidence', () => {
  const evidence = extractRelationshipEvidence(relationship, [{ filename: 'a.txt', text: '林照与青云宗关系不明。' }]);
  const result = normalizeRelationshipRecommendations([relationship], candidates, { 1: evidence }, [{
    index: 1, action: 'skip', confidence: 'medium', reason: '原文存在歧义', evidenceIds: [evidence[0].evidenceId],
  }]);
  assert.equal(result[0].action, 'skip');
  assert.equal(result[0].confidence, 'medium');
  assert.equal(result[0].reason, '原文存在歧义');
  assert.deepEqual(result[0].evidence, [{ filename: 'a.txt', quote: evidence[0].quote }]);
});

test('invented candidate is downgraded to skip', () => {
  const evidence = extractRelationshipEvidence(relationship, [{ filename: 'a.txt', text: '林照效忠青云宗。' }]);
  const result = normalizeRelationshipRecommendations([relationship], candidates, { 1: evidence }, [{
    index: 1, action: 'map', sourceName: '虚构人物', targetName: '青云宗', confidence: 'high', reason: '猜测', evidenceIds: [evidence[0].evidenceId],
  }]);
  assert.deepEqual(result[0], { index: 1, action: 'skip', confidence: 'low', reason: '候选实体无效，已跳过', evidence: [] });
});

test('invented evidence id is removed and mapping is downgraded', () => {
  const evidence = extractRelationshipEvidence(relationship, [{ filename: 'a.txt', text: '林照效忠青云宗。' }]);
  const result = normalizeRelationshipRecommendations([relationship], candidates, { 1: evidence }, [{
    index: 1, action: 'map', sourceName: '林照', targetName: '青云宗', confidence: 'high', reason: '原文明确', evidenceIds: [evidence[0].evidenceId, 'fake-id'],
  }]);
  assert.equal(result[0].action, 'map');
  assert.equal(result[0].confidence, 'low');
  assert.equal(result[0].evidence.length, 1);
});

test('missing model item receives skip fallback', () => {
  const result = normalizeRelationshipRecommendations([relationship], candidates, { 1: [] }, []);
  assert.deepEqual(result[0], { index: 1, action: 'skip', confidence: 'low', reason: '资料证据不足', evidence: [] });
});
