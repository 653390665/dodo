import { renderHook } from '@testing-library/react';
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
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
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
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function renderRewriteHook(options: { chapter?: Chapter; recordSkillUsage?: () => Promise<void> } = {}) {
  const novel = makeNovel();
  const chapter = options.chapter ?? makeChapter();
  const requestSeqRef = { current: 0 };
  const latestChapterIdRef = { current: chapter.id as string | null };
  const abortControllerRef = { current: null as AbortController | null };
  const handleUpdateContent = vi.fn();
  const setCurrentChapter = vi.fn();
  const recordSkillUsage = vi.fn(options.recordSkillUsage ?? (async () => {}));

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
  }));

  return {
    ...hook,
    chapter,
    requestSeqRef,
    latestChapterIdRef,
    handleUpdateContent,
    recordSkillUsage,
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
    expect(chapterClientMocks.updateChapter).toHaveBeenCalledWith(chapter.id, expect.objectContaining({
      content: '新文尾',
    }));
  });

  test('successful audit polish commits content and critique together once despite telemetry failure', async () => {
    const original = '他做出了明确反应，然后转身离去。';
    const chapter = {
      ...makeChapter(original),
      critique: `## 致命问题\n### 弱动作链\n> ${original} —— 动作表达过弱`,
    };
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"token":"他猛地扣住门框，"}\n\n',
      'data: {"token":"挡住了对方去路。"}\n\n',
      'data: [DONE]\n\n',
    ])));
    const { result, handleUpdateContent } = renderRewriteHook({
      chapter,
      recordSkillUsage: async () => { throw new Error('telemetry unavailable'); },
    });

    await result.current.handlePolishChapterFromAudit();

    for (const call of handleUpdateContent.mock.calls) {
      expect(call[2]).toBe(true);
    }
    expect(chapterClientMocks.updateChapter).toHaveBeenCalledTimes(1);
    expect(chapterClientMocks.updateChapter).toHaveBeenCalledWith(chapter.id, expect.objectContaining({
      content: '他猛地扣住门框，挡住了对方去路。',
      critique: '',
    }));
  });
});
