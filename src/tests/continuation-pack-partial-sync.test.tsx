import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockListPacks = vi.fn();
const mockExtract = vi.fn();
const mockSync = vi.fn();
const mockListCharacters = vi.fn();
const mockListLocations = vi.fn();
const mockListItems = vi.fn();
const mockListFactions = vi.fn();

vi.mock('../lib/continuation-client', () => ({
  listContinuationPacks: (...args: unknown[]) => mockListPacks(...args),
  extractPackEntities: (...args: unknown[]) => mockExtract(...args),
  resumePackEntityExtraction: vi.fn(),
  requeryPackEntityExtraction: vi.fn(),
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

const novel = {
  id: 'n1', title: '测试小说', authorId: 'local', summary: '', status: 'ongoing' as const,
  createdAt: 0, updatedAt: 0,
};

const pack = {
  id: 'pack-a', novelId: 'n1', title: 'Pack A', status: 'approved' as const,
  sourceDocuments: [], canonFacts: [], characterStates: [],
  plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
  styleProfile: { pov: 'third', tense: 'past', pacing: '', dialogueDensity: 'normal', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
  contradictions: [], continuationTask: '', sourceMap: { sections: [], keyConflicts: [] },
  readingQuestions: [], continuationGaps: [], createdAt: 0, updatedAt: 0,
};

describe('ContinuationPackView partial sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPacks.mockResolvedValue([pack]);
    mockListCharacters.mockResolvedValue([]);
    mockListLocations.mockResolvedValue([]);
    mockListItems.mockResolvedValue([]);
    mockListFactions.mockResolvedValue([]);
    mockExtract.mockResolvedValue({
      packId: 'pack-a', novelId: 'n1', databaseGeneration: 1,
      extraction: {
        characters: [{ name: '张三', role: 'protagonist', summary: '', bio: '', traits: [] }],
        locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
        relationships: [
          { sourceName: '张三', sourceType: 'character', targetName: '未知角色', targetType: 'character', relationshipType: '敌对', description: '' },
        ],
        globalOutline: '', worldRules: '',
      },
    });
    mockSync.mockResolvedValue({
      created: { characters: 1, locations: 0, items: 0, factions: 0, powerLevels: 0, timelineEvents: 0, relationships: 0 },
      skipped: { characters: 0, locations: 0, items: 0, factions: 0, relationships: 0 },
    });
  });

  test('imports confirmable entities, then keeps unresolved relationships in the repair flow', async () => {
    const onSyncComplete = vi.fn();
    render(<ContinuationPackView novel={novel} onSyncComplete={onSyncComplete} />);
    fireEvent.click(await screen.findByText('Pack A'));
    expect((await screen.findAllByText('资料包已确认')).length).toBeGreaterThan(0);
    expect(await screen.findByText('资料包确认不代表已写入设定集；提取后还需在同步预览确认。')).toBeDefined();
    fireEvent.click((await screen.findAllByRole('button', { name: '提取并预览' }))[0]);

    const confirm = await screen.findByRole('button', { name: '导入可确认项并处理 1 条关系' });
    fireEvent.click(confirm);

    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1));
    expect(onSyncComplete).toHaveBeenCalledWith('pack-a');
    expect(await screen.findByText('本次同步新增：人物 1')).toBeDefined();
    expect(mockSync.mock.calls[0][0]).toMatchObject({
      packId: 'pack-a',
      characters: [{ name: '张三' }],
      relationships: [],
    });

    expect(await screen.findByText('同步预览 — 选择要导入的实体')).toBeDefined();
    expect(await screen.findByRole('option', { name: /未知角色/ })).toBeDefined();
    expect(screen.getByText('待确认')).toBeDefined();
  });

  test('after partial sync, hides imported entities and shows only unresolved relationships', async () => {
    mockListCharacters
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { id: 'c1', novelId: 'n1', name: '张三', role: 'protagonist', summary: '', bio: '', traits: [] },
        { id: 'c2', novelId: 'n1', name: '李四', role: 'supporting', summary: '', bio: '', traits: [] },
      ]);
    mockExtract.mockResolvedValue({
      packId: 'pack-a', novelId: 'n1', databaseGeneration: 1,
      extraction: {
        characters: [
          { name: '张三', role: 'protagonist', summary: '', bio: '', traits: [] },
          { name: '李四', role: 'supporting', summary: '', bio: '', traits: [] },
        ],
        locations: [], items: [], factions: [], powerLevels: [], timelineEvents: [],
        relationships: [
          { sourceName: '张三', sourceType: 'character', targetName: '李四', targetType: 'character', relationshipType: '同盟', description: '已可确认' },
          { sourceName: '张三', sourceType: 'character', targetName: '未知角色', targetType: 'character', relationshipType: '敌对', description: '仍需处理' },
        ],
        globalOutline: '', worldRules: '',
      },
    });

    render(<ContinuationPackView novel={novel} />);
    fireEvent.click(await screen.findByText('Pack A'));
    fireEvent.click((await screen.findAllByRole('button', { name: '提取并预览' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: '导入可确认项并处理 1 条关系' }));

    await waitFor(() => expect(mockListCharacters).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('仍需处理')).toBeDefined();
    expect(screen.queryByText('已可确认')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '人物' }));
    expect(screen.getByText('未提取到人物')).toBeDefined();
    expect(screen.queryByText('新增')).toBeNull();
    expect(screen.queryByText('跳过')).toBeNull();
  });

  test('approved history card extracts into preview without syncing', async () => {
    render(<ContinuationPackView novel={novel} />);

    fireEvent.click(await screen.findByRole('button', { name: '提取并预览' }));
    await waitFor(() => expect(mockExtract).toHaveBeenCalledTimes(1));
    expect(mockExtract).toHaveBeenCalledWith('pack-a', 'n1', expect.any(AbortSignal), expect.any(Function));
    expect(mockSync).not.toHaveBeenCalled();
  });
});
