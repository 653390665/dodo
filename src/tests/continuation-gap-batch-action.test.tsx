import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ContinuationPack, Novel } from '../../shared/types';

const mockListPacks = vi.fn();

vi.mock('../lib/continuation-client', () => ({
  listContinuationPacks: (...args: unknown[]) => mockListPacks(...args),
  extractPackEntities: vi.fn(),
  resumePackEntityExtraction: vi.fn(),
  requeryPackEntityExtraction: vi.fn(),
  syncPackToWorld: vi.fn(),
  deleteContinuationPack: vi.fn().mockResolvedValue(true),
  updateContinuationPack: vi.fn().mockResolvedValue(true),
  approveContinuationImport: vi.fn(),
  resolveContinuationPackConflicts: vi.fn(),
}));

vi.mock('../lib/world-client', () => ({
  listCharacters: vi.fn().mockResolvedValue([]),
  listLocations: vi.fn().mockResolvedValue([]),
  listItems: vi.fn().mockResolvedValue([]),
  listFactions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/prompt-client', () => ({ parseContinuationPack: vi.fn() }));
vi.mock('../components/world-bible/SyncPreviewPanel', () => ({ SyncPreviewPanel: () => null }));

import { ContinuationPackView } from '../components/ContinuationPackView';

const novel: Novel = {
  id: 'novel-gap-batch',
  title: '批量缺口测试',
  authorId: 'local-user',
  summary: '',
  status: 'ongoing',
  createdAt: 1,
  updatedAt: 1,
};

function createPack(gaps: ContinuationPack['continuationGaps']): ContinuationPack {
  return {
    id: 'pack-gap-batch',
    novelId: novel.id,
    title: '批量资料包',
    status: 'approved',
    sourceDocuments: [],
    canonFacts: [],
    characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    contradictions: [],
    continuationTask: '',
    continuationGaps: gaps,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('ContinuationPackView batch gap action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  test('passes every current continuation gap while keeping single-gap action', async () => {
    const gaps = Array.from({ length: 6 }, (_, index) => ({
      id: `gap-${index + 1}`,
      description: `缺口 ${index + 1}`,
      severity: 'medium' as const,
      suggestedDirection: `方向 ${index + 1}`,
      relatedFacts: [],
    }));
    const pack = createPack(gaps);
    mockListPacks.mockResolvedValue([pack]);
    const onOpenGapAssistant = vi.fn();
    const onOpenGapAssistantBatch = vi.fn();

    render(
      <ContinuationPackView
        novel={novel}
        initialActivePackId={pack.id}
        onOpenGapAssistant={onOpenGapAssistant}
        onOpenGapAssistantBatch={onOpenGapAssistantBatch}
      />,
    );

    expect(await screen.findByText(pack.title)).toBeDefined();
    expect(await screen.findByText('续写缺口')).toBeDefined();
    const batchButton = await screen.findByRole('button', { name: '批量交给智能管家处理续写缺口' });
    fireEvent.click(batchButton);
    expect(onOpenGapAssistantBatch).toHaveBeenCalledWith(gaps, pack.title, pack.id);

    fireEvent.click(screen.getByRole('button', { name: '交给智能管家处理：缺口 1' }));
    expect(onOpenGapAssistant).toHaveBeenCalledWith(gaps[0], pack.title, pack.id);
    await waitFor(() => expect(screen.queryByText('缺口 6')).toBeNull());
  });
});
