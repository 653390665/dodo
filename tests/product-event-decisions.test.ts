/**
 * Plan 271 W1 · 裁决行为埋点口径测试。
 *
 * 覆盖：
 * ① `decisions` 只统计「先预览过」的对象（与 rates.previewAcceptance 同口径）；
 * ② 接受新草稿 vs 改后接受（polish/rewrite）拆分；
 * ③ 拒绝 / 放弃去重与 rate；
 * ④ 裁决耗时 p50/p95（只取成功的裁决事件）；
 * ⑤ 事件注册表登记了裁决与默认写法事件。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProductEventMetrics } from '../server/lib/db/product-events.ts';
import { PRODUCT_EVENT_NAMES } from '../shared/types/product-events.ts';
import type { ProductEvent, ProductEventInput } from '../shared/types/product-events.ts';

function event(
  overrides: Partial<ProductEvent> & { eventName: ProductEventInput['eventName'] }
): ProductEvent {
  return {
    id: `id-${Math.random().toString(16).slice(2)}`,
    createdAt: 1_760_000_000_000,
    stage: 'drafting',
    result: 'success',
    novelId: 'n1',
    ...overrides,
  } as ProductEvent;
}

function preview(objectId: string): ProductEvent {
  return event({ eventName: 'draft_preview', objectId, chapterId: 'c1' });
}

test('裁决读数只统计先预览过的对象，并拆分接受/改后接受/拒绝/放弃', () => {
  const decisions = buildProductEventMetrics(
    [
      preview('o1'),
      preview('o2'),
      preview('o3'),
      preview('o4'),
      event({ eventName: 'draft_accept', objectId: 'o1', action: 'draft', durationMs: 1000 }),
      event({ eventName: 'draft_accept', objectId: 'o2', action: 'polish', durationMs: 3000 }),
      event({ eventName: 'draft_reject', objectId: 'o3', action: 'discard', durationMs: 2000 }),
      event({ eventName: 'draft_abandon', objectId: 'o4', action: 'stop-run' }),
      event({ eventName: 'draft_accept', objectId: 'o1', result: 'failure', durationMs: 5 }),
      event({ eventName: 'draft_accept', objectId: 'o9', action: 'draft', durationMs: 999 }),
      event({ eventName: 'draft_reject', objectId: 'o8', action: 'discard' }),
    ],
    30
  ).decisions;

  assert.equal(decisions.previews, 4);
  assert.equal(decisions.accepts, 1);
  assert.equal(decisions.reviseAccepts, 1);
  assert.equal(decisions.rejects, 1);
  assert.equal(decisions.abandonments, 1);
  assert.equal(decisions.decided, 4);
  assert.deepEqual(decisions.acceptanceRate, { value: 0.5, numerator: 2, denominator: 4 });
  assert.deepEqual(decisions.rejectionRate, { value: 0.25, numerator: 1, denominator: 4 });
  assert.deepEqual(decisions.abandonmentRate, { value: 0.25, numerator: 1, denominator: 4 });
  assert.deepEqual(decisions.decisionLatencyMs, { p50: 2000, p95: 2900 });
});

test('无事件时裁决读数归零、rate 为空', () => {
  const decisions = buildProductEventMetrics([], 7).decisions;
  assert.deepEqual(decisions, {
    previews: 0,
    accepts: 0,
    reviseAccepts: 0,
    rejects: 0,
    abandonments: 0,
    decided: 0,
    acceptanceRate: { value: null, numerator: 0, denominator: 0 },
    rejectionRate: { value: null, numerator: 0, denominator: 0 },
    abandonmentRate: { value: null, numerator: 0, denominator: 0 },
    decisionLatencyMs: { p50: null, p95: null },
  });
});

test('事件注册表登记了裁决与默认写法事件', () => {
  const names: readonly string[] = PRODUCT_EVENT_NAMES;
  for (const name of [
    'draft_preview',
    'draft_accept',
    'draft_reject',
    'draft_abandon',
    'writing_style_defaulted',
  ]) {
    assert.ok(names.includes(name), `PRODUCT_EVENT_NAMES 缺少 ${name}`);
  }
});
