import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Chapter, Novel } from '../../shared/types';

const api = vi.hoisted(() => ({
  listChaptersMetadata: vi.fn(),
  getChapter: vi.fn(),
  listCharacters: vi.fn(),
  listLocations: vi.fn(),
  listItems: vi.fn(),
  listFactions: vi.fn(),
  listPowerLevels: vi.fn(),
  listTimelineEvents: vi.fn(),
  syncSkillFeedbackScores: vi.fn(),
  listSkillUsageRecords: vi.fn(),
  getNovel: vi.fn(),
  subscribeToChanges: vi.fn(),
  listEntityRelationshipsClient: vi.fn(),
}));

vi.mock('../lib/api', () => api);

import { useEditorData } from '../lib/hooks/useEditorData';

const novel: Novel = {
  id: 'novel-1',
  title: '测试作品',
  authorId: 'local-user',
  summary: '',
  status: 'ongoing',
  createdAt: 1,
  updatedAt: 1,
};

function chapter(id: string, content: string): Chapter {
  return {
    id,
    novelId: novel.id,
    title: `章节 ${id}`,
    volumeName: '正文卷',
    content,
    sceneBeats: `分镜 ${id}`,
    critique: `审查 ${id}`,
    order: id === 'a' ? 1 : 2,
    wordCount: content.length,
    createdAt: 1,
    updatedAt: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('useEditorData full chapter loading', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.listChaptersMetadata.mockResolvedValue([chapter('a', '数据库完整正文')]);
    api.getChapter.mockResolvedValue(chapter('a', '数据库完整正文'));
    api.getNovel.mockResolvedValue(novel);
    api.listCharacters.mockResolvedValue([]);
    api.listLocations.mockResolvedValue([]);
    api.listItems.mockResolvedValue([]);
    api.listFactions.mockResolvedValue([]);
    api.listPowerLevels.mockResolvedValue([]);
    api.listTimelineEvents.mockResolvedValue([]);
    api.syncSkillFeedbackScores.mockResolvedValue([]);
    api.listSkillUsageRecords.mockResolvedValue([]);
    api.listEntityRelationshipsClient.mockResolvedValue([]);
    api.subscribeToChanges.mockReturnValue(() => {});
  });

  test('loads the complete persisted chapter instead of metadata placeholders', async () => {
    const { result } = renderHook(() => useEditorData(novel.id));

    await waitFor(() => expect(result.current.currentChapter?.content).toBe('数据库完整正文'));
    expect(result.current.currentChapter?.sceneBeats).toBe('分镜 a');
    expect(result.current.currentChapter?.critique).toBe('审查 a');
    expect(api.getChapter).toHaveBeenCalledWith('a');
  });

  test('A → B → A ignores a late B response', async () => {
    const { result } = renderHook(() => useEditorData(novel.id));
    await waitFor(() => expect(result.current.currentChapter?.id).toBe('a'));

    const slowB = deferred<Chapter | undefined>();
    const latestA = deferred<Chapter | undefined>();
    api.getChapter
      .mockImplementationOnce(() => slowB.promise)
      .mockImplementationOnce(() => latestA.promise);

    let loadB!: Promise<Chapter | null>;
    let loadA!: Promise<Chapter | null>;
    act(() => {
      loadB = result.current.selectChapter('b');
      loadA = result.current.selectChapter('a');
    });

    await act(async () => latestA.resolve(chapter('a', 'A 的最新正文')));
    await loadA;
    expect(result.current.currentChapter?.content).toBe('A 的最新正文');

    await act(async () => slowB.resolve(chapter('b', '迟到的 B 正文')));
    await loadB;
    expect(result.current.currentChapter?.id).toBe('a');
    expect(result.current.currentChapter?.content).toBe('A 的最新正文');
  });

  test('clears the editable chapter while a full chapter is loading', async () => {
    const { result } = renderHook(() => useEditorData(novel.id));
    await waitFor(() => expect(result.current.currentChapter?.id).toBe('a'));

    const slowB = deferred<Chapter | undefined>();
    api.getChapter.mockImplementationOnce(() => slowB.promise);

    let loading!: Promise<Chapter | null>;
    act(() => { loading = result.current.selectChapter('b'); });
    expect(result.current.chapterLoading).toBe(true);
    expect(result.current.currentChapter).toBeNull();

    await act(async () => slowB.resolve(chapter('b', 'B 正文')));
    await loading;
    expect(result.current.currentChapter?.content).toBe('B 正文');
  });

  test('auxiliary data failure does not block the chapter', async () => {
    api.listCharacters.mockRejectedValue(new Error('character service unavailable'));
    const { result } = renderHook(() => useEditorData(novel.id));

    await waitFor(() => expect(result.current.currentChapter?.content).toBe('数据库完整正文'));
    expect(result.current.isLoading).toBe(false);
  });
});
