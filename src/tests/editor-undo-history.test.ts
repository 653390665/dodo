import { useEffect, useRef } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useChapterUndo } from '../lib/hooks/useChapterUndo';

interface HarnessChapter {
  id: string;
  content: string;
}

// 最小复刻 EditorView 的装配：useChapterUndo + Step 1 修复后的 reset effect（章节 id 哨兵）。
function useEditorUndoHarness(chapter: HarnessChapter) {
  const isContentLockedRef = useRef(false);
  const { undoState, pushToUndoHistory, handleUndo, resetUndoHistory } = useChapterUndo({
    currentContent: chapter.content,
    isContentLockedRef,
    onUndoRedo: () => {},
  });

  // 复刻 src/components/EditorView.tsx 的 reset effect（修复版：只在章节 id 变化时 reset）
  const lastUndoChapterIdRef = useRef<string | null>(null);
  useEffect(() => {
    const chapterId = chapter?.id ?? null;
    if (!chapter || !chapterId) {
      lastUndoChapterIdRef.current = null;
      return;
    }
    if (lastUndoChapterIdRef.current === chapterId) return;
    lastUndoChapterIdRef.current = chapterId;
    resetUndoHistory(chapter.content);
  }, [chapter, resetUndoHistory]);

  return { undoState, pushToUndoHistory, handleUndo };
}

function setup(initialChapter: HarnessChapter) {
  return renderHook((props: { chapter: HarnessChapter }) => useEditorUndoHarness(props.chapter), {
    initialProps: { chapter: initialChapter },
  });
}

async function flushUndoPush() {
  // pushToUndoHistory 的 2 秒防抖落地
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
}

describe('editor undo history (EditorView reset effect)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('typing pushes history and undo steps back through versions', async () => {
    const { result, rerender } = setup({ id: 'chapter-1', content: 'v0' });

    for (const content of ['v1', 'v2', 'v3']) {
      act(() => result.current.pushToUndoHistory(content));
      // 模拟 handleUpdateContent：同章节内容更新会产生新的 currentChapter 对象
      rerender({ chapter: { id: 'chapter-1', content } });
      await flushUndoPush();
    }

    expect(result.current.undoState.present).toBe('v3');
    act(() => result.current.handleUndo());
    expect(result.current.undoState.present).toBe('v2');
    act(() => result.current.handleUndo());
    expect(result.current.undoState.present).toBe('v1');
  });

  test('switching chapter resets history so undo is a no-op', async () => {
    const { result, rerender } = setup({ id: 'chapter-1', content: 'v0' });

    act(() => result.current.pushToUndoHistory('v1'));
    await flushUndoPush();
    expect(result.current.undoState.past).toEqual(['v0']);

    // 切换章节：新 id + 新内容触发 reset
    rerender({ chapter: { id: 'chapter-2', content: '新章节开头' } });

    expect(result.current.undoState.present).toBe('新章节开头');
    expect(result.current.undoState.past).toEqual([]);
    act(() => result.current.handleUndo());
    expect(result.current.undoState.present).toBe('新章节开头');
    expect(result.current.undoState.past).toEqual([]);
  });

  test('content updates within the same chapter do not clear pushed history (regression)', async () => {
    const { result, rerender } = setup({ id: 'chapter-1', content: 'v0' });

    act(() => result.current.pushToUndoHistory('v1'));
    await flushUndoPush();
    expect(result.current.undoState.past).toEqual(['v0']);

    // 本 bug 的触发链：同章节连续内容更新 → 新 currentChapter 对象 → reset effect 重跑
    rerender({ chapter: { id: 'chapter-1', content: 'v1' } });
    rerender({ chapter: { id: 'chapter-1', content: 'v2' } });

    act(() => result.current.pushToUndoHistory('v2'));
    await flushUndoPush();

    expect(result.current.undoState.present).toBe('v2');
    expect(result.current.undoState.past).toEqual(['v0', 'v1']);
    act(() => result.current.handleUndo());
    expect(result.current.undoState.present).toBe('v1');
  });
});
