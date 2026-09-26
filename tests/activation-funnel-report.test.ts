/**
 * Plan 262 E6 · 激活漏斗离线复测脚本的口径测试。
 *
 * 覆盖：
 * ① `buildProductEventMetrics` 抽纯函数后与 DB 路径读数逐字段一致（防口径二次实现漂移）；
 * ② `summarizeEventRollup` 的去重作品 / 会话口径；
 * ③ `renderFunnelReport` 的关键读数行（作品口径 vs 会话口径、修复前事件计数）；
 * ④ `parseCliArgs` 参数解析与报错。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INSTRUMENTATION_FIX_CUTOFF_MS,
  parseCliArgs,
  renderFunnelReport,
  summarizeEventRollup,
} from '../scripts/report-activation-funnel.ts';
import {
  buildProductEventMetrics,
  createProductEvent,
  getProductEventMetrics,
  listProductEvents,
} from '../server/lib/db/product-events.ts';
import type { ProductEvent, ProductEventInput } from '../shared/types/product-events.ts';
import { closeDb, initDb } from '../server/lib/db.ts';

function event(overrides: Partial<ProductEvent> & { eventName: ProductEventInput['eventName'] }): ProductEvent {
  return {
    id: `id-${Math.random().toString(16).slice(2)}`,
    createdAt: INSTRUMENTATION_FIX_CUTOFF_MS + 3600_000,
    stage: 'drafting',
    result: 'success',
    ...overrides,
  } as ProductEvent;
}

test('buildProductEventMetrics 与 DB 路径同口径（纯函数抽取零漂移）', () => {
  const inputs: ProductEventInput[] = [
    { eventName: 'editor_enter', stage: 'drafting', result: 'success', novelId: 'n1', sessionId: 's1' },
    { eventName: 'editor_enter', stage: 'drafting', result: 'success', novelId: 'n1', sessionId: 's1' },
    { eventName: 'editor_enter', stage: 'drafting', result: 'success', novelId: 'n2', sessionId: 's2' },
    {
      eventName: 'first_content_input',
      stage: 'drafting',
      result: 'success',
      novelId: 'n1',
      chapterId: 'c1',
      sessionId: 's1',
    },
    {
      eventName: 'draft_accept',
      stage: 'drafting',
      result: 'success',
      novelId: 'n1',
      chapterId: 'c1',
      objectId: 'o1',
      sessionId: 's1',
    },
  ];
  initDb(':memory:');
  try {
    for (const input of inputs) createProductEvent(input);

    const dbMetrics = getProductEventMetrics(90);
    const pureMetrics = buildProductEventMetrics(listProductEvents(90), 90);
    assert.deepEqual(pureMetrics, dbMetrics);
  } finally {
    closeDb();
  }

});

test('summarizeEventRollup 按事件名去重作品 / 会话', () => {
  const rollup = summarizeEventRollup([
    event({ eventName: 'editor_enter', novelId: 'n1', sessionId: 's1' }),
    event({ eventName: 'editor_enter', novelId: 'n1', sessionId: 's2' }),
    event({ eventName: 'editor_enter', novelId: 'n2', sessionId: 's2' }),
    event({ eventName: 'content_save', novelId: 'n1', sessionId: 's1' }),
  ]);
  assert.deepEqual(rollup, [
    { eventName: 'editor_enter', events: 3, novels: 2, sessions: 2 },
    { eventName: 'content_save', events: 1, novels: 1, sessions: 1 },
  ]);
});

test('renderFunnelReport 输出作品口径 / 会话口径与修复前事件计数', () => {
  const legacy = event({
    eventName: 'editor_enter',
    novelId: 'n0',
    sessionId: 's0',
    createdAt: INSTRUMENTATION_FIX_CUTOFF_MS - 86_400_000,
  });
  const report = renderFunnelReport(
    [
      legacy,
      event({ eventName: 'editor_enter', novelId: 'n1', sessionId: 's1' }),
      event({ eventName: 'editor_enter', novelId: 'n1', sessionId: 's1' }),
      event({ eventName: 'editor_enter', novelId: 'n2', sessionId: 's2' }),
      event({ eventName: 'editor_enter', novelId: 'n2', sessionId: 's3' }),
      event({ eventName: 'first_content_input', novelId: 'n1', sessionId: 's1', chapterId: 'c1' }),
      event({
        eventName: 'draft_accept',
        novelId: 'n1',
        sessionId: 's1',
        chapterId: 'c1',
        objectId: 'o1',
      }),
    ],
    90
  );

  assert.match(report, /事件 7 条 \/ 去重作品 3 \/ 去重会话 4/);
  assert.match(report, /修复前口径事件 1 条/);
  assert.match(report, /成章数 acceptedChapters=1/);
  assert.match(report, /进入编辑器：作品 3 \/ 会话 4/);
  assert.match(report, /首次手写输入：作品 1 \/ 会话 1/);
  assert.match(report, /editor_enter: 5 \/ 3 \/ 4/);
  assert.match(report, /判读纪律/);
});

test('parseCliArgs 解析文件与 --days，缺参报错', () => {
  assert.deepEqual(parseCliArgs(['/tmp/export.json']), { file: '/tmp/export.json', days: 90 });
  assert.deepEqual(parseCliArgs(['-', '--days=30']), { file: '-', days: 30 });
  assert.throws(() => parseCliArgs(['--days=30']), /用法/);
  assert.throws(() => parseCliArgs(['/tmp/export.json', '--days=0']), /--days 非法/);
});
