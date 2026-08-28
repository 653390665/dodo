import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockListPacks = vi.fn();
const mockStartWriting = vi.fn();

vi.mock('../lib/world-client', () => {
  const empty = () => Promise.resolve([]);
  return {
    listCharacters: empty, listLocations: empty, listItems: empty, listTimelineEvents: empty,
    listFactions: empty, listPowerLevels: empty, listEntityRelationshipsClient: empty,
    createCharacter: empty, updateCharacter: empty, deleteCharacter: empty,
    createLocation: empty, updateLocation: empty, deleteLocation: empty,
    createItem: empty, updateItem: empty, deleteItem: empty,
    createFaction: empty, updateFaction: empty, deleteFaction: empty,
    createPowerLevel: empty, updatePowerLevel: empty, deletePowerLevel: empty,
    createTimelineEvent: empty, updateTimelineEvent: empty, deleteTimelineEvent: empty,
    importWorldExtraction: empty,
  };
});
vi.mock('../lib/continuation-client', () => ({ listContinuationPacks: (...args: unknown[]) => mockListPacks(...args) }));
vi.mock('../lib/novel-client', () => ({ getNovel: vi.fn(async () => novel), updateNovel: vi.fn() }));
vi.mock('../lib/db-transport', () => ({
  call: vi.fn(async (method: string) => method === 'listChaptersMetadata' ? [] : undefined),
  getDatabaseGenerationSnapshot: vi.fn(async () => 7),
  requireResponseDatabaseGeneration: vi.fn(),
  subscribeToChanges: vi.fn(() => () => {}),
}));
vi.mock('../lib/prompt-client', () => ({ parseDocAsync: vi.fn() }));
vi.mock('../components/ContinuationPackView', () => ({
  ContinuationPackView: ({ onSyncComplete }: { onSyncComplete?: (packId: string) => void }) => (
    <button type="button" onClick={() => onSyncComplete?.('pack-a')}>完成同步</button>
  ),
}));
vi.mock('../components/ContinuationOverviewPanel', () => ({ ContinuationOverviewPanel: () => <div>概览</div> }));
vi.mock('../components/WorldBibleOnboarding', () => ({ WorldBibleOnboarding: () => <div>引导</div> }));

import { WorldBibleView } from '../components/WorldBibleView';

const novel = { id: 'novel-a', title: '测试小说', authorId: 'local', summary: '', status: 'ongoing' as const, createdAt: 1, updatedAt: 1 };
const pack = {
  id: 'pack-a', novelId: 'novel-a', title: '资料包', status: 'approved' as const,
  sourceDocuments: [], canonFacts: [], characterStates: [], plotState: {}, styleProfile: {},
  contradictions: [], continuationTask: '继续写下一章', continuationGaps: [], createdAt: 1, updatedAt: 1,
};

function setIntent(overrides: Partial<{ novelId: string; packId: string }> = {}) {
  localStorage.setItem('inkflow-world-bible-sync-intent', JSON.stringify({
    intentId: 'intent-1', createdAt: Date.now(), novelId: novel.id, packId: pack.id, ...overrides,
  }));
}

function renderView() {
  render(<WorldBibleView novel={novel} onStartContinuationWriting={mockStartWriting} />);
  fireEvent.click(screen.getByRole('button', { name: /资料包管理/ }));
}

describe('WorldBibleView sync return', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockListPacks.mockResolvedValue([pack]);
  });

  test('matching cockpit intent navigates once and clears intent after sync', async () => {
    setIntent();
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: '完成同步' }));
    await waitFor(() => expect(mockStartWriting).toHaveBeenCalledTimes(1));
    expect(mockStartWriting).toHaveBeenCalledWith('pack-a', expect.stringContaining('继续写下一章'));
    expect(localStorage.getItem('inkflow-world-bible-sync-intent')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '完成同步' }));
    expect(mockStartWriting).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['manual sync', {}],
    ['mismatched intent', { packId: 'pack-b' }],
  ])('%s does not navigate or clear intent', async (_label, intent) => {
    if (Object.keys(intent).length) setIntent(intent);
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: '完成同步' }));
    await waitFor(() => expect(mockListPacks).toHaveBeenCalled());
    expect(mockStartWriting).not.toHaveBeenCalled();
    if ('packId' in intent && intent.packId) expect(localStorage.getItem('inkflow-world-bible-sync-intent')).not.toBeNull();
    else expect(localStorage.getItem('inkflow-world-bible-sync-intent')).toBeNull();
  });

  test('matching intent with missing pack does not navigate or clear intent', async () => {
    setIntent();
    mockListPacks.mockResolvedValue([]);
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: '完成同步' }));
    await waitFor(() => expect(mockListPacks).toHaveBeenCalled());
    expect(mockStartWriting).not.toHaveBeenCalled();
    expect(localStorage.getItem('inkflow-world-bible-sync-intent')).not.toBeNull();
  });

  test('keeps intent and permits retry when navigation rejects', async () => {
    setIntent();
    mockStartWriting.mockRejectedValueOnce(new Error('导航失败')).mockResolvedValue(undefined);
    renderView();
    const complete = await screen.findByRole('button', { name: '完成同步' });
    fireEvent.click(complete);
    await waitFor(() => expect(mockStartWriting).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('inkflow-world-bible-sync-intent')).not.toBeNull();
    fireEvent.click(complete);
    await waitFor(() => expect(mockStartWriting).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem('inkflow-world-bible-sync-intent')).toBeNull();
  });
});
