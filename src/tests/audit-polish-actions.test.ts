import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Chapter, Novel } from '../../shared/types';

const chapterClientMocks = vi.hoisted(() => ({
  updateChapter: vi.fn(async () => true),
  createChapterVersion: vi.fn(async () => {}),
}));

const dbTransportMocks = vi.hoisted(() => ({
  getDatabaseGenerationSnapshot: vi.fn(async () => 7),
}));

vi.mock('../lib/chapter-client', () => chapterClientMocks);
vi.mock('../lib/db-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db-transport')>()),
  getDatabaseGenerationSnapshot: dbTransportMocks.getDatabaseGenerationSnapshot,
}));

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
  sessionCardIds?: string[];
  recordSkillUsage?: () => Promise<void>;
  flushPendingEditorWrites?: () => Promise<void>;
  onStyleConfirmationRequired?: (data: { retry?: (fingerprint: string) => Promise<void> }) => void;
} = {}) {
  const novel = makeNovel();
  const chapter = options.chapter ?? makeChapter();
  const requestSeqRef = { current: 0 };
  const latestChapterIdRef = { current: chapter.id as string | null };
  const abortControllerRef = { current: null as AbortController | null };
  const handleUpdateContent = vi.fn();
  const setCurrentChapter = vi.fn();
  const setAiActionState = vi.fn();
  const setCandidate = vi.fn();
  const contentElement = { value: chapter.content, selectionStart: 0, selectionEnd: 2 };
  const recordSkillUsage = vi.fn(options.recordSkillUsage ?? (async () => {}));
  const flushPendingEditorWrites = vi.fn(options.flushPendingEditorWrites ?? (async () => {}));

  const hook = renderHook(() => useAuditPolishActions({
    novel,
    currentChapter: chapter,
    mountedSkills: [],
    sessionCardIds: options.sessionCardIds,
    onStyleConfirmationRequired: options.onStyleConfirmationRequired,
    contentRef: { current: contentElement } as never,
    polishPromptSurface: 'chapter-polish',
    requestSeqRef,
    abortControllerRef,
    latestChapterIdRef,
    setIsGeneratingContent: vi.fn(),
    setIsGeneratingCritique: vi.fn(),
    setGenerationStatus: vi.fn(),
    setAuditStatus: vi.fn(),
    setAuditUnknownFeedback: vi.fn(),
    setAiActionState,
    setCandidate,
    setCurrentChapter,
    buildAgentContext: () => ({ novel, characters: [] }),
    handleUpdateContent,
    getCurrentFitScore: () => 80,
    recordSkillUsage,
    formatAiFailure: () => '审稿失败，请重试。',
    flushPendingEditorWrites,
  }));

  return {
    ...hook,
    chapter,
    requestSeqRef,
    latestChapterIdRef,
    handleUpdateContent,
    recordSkillUsage,
    setAiActionState,
    setCandidate,
    flushPendingEditorWrites,
    contentElement,
  };
}

describe('useAuditPolishActions rewrite persistence guards', () => {
  beforeEach(() => {
    chapterClientMocks.updateChapter.mockClear();
    chapterClientMocks.createChapterVersion.mockClear();
    dbTransportMocks.getDatabaseGenerationSnapshot.mockClear();
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
    const { result, handleUpdateContent, chapter, setAiActionState } = renderRewriteHook();

    await result.current.handleRewriteSelectedText();

    expect(handleUpdateContent).toHaveBeenLastCalledWith(chapter.content, false, true);
    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
    const runningState = setAiActionState.mock.calls[0]?.[0];
    const errorUpdater = setAiActionState.mock.calls[1]?.[0];
    expect(errorUpdater).toBeTypeOf('function');
    expect(errorUpdater(runningState)).toMatchObject({
      status: 'error', operation: 'rewrite', message: '改写流未正常结束，原文已恢复。', retryable: true,
    });
    expect(alert).not.toHaveBeenCalled();
  });

  test('a style-required rewrite can be resumed exactly once with the original instruction', async () => {
    let retry: ((fingerprint: string) => Promise<void>) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'STYLE_CONFIRMATION_REQUIRED', candidates: [] }, { status: 409 }))
      .mockResolvedValueOnce(sseResponse(['data: {"token":"新文"}\n\n', 'data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchMock);
    const { result, setAiActionState, setCandidate } = renderRewriteHook({
      onStyleConfirmationRequired: (data) => { retry = data.retry; },
    });

    await result.current.handleRewriteSelectedText();
    expect(retry).toBeTypeOf('function');
    expect(setAiActionState).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'idle' }));
    await retry?.('fp-confirmed');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      text: '原文',
      instruction: '润色',
      styleConfirmationFingerprint: 'fp-confirmed',
    });
    expect(setCandidate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'rewrite', content: '新文尾' }));
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

    expect(handleUpdateContent).not.toHaveBeenCalled();
    expect(handleUpdateContent).not.toHaveBeenCalledWith(chapter.content, false, true);
    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
    expect(chapterClientMocks.createChapterVersion).not.toHaveBeenCalled();
    expect(recordSkillUsage).not.toHaveBeenCalled();
  });

  test('a stale rewrite failure cannot overwrite the current AI action state', async () => {
    let rejectRewrite: ((error: Error) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((_resolve, reject) => { rejectRewrite = reject; })));
    const { result, requestSeqRef, latestChapterIdRef, setAiActionState } = renderRewriteHook();

    const pending = result.current.handleRewriteSelectedText();
    await vi.waitFor(() => expect(rejectRewrite).toBeTypeOf('function'));
    requestSeqRef.current += 1;
    latestChapterIdRef.current = 'chapter-2';
    rejectRewrite?.(new Error('late provider failure'));
    await pending;

    expect(setAiActionState).toHaveBeenCalledTimes(1);
    expect(setAiActionState).toHaveBeenCalledWith(expect.objectContaining({ status: 'running', operation: 'rewrite' }));
    expect(alert).not.toHaveBeenCalled();
  });

  test('author edits during rewrite invalidate the candidate without restoring over the edit', async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(async () => {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"token":"新文"}\n\n'));
          release = () => {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          };
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-InkFlow-Database-Generation': '7' } });
    }));
    const { result, contentElement, handleUpdateContent, setCandidate } = renderRewriteHook();

    const pending = result.current.handleRewriteSelectedText();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    contentElement.value = '作者刚刚改过的正文';
    release?.();
    await pending;

    expect(setCandidate).not.toHaveBeenCalled();
    expect(handleUpdateContent).not.toHaveBeenCalledWith('原文尾', false, true);
  });

  test('successful streaming previews use skipPersist and commit chapter content once', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => sseResponse([
      'data: {"token":"新"}\n\n',
      'data: {"token":"文"}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const { result, handleUpdateContent, chapter, setCandidate } = renderRewriteHook({
      sessionCardIds: ['deconstruct-card-pacing'],
    });

    await result.current.handleRewriteSelectedText();

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      chapterId: chapter.id,
      databaseGeneration: 7,
      sessionCardIds: ['deconstruct-card-pacing'],
    });

    expect(handleUpdateContent).not.toHaveBeenCalled();
    expect(setCandidate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'rewrite', content: '新文尾', baselineHash: expect.any(String) }));
    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
    expect(chapterClientMocks.createChapterVersion).not.toHaveBeenCalled();
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
    const { result, handleUpdateContent, setCandidate } = renderRewriteHook({
      chapter,
      sessionCardIds: ['deconstruct-card-pacing'],
      recordSkillUsage: async () => { throw new Error('telemetry unavailable'); },
    });

    await result.current.handlePolishChapterFromAudit();

    const rewriteCall = (fetch as unknown as { mock: { calls: [RequestInfo | URL, RequestInit?][] } }).mock.calls
      .find((call) => String(call[0]) === '/api/rewrite');
    expect(JSON.parse(String(rewriteCall?.[1]?.body))).toMatchObject({
      sessionCardIds: ['deconstruct-card-pacing'],
    });
    expect(handleUpdateContent).not.toHaveBeenCalled();
    expect(setCandidate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'polish', content: '他猛地扣住门框，挡住了对方去路。', reviewRecheck: true }));
    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
  });

  test('review issue preview returns a candidate without saving a version or chapter', async () => {
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
    const { result, handleUpdateContent } = renderRewriteHook({ chapter });

    const candidate = await result.current.handlePolishChapterFromAudit(undefined, {
      issueIds: ['review-issue-1'],
      previewOnly: true,
    });

    expect(candidate).toBe('他猛地扣住门框，挡住了对方去路。');
    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
    expect(chapterClientMocks.createChapterVersion).not.toHaveBeenCalled();
    expect(handleUpdateContent).not.toHaveBeenCalled();
  });

  test('style-required audit polish resumes once with confirmed fingerprint', async () => {
    const original = '他做出了明确反应，然后转身离去。';
    const chapter = {
      ...makeChapter(original),
      critique: `## 致命问题\n### 弱动作链\n> ${original} —— 动作表达过弱`,
    };
    let retry: ((fingerprint: string) => Promise<void>) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'STYLE_CONFIRMATION_REQUIRED', candidates: [] }, { status: 409 }))
      .mockResolvedValueOnce(sseResponse([
        'data: {"token":"他猛地扣住门框，"}\n\n',
        'data: {"token":"挡住了对方去路。"}\n\n',
        'data: [DONE]\n\n',
      ]));
    vi.stubGlobal('fetch', fetchMock);
    const { result, setCandidate } = renderRewriteHook({
      chapter,
      onStyleConfirmationRequired: (data) => { retry = data.retry; },
    });

    await result.current.handlePolishChapterFromAudit();
    expect(retry).toBeTypeOf('function');
    await retry?.('fp-confirmed');

    const rewriteCall = fetchMock.mock.calls.find((call) => String(call[0]) === '/api/rewrite' && String(call[1]?.body).includes('fp-confirmed'));
    expect(rewriteCall).toBeTruthy();
    expect(JSON.parse(String(rewriteCall?.[1]?.body))).toMatchObject({
      styleConfirmationFingerprint: 'fp-confirmed',
    });
    expect(setCandidate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'polish' }));
  });

  test('audit polling and critique persistence stay bound to the starting database generation', async () => {
    vi.useFakeTimers();
    dbTransportMocks.getDatabaseGenerationSnapshot.mockResolvedValueOnce(17);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ jobId: 'audit-1', databaseGeneration: 17 }))
      .mockResolvedValueOnce(Response.json({
        status: 'completed',
        progress: 100,
        result: { feedback: '完整审稿反馈', score: 88 },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const { result, chapter } = renderRewriteHook({
      sessionCardIds: ['deconstruct-card-pacing'],
    });

    const pending = result.current.handleRunAudit();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      await pending;
    });

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/audit/jobs/audit-1?databaseGeneration=17', {
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      chapterId: chapter.id,
      databaseGeneration: 17,
      sessionCardIds: ['deconstruct-card-pacing'],
    });
    expect(chapterClientMocks.updateChapter).toHaveBeenCalledWith(
      chapter.id,
      expect.objectContaining({
        critique: '完整审稿反馈',
        workflowMeta: expect.objectContaining({
          version: 1,
          lastAudit: expect.objectContaining({
            status: 'pass',
            source: 'model',
            contentHash: expect.any(String),
            completedAt: expect.any(Number),
          }),
        }),
      }),
      17,
    );
    vi.useRealTimers();
  });

  test('audit result is discarded when the author edits the chapter while polling', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ jobId: 'audit-stale', databaseGeneration: 7 }))
      .mockResolvedValueOnce(Response.json({ status: 'completed', progress: 100, result: { feedback: '旧审稿反馈', score: 88 } }));
    vi.stubGlobal('fetch', fetchMock);
    const { result, contentElement } = renderRewriteHook();

    const pending = result.current.handleRunAudit();
    await act(async () => { await Promise.resolve(); });
    contentElement.value = '作者在审稿期间修改了正文';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      await pending;
    });

    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test('audit polling failure cancels the incomplete generation-bound job', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ jobId: 'audit-failed', databaseGeneration: 23 }))
      .mockResolvedValueOnce(new Response('backend unavailable', { status: 502 }))
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderRewriteHook();

    const pending = result.current.handleRunAudit();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      await pending;
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/audit/jobs/audit-failed/cancel?databaseGeneration=23',
      { method: 'POST' },
    );
    expect(chapterClientMocks.updateChapter).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test('audit request failure uses retryable state without showing an alert', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('provider unavailable'); }));
    const { result, setAiActionState } = renderRewriteHook();

    await result.current.handleRunAudit();

    const runningState = setAiActionState.mock.calls[0]?.[0];
    const errorUpdater = setAiActionState.mock.calls[1]?.[0];
    expect(errorUpdater).toBeTypeOf('function');
    expect(errorUpdater(runningState)).toMatchObject({
      status: 'error',
      operation: 'audit',
      message: '审稿失败，请重试。',
      retryable: true,
    });
    expect(alert).not.toHaveBeenCalled();
  });
});
