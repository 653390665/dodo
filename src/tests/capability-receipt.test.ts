import { describe, expect, test } from 'vitest';

import { buildCapabilityReceipt } from '../lib/capability-receipt';

describe('buildCapabilityReceipt', () => {
  test('目录内卡解析为标题，流程解析为流程名', () => {
    const entries = buildCapabilityReceipt(['core-slop-shield', 'xiaofeiji-novel-flow']);
    expect(entries).toHaveLength(2);
    expect(entries[0].resolved).toBe(true);
    expect(entries[0].title).toBe('去 AI 腔与废话净化器');
    expect(entries[1].resolved).toBe(true);
    expect(entries[1].title).toBe('长篇商业连载流程');
  });

  test('目录外 id 原样展示且 resolved=false', () => {
    const entries = buildCapabilityReceipt(['gone-card-900']);
    expect(entries).toEqual([{ id: 'gone-card-900', title: 'gone-card-900', resolved: false }]);
  });

  test('空/缺失回执返回空数组（旧 run 静默降级）', () => {
    expect(buildCapabilityReceipt(undefined)).toEqual([]);
    expect(buildCapabilityReceipt([])).toEqual([]);
  });
});
