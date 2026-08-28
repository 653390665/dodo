import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Chapter, Novel } from '../../shared/types';

const mocks = vi.hoisted(() => ({
  editorAgentPhase: vi.fn(),
  buildContextPrompt: vi.fn(() => 'context'),
  createChapterVersion: vi.fn(),
  updateChapter: vi.fn(),
}));

vi.mock('../lib/agents', () => ({
  editorAgentPhase: mocks.editorAgentPhase,
  buildContextPrompt: mocks.buildContextPrompt,
}));
vi.mock('../lib/chapter-client', () => ({
  createChapterVersion: mocks.createChapterVersion,
  updateChapter: mocks.updateChapter,
}));

import { useDraftGeneration } from '../lib/hooks/generation/useDraftGeneration';

const novel: Novel = {
  id: 'novel-1', title: 'Novel', authorId: 'user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1,
};
const chapter: Chapter = {
  id: 'chapter-1', novelId: novel.id, title: 'Chapter', content: 'baseline', sceneBeats: 'beats',
  order: 1, wordCount: 8, createdAt: 1, updatedAt: 1,
};
const generatedDraft = Array.from({ length: 40 }, (_, index) => [
  `生成场景${index + 1}从一声门响开始，林舟先确认水痕方向，再把手从桌沿收回。`,
  '对方的停顿托住了下一句对白，灯影沿着地面移动，逼得两人的站位同时改变。',
  '他将线索压回袖中，听见远处锁舌回应，局势因此向门外又推进一步。',
  '雨声盖住半句话，留下的空白反而指向更近的危险。',
].join('')).join('\n\n');

function setup(flushPendingEditorWrites: () => Promise<void>, sessionCardIds?: string[]) {
  const setCurrentChapter = vi.fn();
  const setAiActionState = vi.fn();
  const setCandidate = vi.fn();
  const recordSkillUsage = vi.fn().mockResolvedValue(undefined);
  const props = {
    novel,
    currentChapter: chapter,
    mountedSkills: [],
    userIntent: '',
    selectedContinuationPackId: '',
    sessionCardIds,
    contentRef: { current: { value: chapter.content } as HTMLTextAreaElement },
    draftPromptSurface: 'workspace-draft',
    requestSeqRef: { current: 0 },
    abortControllerRef: { current: null as AbortController | null },
    latestChapterIdRef: { current: chapter.id as string | null },
    isGeneratingContent: false,
    setIsGeneratingContent: vi.fn(),
    setIsGeneratingBeats: vi.fn(),
    setGenerationStatus: vi.fn(),
    setAiActionState,
    setCandidate,
    setUserIntent: vi.fn(),
    setCurrentChapter,
    buildAgentContext: vi.fn(() => ({} as never)),
    pushToUndoHistory: vi.fn(),
    getCurrentFitScore: vi.fn(() => 1),
    recordSkillUsage,
    formatAiFailure: vi.fn(() => 'generation failed'),
    flushPendingEditorWrites,
  };
  return { hook: renderHook(() => useDraftGeneration(props)), props, setCandidate };
}

describe('draft generation save and stream gates', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockClear());
    mocks.updateChapter.mockResolvedValue(true);
    vi.stubGlobal('alert', vi.fn());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  test('partial draft EOF restores the baseline and creates no success records', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/api/db/generation')
      ? Response.json({ databaseGeneration: 11 })
      : new Response(
        'data: {"type":"token","content":"partial"}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream', 'x-inkflow-database-generation': '11' } },
      )) as typeof fetch;
    const { hook, props } = setup(vi.fn().mockResolvedValue(undefined));

    await act(() => hook.result.current.handleGenerateContent());

    expect(mocks.updateChapter).not.toHaveBeenCalled();
    expect(mocks.createChapterVersion).not.toHaveBeenCalled();
    expect(props.recordSkillUsage).not.toHaveBeenCalled();
    expect(props.setCurrentChapter).toHaveBeenCalledWith(expect.any(Function));
    const runningState = props.setAiActionState.mock.calls[0]?.[0];
    const errorUpdater = props.setAiActionState.mock.calls[1]?.[0];
    expect(errorUpdater).toBeTypeOf('function');
    expect(errorUpdater(runningState)).toMatchObject({
      status: 'error', operation: 'draft', message: 'generation failed', retryable: true,
    });
    expect(alert).not.toHaveBeenCalled();
  });

  test('a failed editor flush prevents the model and fallback beats paths', async () => {
    const { hook, props } = setup(vi.fn().mockRejectedValue(new Error('disk full')));

    await act(() => hook.result.current.handleGenerateBeats());

    expect(mocks.editorAgentPhase).not.toHaveBeenCalled();
    expect(mocks.updateChapter).not.toHaveBeenCalled();
    const runningState = props.setAiActionState.mock.calls[0]?.[0];
    const errorUpdater = props.setAiActionState.mock.calls[1]?.[0];
    expect(errorUpdater).toBeTypeOf('function');
    expect(errorUpdater(runningState)).toMatchObject({
      status: 'error', operation: 'beats', message: 'generation failed', retryable: true,
    });
    expect(alert).not.toHaveBeenCalled();
  });

  test('scene beats use the starting generation and update UI only after persistence succeeds', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ databaseGeneration: 9 })) as typeof fetch;
    mocks.editorAgentPhase.mockResolvedValueOnce({ text: 'new beats', databaseGeneration: 9 });
    const { hook, props } = setup(vi.fn().mockResolvedValue(undefined));

    await act(() => hook.result.current.handleGenerateBeats());

    expect(mocks.editorAgentPhase).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      9,
      undefined,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(mocks.updateChapter).toHaveBeenCalledTimes(1);
    expect(mocks.updateChapter).toHaveBeenCalledWith(chapter.id, { sceneBeats: 'new beats' }, 9);
    expect(props.setCurrentChapter).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  test('guarded scene-beat persistence failure keeps the original and never attempts a client fallback', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ databaseGeneration: 10 })) as typeof fetch;
    mocks.editorAgentPhase.mockResolvedValueOnce({ text: 'stale beats', databaseGeneration: 10 });
    mocks.updateChapter.mockResolvedValueOnce(false);
    const { hook, props } = setup(vi.fn().mockResolvedValue(undefined));

    await act(() => hook.result.current.handleGenerateBeats());

    expect(mocks.updateChapter).toHaveBeenCalledTimes(1);
    expect(props.setCurrentChapter).toHaveBeenCalledTimes(1);
    const restore = props.setCurrentChapter.mock.calls[0][0] as (value: Chapter) => Chapter;
    expect(restore({ ...chapter, sceneBeats: chapter.sceneBeats })).toMatchObject({ sceneBeats: chapter.sceneBeats });
    const runningState = props.setAiActionState.mock.calls[0]?.[0];
    const errorUpdater = props.setAiActionState.mock.calls[1]?.[0];
    expect(errorUpdater).toBeTypeOf('function');
    expect(errorUpdater(runningState)).toMatchObject({
      status: 'error', operation: 'beats', message: 'generation failed', retryable: true,
    });
    expect(alert).not.toHaveBeenCalled();
  });

  test('editor-agent generation rejection does not create or persist an unbilled fallback', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ databaseGeneration: 12 })) as typeof fetch;
    mocks.editorAgentPhase.mockRejectedValueOnce(new Error('数据库已在分镜生成期间切换'));
    const { hook, props } = setup(vi.fn().mockResolvedValue(undefined));

    await act(() => hook.result.current.handleGenerateBeats());

    expect(mocks.updateChapter).not.toHaveBeenCalled();
    const runningState = props.setAiActionState.mock.calls[0]?.[0];
    const errorUpdater = props.setAiActionState.mock.calls[1]?.[0];
    expect(errorUpdater).toBeTypeOf('function');
    expect(errorUpdater(runningState)).toMatchObject({
      status: 'error', operation: 'beats', message: 'generation failed', retryable: true,
    });
    expect(alert).not.toHaveBeenCalled();
  });

  test('a stale scene-beat failure cannot overwrite the current AI action state', async () => {
    let rejectGeneration!: (error: Error) => void;
    globalThis.fetch = vi.fn(async () => Response.json({ databaseGeneration: 12 })) as typeof fetch;
    mocks.editorAgentPhase.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectGeneration = reject; }));
    const { hook, props } = setup(vi.fn().mockResolvedValue(undefined));

    const pending = hook.result.current.handleGenerateBeats();
    await Promise.resolve();
    props.requestSeqRef.current += 1;
    props.latestChapterIdRef.current = 'chapter-2';
    rejectGeneration(new Error('late provider failure'));
    await pending;

    expect(props.setAiActionState).toHaveBeenCalledTimes(1);
    expect(props.setAiActionState).toHaveBeenCalledWith(expect.objectContaining({ status: 'running', operation: 'beats' }));
    expect(alert).not.toHaveBeenCalled();
  });

  test('scene-beat persistence cannot update another chapter after the request becomes stale', async () => {
    let resolveSave!: (saved: boolean) => void;
    globalThis.fetch = vi.fn(async () => Response.json({ databaseGeneration: 12 })) as typeof fetch;
    mocks.editorAgentPhase.mockResolvedValueOnce({ text: 'chapter A beats', databaseGeneration: 12 });
    mocks.updateChapter.mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    const { hook, props } = setup(vi.fn().mockResolvedValue(undefined));

    const pending = hook.result.current.handleGenerateBeats();
    await vi.waitFor(() => expect(mocks.updateChapter).toHaveBeenCalledTimes(1));
    props.requestSeqRef.current += 1;
    props.latestChapterIdRef.current = 'chapter-2';
    resolveSave(true);
    await pending;

    expect(props.setCurrentChapter).not.toHaveBeenCalled();
    expect(props.setUserIntent).not.toHaveBeenCalled();
    expect(props.setAiActionState).toHaveBeenCalledTimes(1);
  });

  test('auxiliary version failure does not roll back an already committed draft', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/api/db/generation')
      ? Response.json({ databaseGeneration: 11 })
      : new Response(
        `data: ${JSON.stringify({ type: 'token', content: generatedDraft })}\n\ndata: ${JSON.stringify({ type: 'done', text: generatedDraft })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream', 'x-inkflow-database-generation': '11' } },
      )) as typeof fetch;
    mocks.createChapterVersion.mockRejectedValueOnce(new Error('version store failed'));
    const { hook, props, setCandidate } = setup(vi.fn().mockResolvedValue(undefined));

    await act(() => hook.result.current.handleGenerateContent());

    expect(setCandidate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'draft', content: `baseline\n\n${generatedDraft}` }));
    expect(mocks.updateChapter).not.toHaveBeenCalled();
    expect(mocks.createChapterVersion).not.toHaveBeenCalled();
    expect(props.recordSkillUsage).not.toHaveBeenCalled();
    expect(props.setGenerationStatus).toHaveBeenCalledWith('正文候选已生成，请接受后保存。');
    expect(alert).not.toHaveBeenCalled();
  });

  test('draft generation binds the request to the current chapter and database generation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/db/generation')) {
        return Response.json({ databaseGeneration: 17 });
      }
      return new Response(
        `data: ${JSON.stringify({ type: 'token', content: generatedDraft })}\n\ndata: ${JSON.stringify({ type: 'done', text: generatedDraft })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream', 'x-inkflow-database-generation': '17' } },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const { hook } = setup(vi.fn().mockResolvedValue(undefined), ['deconstruct-card-pacing']);

    await act(() => hook.result.current.handleGenerateContent());

    const draftCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/orchestrate-draft');
    expect(draftCall).toBeDefined();
    expect(JSON.parse(String(draftCall?.[1]?.body))).toMatchObject({
      novelId: novel.id,
      chapterId: chapter.id,
      databaseGeneration: 17,
      sessionCardIds: ['deconstruct-card-pacing'],
    });
  });
});
