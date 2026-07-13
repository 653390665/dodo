import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Chapter, Novel } from '../../shared/types';

const client = vi.hoisted(() => ({
  createChapter: vi.fn(),
  createChapterVersion: vi.fn(),
  deleteChapter: vi.fn(),
  listChaptersMetadata: vi.fn(),
  updateChapter: vi.fn(),
  updateNovel: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../lib/chapter-client', () => ({
  createChapter: client.createChapter,
  createChapterVersion: client.createChapterVersion,
  deleteChapter: client.deleteChapter,
  listChaptersMetadata: client.listChaptersMetadata,
  updateChapter: client.updateChapter,
}));
vi.mock('../lib/novel-client', () => ({ updateNovel: client.updateNovel }));
vi.mock('../lib/toast', () => ({ toast: client.toast }));

import { __editorWriteQueueTestHooks, hasPendingEditorWrites } from '../lib/editor-write-queue';
import { useEditorPersistence } from '../lib/hooks/useEditorPersistence';

const novel: Novel = {
  id: 'novel-1', title: '测试作品', authorId: 'local-user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1,
};
const chapter: Chapter = {
  id: 'chapter-1', novelId: novel.id, title: '第一章', volumeName: '正文卷', content: '原文', sceneBeats: '',
  order: 1, wordCount: 2, createdAt: 1, updatedAt: 1,
};

function setup(currentChapter: Chapter | null = chapter, chapters = currentChapter ? [currentChapter] : []) {
  const setChapters = vi.fn();
  const setCurrentChapter = vi.fn();
  const hook = renderHook(() => useEditorPersistence({
    novel,
    chapters,
    currentChapter,
    isContentLockedRef: { current: false },
    contentRef: { current: null },
    setChapters,
    setCurrentChapter,
    setMountedSkillLoadout: vi.fn(),
    setProjectPreferenceProfile: vi.fn(),
    setGlobalOutline: vi.fn(),
    setExpandedVolumes: vi.fn(),
    pushToUndoHistory: vi.fn(),
  }));
  return { ...hook, setChapters, setCurrentChapter };
}

describe('useEditorPersistence safety boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __editorWriteQueueTestHooks.reset();
    Object.values(client).forEach((mock) => mock.mockReset());
    client.updateChapter.mockResolvedValue(true);
    client.deleteChapter.mockResolvedValue(true);
    client.updateNovel.mockResolvedValue(undefined);
  });

  afterEach(() => {
    __editorWriteQueueTestHooks.reset();
    vi.useRealTimers();
  });

  test('does not add or select a ghost chapter when creation fails', async () => {
    client.createChapter.mockRejectedValue(new Error('disk full'));
    const { result, setChapters, setCurrentChapter } = setup();

    await act(() => result.current.handleAddChapter());

    expect(setChapters).not.toHaveBeenCalled();
    expect(setCurrentChapter).not.toHaveBeenCalled();
    expect(client.toast).toHaveBeenCalledWith('创建章节失败，请稍后重试', 'error');
  });

  test('adds and selects a chapter only after createChapter resolves', async () => {
    let release!: () => void;
    client.createChapter.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const { result, setChapters, setCurrentChapter } = setup();

    let creating!: Promise<void>;
    act(() => {
      creating = result.current.handleAddChapter();
    });
    for (let i = 0; i < 5 && !release; i += 1) await Promise.resolve();
    expect(setChapters).not.toHaveBeenCalled();
    expect(setCurrentChapter).not.toHaveBeenCalled();
    await act(async () => {
      release();
      await creating;
    });

    expect(setChapters).toHaveBeenCalledTimes(1);
    expect(setCurrentChapter).toHaveBeenCalledTimes(1);
  });

  test('a missing-row save remains pending and later typing never shows synced', async () => {
    client.updateChapter.mockResolvedValue(false);
    const { result } = setup();

    act(() => result.current.handleUpdateContent('第一次输入'));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.syncSuccess).toBe(false);
    expect(hasPendingEditorWrites()).toBe(true);

    act(() => result.current.handleUpdateContent('第二次输入'));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.syncSuccess).toBe(false);
    expect(hasPendingEditorWrites()).toBe(true);
  });

  test('flushes all five editor fields through their real persistence handlers before one second', async () => {
    const { result } = setup();
    act(() => {
      result.current.handleUpdateContent('新正文');
      result.current.handleUpdateChapterBeats('新分镜');
      result.current.handleUpdateGlobalOutline('新大纲');
      result.current.handleTitleChange('新标题');
      result.current.handleVolumeNameChange('新卷名');
    });

    await act(() => result.current.flushPendingEditorWrites());

    expect(client.updateChapter).toHaveBeenCalledWith(chapter.id, expect.objectContaining({ content: '新正文' }));
    expect(client.updateChapter).toHaveBeenCalledWith(chapter.id, { sceneBeats: '新分镜' });
    expect(client.updateChapter).toHaveBeenCalledWith(chapter.id, { title: '新标题' });
    expect(client.updateChapter).toHaveBeenCalledWith(chapter.id, { volumeName: '新卷名' });
    expect(client.updateNovel).toHaveBeenCalledWith(novel.id, { globalOutline: '新大纲' });
    expect(hasPendingEditorWrites()).toBe(false);
  });
});
