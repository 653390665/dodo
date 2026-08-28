import test from 'node:test';
import assert from 'node:assert/strict';

import { extractSkill, parseContinuationPack, refineSetupTask } from '../src/lib/prompt-client';

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
  globalThis.fetch = async (input) => {
    if (String(input) === '/api/db/generation') {
      return Response.json({ databaseGeneration: 1 });
    }
    return {
      ok: true,
      json: async () => ({
        text: '补充主角进入宗门前的动机和代价。',
      }),
    } as Response;
  };

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

test('parseContinuationPack maps invalidated import codes to a restart action', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input) === '/api/product-events') {
      return Response.json({});
    }
    return Response.json({
      error: '续写导入会话无效或已过期，请重新开始导入',
      code: 'CONTINUATION_IMPORT_SESSION_EXPIRED',
    }, { status: 400 });
  };

  try {
    await assert.rejects(
      () => parseContinuationPack({
        novelId: 'continuation-import-draft-expired',
        title: '过期资料',
        documents: [{ filename: '资料.txt', filedata: 'YQ==' }],
      }),
      /续写资料导入已失效，请重新导入资料。/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
