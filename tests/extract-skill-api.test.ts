import test from 'node:test';
import assert from 'node:assert/strict';

import { extractSkill } from '../src/lib/prompt-client';

test('extractSkill surfaces rejected reason from input gate', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: false,
      json: async () => ({
        rejected: true,
        reason: '中文内容仅 32 字，不足以提炼写作风格。请上传至少 200 字的小说正文片段。',
      }),
    } as Response);

  try {
    await assert.rejects(
      () => extractSkill('太短了'),
      /中文内容仅 32 字/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
