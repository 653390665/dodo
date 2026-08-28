import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJsonPayload } from '../src/lib/extract-skill-json';

test('extract skill JSON parser should ignore markdown fences and leading chatter', () => {
  const payload = extractJsonPayload(`
下面是拆书结果：

\`\`\`json
{
  "skills": [
    {
      "name": "雨夜刀锋",
      "style": "冷峻短句"
    }
  ]
}
\`\`\`
`);

  assert.equal(Array.isArray(payload.skills), true);
  assert.equal(payload.skills[0].name, '雨夜刀锋');
});

test('extract skill JSON parser should reject non-json output', () => {
  assert.throws(() => extractJsonPayload('这次我先给你分析思路，不返回 JSON。'));
});

test('extract skill JSON parser should ignore trailing chatter after a valid object', () => {
  const payload = extractJsonPayload(`{"skills":[{"name":"雨夜刀锋"}]}\n以上是拆书结果。`);
  assert.equal(payload.skills[0].name, '雨夜刀锋');
});

test('extract skill JSON parser should ignore trailing markdown after a valid array', () => {
  const payload = extractJsonPayload(`[{"name":"雨夜刀锋"}]\n\n---\n请继续下一步。`);
  assert.equal(payload[0].name, '雨夜刀锋');
});

test('extract skill JSON parser should reject truncated json output', () => {
  assert.throws(() => extractJsonPayload(`{"skills":[{"name":"雨夜刀锋"}]`));
});
