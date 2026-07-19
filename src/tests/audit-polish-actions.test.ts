import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Chapter, Novel } from '../../shared/types';

const chapterClientMocks = vi.hoisted(() => ({
  updateChapter: vi.fn(async () => true),
  createChapterVersion: vi.fn(async () => {}),
}));

vi.mock('../lib/chapter-client', () => chapterClientMocks);

import { useAuditPolishActions } from '../lib/hooks/generation/useAuditPolishActions';

function makeNovel(): Novel {
  return {
    id: 'novel-1',
    title: '测试小说',
    authorId: 'local-user',
    summary: '',
    status: 'ongoing',
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeChapter(content = '原文尾'): Chapter {
  return {
    id: 'chapter-1',
    novelId: 'novel-1',
    title: '第一章',
    content,
    order: 1,
    wordCount: content.length,
    sceneBeats: '',
    critique: '',
    createdAt: 1,
    updatedAt: 1,
  };
}

function sseResponse(events: string[], delayBeforeCloseMs = 0): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      if (delayBeforeCloseMs > 0) {
        setTimeout(() => controller.close(), delayBeforeCloseMs);
      } else {
        controller.close();
      }
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-InkFlow-Database-Generation': '7' } });
}

function delayedDoneSseResponse(token: string, delayMs = 25): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
      setTimeout(() => {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }, delayMs);
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-InkFlow-Database-Generation': '7' } });
}

function renderRewriteHook(options: {
  chapter?: Chapter;
  recordSkillUsage?: () => Promise<void>;
  flushPendingEditorWrites?: () => Promise<void>;
} = {}) {
  const novel = makeNovel();
  const chapter = options.chapter ?? makeChapter();
  const requestSeqRef = { current: 0 };
  const latestChapterIdRef = { current: chapter.id as string | null };
  const abortControllerRef = { current: null as AbortController | null };
  const handleUpdateContent = vi.fn();
  const setCurrentChapter = vi.fn();
  const recordSkillUsage = vi.fn(options.recordSkillUsage ?? (async () => {}));
  const flushPendingEditorWrites = vi.fn(options.flushPendingEditorWrites ?? (async () => {}));

  const hook = renderHook(() => useAuditPolishActions({
    novel,
    currentChapter: chapter,
    mountedSkills: [],
    contentRef: { current: { selectionStart: 0, selectionEnd: 2 } } as never,
    polishPromptSurface: 'chapter-polish',
    requestSeqRef,
    abortControllerRef,
    latestChapterIdRef,
    setIsGeneratingContent: vi.fn(),
    setIsGeneratingCritique: vi.fn(),
    setGenerationStatus: vi.fn(),
    setAuditStatus: vi.fn(),
    setCurrentChapter,
    buildAgentContext: () => ({ novel, characters: [] }),
    handleUpdateContent,
    getCurrentFitScore: () => 80,
    recordSkillUsage,
    formatAiFailure: () => 'failed',
    flushPendingEditorWrites,
  }));

  return {
    ...hook,
    chapter,
    requestSeqRef,
    latestChapterIdRef,
    handleUpdateContent,
    recordSkillUsage,
    flushPendingEditorWrites,
  };
}

describe('useAuditPolishActions rewrite persistence guards', () => {
  beforeEach(() => {
    chapterClientMocks.updateChapter.mockClear();
    chapterClientMocks.createChapterVersion.mockClear();
    vi.stubGlobal('prompt', vi.fn(() => '润色'));
    vi.stubGlobal('alert', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('missing [DONE] restores the original content without persisting the preview', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"token":"新文"}\n\n',
    ])));
    const { result, handleUpdateContent, chapter } = renderRewriteHook();

    await result.current.handleRewriteSelectedText();

    expect(handleUpdateContent).toHaveBeenLastCalledWith(chapter.content, false, true);
    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
  });

  test('a stale request cannot restore over a newer chapter or request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => delayedDoneSseResponse('新文')));
    const {
      result,
      handleUpdateContent,
      chapter,
      requestSeqRef,
      latestChapterIdRef,
      recordSkillUsage,
    } = renderRewriteHook();

    const pending = result.current.handleRewriteSelectedText();
    await new Promise((resolve) => setTimeout(resolve, 0));
    requestSeqRef.current += 1;
    latestChapterIdRef.current = 'chapter-2';
    await pending;

    expect(handleUpdateContent).toHaveBeenCalledWith('新文尾', false, true);
    expect(handleUpdateContent).not.toHaveBeenCalledWith(chapter.content, false, true);
    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
    expect(chapterClientMocks.createChapterVersion).not.toHaveBeenCalled();
    expect(recordSkillUsage).not.toHaveBeenCalled();
  });

  test('successful streaming previews use skipPersist and commit chapter content once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"token":"新"}\n\n',
      'data: {"token":"文"}\n\n',
      'data: [DONE]\n\n',
    ])));
    const { result, handleUpdateContent, chapter } = renderRewriteHook();

    await result.current.handleRewriteSelectedText();

    expect(handleUpdateContent).toHaveBeenCalled();
    for (const call of handleUpdateContent.mock.calls) {
      expect(call[2]).toBe(true);
    }
    expect(chapterClientMocks.updateChapter).toHaveBeenCalledTimes(1);
    expect(chapterClientMocks.updateChapter).toHaveBeenCalledWith(
      chapter.id,
      expect.objectContaining({ content: '新文尾' }),
      7,
    );
    expect(chapterClientMocks.createChapterVersion).toHaveBeenCalledWith(expect.any(Object), 7);
  });

  test('does not start or commit an AI rewrite when pending user content cannot flush', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result, handleUpdateContent } = renderRewriteHook({
      flushPendingEditorWrites: async () => { throw new Error('disk unavailable'); },
    });

    await result.current.handleRewriteSelectedText();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(handleUpdateContent).toHaveBeenCalledWith('原文尾', false, true);
    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
    expect(chapterClientMocks.createChapterVersion).not.toHaveBeenCalled();
  });

  test('a completed rewrite without a database generation is restored and never persisted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'data: {"token":"新文"}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )));
    const { result, handleUpdateContent, chapter } = renderRewriteHook();

    await result.current.handleRewriteSelectedText();

    expect(handleUpdateContent).toHaveBeenLastCalledWith(chapter.content, false, true);
    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
    expect(chapterClientMocks.createChapterVersion).not.toHaveBeenCalled();
  });

  test('successful audit polish commits content and critique together once despite telemetry failure', async () => {
    const original = '他做出了明确反应，然后转身离去。';
    const chapter = {
      ...makeChapter(original),
      critique: `## 致命问题\n### 弱动作链\n> ${original} —— 动作表达过弱`,
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input) === '/api/db/generation'
        ? Response.json({ databaseGeneration: 7 })
        : sseResponse([
          'data: {"token":"他猛地扣住门框，"}\n\n',
          'data: {"token":"挡住了对方去路。"}\n\n',
          'data: [DONE]\n\n',
        ])
    )));
    const { result, handleUpdateContent } = renderRewriteHook({
      chapter,
      recordSkillUsage: async () => { throw new Error('telemetry unavailable'); },
    });

    await result.current.handlePolishChapterFromAudit();

    for (const call of handleUpdateContent.mock.calls) {
      expect(call[2]).toBe(true);
    }
    expect(chapterClientMocks.updateChapter).toHaveBeenCalledTimes(1);
    expect(chapterClientMocks.updateChapter).toHaveBeenCalledWith(
      chapter.id,
      expect.objectContaining({
        content: '他猛地扣住门框，挡住了对方去路。',
        critique: '',
      }),
      7,
    );
  });

  test('audit polling and critique persistence stay bound to the starting database generation', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ jobId: 'audit-1', databaseGeneration: 17 }))
      .mockResolvedValueOnce(Response.json({
        status: 'completed',
        progress: 100,
        result: { feedback: '完整审稿反馈', score: 88 },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const { result, chapter } = renderRewriteHook();

    const pending = result.current.handleRunAudit();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      await pending;
    });

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/audit/jobs/audit-1?databaseGeneration=17', {
      signal: expect.any(AbortSignal),
    });
    expect(chapterClientMocks.updateChapter).toHaveBeenCalledWith(
      chapter.id,
      { critique: '完整审稿反馈' },
      17,
    );
    vi.useRealTimers();
  });

  test('audit polling failure cancels the incomplete generation-bound job', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ jobId: 'audit-failed', databaseGeneration: 23 }))
      .mockResolvedValueOnce(new Response('backend unavailable', { status: 502 }))
      .mockResolvedValueOnce(Response.json({ cancelled: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderRewriteHook();

    const pending = result.current.handleRunAudit();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      await pending;
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/audit/jobs/audit-failed/cancel?databaseGeneration=23',
      { method: 'POST' },
    );
    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
