import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useChapterProductionFlow } from '../lib/hooks/useChapterProductionFlow';

const { startStream, ProductionStyleConfirmationRequiredErrorMock } = vi.hoisted(() => ({
  startStream: vi.fn().mockImplementation(async (_payload, onEvent) => {
    onEvent({
      type: 'done',
      run: {
        id: 'run-1', novelId: 'novel-1', status: 'review_required', userIntent: '继续写冲突',
        sceneBeats: '', draftContent: '', styleAudit: '',
        continuityReport: { score: 70, issues: [], proposedPatch: { characterUpdates: [], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [] } },
        createdAt: 1, updatedAt: 1,
      },
    });
  }),
  ProductionStyleConfirmationRequiredErrorMock: class extends Error {
    readonly code = 'STYLE_CONFIRMATION_REQUIRED';
    constructor(readonly resolution?: unknown, readonly candidates?: unknown[]) {
      super('Writing style confirmation is required');
      this.name = 'ProductionStyleConfirmationRequiredError';
    }
  },
}));

vi.mock('../lib/production-client', () => ({
  startChapterProductionRunStream: startStream,
  applyChapterProductionRun: vi.fn(),
  ProductionStyleConfirmationRequiredError: ProductionStyleConfirmationRequiredErrorMock,
}));
vi.mock('../lib/chapter-client', () => ({ getChapter: vi.fn() }));
vi.mock('../lib/db-transport', () => ({ getDatabaseGenerationSnapshot: vi.fn(async () => 7) }));

describe('continuation production autostart', () => {
  test('flushes pending editor writes before capturing the production baseline', async () => {
    const order: string[] = [];
    startStream.mockReset();
    startStream.mockImplementationOnce(async (_payload, onEvent) => {
      order.push('start');
      onEvent({
        type: 'done',
        run: {
          id: 'run-flushed', novelId: 'novel-1', status: 'review_required', userIntent: '继续写冲突',
          sceneBeats: '', draftContent: '', styleAudit: '',
          continuityReport: { score: 70, issues: [], proposedPatch: { characterUpdates: [], itemUpdates: [], foreshadowingUpdates: [], timelineEventsToCreate: [], foreshadowingsToCreate: [] } },
          createdAt: 1, updatedAt: 1,
        },
      });
    });
    const flushPendingEditorWrites = vi.fn(async () => {
      order.push('flush');
    });
    const { result } = renderHook(() => useChapterProductionFlow({
      novelId: 'novel-1', currentChapterId: 'chapter-1',
      flushPendingEditorWrites,
      refreshChapters: vi.fn().mockResolvedValue([]), setCurrentChapter: vi.fn(),
    }));

    await act(async () => {
      await result.current.handleStartProductionRun('继续写冲突');
    });

    expect(flushPendingEditorWrites).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['flush', 'start']);
  });

  test('intentOverride enters initial run and stream request payload', async () => {
    const { result } = renderHook(() => useChapterProductionFlow({
      novelId: 'novel-1',
      currentChapterId: 'chapter-1',
      continuationPackId: 'pack-1',
      sessionCardIds: ['deconstruct-card-pacing'],
      refreshChapters: vi.fn().mockResolvedValue([]),
      setCurrentChapter: vi.fn(),
    }));

    await act(async () => {
      await result.current.handleStartProductionRun('继续写冲突');
    });

    expect(startStream).toHaveBeenCalledWith(
      expect.objectContaining({
        userIntent: '继续写冲突',
        continuationPackId: 'pack-1',
        sessionCardIds: ['deconstruct-card-pacing'],
      }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(result.current.activeProductionRun?.userIntent).toBe('继续写冲突');
    expect(result.current.productionIntent).toBe('继续写冲突');
  });

  test('style confirmation retry preserves the original production input and does not loop', async () => {
    startStream.mockReset();
    startStream
      .mockRejectedValueOnce(new ProductionStyleConfirmationRequiredErrorMock({
        resolution: { mode: 'default', fingerprint: 'fp-1', summary: 'default', sources: [], allowedModes: ['default'], warnings: [], confirmed: false, resolverVersion: 1 },
        candidates: [],
      }))
      .mockRejectedValueOnce(new ProductionStyleConfirmationRequiredErrorMock({
        resolution: { mode: 'default', fingerprint: 'fp-2', summary: 'default', sources: [], allowedModes: ['default'], warnings: [], confirmed: false, resolverVersion: 1 },
        candidates: [],
      }));
    const onStyleConfirmationRequired = vi.fn();
    const { result } = renderHook(() => useChapterProductionFlow({
      novelId: 'novel-1', currentChapterId: 'chapter-1', continuationPackId: 'pack-1',
      refreshChapters: vi.fn().mockResolvedValue([]), setCurrentChapter: vi.fn(), onStyleConfirmationRequired,
    }));

    await act(async () => { await result.current.handleStartProductionRun('保留输入'); });
    const firstPrompt = onStyleConfirmationRequired.mock.calls[0][0] as { retry?: (fingerprint: string) => Promise<void> };
    expect(firstPrompt.retry).toEqual(expect.any(Function));
    await act(async () => { await firstPrompt.retry?.('fp-confirmed'); });

    expect(startStream).toHaveBeenNthCalledWith(2, expect.objectContaining({
      userIntent: '保留输入', continuationPackId: 'pack-1', writingStyleFingerprint: 'fp-confirmed',
    }), expect.any(Function), expect.any(AbortSignal));
    expect(onStyleConfirmationRequired).toHaveBeenCalledTimes(1);
    expect(result.current.productionIntent).toBe('保留输入');
  });

  test('cancelling a running production marks the preview failed and keeps the input for retry', async () => {
    startStream.mockReset();
    startStream.mockImplementationOnce(async (_payload, _onEvent, signal: AbortSignal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const { result } = renderHook(() => useChapterProductionFlow({
      novelId: 'novel-1', currentChapterId: 'chapter-1',
      refreshChapters: vi.fn().mockResolvedValue([]), setCurrentChapter: vi.fn(),
    }));

    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = result.current.handleStartProductionRun('保留重试输入');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isProductionRunning).toBe(true);

    await act(async () => {
      result.current.stopProductionFlow();
      await pending;
    });

    expect(result.current.isProductionRunning).toBe(false);
    expect(result.current.productionIntent).toBe('保留重试输入');
    expect(result.current.productionError).toBe('生产任务已取消，可重新发起。');
    expect(result.current.activeProductionRun).toMatchObject({
      status: 'failed',
      errorMessage: '生产任务已取消，可重新发起。',
    });
  });
});
