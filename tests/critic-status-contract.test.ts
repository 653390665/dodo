import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCriticFeedback, UNKNOWN_CRITIC_FEEDBACK } from '../server/helpers/ai-production-pipeline';

test('critic status is unknown when feedback has no verifiable marker', () => {
  assert.deepEqual(classifyCriticFeedback('整体不错，可以继续优化。'), { status: 'unknown' });
});

const issue = { issueType: 'style-slop', issueSubtype: 'ai-cliche', severity: 'major', snippet: '原句', explanation: '问题', patchHint: '修补' };
const validPass = JSON.stringify({
  scores: {
    可读性: { score: 8, reason: '清晰' },
    分镜执行度: { score: 8, reason: '完整' },
    冲突推进度: { score: 8, reason: '推进' },
    风格契合度: { score: 8, reason: '契合' },
    网文章节感: { score: 8, reason: '有钩子' },
  },
  totalScore: 40,
  pass: true,
  failReason: '',
  fatalIssues: [],
  surgerySuggestions: [],
  evidence: [
    { category: 'scene_execution', severity: 'low', quote: '场景证据', explanation: '章节目标有明确动作落点', suggestedFix: '保持动作链' },
    { category: 'character_state', severity: 'low', quote: '角色证据', explanation: '人物状态与选择一致', suggestedFix: '保持人物动机' },
    { category: 'hard_canon', severity: 'low', quote: '设定证据', explanation: '世界规则未见冲突', suggestedFix: '保持规则约束' },
    { category: 'foreshadowing', severity: 'low', quote: '伏笔证据', explanation: '章末留下可追踪信息', suggestedFix: '在后续回收' },
  ],
});
const validFail = JSON.stringify({
  scores: {
    可读性: { score: 5, reason: '一般' },
    分镜执行度: { score: 5, reason: '一般' },
    冲突推进度: { score: 5, reason: '一般' },
    风格契合度: { score: 5, reason: '一般' },
    网文章节感: { score: 5, reason: '一般' },
  },
  totalScore: 25,
  pass: false,
  failReason: '需要修订',
  fatalIssues: [issue],
  surgerySuggestions: ['收紧冲突'],
});

test('only complete structured PASS passes', () => {
  assert.deepEqual(classifyCriticFeedback(validPass), { status: 'pass', score: 80 });
});

test('critic status is unknown when a PASS omits semantic evidence', () => {
  const withoutEvidence = JSON.stringify({ ...JSON.parse(validPass), evidence: undefined });
  assert.deepEqual(classifyCriticFeedback(withoutEvidence), { status: 'unknown' });
});

test('structured JSON remains valid with provider prefix, markdown fence, or reasoning block', () => {
  assert.deepEqual(classifyCriticFeedback(`审稿结果如下：\n${validPass}`), { status: 'pass', score: 80 });
  assert.deepEqual(classifyCriticFeedback('```json\n' + validPass + '\n```'), { status: 'pass', score: 80 });
  assert.deepEqual(classifyCriticFeedback(`<think>先检查评分合同</think>\n${validPass}`), { status: 'pass', score: 80 });
});

test('explicit pass below the score threshold is still fail', () => {
  const lowPass = validPass.replace(/"score":8/g, '"score":7.8').replace('"totalScore":40', '"totalScore":39');
  assert.deepEqual(classifyCriticFeedback(lowPass), { status: 'fail', score: 78 });
});

test('complete structured FAIL fails', () => {
  assert.deepEqual(classifyCriticFeedback(validFail), { status: 'fail', score: 50 });
});

test('plain PASS is unknown', () => {
  assert.deepEqual(classifyCriticFeedback('PASS\n审稿完成'), { status: 'unknown' });
});

test('explicitly negated PASS is unknown, not pass', () => {
  assert.deepEqual(classifyCriticFeedback('not PASS'), { status: 'unknown' });
  assert.deepEqual(classifyCriticFeedback('非 PASS'), { status: 'unknown' });
  assert.deepEqual(classifyCriticFeedback('未通过 PASS'), { status: 'unknown' });
});

test('prose score is unknown', () => {
  assert.deepEqual(classifyCriticFeedback('PASS，但评分: 72/100'), { status: 'unknown' });
});

test('explicit FAIL prose is unknown', () => {
  assert.deepEqual(classifyCriticFeedback('FAIL：冲突推进不足'), { status: 'unknown' });
});

test('malformed and truncated JSON are unknown', () => {
  assert.deepEqual(classifyCriticFeedback('{"score": 95, "fatalIssues": []'), { status: 'unknown' });
  assert.deepEqual(classifyCriticFeedback('{"score":95,"fatalIssues":null}'), { status: 'unknown' });
});

test('unavailable critic feedback is unknown without a score', () => {
  assert.deepEqual(classifyCriticFeedback('模型请求失败', false), { status: 'unknown' });
  assert.equal(UNKNOWN_CRITIC_FEEDBACK, '审稿结果不可验证，未完成结构化审阅，请重试。');
});

test('malformed critic feedback is unknown without throwing', () => {
  assert.deepEqual(classifyCriticFeedback(null as unknown as string), { status: 'unknown' });
});
