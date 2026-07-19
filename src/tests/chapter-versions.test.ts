import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ChapterVersion } from '../../shared/types';

const clients = vi.hoisted(() => ({
  listChapterVersions: vi.fn(),
  subscribeToChanges: vi.fn(() => () => undefined),
}));

vi.mock('../lib/chapter-client', () => ({ listChapterVersions: clients.listChapterVersions }));
vi.mock('../lib/db-transport', () => ({ subscribeToChanges: clients.subscribeToChanges }));

import { useChapterVersions } from '../lib/hooks/useChapterVersions';

function version(chapterId: string): ChapterVersion {
  return {
    id: `version-${chapterId}`,
    chapterId,
    content: chapterId,
    wordCount: chapterId.length,
    author: 'user',
    createdAt: 1,
  };
}

describe('useChapterVersions request isolation', () => {
  beforeEach(() => {
    clients.listChapterVersions.mockReset();
    clients.subscribeToChanges.mockClear();
  });

  test('a late chapter A response cannot overwrite chapter B versions', async () => {
    let resolveA!: (versions: ChapterVersion[]) => void;
    let resolveB!: (versions: ChapterVersion[]) => void;
    clients.listChapterVersions.mockImplementation((chapterId: string) => new Promise<ChapterVersion[]>((resolve) => {
      if (chapterId === 'A') resolveA = resolve;
      else resolveB = resolve;
    }));

    const hook = renderHook(({ chapterId }) => useChapterVersions(chapterId), {
      initialProps: { chapterId: 'A' },
    });
    hook.rerender({ chapterId: 'B' });

    await act(async () => { resolveB([version('B')]); });
    await waitFor(() => expect(hook.result.current.versions).toEqual([version('B')]));

    await act(async () => { resolveA([version('A')]); });
    expect(hook.result.current.versions).toEqual([version('B')]);
  });
});
