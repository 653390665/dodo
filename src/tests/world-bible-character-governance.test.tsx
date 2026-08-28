import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ArtifactCandidate, CharacterCore } from '../../shared/types/creative-artifacts';

const character = { id: 'c1', novelId: 'n1', name: '阿青', role: 'protagonist' as const, summary: '', bio: '当前小传', traits: [] };
const core: CharacterCore = { schemaVersion: 1, desire: '回家', externalGoal: '', internalNeed: '', fear: '', woundOrFalseBelief: '', strengths: [], flaws: [], contradictions: [], speechPattern: '', habitualActions: [], decisionPattern: '', relationshipTensions: [], arc: { start: '', turns: [], target: '' }, immutableFacts: [] };
const candidate: ArtifactCandidate<CharacterCore> = {
  id: 'candidate-1', novelId: 'n1', target: { kind: 'character', id: 'c1', version: 0 }, operation: 'restructure', goal: '', baseFingerprint: 'fp', sourceCapabilityVersions: [{ capabilityId: 'bible-character-arc', version: '3' }], proposedCore: core,
  diff: { changed: true, fields: [{ path: 'desire', kind: 'added', after: '回家' }] }, impactReport: { downstream: [], reviewRequired: [], manuscriptConflict: false, reasons: [] }, status: 'pending',
};

vi.mock('../lib/world-client', () => {
  const empty = vi.fn(async () => []);
  return {
    listCharacters: vi.fn(async () => [character]), listLocations: empty, listItems: empty, listTimelineEvents: empty,
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
vi.mock('../lib/continuation-client', () => ({ listContinuationPacks: vi.fn(async () => []) }));
vi.mock('../lib/novel-client', () => ({ getNovel: vi.fn(async () => novel), updateNovel: vi.fn() }));
vi.mock('../lib/db-transport', () => ({
  call: vi.fn(async () => []), getDatabaseGenerationSnapshot: vi.fn(async () => 7), requireResponseDatabaseGeneration: vi.fn(), subscribeToChanges: vi.fn(() => () => {}),
}));
vi.mock('../lib/prompt-client', () => ({ parseDocAsync: vi.fn() }));
vi.mock('../components/ContinuationOverviewPanel', () => ({ ContinuationOverviewPanel: () => <div>概览</div> }));
vi.mock('../components/ContinuationPackView', () => ({ ContinuationPackView: () => <div>资料包</div> }));
vi.mock('../components/WorldBibleOnboarding', () => ({ WorldBibleOnboarding: () => <div>引导</div> }));

import { WorldBibleView } from '../components/WorldBibleView';

const novel = { id: 'n1', title: '测试小说', authorId: 'local', summary: '', status: 'ongoing' as const, createdAt: 1, updatedAt: 1 };

describe('WorldBibleView character governance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('inkflow-world-bible-active-tab', 'characters');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/artifacts?kind=character')) return Response.json({ cores: [], candidates: [candidate] });
      if (url.endsWith('/candidate-1/accept')) return Response.json({ core: { core, version: 1 } });
      return Response.json({ error: 'unexpected request' }, { status: 500 });
    }));
  });

  test('loads pending candidates and accepts them through the real character page', async () => {
    render(<WorldBibleView novel={novel} />);
    expect(await screen.findByText(/desire：added/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '接受角色候选' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/novels/n1/artifacts/candidates/candidate-1/accept',
      expect.objectContaining({ method: 'POST' }),
    ));
    await waitFor(() => expect(screen.queryByRole('button', { name: '接受角色候选' })).toBeNull());
  });

  test('recommends character restructuring without auto-running and persists dismissal', async () => {
    const openStore = vi.fn();
    let dismissalChecks = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/artifacts?kind=character')) return Response.json({ cores: [], candidates: [] });
      if (url.endsWith('/capability-recommendations/dismissed')) {
        dismissalChecks += 1;
        return Response.json({ dismissed: false });
      }
      if (url.endsWith('/capability-recommendations/dismiss')) return new Response(null, { status: 204 });
      return Response.json({ error: 'unexpected request' }, { status: 500 });
    }));

    const view = render(<WorldBibleView novel={novel} onOpenCapabilityStore={openStore} />);

    await screen.findByDisplayValue('阿青');
    expect(await screen.findByText(/角色结构缺少/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /单次能力：使用 bible-character-arc/ })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalledWith('/api/generate-outline', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: '前往能力商店' }));
    expect(openStore).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '暂不推荐' }));
    await waitFor(() => expect(screen.queryByText(/角色结构缺少/)).toBeNull());
    expect(fetch).toHaveBeenCalledWith('/api/capability-recommendations/dismiss', expect.objectContaining({ method: 'POST' }));

    view.rerender(<WorldBibleView novel={{ ...novel, id: 'n2' }} onOpenCapabilityStore={openStore} />);
    expect(await screen.findByText(/角色结构缺少/)).toBeTruthy();
    await waitFor(() => expect(dismissalChecks).toBe(2));
  });
});
