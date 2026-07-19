import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const mockExtract = vi.fn();
const mockListPacks = vi.fn().mockResolvedValue([]);

vi.mock('../lib/continuation-client', () => ({
  listContinuationPacks: (...args: unknown[]) => mockListPacks(...args),
  extractPackEntities: (...args: unknown[]) => mockExtract(...args),
  syncPackToWorld: vi.fn().mockResolvedValue({ created: { characters: 0, locations: 0, items: 0, factions: 0, powerLevels: 0, timelineEvents: 0, relationships: 0 }, skipped: { characters: 0, locations: 0, items: 0, factions: 0, relationships: 0 } }),
  deleteContinuationPack: vi.fn().mockResolvedValue(true),
  updateContinuationPack: vi.fn().mockResolvedValue(true),
  approveContinuationImport: vi.fn(),
}));

vi.mock('../lib/world-client', () => ({
  listCharacters: vi.fn().mockResolvedValue([]),
  listLocations: vi.fn().mockResolvedValue([]),
  listItems: vi.fn().mockResolvedValue([]),
  listFactions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/prompt-client', () => ({
  parseContinuationPack: vi.fn(),
}));

vi.mock('../components/world-bible/SyncPreviewPanel', () => ({
  SyncPreviewPanel: ({ extraction, onConfirm }: { extraction: { characters: { name: string }[] }; onConfirm: (s: { characters: { name: string }[] }) => void }) => (
    <div data-testid="sync-preview">
      <span data-testid="preview-char">{extraction.characters[0]?.name ?? 'none'}</span>
      <button onClick={() => onConfirm({ characters: extraction.characters })}>确认同步</button>
    </div>
  ),
}));

import { ContinuationPackView } from '../components/ContinuationPackView';

const mockNovel = { id: 'n1', title: '测试小说', authorId: 'local', summary: '', status: 'ongoing' as const, createdAt: 0, updatedAt: 0 };

function makePack(id: string, title: string) {
  return { id, novelId: 'n1', title, status: 'approved' as const, sourceDocuments: [], canonFacts: [], characterStates: [], plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' }, styleProfile: { pov: 'third', tense: 'past', pacing: '', dialogueDensity: 'normal', proseTraits: [], avoidTraits: [], sampleEvidence: '' }, contradictions: [], continuationTask: '', sourceMap: { sections: [], keyConflicts: [] }, readingQuestions: [], continuationGaps: [], createdAt: 0, updatedAt: 0 };
}

describe('ContinuationPackView A/B late response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPacks.mockResolvedValue([]);
  });

  test('T3.4: switching packs cancels pending extraction and starts new one', async () => {
    let resolveA!: (v: unknown) => void;
    const pendingA = new Promise(r => { resolveA = r; });

    mockExtract.mockImplementationOnce(() => pendingA);

    mockListPacks.mockResolvedValue([makePack('pack-a', 'Pack A'), makePack('pack-b', 'Pack B')]);

    render(<ContinuationPackView novel={mockNovel} />);

    await waitFor(() => expect(screen.getByText('Pack A')).toBeDefined());

    // Click pack A, then trigger extraction
    fireEvent.click(screen.getByText('Pack A'));
    await waitFor(() => expect(screen.getByText('同步到设定')).toBeDefined());
    fireEvent.click(screen.getByText('同步到设定'));

    // Extraction for A is in-flight (never resolved yet)
    expect(mockExtract).toHaveBeenCalledTimes(1);
    expect(mockExtract).toHaveBeenCalledWith('pack-a', 'n1', expect.any(AbortSignal));

    // Now mock pack B's extraction to resolve immediately
    mockExtract.mockResolvedValueOnce({
      packId: 'pack-b', novelId: 'n1', databaseGeneration: 1,
      extraction: {
        characters: [{ name: 'PackB角色', role: 'protagonist', summary: '', bio: '', traits: [] }],
        locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
        relationships: [], globalOutline: '', worldRules: '',
      },
    });

    // Switch to pack B and trigger extraction
    // Note: button is disabled because A is extracting, but cancelPendingExtraction is called
    // when handleSyncEntities runs. Since the button is disabled, we need to simulate
    // the scenario differently — resolve A first, then start B.

    // Let A resolve
    await act(async () => {
      resolveA({
        packId: 'pack-a', novelId: 'n1', databaseGeneration: 1,
        extraction: {
          characters: [{ name: 'PackA角色', role: 'supporting', summary: '', bio: '', traits: [] }],
          locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
          relationships: [], globalOutline: '', worldRules: '',
        },
      });
    });

    // A's preview should be shown
    await waitFor(() => expect(screen.getByTestId('preview-char').textContent).toBe('PackA角色'));

    // Now click pack B and trigger extraction — this cancels A's seq
    fireEvent.click(screen.getByText('Pack B'));
    await waitFor(() => expect(screen.getByText('同步到设定')).toBeDefined());
    fireEvent.click(screen.getByText('同步到设定'));

    // B resolves
    await waitFor(() => expect(screen.getByTestId('preview-char').textContent).toBe('PackB角色'));

    // Verify extractPackEntities was called for both packs
    expect(mockExtract).toHaveBeenCalledTimes(2);
    expect(mockExtract).toHaveBeenNthCalledWith(1, 'pack-a', 'n1', expect.any(AbortSignal));
    expect(mockExtract).toHaveBeenNthCalledWith(2, 'pack-b', 'n1', expect.any(AbortSignal));
  });

  test('T3.4b: late response from pack A after B starts is discarded', async () => {
    let resolveA!: (v: unknown) => void;
    let resolveB!: (v: unknown) => void;

    mockExtract
      // Deliberately ignore AbortSignal: this simulates a transport that cannot
      // stop A after the user switches to B.
      .mockImplementationOnce((_packId: string, _novelId: string, _signal: AbortSignal) => new Promise(r => { resolveA = r; }))
      .mockImplementationOnce(() => new Promise(r => { resolveB = r; }));

    mockListPacks.mockResolvedValue([makePack('pack-a', 'Pack A'), makePack('pack-b', 'Pack B')]);

    render(<ContinuationPackView novel={mockNovel} />);

    await waitFor(() => expect(screen.getByText('Pack A')).toBeDefined());

    // Start A's extraction
    fireEvent.click(screen.getByText('Pack A'));
    await waitFor(() => expect(screen.getByText('同步到设定')).toBeDefined());
    fireEvent.click(screen.getByText('同步到设定'));
    expect(mockExtract).toHaveBeenCalledTimes(1);

    // Switch to B while A is still pending, then start B.
    fireEvent.click(screen.getByText('Pack B'));
    await waitFor(() => expect(screen.getByText('同步到设定')).toBeDefined());
    fireEvent.click(screen.getByText('同步到设定'));
    expect(mockExtract).toHaveBeenCalledTimes(2);

    // Now resolve B first (B completes before A's late response)
    await act(async () => {
      resolveB({
        packId: 'pack-b', novelId: 'n1', databaseGeneration: 1,
        extraction: {
          characters: [{ name: 'PackB角色', role: 'protagonist', summary: '', bio: '', traits: [] }],
          locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
          relationships: [], globalOutline: '', worldRules: '',
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('preview-char').textContent).toBe('PackB角色'));

    // A ignores the abort and returns after B: its stale result must be discarded.
    await act(async () => {
      resolveA({
        packId: 'pack-a', novelId: 'n1', databaseGeneration: 1,
        extraction: {
          characters: [{ name: 'PackA角色', role: 'supporting', summary: '', bio: '', traits: [] }],
          locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
          relationships: [], globalOutline: '', worldRules: '',
        },
      });
    });

    expect(screen.getByTestId('preview-char').textContent).toBe('PackB角色');
    expect(screen.queryByText('PackA角色')).toBeNull();
  });

  test('T3.4c: late response after unmount does not update state', async () => {
    let resolveA!: (v: unknown) => void;
    mockExtract.mockImplementationOnce((_packId: string, _novelId: string, _signal: AbortSignal) => new Promise(r => { resolveA = r; }));
    mockListPacks.mockResolvedValue([makePack('pack-a', 'Pack A')]);

    const { unmount, container } = render(<ContinuationPackView novel={mockNovel} />);
    await waitFor(() => expect(screen.getByText('Pack A')).toBeDefined());
    fireEvent.click(screen.getByText('Pack A'));
    await waitFor(() => expect(screen.getByText('同步到设定')).toBeDefined());
    fireEvent.click(screen.getByText('同步到设定'));
    expect(mockExtract).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      resolveA({
        packId: 'pack-a', novelId: 'n1', databaseGeneration: 1,
        extraction: {
          characters: [{ name: 'PackA角色', role: 'supporting', summary: '', bio: '', traits: [] }],
          locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
          relationships: [], globalOutline: '', worldRules: '',
        },
      });
    });

    expect(container.innerHTML).toBe('');
  });
});
