import test from 'node:test';
import assert from 'node:assert/strict';

import { approveContinuationImport } from '../src/lib/continuation-client';

test('approveContinuationImport maps invalidated import codes to a restart action', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    if (String(input) === '/api/product-events') {
      return Response.json({});
    }
    return Response.json({
      error: '数据库已在解析后切换，请重新导入资料',
      code: 'CONTINUATION_IMPORT_GENERATION_CHANGED',
    }, { status: 409 });
  };

  try {
    await assert.rejects(
      () => approveContinuationImport({
        packId: 'pack-expired',
        mode: 'new',
        newNovel: { title: '不应创建', summary: '' },
        conflictResolutions: [],
      }),
      /续写资料导入已失效，请重新导入资料。/,
    );
    assert.deepEqual(requests, [
      '/api/continuation-packs/approve-import',
      '/api/product-events',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
