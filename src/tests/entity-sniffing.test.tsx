import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Chapter, Character } from '../../shared/types';

const { startWorldJob } = vi.hoisted(() => ({ startWorldJob: vi.fn() }));
vi.mock('../lib/world-job-client', () => ({ startWorldJob }));
vi.mock('../lib/world-client', () => ({ createCharacter: vi.fn(), createItem: vi.fn(), createLocation: vi.fn() }));

import { useEntitySniffing } from '../lib/hooks/useEntitySniffing';

describe('useEntitySniffing', () => {
  beforeEach(() => {
    startWorldJob.mockReset();
    startWorldJob.mockResolvedValue({ result: { activeExisting: [], newEntities: [] }, databaseGeneration: 1 });
  });

  test('同一章节内容与实体名称重复触发在节流窗口内只发一次请求', async () => {
    const chapter = { id: 'ch-1', sceneBeats: '分镜', content: '正文' } as Chapter;
    const { result, rerender } = renderHook(({ currentChapter, characters }: { currentChapter: Chapter; characters: Character[] }) => useEntitySniffing({
      novelId: 'novel-1', currentChapter, characters, locations: [], items: [],
    }), { initialProps: { currentChapter: chapter, characters: [{ name: '主角' } as Character] } });

    await act(async () => { await result.current.handleSniffEntities(); });
    rerender({ currentChapter: { ...chapter }, characters: [{ name: '主角', updatedAt: 2 } as Character] });
    await act(async () => { await result.current.handleSniffEntities(); });

    expect(startWorldJob).toHaveBeenCalledTimes(1);
    expect(startWorldJob).toHaveBeenCalledWith(
      '/api/extract-entities',
      expect.objectContaining({ text: '分镜\n正文', existingNames: ['主角'] }),
      {},
      expect.any(AbortSignal),
    );
  });
});
