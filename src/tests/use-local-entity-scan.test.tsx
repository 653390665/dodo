import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { useLocalEntityScan } from '../lib/hooks/useLocalEntityScan';

function setTextareaCursor(ref: { current: HTMLTextAreaElement | null }, cursor: number) {
  Object.defineProperty(ref.current, 'selectionStart', { value: cursor, configurable: true });
  Object.defineProperty(ref.current, 'selectionEnd', { value: cursor, configurable: true });
}

describe('useLocalEntityScan', () => {
  test('输入后 400ms 防抖窗口内不扫描，窗口结束才扫描一次', async () => {
    vi.useFakeTimers();
    try {
      const ref = { current: document.createElement('textarea') };
      const initial = { id: 'ch-1', content: '林舟走进潮汐城码头，雨下个不停。' };

      const { result, rerender } = renderHook(
        ({
          content,
          cursor,
        }: {
          content: { id: string; content: string };
          cursor: number;
        }) => {
          setTextareaCursor(ref, cursor);
          return useLocalEntityScan({
            contentRef: ref,
            currentChapter: content,
            characters: [{ name: '林舟' }],
            locations: [{ name: '潮汐城' }],
            items: [],
            factions: [],
          });
        },
        { initialProps: { content: initial, cursor: 0 } }
      );

      expect(result.current).toEqual([]);

      // 连续打字三键（内容变化 + keyup），防抖定时器反复重置/去重
      const typed = { id: 'ch-1', content: `${initial.content}林舟回头。` };
      for (const cursor of [17, 18, 19]) {
        rerender({ content: typed, cursor });
        await act(async () => {
          ref.current.dispatchEvent(new Event('keyup'));
        });
      }

      await act(async () => {
        vi.advanceTimersByTime(399);
      });
      expect(result.current).toEqual([]);

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toEqual(['林舟', '潮汐城']);
    } finally {
      vi.useRealTimers();
    }
  });

  test('光标未变时重复 keyup 不重跑扫描（结果引用保持稳定）', async () => {
    vi.useFakeTimers();
    try {
      const ref = { current: document.createElement('textarea') };
      const chapter = { id: 'ch-1', content: '林舟与苏芷同桌对弈。' };

      const { result } = renderHook(() =>
        useLocalEntityScan({
          contentRef: ref,
          currentChapter: chapter,
          characters: [{ name: '林舟' }, { name: '苏芷' }],
          locations: [],
          items: [],
          factions: [],
        })
      );

      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      const afterFirstScan = result.current;
      expect(afterFirstScan).toEqual(['林舟', '苏芷']);

      // 同一光标位置连续 5 次 keyup + 放行防抖窗口：哈希未变 → 不扫描、不 setState
      for (let i = 0; i < 5; i += 1) {
        await act(async () => {
          ref.current.dispatchEvent(new Event('keyup'));
          vi.advanceTimersByTime(400);
        });
      }
      expect(result.current).toBe(afterFirstScan);
    } finally {
      vi.useRealTimers();
    }
  });

  test('章节内容清空时实体列表被清空', async () => {
    vi.useFakeTimers();
    try {
      const ref = { current: document.createElement('textarea') };
      const { result, rerender } = renderHook(
        ({ content }: { content: { id: string; content: string } | null }) =>
          useLocalEntityScan({
            contentRef: ref,
            currentChapter: content,
            characters: [{ name: '林舟' }],
            locations: [],
            items: [],
            factions: [],
          }),
        { initialProps: { content: { id: 'ch-1', content: '林舟登场' } } }
      );

      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(result.current).toEqual(['林舟']);

      rerender({ content: { id: 'ch-1', content: '' } });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(result.current).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
