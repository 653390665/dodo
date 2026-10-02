import assert from 'node:assert/strict';
import test from 'node:test';

import { generateText } from '../server/lib/server-llm';
import { DEFAULT_PROMPT_TEMPLATES } from '../shared/config/prompt-templates';

/**
 * Plan 277（R-276-1）：定点修复的回执是补丁载荷，不是正文。
 * 只有 patch 输出模式保证原样返回；prose 模式会把带副词的补丁整批改写成干净场景（@@FIX 标记丢失）。
 */

const NEWLINE = String.fromCharCode(10);
const SLOP_REPAIR_PAYLOAD = '@@FIX 1@@' + NEWLINE + '他忍不住倒吸一口凉气，嘴角勾起一抹邪笑。';
const CLEAN_REPLACEMENT = '他垂着眼，指节在桌面上敲了一下。';
const CREATIVE_PROMPT =
  '对本章正文草稿做一次定点润色：只修被点名的这句，按 @@FIX 1@@ 格式回一句。原句：他倒吸一口凉气，嘴角勾起一抹邪笑。';

function mockConfig() {
  return {
    apiKey: 'mock-key',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    promptGuardLevel: 'strict' as const,
    promptTemplates: DEFAULT_PROMPT_TEMPLATES,
  };
}

function stubFetch(replies: string[]) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    const content = replies[Math.min(calls, replies.length - 1)];
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    calls: () => calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test('patch output mode returns the repair payload verbatim instead of rewriting it', async () => {
  const stub = stubFetch([SLOP_REPAIR_PAYLOAD, CLEAN_REPLACEMENT]);
  try {
    const out = await generateText(mockConfig(), {
      prompt: CREATIVE_PROMPT,
      outputMode: 'patch',
      maxAttempts: 2,
    });
    assert.equal(out, SLOP_REPAIR_PAYLOAD);
    assert.equal(stub.calls(), 1, 'the prose correction gate never ran');
  } finally {
    stub.restore();
  }
});

test('prose output mode still runs the correction gate on a sloppy repair payload', async () => {
  const stub = stubFetch([SLOP_REPAIR_PAYLOAD, CLEAN_REPLACEMENT]);
  try {
    const out = await generateText(mockConfig(), {
      prompt: CREATIVE_PROMPT,
      maxAttempts: 2,
    });
    assert.equal(out, CLEAN_REPLACEMENT, 'prose mode still rewrites the slop');
    assert.equal(stub.calls(), 2, 'one initial call plus one corrective retry');
  } finally {
    stub.restore();
  }
});
