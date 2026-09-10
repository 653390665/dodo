import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ChapterVersionMeta } from '../lib/chapter-client';

const clients = vi.hoisted(() => ({
  listChapterVersionMetas: vi.fn(),
  subscribeToChanges: vi.fn(() => () => undefined),
}));

vi.mock('../lib/chapter-client', () => ({ listChapterVersionMetas: clients.listChapterVersionMetas }));
vi.mock('../lib/db-transport', () => ({ subscribeToChanges: clients.subscribeToChanges }));

import { useChapterVersions } from '../lib/hooks/useChapterVersions';

function versionMeta(chapterId: string): ChapterVersionMeta {
  return {
    id: `version-${chapterId}`,
    wordCount: chapterId.length,
    author: 'user',
    createdAt: 1,
    preview: chapterId,
  };
}

describe('useChapterVersions request isolation', () => {
  beforeEach(() => {
    clients.listChapterVersionMetas.mockReset();
    clients.subscribeToChanges.mockClear();
  });

  test('a late chapter A response cannot overwrite chapter B versions', async () => {
    let resolveA!: (versions: ChapterVersionMeta[]) => void;
    let resolveB!: (versions: ChapterVersionMeta[]) => void;
    clients.listChapterVersionMetas.mockImplementation((chapterId: string) => new Promise<ChapterVersionMeta[]>((resolve) => {
      if (chapterId === 'A') resolveA = resolve;
      else resolveB = resolve;
    }));

    const hook = renderHook(({ chapterId }) => useChapterVersions(chapterId), {
      initialProps: { chapterId: 'A' },
    });
    hook.rerender({ chapterId: 'B' });

    await act(async () => { resolveB([versionMeta('B')]); });
    await waitFor(() => expect(hook.result.current.versions).toEqual([versionMeta('B')]));

    await act(async () => { resolveA([versionMeta('A')]); });
    expect(hook.result.current.versions).toEqual([versionMeta('B')]);
  });
});
