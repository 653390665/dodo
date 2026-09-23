import { describe, expect, test } from 'vitest';
import { claimProductEventOnce, resetProductEventOnceMemory } from '../lib/telemetry-once';

describe('claimProductEventOnce', () => {
  test('同一 key 只认领一次（防止重复上报同一事实）', () => {
    expect(claimProductEventOnce('writing-style-required:novel-1:style-1')).toBe(true);
    expect(claimProductEventOnce('writing-style-required:novel-1:style-1')).toBe(false);
  });

  test('不同 key 互不影响', () => {
    expect(claimProductEventOnce('novel-1:chapter-1')).toBe(true);
    expect(claimProductEventOnce('novel-1:chapter-2')).toBe(true);
    expect(claimProductEventOnce('novel-2:chapter-1')).toBe(true);
  });

  test('localStorage 命中在内存重置后依然生效（跨刷新去重）', () => {
    expect(claimProductEventOnce('writing-style-required:novel-1:style-2')).toBe(true);
    resetProductEventOnceMemory();
    expect(claimProductEventOnce('writing-style-required:novel-1:style-2')).toBe(false);
  });
});
