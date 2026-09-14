import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useCompletionAutoGate } from '../lib/hooks/useCompletionAutoGate';

// Plan 207 回归：完成风暴（事实待确认时 10 秒 283 次 POST /complete）的
// 防线断言——同一候选身份至多自动补跑一次，只观察外部触发次数。

interface HookProps {
  needsGate: boolean;
  inFlight: boolean;
  attemptKey: string | null;
  onComplete: () => void;
}

describe('useCompletionAutoGate（Plan 207 完成风暴防线）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (initial: Omit<HookProps, 'inFlight'>) => {
    const props = { ...initial, inFlight: false };
    return {
      hook: renderHook((next: HookProps) => useCompletionAutoGate(next), { initialProps: props }),
      runTimers: () =>
        act(() => {
          vi.advanceTimersByTime(50);
        }),
    };
  };

  test('needsGate 为 true 时补跑恰好一次', () => {
    const onComplete = vi.fn();
    const { runTimers } = setup({
      needsGate: true,
      attemptKey: 'chapter-1:run-1',
      onComplete,
    });
    expect(onComplete).not.toHaveBeenCalled();
    runTimers();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('风暴场景：补跑后在飞标记翻转 + 回调身份换新 + 门仍待评估，不再重跑', () => {
    const onComplete = vi.fn();
    const { hook, runTimers } = setup({
      needsGate: true,
      attemptKey: 'chapter-1:run-1',
      onComplete,
    });
    runTimers();
    expect(onComplete).toHaveBeenCalledTimes(1);
    // 模拟 handleCompleteChapter 一轮结束：inFlight true→false 翻转让 effect 重跑，
    // 回调随渲染换新身份（钩内经 ref 读最新回调），needsGate 仍为 true（门被冲回 drafting）。
    act(() => {
      hook.rerender({ needsGate: true, inFlight: true, attemptKey: 'chapter-1:run-1', onComplete });
    });
    act(() => {
      hook.rerender({ needsGate: true, inFlight: false, attemptKey: 'chapter-1:run-1', onComplete });
    });
    runTimers();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('门已评估（needsGate 翻 false）再被冲回 true，同一候选不二次补跑', () => {
    const onComplete = vi.fn();
    const { hook, runTimers } = setup({
      needsGate: true,
      attemptKey: 'chapter-1:run-1',
      onComplete,
    });
    runTimers();
    expect(onComplete).toHaveBeenCalledTimes(1);
    // 成功写入 review-required → 门已评估，needsGate 翻 false
    act(() => {
      hook.rerender({ needsGate: false, inFlight: false, attemptKey: 'chapter-1:run-1', onComplete });
    });
    runTimers();
    // GET 刷新把门冲回 drafting → needsGate 翻回 true
    act(() => {
      hook.rerender({ needsGate: true, inFlight: false, attemptKey: 'chapter-1:run-1', onComplete });
    });
    runTimers();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('换候选（新 runId）重新获得一次补跑机会', () => {
    const onComplete = vi.fn();
    const { hook, runTimers } = setup({
      needsGate: true,
      attemptKey: 'chapter-1:run-1',
      onComplete,
    });
    runTimers();
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => {
      hook.rerender({ needsGate: true, inFlight: false, attemptKey: 'chapter-1:run-2', onComplete });
    });
    runTimers();
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  test('needsGate=false 或 inFlight=true 时不触发', () => {
    const onComplete = vi.fn();
    const { hook, runTimers } = setup({
      needsGate: false,
      attemptKey: 'chapter-1:run-1',
      onComplete,
    });
    runTimers();
    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      hook.rerender({ needsGate: true, inFlight: true, attemptKey: 'chapter-1:run-1', onComplete });
    });
    runTimers();
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('attemptKey 为 null 时不触发', () => {
    const onComplete = vi.fn();
    const { runTimers } = setup({ needsGate: true, attemptKey: null, onComplete });
    runTimers();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
