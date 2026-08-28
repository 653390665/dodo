import React from 'react';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listNovels: vi.fn(),
  deleteNovel: vi.fn(),
  listChaptersMetadata: vi.fn(),
  listContinuationPacks: vi.fn(),
  callBatch: vi.fn(),
  subscribeToChanges: vi.fn((_callback: () => void) => () => {}),
}));

vi.mock('../lib/novel-client', () => ({ listNovels: mocks.listNovels, createNovel: vi.fn(), deleteNovel: mocks.deleteNovel }));
vi.mock('../lib/chapter-client', () => ({ createChapter: vi.fn(), listChapters: vi.fn(), listChaptersMetadata: mocks.listChaptersMetadata }));
vi.mock('../lib/continuation-client', () => ({ listContinuationPacks: mocks.listContinuationPacks }));
vi.mock('../lib/db-transport', () => ({ callBatch: mocks.callBatch, subscribeToChanges: mocks.subscribeToChanges }));
vi.mock('../lib/client-logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import { Library } from '../components/Library';

const novel = (id: string) => ({ id, title: `作品 ${id}`, authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });

describe('Library metadata refresh', () => {
  beforeEach(() => {
    // Keep the legacy-server fallback explicit for existing refresh/race cases.
    mocks.callBatch.mockReset();
    mocks.callBatch.mockRejectedValue(new Error('batch metadata unsupported'));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  test('does not let a delayed delete refresh overwrite an SSE refresh', async () => {
    let notify: (() => void) | undefined;
    let resolveDeleteList!: (value: unknown[]) => void;
    const oldNovel = novel('old');
    const freshNovel = novel('fresh');
    mocks.subscribeToChanges.mockImplementation((callback: () => void) => { notify = callback; return () => {}; });
    mocks.listNovels
      .mockResolvedValueOnce([oldNovel])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveDeleteList = resolve; }))
      .mockResolvedValueOnce([freshNovel]);
    mocks.deleteNovel.mockResolvedValue(undefined);
    mocks.listChaptersMetadata.mockResolvedValue([]);
    mocks.listContinuationPacks.mockResolvedValue([]);

    render(<Library userId="local" onSelectNovel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('作品 old')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: '删除《作品 old》' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(mocks.deleteNovel).toHaveBeenCalledWith('old'));
    await waitFor(() => expect(mocks.listNovels).toHaveBeenCalledTimes(2));

    await act(async () => { notify?.(); });
    await waitFor(() => expect(screen.getByText('作品 fresh')).toBeDefined());

    await act(async () => { resolveDeleteList([oldNovel]); });
    expect(screen.queryByText('作品 old')).toBeNull();
    expect(screen.getByText('作品 fresh')).toBeDefined();
  });

  test('does not close selection mode when delete metadata becomes stale', async () => {
    let notify: (() => void) | undefined;
    let resolveDeleteChapter!: (value: unknown[]) => void;
    let resolveDeletePack!: (value: unknown[]) => void;
    const oldNovel = novel('old');
    const freshNovel = novel('fresh');
    let chapterCall = 0;
    let packCall = 0;
    mocks.subscribeToChanges.mockImplementation((callback: () => void) => { notify = callback; return () => {}; });
    mocks.listNovels
      .mockResolvedValueOnce([oldNovel])
      .mockResolvedValueOnce([oldNovel])
      .mockResolvedValueOnce([freshNovel]);
    mocks.deleteNovel.mockResolvedValue(undefined);
    mocks.listChaptersMetadata.mockImplementation(() => {
      chapterCall += 1;
      return chapterCall === 2
        ? new Promise((resolve) => { resolveDeleteChapter = resolve; })
        : Promise.resolve([]);
    });
    mocks.listContinuationPacks.mockImplementation(() => {
      packCall += 1;
      return packCall === 2
        ? new Promise((resolve) => { resolveDeletePack = resolve; })
        : Promise.resolve([]);
    });

    render(<Library userId="local" onSelectNovel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('作品 old')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '批量管理' }));
    fireEvent.click(screen.getByRole('button', { name: '选择此书' }));
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(chapterCall).toBe(2));

    await act(async () => { notify?.(); });
    await waitFor(() => {
      expect(screen.getByText('作品 fresh')).toBeDefined();
      expect(chapterCall).toBe(3);
      expect(packCall).toBe(3);
    });

    await act(async () => {
      resolveDeleteChapter([]);
      resolveDeletePack([]);
    });
    expect(screen.getByRole('button', { name: '退出' })).toBeDefined();
  });

  test.each([10, 50, 100])('falls back to two metadata requests per %i novels on older servers', async (count) => {
    const novels = Array.from({ length: count }, (_, index) => novel(String(index)));
    let serializedBytes = 0;
    mocks.listNovels.mockResolvedValue(novels);
    mocks.listChaptersMetadata.mockImplementation(async () => {
      const value = [{ id: 'chapter', title: '章节', order: 1 }];
      serializedBytes += JSON.stringify(value).length;
      return value;
    });
    mocks.listContinuationPacks.mockImplementation(async () => {
      const value = [{ id: 'pack', title: '资料包' }];
      serializedBytes += JSON.stringify(value).length;
      return value;
    });
    render(<Library userId="local" onSelectNovel={vi.fn()} />);
    await waitFor(() => {
      expect(mocks.listChaptersMetadata).toHaveBeenCalledTimes(count);
      expect(mocks.listContinuationPacks).toHaveBeenCalledTimes(count);
      expect(screen.getAllByText('章节总数:')).toHaveLength(count);
    });
    const measurement = { novels: count, requests: count * 2, serializedBytes };
    console.info('library measurement', measurement);
    expect(measurement.requests).toBe(count * 2);
    const expectedBytesPerNovel = JSON.stringify([{ id: 'chapter', title: '章节', order: 1 }]).length
      + JSON.stringify([{ id: 'pack', title: '资料包' }]).length;
    expect(measurement.serializedBytes).toBe(count * expectedBytesPerNovel);
  });

  test('loads all library metadata through one batch request when supported', async () => {
    const novels = Array.from({ length: 100 }, (_, index) => novel(String(index)));
    const chapters = Object.fromEntries(novels.map((item) => [item.id, [{ id: `${item.id}-chapter`, title: '章节', order: 1 }]]));
    const packs = Object.fromEntries(novels.map((item) => [item.id, [{ id: `${item.id}-pack`, title: '资料包' }]]));
    mocks.listNovels.mockResolvedValue(novels);
    mocks.callBatch.mockResolvedValue({ chapters, packs });

    render(<Library userId="local" onSelectNovel={vi.fn()} />);

    await waitFor(() => {
      expect(mocks.callBatch).toHaveBeenCalledTimes(1);
      expect(screen.getAllByText('章节总数:')).toHaveLength(novels.length);
    });
    expect(mocks.callBatch).toHaveBeenCalledWith('listLibraryMetadata', novels.map((item) => item.id));
    expect(mocks.listChaptersMetadata).not.toHaveBeenCalled();
    expect(mocks.listContinuationPacks).not.toHaveBeenCalled();
    expect(screen.getAllByText(/包: .*资料包/)).toHaveLength(novels.length);
  });

  test('does not commit late metadata after a newer refresh', async () => {
    let notify: (() => void) | undefined;
    mocks.subscribeToChanges.mockImplementation((callback: () => void) => { notify = callback; return () => {}; });
    const sameNovel = novel('same');
    let resolveFirstChapter!: (value: unknown[]) => void;
    let resolveFirstPack!: (value: unknown[]) => void;
    let chapterCall = 0;
    let packCall = 0;
    mocks.listNovels.mockResolvedValue([sameNovel]);
    mocks.listChaptersMetadata.mockImplementation(() => {
      chapterCall += 1;
      return chapterCall === 1
        ? new Promise((resolve) => { resolveFirstChapter = resolve; })
        : Promise.resolve([
            { id: 'new-chapter-1', title: '新章节', order: 1, updatedAt: 1 },
            { id: 'new-chapter-2', title: '新章节（最新）', order: 2, updatedAt: 2 },
          ]);
    });
    mocks.listContinuationPacks.mockImplementation(() => {
      packCall += 1;
      return packCall === 1
        ? new Promise((resolve) => { resolveFirstPack = resolve; })
        : Promise.resolve([{ id: 'new-pack', title: '新资料包', createdAt: 2 }]);
    });
    render(<Library userId="local" onSelectNovel={vi.fn()} />);
    await waitFor(() => {
      expect(chapterCall).toBe(1);
      expect(packCall).toBe(1);
    });
    expect(notify).toBeTypeOf('function');
    await act(async () => { notify?.(); });
    await waitFor(() => {
      expect(chapterCall).toBe(2);
      expect(packCall).toBe(2);
    });
    await waitFor(() => expect(screen.getByText('新章节（最新）')).toBeDefined());
    expect(screen.getByText('章节总数:').parentElement?.textContent).toContain('2 章');
    expect(screen.getByText(/新资料包/)).toBeDefined();
    await act(async () => {
      resolveFirstChapter([{ id: 'old-chapter', title: '旧章节', order: 1, updatedAt: 1 }]);
      resolveFirstPack([{ id: 'old-pack', title: '旧资料包', createdAt: 1 }]);
    });
    expect(screen.queryByText('旧章节')).toBeNull();
    expect(screen.queryByText(/旧资料包/)).toBeNull();
    expect(screen.getByText('章节总数:').parentElement?.textContent).toContain('2 章');
    expect(screen.getByText('新章节（最新）')).toBeDefined();
    expect(screen.getByText(/新资料包/)).toBeDefined();
  });

  test('shows retryable error and keeps cached metadata when refresh fails', async () => {
    let notify: (() => void) | undefined;
    mocks.subscribeToChanges.mockImplementation((callback: () => void) => { notify = callback; return () => {}; });
    mocks.listNovels.mockResolvedValue([novel('one')]);
    mocks.listChaptersMetadata
      .mockResolvedValueOnce([{ id: 'old', title: '旧章节', order: 1 }])
      .mockRejectedValueOnce(new Error('offline'));
    mocks.listContinuationPacks
      .mockResolvedValueOnce([{ id: 'old-pack', title: '旧资料包', createdAt: 1, sourceDocuments: [] }])
      .mockRejectedValueOnce(new Error('offline'));
    render(<Library userId="local" onSelectNovel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('旧章节')).toBeDefined());
    expect(screen.getByText(/包: 旧资料包/)).toBeDefined();
    notify?.();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('保留上次数据'));
    expect(screen.getByText('章节总数:').parentElement?.textContent).toContain('1 章');
    expect(screen.getByText('旧章节')).toBeDefined();
    expect(screen.getByText(/包: 旧资料包/)).toBeDefined();
    expect(screen.getByRole('button', { name: '重试刷新' })).toBeDefined();
  });

  test('does not commit metadata after unmount', async () => {
    let resolveMetadata!: (value: unknown[]) => void;
    const unsubscribe = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.subscribeToChanges.mockImplementation(() => unsubscribe);
    mocks.listNovels.mockResolvedValue([novel('one')]);
    mocks.listChaptersMetadata.mockImplementation(() => new Promise((resolve) => { resolveMetadata = resolve; }));
    mocks.listContinuationPacks.mockResolvedValue([]);
    const view = render(<Library userId="local" onSelectNovel={vi.fn()} />);
    await waitFor(() => expect(mocks.listChaptersMetadata).toHaveBeenCalled());
    await act(async () => {
      view.unmount();
      resolveMetadata([{ id: 'late', title: '卸载后章节', order: 1 }]);
      await Promise.resolve();
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
    expect(screen.queryByText('卸载后章节')).toBeNull();
    consoleError.mockRestore();
  });

  test('counts v3 project deck cards in readiness chips', async () => {
    mocks.listNovels.mockResolvedValue([{
      ...novel('v3'),
      mountedSkillIds: [],
      projectPreferenceProfile: {
        capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          projectSkillDeck: {
            mainCardId: 'main-card',
            supportCardIds: ['support-one', 'support-two'],
            updatedAt: 1,
          },
          favoriteTechniqueIds: [],
        },
      },
    }]);
    mocks.listChaptersMetadata.mockResolvedValue([]);
    mocks.listContinuationPacks.mockResolvedValue([]);

    render(<Library userId="local" onSelectNovel={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('能力卡 3/3')).toBeDefined());
    expect(screen.queryByText('能力卡 0/3')).toBeNull();
  });
});
