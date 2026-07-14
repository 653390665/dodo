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

function setup(flushPendingEditorWrites: () => Promise<void>) {
  const setCurrentChapter = vi.fn();
  const recordSkillUsage = vi.fn().mockResolvedValue(undefined);
  const props = {
    novel,
    currentChapter: chapter,
    mountedSkills: [],
    userIntent: '',
    selectedContinuationPackId: '',
    contentRef: { current: { value: chapter.content } as HTMLTextAreaElement },
    draftPromptSurface: 'workspace-draft',
    requestSeqRef: { current: 0 },
    abortControllerRef: { current: null as AbortController | null },
    latestChapterIdRef: { current: chapter.id as string | null },
    isGeneratingContent: false,
    setIsGeneratingContent: vi.fn(),
    setIsGeneratingBeats: vi.fn(),
    setGenerationStatus: vi.fn(),
    setUserIntent: vi.fn(),
    setCurrentChapter,
    buildAgentContext: vi.fn(() => ({} as never)),
    pushToUndoHistory: vi.fn(),
    getCurrentFitScore: vi.fn(() => 1),
    recordSkillUsage,
    formatAiFailure: vi.fn(() => 'generation failed'),
    flushPendingEditorWrites,
  };
  return { hook: renderHook(() => useDraftGeneration(props)), props };
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
    globalThis.fetch = vi.fn(async () => new Response(
      'data: {"type":"token","content":"partial"}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )) as typeof fetch;
    const { hook, props } = setup(vi.fn().mockResolvedValue(undefined));

    await act(() => hook.result.current.handleGenerateContent());

    expect(mocks.updateChapter).not.toHaveBeenCalled();
    expect(mocks.createChapterVersion).not.toHaveBeenCalled();
    expect(props.recordSkillUsage).not.toHaveBeenCalled();
    expect(props.setCurrentChapter).toHaveBeenCalledWith(expect.any(Function));
    expect(alert).toHaveBeenCalledWith('generation failed');
  });

  test('a failed editor flush prevents the model and fallback beats paths', async () => {
    const { hook } = setup(vi.fn().mockRejectedValue(new Error('disk full')));

    await act(() => hook.result.current.handleGenerateBeats());

    expect(mocks.editorAgentPhase).not.toHaveBeenCalled();
    expect(mocks.updateChapter).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('正文保存失败'));
  });

  test('auxiliary version failure does not roll back an already committed draft', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      'data: {"type":"token","content":"generated"}\n\ndata: {"type":"done","text":"generated"}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )) as typeof fetch;
    mocks.createChapterVersion.mockRejectedValueOnce(new Error('version store failed'));
    const { hook, props } = setup(vi.fn().mockResolvedValue(undefined));

    await act(() => hook.result.current.handleGenerateContent());

    expect(mocks.updateChapter).toHaveBeenCalledWith(chapter.id, expect.objectContaining({ content: 'baseline\n\ngenerated' }));
    expect(props.recordSkillUsage).toHaveBeenCalledTimes(1);
    expect(props.setGenerationStatus).toHaveBeenCalledWith('正文已生成到主编辑器。');
    expect(alert).not.toHaveBeenCalled();
  });
});
