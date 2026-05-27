import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelJsonPayload } from '../src/lib/model-json';

test('parseModelJsonPayload parses clean json wrapped in markdown fences', () => {
  const payload = parseModelJsonPayload(`
\`\`\`json
{"continuationTask":"继续写下去","canonFacts":[]}
\`\`\`
`);

  assert.equal(payload.continuationTask, '继续写下去');
  assert.deepEqual(payload.canonFacts, []);
});

test('parseModelJsonPayload repairs unescaped quotes inside strings', () => {
  const payload = parseModelJsonPayload(`
{
  "canonFacts": [
    {
      "text": "供桌下有“第三块裂砖”机关",
      "evidence": "原文写明主角说 "先找第三块裂砖" 后再掀供桌。"
    }
  ],
  "continuationTask": "继续推进城隍庙暗道"
}
`);

  assert.equal(payload.canonFacts[0].text, '供桌下有"第三块裂砖"机关');
  assert.equal(payload.canonFacts[0].evidence, '原文写明主角说 "先找第三块裂砖" 后再掀供桌。');
});

test('parseModelJsonPayload throws readable error for truncated json', () => {
  assert.throws(
    () => parseModelJsonPayload('not json at all'),
    /不完整的 JSON|可解析的 JSON/,
  );
});

test('parseModelJsonPayload auto-closes safely truncated json tails', () => {
  const payload = parseModelJsonPayload(`
{
  "continuationTask": "继续推进",
  "canonFacts": [
    {
      "text": "裂砖机关",
      "evidence": "原文提到第三块裂砖"
    }
  ],
  "readingQuestions": [
    {
      "question": "谁知道暗道入口",
      "context": "资料未说明"
    }
`);

  assert.equal(payload.continuationTask, '继续推进');
  assert.equal(payload.canonFacts[0].text, '裂砖机关');
  assert.equal(payload.readingQuestions[0].question, '谁知道暗道入口');
});
