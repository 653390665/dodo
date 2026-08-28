import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockListPacks = vi.fn();
const mockRequery = vi.fn();
const mockExtract = vi.fn();
const mockResume = vi.fn();
const mockSync = vi.fn();
const mockListCharacters = vi.fn();
const mockListLocations = vi.fn();
const mockListItems = vi.fn();
const mockListFactions = vi.fn();

vi.mock('../lib/continuation-client', () => ({
  listContinuationPacks: (...args: unknown[]) => mockListPacks(...args),
  requeryPackEntityExtraction: (...args: unknown[]) => mockRequery(...args),
  extractPackEntities: (...args: unknown[]) => mockExtract(...args),
  resumePackEntityExtraction: (...args: unknown[]) => mockResume(...args),
  syncPackToWorld: (...args: unknown[]) => mockSync(...args),
  deleteContinuationPack: vi.fn().mockResolvedValue(true),
  updateContinuationPack: vi.fn().mockResolvedValue(true),
  approveContinuationImport: vi.fn(),
}));

vi.mock('../lib/world-client', () => ({
  listCharacters: (...args: unknown[]) => mockListCharacters(...args),
  listLocations: (...args: unknown[]) => mockListLocations(...args),
  listItems: (...args: unknown[]) => mockListItems(...args),
  listFactions: (...args: unknown[]) => mockListFactions(...args),
}));

vi.mock('../lib/prompt-client', () => ({ parseContinuationPack: vi.fn() }));

import { ContinuationPackView } from '../components/ContinuationPackView';

const novel = { id: 'novel-1', title: '测试小说', authorId: 'local', summary: '', status: 'ongoing' as const, createdAt: 0, updatedAt: 0 };
const pack = {
  id: 'pack-1', novelId: novel.id, title: '恢复资料包', status: 'approved' as const,
  sourceDocuments: [], canonFacts: [], characterStates: [],
  plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
  styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
  contradictions: [], continuationTask: '', sourceMap: { sections: [], keyConflicts: [] },
  readingQuestions: [], continuationGaps: [], createdAt: 0, updatedAt: 0,
};
const snapshot = {
  packId: pack.id, novelId: novel.id, databaseGeneration: 3,
  extraction: { characters: [], locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [], relationships: [], globalOutline: '', worldRules: '' },
};

describe('ContinuationPackView job URL recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/world?extractionJobId=job-1&extractionPackId=pack-1&databaseGeneration=3&keep=1#preview');
    mockListPacks.mockResolvedValue([pack]);
    mockRequery.mockResolvedValue(snapshot);
    mockListCharacters.mockResolvedValue([]);
    mockListLocations.mockResolvedValue([]);
    mockListItems.mockResolvedValue([]);
    mockListFactions.mockResolvedValue([]);
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  test('requeries a matching completed job once and opens sync preview without writes', async () => {
    render(<ContinuationPackView novel={novel} />);

    expect(await screen.findByText('同步预览 — 选择要导入的实体')).toBeDefined();
    await waitFor(() => expect(mockRequery).toHaveBeenCalledTimes(1));
    expect(mockRequery).toHaveBeenCalledWith('job-1', 3, expect.any(AbortSignal), expect.any(Function));
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    expect(window.location.search).toContain('extractionJobId');
    screen.getByRole('button', { name: '关闭同步预览' }).click();
    await waitFor(() => expect(window.location.search).not.toContain('extractionJobId'));
    expect(window.location.search).toContain('keep=1');
    expect(window.location.hash).toBe('#preview');
  });

  test('does not recover a job belonging to another novel', async () => {
    mockListPacks.mockResolvedValue([{ ...pack, novelId: 'other-novel' }]);
    render(<ContinuationPackView novel={novel} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockRequery).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
  });

  test('does not recover when database generation is missing', async () => {
    window.history.replaceState(null, '', '/world?extractionJobId=job-1&extractionPackId=pack-1');
    render(<ContinuationPackView novel={novel} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockRequery).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
  });

  test('auto-syncs a matching approved pack once and opens preview without writes', async () => {
    window.history.replaceState(null, '', '/world');
    mockExtract.mockResolvedValue(snapshot);
    const onAutoSyncConsumed = vi.fn();
    render(<ContinuationPackView novel={novel} initialAutoSyncPackId={pack.id} onAutoSyncConsumed={onAutoSyncConsumed} />);

    expect(await screen.findByText('同步预览 — 选择要导入的实体')).toBeDefined();
    await waitFor(() => expect(mockExtract).toHaveBeenCalledTimes(1));
    expect(onAutoSyncConsumed).toHaveBeenCalledTimes(1);
    expect(onAutoSyncConsumed).toHaveBeenCalledWith(pack.id);
    expect(mockExtract).toHaveBeenCalledWith(pack.id, novel.id, expect.any(AbortSignal), expect.any(Function));
    expect(mockRequery).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  test.each([
    ['draft pack', { ...pack, status: 'draft' as const }],
    ['other novel pack', { ...pack, novelId: 'other-novel' }],
  ])('does not auto-sync a %s', async (_label, candidate) => {
    window.history.replaceState(null, '', '/world');
    mockListPacks.mockResolvedValue([candidate]);
    const onAutoSyncConsumed = vi.fn();
    render(<ContinuationPackView novel={novel} initialAutoSyncPackId={candidate.id} onAutoSyncConsumed={onAutoSyncConsumed} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    expect(onAutoSyncConsumed).not.toHaveBeenCalled();
  });

  test('does not auto-sync when the requested pack is missing', async () => {
    window.history.replaceState(null, '', '/world');
    mockListPacks.mockResolvedValue([]);
    const onAutoSyncConsumed = vi.fn();
    render(<ContinuationPackView novel={novel} initialAutoSyncPackId="missing-pack" onAutoSyncConsumed={onAutoSyncConsumed} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    expect(onAutoSyncConsumed).not.toHaveBeenCalled();
  });

  test('keeps auto-sync idempotent across rerenders', async () => {
    window.history.replaceState(null, '', '/world');
    mockExtract.mockResolvedValue(snapshot);
    const onAutoSyncConsumed = vi.fn();
    const view = render(<ContinuationPackView novel={novel} initialAutoSyncPackId={pack.id} onAutoSyncConsumed={onAutoSyncConsumed} />);
    expect(await screen.findByText('同步预览 — 选择要导入的实体')).toBeDefined();
    view.rerender(<ContinuationPackView novel={novel} initialAutoSyncPackId={pack.id} />);
    await waitFor(() => expect(mockExtract).toHaveBeenCalledTimes(1));
    expect(onAutoSyncConsumed).toHaveBeenCalledTimes(1);
    expect(mockSync).not.toHaveBeenCalled();
  });

  test('keeps intent after local entity load failure and consumes once after retry', async () => {
    window.history.replaceState(null, '', '/world');
    mockExtract.mockResolvedValue(snapshot);
    mockListCharacters.mockRejectedValueOnce(new Error('本地设定暂不可用'));
    const onAutoSyncConsumed = vi.fn();
    render(<ContinuationPackView novel={novel} initialAutoSyncPackId={pack.id} onAutoSyncConsumed={onAutoSyncConsumed} />);

    expect(await screen.findByText('同步预览 — 选择要导入的实体')).toBeDefined();
    expect((await screen.findByRole('alert')).textContent).toContain('本地设定暂不可用');
    expect(onAutoSyncConsumed).not.toHaveBeenCalled();
    const retry = screen.getByRole('button', { name: /只重试列表/ });
    expect(retry.hasAttribute('disabled')).toBe(false);
    retry.click();
    await waitFor(() => expect(mockListCharacters).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onAutoSyncConsumed).toHaveBeenCalledTimes(1));
    expect(onAutoSyncConsumed).toHaveBeenCalledWith(pack.id);
  });

});
