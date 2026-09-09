import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Chapter, Novel } from '../../shared/types';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow';
import { useEditorGenerationStore } from '../stores/editor-generation-store';

// EditorView 接线特征测试（Plan 186）。
//
// 选择 hook 级路径：直接驱动 useEditorGenerationFlow 返回的 handler，只 mock
// transport/client 层。组件级挂载 EditorView 需要 mock 15+ 模块（见
// components.test.tsx），超过计划允许的 mock 面上限。
//
// 本测试锁定真实 hooks 之间的实参传递（databaseGeneration / seq / baselineHash /
// source）：这些接线此前只有 mock 掉 hooks 的生命周期测试覆盖，实参可双向断裂而无
// 测试变红。变更语义需产品决策。

const chapterClientMocks = vi.hoisted(() => ({
  acceptChapterContentCandidate: vi.fn(async (_payload: Record<string, unknown>, _generation?: number) => true),
  updateChapter: vi.fn(async () => true),
}));

const dbTransportMocks = vi.hoisted(() => ({
  getDatabaseGenerationSnapshot: vi.fn(async () => 7),
  requireResponseDatabaseGeneration: vi.fn(() => 7),
}));

const draftStreamMocks = vi.hoisted(() => ({
  readDraftStream: vi.fn(async (
    _response: Response,
    _handlers: { onStatus?: (message: string) => void; onSource?: (source: 'model' | 'fallback') => void; onToken?: (token: string) => void },
  ) => '一段生成的正文。'),
}));

const sseMocks = vi.hoisted(() => ({
  readSseStream: vi.fn(async () => ({ done: true, text: '这段新描写更有画面感。' })),
}));

const productEventMocks = vi.hoisted(() => ({
  recordProductEvent: vi.fn(async () => undefined),
}));

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/chapter-client', () => chapterClientMocks);
vi.mock('../lib/db-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db-transport')>()),
  getDatabaseGenerationSnapshot: dbTransportMocks.getDatabaseGenerationSnapshot,
  requireResponseDatabaseGeneration: dbTransportMocks.requireResponseDatabaseGeneration,
}));
vi.mock('../lib/draft-stream', () => draftStreamMocks);
vi.mock('../lib/sse-client', () => ({
  SseError: class SseError extends Error { violations?: string[] },
  readSseStream: sseMocks.readSseStream,
}));
vi.mock('../lib/product-events-client', () => productEventMocks);

import { useEditorGenerationFlow } from '../lib/hooks/useEditorGenerationFlow';

const novel: Novel = {
  id: 'novel-1', title: '接线测试小说', authorId: 'local-user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1,
};

const chapterBaseline = '城门外的风卷着沙尘，守夜人点亮了灯。这段旧描写需要重写。';
const rewriteTarget = '这段旧描写需要重写。';
const selectionStart = chapterBaseline.indexOf(rewriteTarget);
const selectionEnd = selectionStart + rewriteTarget.length;

const chapter: Chapter = {
  id: 'chapter-1', novelId: novel.id, title: '第一章', content: chapterBaseline, sceneBeats: '分镜一：入城',
  order: 1, wordCount: chapterBaseline.length, createdAt: 1, updatedAt: 1,
};

function renderFlow() {
  const contentElement = { value: chapterBaseline, selectionStart, selectionEnd };
  return renderHook(() => useEditorGenerationFlow({
    novel,
    currentChapter: chapter,
    userIntent: '',
    globalOutline: '',
    expectedWordCount: '',
    contentRef: { current: contentElement } as never,
    selectedContinuationPackId: '',
    approvedOutlinePackId: '',
    buildAgentContext: () => ({ novel, characters: [] }) as never,
    handleUpdateContent: vi.fn(),
    pushToUndoHistory: vi.fn(),
    setCurrentChapter: vi.fn(),
    setGlobalOutline: vi.fn(),
    setUserIntent: vi.fn(),
    getCurrentFitScore: () => 100,
    recordSkillUsage: vi.fn(async () => undefined),
    formatAiFailure: () => 'failed',
    flushPendingEditorWrites: vi.fn(async () => undefined),
    databaseGeneration: 7,
  }));
}

describe('editor wiring contract (real hooks, mocked transport)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, body: {} }));
    dbTransportMocks.getDatabaseGenerationSnapshot.mockClear().mockResolvedValue(7);
    dbTransportMocks.requireResponseDatabaseGeneration.mockClear().mockReturnValue(7);
    chapterClientMocks.acceptChapterContentCandidate.mockClear().mockResolvedValue(true);
    chapterClientMocks.updateChapter.mockClear().mockResolvedValue(true);
    draftStreamMocks.readDraftStream.mockClear();
    sseMocks.readSseStream.mockClear().mockResolvedValue({ done: true, text: '这段新描写更有画面感。' });
    productEventMocks.recordProductEvent.mockClear();
    useEditorGenerationStore.setState({
      isGeneratingOutline: false,
      isGeneratingContent: false,
      isGeneratingBeats: false,
      isGeneratingCritique: false,
      isAcceptingAiCandidate: false,
      generationStatus: null,
    });
  });

  test('draft generation forwards numeric databaseGeneration and the right chapter/novel to the transport', async () => {
    const draftResponse = { ok: true, status: 200, body: {} };
    fetchMock.mockResolvedValueOnce(draftResponse);
    const { result } = renderFlow();

    await act(async () => { await result.current.handleGenerateContent(); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/orchestrate-draft');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(typeof body.databaseGeneration).toBe('number');
    expect(body.databaseGeneration).toBe(7);
    expect(body.novelId).toBe('novel-1');
    expect(body.chapterId).toBe('chapter-1');

    // 响应对象原样交给流读取层（transport → stream reader 接线）。
    expect(draftStreamMocks.readDraftStream).toHaveBeenCalledTimes(1);
    expect(draftStreamMocks.readDraftStream.mock.calls[0][0]).toBe(draftResponse);
  });

  test('context rewrite produces a candidate carrying generation, and acceptance passes baselineHash/source to the save client', async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.handleContextRewriteCandidate({
        targetText: rewriteTarget,
        beforeContext: '城门外的风卷着沙尘，守夜人点亮了灯。',
        afterContext: '',
        auditIssue: '描写陈旧',
        sceneBeats: chapter.sceneBeats,
        databaseGeneration: 7,
        selectionStart,
        selectionEnd,
      });
    });

    // 改写请求接线：transport 实参 + 候选携带同一代数据库版本。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [rewriteUrl, rewriteInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(rewriteUrl).toBe('/api/rewrite');
    const rewriteBody = JSON.parse(String(rewriteInit.body)) as Record<string, unknown>;
    expect(typeof rewriteBody.databaseGeneration).toBe('number');
    expect(rewriteBody.databaseGeneration).toBe(7);
    expect(rewriteBody.novelId).toBe('novel-1');
    expect(rewriteBody.chapterId).toBe('chapter-1');

    expect(result.current.aiContentCandidate).toMatchObject({
      operation: 'rewrite',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      databaseGeneration: 7,
      source: 'model',
      baselineHash: computeChapterWorkflowHash(chapterBaseline, chapter.sceneBeats),
    });

    await act(async () => { await result.current.acceptAiContentCandidate(); });

    expect(chapterClientMocks.acceptChapterContentCandidate).toHaveBeenCalledTimes(1);
    const [payload, generation] = chapterClientMocks.acceptChapterContentCandidate.mock.calls[0];
    expect(generation).toBe(7);
    expect(payload.baselineHash).toBe(computeChapterWorkflowHash(chapterBaseline, chapter.sceneBeats));
    expect(payload.source).toBe('model');
    expect(payload.chapterId).toBe('chapter-1');
    expect(payload.novelId).toBe('novel-1');
  });
});
