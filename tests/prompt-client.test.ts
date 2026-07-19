import test from 'node:test';
import assert from 'node:assert/strict';

import { extractSkill, refineSetupTask } from '../src/lib/prompt-client';

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

test('refineSetupTask returns refined text payload', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        text: '补充主角进入宗门前的动机和代价。',
      }),
    } as Response);

  try {
    const text = await refineSetupTask({
      novelId: 'novel-1',
      taskTitle: '角色动机',
      currentDraft: '主角想加入宗门。',
      userRequest: '让动机更具体',
      storyContext: '仙侠世界',
    });
    assert.equal(text, '补充主角进入宗门前的动机和代价。');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
