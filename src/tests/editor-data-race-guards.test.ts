import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Chapter, ContinuationPack, Novel } from '../../shared/types';

// Plan 178：编辑器数据流与生成互斥收口的回归测试。
// 结构仿 editor-persistence.test.ts：真实 hook + 最小模块 mock。

const mocks = vi.hoisted(() => ({
  editorAgentPhase: vi.fn(),
  buildContextPrompt: vi.fn(() => 'context'),
  extractWorldSetupPhase: vi.fn(),
  updateChapter: vi.fn(),
  recordProductEvent: vi.fn(),
  getDatabaseGenerationSnapshot: vi.fn(),
  requireResponseDatabaseGeneration: vi.fn(() => 12),
  subscribeToChanges: vi.fn(),
  listContinuationPacks: vi.fn(),
  listNovels: vi.fn(),
}));

vi.mock('../lib/agents', () => ({
  editorAgentPhase: mocks.editorAgentPhase,
  buildContextPrompt: mocks.buildContextPrompt,
  extractWorldSetupPhase: mocks.extractWorldSetupPhase,
}));
vi.mock('../lib/chapter-client', () => ({
  updateChapter: mocks.updateChapter,
  createChapter: vi.fn(),
}));
vi.mock('../lib/product-events-client', () => ({
  recordProductEvent: mocks.recordProductEvent,
}));
vi.mock('../lib/db-transport', () => ({
  getDatabaseGenerationSnapshot: mocks.getDatabaseGenerationSnapshot,
  requireResponseDatabaseGeneration: mocks.requireResponseDatabaseGeneration,
  subscribeToChanges: mocks.subscribeToChanges,
}));
vi.mock('../lib/continuation-client', () => ({
  listContinuationPacks: mocks.listContinuationPacks,
}));
vi.mock('../lib/novel-client', () => ({
  listNovels: mocks.listNovels,
}));
// AIAssistant 渲染用 stub，避免 jsdom 下拉真实 markdown 渲染链。
vi.mock('react-markdown', () => ({
  default: (props: { children?: unknown }) => props.children ?? null,
}));

import { AIAssistant } from '../components/AIAssistant';
import { useDraftGeneration } from '../lib/hooks/generation/useDraftGeneration';
import { useEditorContinuationPacks } from '../lib/hooks/useEditorContinuationPacks';
import { useContinuationPackStore } from '../stores/continuation-pack-store';
import { useEditorGenerationStore } from '../stores/editor-generation-store';

const novel: Novel = {
  id: 'novel-1', title: 'Novel', authorId: 'user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1,
};
const chapter: Chapter = {
  id: 'chapter-1', novelId: novel.id, title: 'Chapter', content: 'baseline', sceneBeats: 'beats',
  order: 1, wordCount: 8, createdAt: 1, updatedAt: 1,
};

function setupDraftGeneration(flushPendingEditorWrites: () => Promise<void>) {
  const props = {
    novel,
    currentChapter: chapter,
    userIntent: '',
    selectedContinuationPackId: '',
    contentRef: { current: { value: chapter.content } as HTMLTextAreaElement },
    draftPromptSurface: 'workspace-draft',
    requestSeqRef: { current: 0 },
    abortControllerRef: { current: null as AbortController | null },
    latestChapterIdRef: { current: chapter.id as string | null },
    setGenerationStatus: vi.fn(),
    setAiActionState: vi.fn(),
    setUserIntent: vi.fn(),
    setCurrentChapter: vi.fn(),
    buildAgentContext: vi.fn(() => ({} as never)),
    pushToUndoHistory: vi.fn(),
    getCurrentFitScore: vi.fn(() => 1),
    recordSkillUsage: vi.fn().mockResolvedValue(undefined),
    formatAiFailure: vi.fn(() => 'generation failed'),
    flushPendingEditorWrites,
  };
  return { hook: renderHook(() => useDraftGeneration(props)), props };
}

describe('editor data race guards (plan 178)', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.buildContextPrompt.mockReturnValue('context');
    mocks.getDatabaseGenerationSnapshot.mockResolvedValue(12);
    mocks.updateChapter.mockResolvedValue(true);
    mocks.subscribeToChanges.mockReturnValue(() => {});
    useEditorGenerationStore.setState({
      isGeneratingOutline: false,
      isGeneratingContent: false,
      isGeneratingBeats: false,
      isGeneratingCritique: false,
      generationStatus: null,
    });
    useContinuationPackStore.setState({ continuationPacks: [], selectedContinuationPackId: '' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('entry mutex: beats request is rejected while content generation is in flight', async () => {
    // 模拟正文生成在途（修复前：点分镜会把它强制置回 false，解锁正文编辑）。
    useEditorGenerationStore.getState().setIsGeneratingContent(true);
    const flush = vi.fn().mockResolvedValue(undefined);
    const { hook } = setupDraftGeneration(flush);

    await act(() => hook.result.current.handleGenerateBeats());

    const state = useEditorGenerationStore.getState();
    expect(state.isGeneratingBeats).toBe(false);
    expect(state.isGeneratingContent).toBe(true);
    expect(flush).not.toHaveBeenCalled();
    expect(mocks.editorAgentPhase).not.toHaveBeenCalled();
  });

  test('entry mutex: content request is rejected while beats generation is in flight', async () => {
    useEditorGenerationStore.getState().setIsGeneratingBeats(true);
    const { hook } = setupDraftGeneration(vi.fn().mockResolvedValue(undefined));

    await act(() => hook.result.current.handleGenerateContent());

    const state = useEditorGenerationStore.getState();
    expect(state.isGeneratingContent).toBe(false);
    expect(state.isGeneratingBeats).toBe(true);
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });

  test('a beats run keeps the content flag untouched during and after the run', async () => {
    let releaseFlush!: () => void;
    const { hook } = setupDraftGeneration(() => new Promise<void>((resolve) => { releaseFlush = resolve; }));

    let pending!: Promise<void>;
    await act(async () => {
      pending = hook.result.current.handleGenerateBeats();
    });

    // flush 挂起 → beats 在途。
    expect(useEditorGenerationStore.getState().isGeneratingBeats).toBe(true);
    expect(useEditorGenerationStore.getState().isGeneratingContent).toBe(false);

    await act(async () => {
      releaseFlush();
      await pending;
    });

    expect(useEditorGenerationStore.getState().isGeneratingBeats).toBe(false);
    expect(useEditorGenerationStore.getState().isGeneratingContent).toBe(false);
  });

  test('finally: a superseded beats run still resets its own flag', async () => {
    let rejectGeneration!: (error: Error) => void;
    mocks.editorAgentPhase.mockImplementationOnce(() => new Promise<string>((_resolve, reject) => {
      rejectGeneration = reject as unknown as (error: Error) => void;
    }));
    const { hook, props } = setupDraftGeneration(vi.fn().mockResolvedValue(undefined));

    const pending = hook.result.current.handleGenerateBeats();
    await vi.waitFor(() => expect(mocks.editorAgentPhase).toHaveBeenCalledTimes(1));

    // 模拟新请求顶掉 seq（修复前：finally 检查 seq 失败 → 旗标永久卡 true）。
    props.requestSeqRef.current += 1;
    props.latestChapterIdRef.current = 'chapter-2';
    await act(async () => {
      rejectGeneration(new Error('superseded'));
      await pending;
    });

    expect(useEditorGenerationStore.getState().isGeneratingBeats).toBe(false);
  });

  test('stale continuation packs response for the previous novel never lands in the store', async () => {
    const packA = {
      id: 'pack-a', novelId: 'novel-a', title: 'A 的资料包', status: 'approved', updatedAt: 2,
    } as unknown as ContinuationPack;
    const packB = {
      id: 'pack-b', novelId: 'novel-b', title: 'B 的资料包', status: 'approved', updatedAt: 1,
    } as unknown as ContinuationPack;

    let resolveNovelA!: (packs: ContinuationPack[]) => void;
    mocks.listContinuationPacks.mockImplementationOnce(
      () => new Promise<ContinuationPack[]>((resolve) => { resolveNovelA = resolve; }),
    );
    mocks.listContinuationPacks.mockResolvedValueOnce([packB]);

    const { rerender } = renderHook(
      ({ novelId }) => useEditorContinuationPacks(novelId, null),
      { initialProps: { novelId: 'novel-a' } },
    );

    // 换到 B 书：B 的响应先落库。
    rerender({ novelId: 'novel-b' });
    await act(async () => {});
    expect(useContinuationPackStore.getState().continuationPacks.map((pack) => pack.id)).toEqual(['pack-b']);

    // A 书的慢响应后到：不得写进 B 书的 store。
    await act(async () => {
      resolveNovelA([packA]);
      await Promise.resolve();
    });

    expect(mocks.listContinuationPacks).toHaveBeenNthCalledWith(1, 'novel-a');
    expect(mocks.listContinuationPacks).toHaveBeenNthCalledWith(2, 'novel-b');
    expect(useContinuationPackStore.getState().continuationPacks.map((pack) => pack.id)).toEqual(['pack-b']);
    expect(useContinuationPackStore.getState().selectedContinuationPackId).toBe('pack-b');
  });

  test('AIAssistant survives a failing novels refresh triggered by SSE listener', async () => {
    mocks.listNovels.mockRejectedValue(new Error('offline'));
    let listener: (() => void) | undefined;
    mocks.subscribeToChanges.mockImplementation((fn: () => void) => {
      listener = fn;
      return () => {};
    });

    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => { rejections.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    try {
      const { unmount } = render(React.createElement(AIAssistant));
      await act(async () => { await Promise.resolve(); });
      expect(listener).toEqual(expect.any(Function));

      // 手动触发 SSE 广播回调：listNovels 两次 reject 都应被 catch 吞掉。
      await act(async () => {
        listener?.();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(rejections).toEqual([]);
      expect(screen.queryByText('灵感启动助手')).toBeTruthy();
      unmount();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
