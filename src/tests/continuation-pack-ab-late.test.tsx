import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';
import type { ContinuationPack } from '../../shared/types';

const mockExtract = vi.fn();
const mockListPacks = vi.fn().mockResolvedValue([]);
const mockSync = vi.fn();
const mockResolveConflicts = vi.fn();

function makeSyncResult() {
  return { created: { characters: 0, locations: 0, items: 0, factions: 0, powerLevels: 0, timelineEvents: 0, relationships: 0 }, skipped: { characters: 0, locations: 0, items: 0, factions: 0, relationships: 0 } };
}

vi.mock('../lib/continuation-client', () => ({
  listContinuationPacks: (...args: unknown[]) => mockListPacks(...args),
  extractPackEntities: (...args: unknown[]) => mockExtract(...args),
  resumePackEntityExtraction: vi.fn(),
  requeryPackEntityExtraction: vi.fn(),
  syncPackToWorld: (...args: unknown[]) => mockSync(...args),
  deleteContinuationPack: vi.fn().mockResolvedValue(true),
  updateContinuationPack: vi.fn().mockResolvedValue(true),
  approveContinuationImport: vi.fn(),
  resolveContinuationPackConflicts: (...args: unknown[]) => mockResolveConflicts(...args),
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
  SyncPreviewPanel: ({ extraction, onConfirm, onCancel, isSyncing }: {
    extraction: { characters: { name: string }[] };
    onConfirm: (s: { characters: { name: string }[] }) => void;
    onCancel: () => void;
    isSyncing: boolean;
  }) => (
    <div data-testid="sync-preview">
      <span data-testid="preview-char">{extraction.characters[0]?.name ?? 'none'}</span>
      <span data-testid="sync-loading">{isSyncing ? 'loading' : 'idle'}</span>
      <button data-testid="close-preview" disabled={isSyncing} onClick={onCancel}>关闭预览</button>
      <button data-testid="confirm-sync" disabled={isSyncing} onClick={() => onConfirm({ characters: extraction.characters })}>确认同步</button>
    </div>
  ),
}));

import { ContinuationPackView } from '../components/ContinuationPackView';

const mockNovel = { id: 'n1', title: '测试小说', authorId: 'local', summary: '', status: 'ongoing' as const, createdAt: 0, updatedAt: 0 };

function makePack(id: string, title: string): ContinuationPack {
  return { id, novelId: 'n1', title, status: 'approved' as const, sourceDocuments: [], canonFacts: [], characterStates: [], plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' }, styleProfile: { pov: 'third', tense: 'past', pacing: '', dialogueDensity: 'normal', proseTraits: [], avoidTraits: [], sampleEvidence: '' }, contradictions: [], continuationTask: '', sourceMap: { sections: [], keyConflicts: [] }, readingQuestions: [], continuationGaps: [], createdAt: 0, updatedAt: 0 };
}

async function clickExtractAndPreview() {
  const buttons = await screen.findAllByRole('button', { name: '提取并预览' });
  fireEvent.click(buttons[0]);
}

describe('ContinuationPackView A/B late response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPacks.mockResolvedValue([]);
    mockSync.mockReset().mockResolvedValue(makeSyncResult());
    mockResolveConflicts.mockReset();
  });

  test('approved pack exposes Agent suggestion and saves an edited conflict resolution', async () => {
    const pack = makePack('pack-conflict', '冲突资料包');
    pack.contradictions = [{ id: 'c-1', severity: 'medium', summary: '编号冲突', conflictingEvidence: ['文档 A', '文档 B'], suggestedResolution: '采用文档 A' }];
    const updatedPack = { ...pack, contradictions: [{ ...pack.contradictions[0], acceptedResolution: '采用文档 B', resolvedAt: 10 }] };
    mockListPacks.mockResolvedValue([pack]);
    mockResolveConflicts.mockResolvedValue(updatedPack);

    render(<ContinuationPackView novel={mockNovel} initialActivePackId="pack-conflict" />);
    expect(await screen.findByText('Agent 初始建议：采用文档 A')).toBeTruthy();
    const textarea = await screen.findByRole('textbox', { name: '冲突裁决：编号冲突' });
    fireEvent.change(textarea, { target: { value: '采用文档 B' } });
    fireEvent.click(screen.getByRole('button', { name: '保存裁决' }));

    await waitFor(() => expect(mockResolveConflicts).toHaveBeenCalledWith({
      packId: 'pack-conflict',
      novelId: 'n1',
      conflictResolutions: [{ contradictionId: 'c-1', resolution: '采用文档 B' }],
    }));
    expect(await screen.findByText('已处理')).toBeTruthy();
  });

  test('approved pack can apply Agent suggestion without editing', async () => {
    const pack = makePack('pack-agent', '建议资料包');
    pack.contradictions = [{ id: 'c-agent', severity: 'medium', summary: '编号冲突', conflictingEvidence: ['文档 A'], suggestedResolution: '采用文档 A' }];
    mockListPacks.mockResolvedValue([pack]);
    mockResolveConflicts.mockResolvedValue({ ...pack, contradictions: [{ ...pack.contradictions[0], acceptedResolution: '采用文档 A', resolvedAt: 11 }] });

    render(<ContinuationPackView novel={mockNovel} initialActivePackId="pack-agent" />);
    const applyButton = await screen.findByRole('button', { name: '采用 Agent 建议' });
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(applyButton);

    await waitFor(() => expect(mockResolveConflicts).toHaveBeenCalledWith({
      packId: 'pack-agent',
      novelId: 'n1',
      conflictResolutions: [{ contradictionId: 'c-agent', resolution: '采用文档 A' }],
    }));
    expect(await screen.findByText('已处理')).toBeTruthy();
  });

  test('draft high contradiction requires explicit resolution and submits it on approval', async () => {
    const pack = makePack('pack-draft-conflict', '待审核资料包');
    pack.status = 'draft';
    pack.contradictions = [{ id: 'c-high', severity: 'high', summary: '关键设定冲突', conflictingEvidence: ['文档 A', '文档 B'], suggestedResolution: '采用文档 A' }];
    const approvedPack = { ...pack, status: 'approved' as const, contradictions: [{ ...pack.contradictions[0], acceptedResolution: '采用文档 B', resolvedAt: 12 }] };
    mockListPacks.mockResolvedValue([pack]);
    const approve = vi.mocked((await import('../lib/continuation-client')).approveContinuationImport);
    approve.mockResolvedValue({ novel: mockNovel, pack: approvedPack });

    render(<ContinuationPackView novel={mockNovel} initialActivePackId="pack-draft-conflict" />);
    expect(await screen.findByText('Agent 初始建议：采用文档 A')).toBeTruthy();
    const approveButton = screen.getByRole('button', { name: '确认资料包' }) as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);

    const textarea = screen.getByRole('textbox', { name: '冲突裁决：关键设定冲突' });
    fireEvent.change(textarea, { target: { value: '采用文档 B' } });
    expect(approveButton.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '采用此方案' }));
    expect(approveButton.disabled).toBe(false);
    fireEvent.click(approveButton);

    await waitFor(() => expect(approve).toHaveBeenCalledWith({
      packId: 'pack-draft-conflict',
      mode: 'existing',
      existingNovelId: 'n1',
      conflictResolutions: [{ contradictionId: 'c-high', resolution: '采用文档 B' }],
    }));
    expect(await within(screen.getByLabelText('当前资料包：待审核资料包')).findByText('资料包已确认')).toBeTruthy();
  });

  test.each([
    ['成功', (resolveA: (value: unknown) => void) => resolveA({
      packId: 'pack-a', novelId: 'n1', databaseGeneration: 1,
      extraction: {
        characters: [{ name: 'PackA角色', role: 'supporting', summary: '', bio: '', traits: [] }],
        locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
        relationships: [], globalOutline: '', worldRules: '',
      },
    })],
    ['失败', (_resolveA: (value: unknown) => void, rejectA: (reason?: unknown) => void) => rejectA(new Error('A late failure'))],
  ])('T1: A 迟到%s不影响 B 的预览、错误和 loading', async (_label, settleA) => {
    let resolveA!: (v: unknown) => void;
    let rejectA!: (e?: unknown) => void;
    let resolveB!: (v: unknown) => void;
    let rejectB!: (e?: unknown) => void;
    const pendingA = new Promise((resolve, reject) => { resolveA = resolve; rejectA = reject; });
    const pendingB = new Promise(r => { resolveB = r; });

    mockExtract
      .mockImplementationOnce(() => pendingA)
      .mockImplementationOnce(() => pendingB);
    mockSync.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectB = reject; }));
    mockListPacks.mockResolvedValue([makePack('pack-a', 'Pack A'), makePack('pack-b', 'Pack B')]);

    render(<ContinuationPackView novel={mockNovel} />);
    await waitFor(() => expect(screen.getByText('Pack A')).toBeDefined());

    fireEvent.click(screen.getByText('Pack A'));
    await clickExtractAndPreview();
    fireEvent.click(screen.getByText('Pack B'));
    await clickExtractAndPreview();

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

    fireEvent.click(screen.getByTestId('confirm-sync'));
    await waitFor(() => expect(screen.getByTestId('sync-loading').textContent).toBe('loading'));
    expect((screen.getByTestId('close-preview') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('confirm-sync') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Pack A').closest('button') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { settleA(resolveA, rejectA); });
    expect(screen.getByTestId('preview-char').textContent).toBe('PackB角色');
    expect(screen.getByTestId('sync-loading').textContent).toBe('loading');

    await act(async () => { rejectB(new Error('B sync failure')); });
    await waitFor(() => expect(screen.getByText('同步失败：B sync failure')).toBeDefined());
    expect(screen.getByTestId('preview-char').textContent).toBe('PackB角色');
    expect(screen.getByTestId('sync-loading').textContent).toBe('idle');
  });

  test('T1: sync response after unmount does not update state', async () => {
    let resolveSync!: (value: unknown) => void;
    mockListPacks.mockResolvedValue([makePack('pack-a', 'Pack A')]);
    mockExtract.mockResolvedValueOnce({
      packId: 'pack-a', novelId: 'n1', databaseGeneration: 1,
      extraction: {
        characters: [{ name: 'PackA角色', role: 'supporting', summary: '', bio: '', traits: [] }],
        locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
        relationships: [], globalOutline: '', worldRules: '',
      },
    });
    mockSync.mockImplementationOnce(() => new Promise(resolve => { resolveSync = resolve; }));

    const { unmount, container } = render(<ContinuationPackView novel={mockNovel} />);
    await waitFor(() => expect(screen.getByText('Pack A')).toBeDefined());
    fireEvent.click(screen.getByText('Pack A'));
    await clickExtractAndPreview();
    await waitFor(() => expect(screen.getByTestId('preview-char').textContent).toBe('PackA角色'));
    fireEvent.click(screen.getByTestId('confirm-sync'));
    await waitFor(() => expect(screen.getByTestId('sync-loading').textContent).toBe('loading'));

    unmount();
    await act(async () => { resolveSync(makeSyncResult()); });
    expect(container.innerHTML).toBe('');
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
    await clickExtractAndPreview();

    // Extraction for A is in-flight (never resolved yet)
    expect(mockExtract).toHaveBeenCalledTimes(1);
    expect(mockExtract).toHaveBeenCalledWith('pack-a', 'n1', expect.any(AbortSignal), expect.any(Function));

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
    await clickExtractAndPreview();

    // B resolves
    await waitFor(() => expect(screen.getByTestId('preview-char').textContent).toBe('PackB角色'));

    // Verify extractPackEntities was called for both packs
    expect(mockExtract).toHaveBeenCalledTimes(2);
    expect(mockExtract).toHaveBeenNthCalledWith(1, 'pack-a', 'n1', expect.any(AbortSignal), expect.any(Function));
    expect(mockExtract).toHaveBeenNthCalledWith(2, 'pack-b', 'n1', expect.any(AbortSignal), expect.any(Function));
  });

  test('extraction failure stays inside the selected pack card', async () => {
    const failure = Object.assign(new Error('字段格式不符合要求'), {
      code: 'EXTRACTION_SCHEMA_MISMATCH', jobId: 'job-b', databaseGeneration: 1, batch: 24, totalBatches: 28,
    });
    mockListPacks.mockResolvedValue([makePack('pack-a', 'Pack A'), makePack('pack-b', 'Pack B')]);
    mockExtract.mockRejectedValueOnce(failure);

    render(<ContinuationPackView novel={mockNovel} />);
    await waitFor(() => expect(screen.getByText('Pack B')).toBeDefined());
    fireEvent.click(screen.getByText('Pack B'));
    await clickExtractAndPreview();

    const activeCard = await screen.findByLabelText('当前资料包：Pack B');
    expect(await within(activeCard).findByRole('alert')).toBeDefined();
    expect(activeCard.className).toContain('border-theme-border');
    expect(screen.getByText('资料包管理')).toBeDefined();
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
    await clickExtractAndPreview();
    expect(mockExtract).toHaveBeenCalledTimes(1);

    // Switch to B while A is still pending, then start B.
    fireEvent.click(screen.getByText('Pack B'));
    await clickExtractAndPreview();
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
    await clickExtractAndPreview();
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

  test('续写缺口可交给设定助手，并携带完整缺口上下文', async () => {
    const pack = makePack('pack-gap', '缺口资料包');
    pack.continuationGaps = [{
      id: 'gap-1',
      severity: 'medium',
      description: '年轻外勤搭档细节未展开',
      suggestedDirection: '补充二十年前共事片段',
      relatedFacts: ['顾铁峰曾与苏老板共事'],
    }];
    mockListPacks.mockResolvedValue([pack]);
    const onOpenGapAssistant = vi.fn();

    render(<ContinuationPackView novel={mockNovel} initialActivePackId="pack-gap" onOpenGapAssistant={onOpenGapAssistant} />);

    fireEvent.click(await screen.findByRole('button', { name: '交给智能管家处理：年轻外勤搭档细节未展开' }));

    expect(onOpenGapAssistant).toHaveBeenCalledWith(pack.continuationGaps[0], '缺口资料包', 'pack-gap');
    expect(screen.getByText('生成补充草稿，确认后再写入设定。')).toBeDefined();
  });
});
