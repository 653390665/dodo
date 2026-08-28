import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Character } from '../../shared/types';
import type { ArtifactCandidate, StructuredWorldCore } from '../../shared/types/creative-artifacts';
import type { WorldCapabilityLaunchIntent } from '../../shared/types/capability-manifest';

const mocks = vi.hoisted(() => ({
  characters: [] as Character[],
  worldCandidates: [] as Array<ArtifactCandidate<StructuredWorldCore>>,
  startWorldJob: vi.fn(),
  updateNovel: vi.fn(),
  createCharacter: vi.fn(),
  updateCharacter: vi.fn(),
  deleteCharacter: vi.fn(),
  importWorldExtraction: vi.fn(),
  parseDocAsync: vi.fn(),
  requireResponseDatabaseGeneration: vi.fn(),
  getDatabaseGenerationSnapshot: vi.fn(),
}));

const novel = { id: 'n1', title: '测试小说', authorId: 'local', summary: '', status: 'ongoing' as const, createdAt: 1, updatedAt: 1 };
const worldCore: StructuredWorldCore = {
  schemaVersion: 1,
  hardRules: [{ id: 'rule-1', statement: '夜间禁止使用火焰术' }],
  powerConstraints: [],
  prohibitions: [],
  factionConstraints: [],
};
const worldCandidate: ArtifactCandidate<StructuredWorldCore> = {
  id: 'world-candidate-1',
  novelId: 'n1',
  target: { kind: 'world', id: 'n1', version: 0 },
  operation: 'restructure',
  goal: '补齐世界规则',
  baseFingerprint: 'world-fingerprint',
  sourceCapabilityVersions: [{ capabilityId: 'bible-world-builder', version: '3' }],
  proposedCore: worldCore,
  proposedContent: '夜幕降临后，火焰术会唤醒巡夜者。',
  diff: { changed: true, fields: [{ path: 'hardRules[0]', kind: 'added', after: '夜间禁止使用火焰术' }] },
  impactReport: {
    downstream: [{ kind: 'master-outline', id: 'outline-1', version: 2 }],
    reviewRequired: [{ kind: 'narrative-promise', id: 'promise-1', version: 1 }],
    manuscriptConflict: false,
    reasons: ['新增规则会影响现有伏笔'],
  },
  status: 'pending',
};

vi.mock('../lib/world-client', () => {
  const empty = vi.fn(async () => []);
  return {
    listCharacters: vi.fn(async () => mocks.characters), listLocations: empty, listItems: empty, listTimelineEvents: empty,
    listFactions: empty, listPowerLevels: empty, listEntityRelationshipsClient: empty,
    createCharacter: mocks.createCharacter, updateCharacter: mocks.updateCharacter, deleteCharacter: mocks.deleteCharacter,
    createLocation: empty, updateLocation: empty, deleteLocation: empty,
    createItem: empty, updateItem: empty, deleteItem: empty,
    createFaction: empty, updateFaction: empty, deleteFaction: empty,
    createPowerLevel: empty, updatePowerLevel: empty, deletePowerLevel: empty,
    createTimelineEvent: empty, updateTimelineEvent: empty, deleteTimelineEvent: empty,
    importWorldExtraction: mocks.importWorldExtraction,
  };
});
vi.mock('../lib/world-job-client', () => ({ startWorldJob: mocks.startWorldJob }));
vi.mock('../lib/continuation-client', () => ({ listContinuationPacks: vi.fn(async () => []) }));
vi.mock('../lib/novel-client', () => ({ getNovel: vi.fn(async () => novel), updateNovel: mocks.updateNovel }));
vi.mock('../lib/db-transport', () => ({
  call: vi.fn(async () => []), getDatabaseGenerationSnapshot: mocks.getDatabaseGenerationSnapshot, requireResponseDatabaseGeneration: mocks.requireResponseDatabaseGeneration, subscribeToChanges: vi.fn(() => () => {}),
}));
vi.mock('../lib/prompt-client', () => ({ parseDocAsync: mocks.parseDocAsync }));
vi.mock('../lib/character-bio-stream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/character-bio-stream')>();
  return {
    ...actual,
    streamCharacterBio: vi.fn(async ({ onPreview, onCommit }: {
      onPreview: (bio: string) => void;
      onCommit: (bio: string) => Promise<void>;
    }) => {
      onPreview('生成小传');
      await onCommit('生成小传');
      return true;
    }),
  };
});
vi.mock('../components/ContinuationOverviewPanel', () => ({ ContinuationOverviewPanel: () => <div>概览</div> }));
vi.mock('../components/ContinuationPackView', () => ({ ContinuationPackView: () => <div>资料包</div> }));
vi.mock('../components/WorldBibleOnboarding', () => ({ WorldBibleOnboarding: () => <div>引导</div> }));
vi.mock('../components/world-bible/GlobalSetupTab', () => ({
  GlobalSetupTab: ({ onSave }: { onSave: (outline: string, rules: string) => Promise<void> }) => (
    <button type="button" onClick={() => void onSave('新大纲', '新规则')}>保存全局设定</button>
  ),
}));

import { WorldBibleView } from '../components/WorldBibleView';

function worldIntent(overrides: Partial<WorldCapabilityLaunchIntent> = {}): WorldCapabilityLaunchIntent {
  return {
    novelId: 'n1',
    launchToken: 101,
    capabilityId: 'bible-world-builder',
    artifactKind: 'world',
    ...overrides,
  };
}

describe('WorldBibleView world capability governance', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.characters = [];
    mocks.worldCandidates = [];
    mocks.getDatabaseGenerationSnapshot.mockResolvedValue(7);
    mocks.createCharacter.mockResolvedValue(undefined);
    mocks.updateCharacter.mockResolvedValue(true);
    mocks.deleteCharacter.mockResolvedValue(true);
    mocks.updateNovel.mockResolvedValue(true);
    mocks.importWorldExtraction.mockResolvedValue(undefined);
    mocks.parseDocAsync.mockResolvedValue({ databaseGeneration: 8 });
    mocks.requireResponseDatabaseGeneration.mockReturnValue(7);
    mocks.startWorldJob.mockResolvedValue({ result: { candidate: worldCandidate }, databaseGeneration: 7 });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/generate-bio') return new Response('bio', { status: 200 });
      if (url.includes('/artifacts?kind=character')) return Response.json({ cores: [], candidates: [] });
      if (url.includes('/artifacts?kind=world')) return Response.json({ cores: [], candidates: mocks.worldCandidates });
      if (url.endsWith('/world-candidate-1/accept')) return Response.json({ core: { core: worldCore, version: 1 } });
      if (url.endsWith('/world-candidate-1/reject')) return Response.json({ candidate: { ...worldCandidate, status: 'rejected' } });
      return Response.json({ error: 'unexpected request' }, { status: 500 });
    }));
  });

  test('shows a pending world diff and accepts it without writing readable world fields', async () => {
    localStorage.setItem('inkflow-world-bible-active-tab', 'global');
    mocks.worldCandidates = [worldCandidate];

    render(<WorldBibleView novel={novel} />);

    expect(await screen.findByRole('region', { name: '世界观候选审阅' })).toBeTruthy();
    expect(screen.getByText((_text, element) => element?.tagName === 'LI'
      && element.textContent?.includes('hardRules[0]：added') === true)).toBeTruthy();
    expect(screen.getByText('夜幕降临后，火焰术会唤醒巡夜者。')).toBeTruthy();
    expect(screen.getByText('新增规则会影响现有伏笔')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '接受世界观候选' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/novels/n1/artifacts/candidates/world-candidate-1/accept',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(mocks.updateNovel).not.toHaveBeenCalled();
  });

  test('rejects a pending world candidate without touching readable world fields', async () => {
    localStorage.setItem('inkflow-world-bible-active-tab', 'global');
    mocks.worldCandidates = [worldCandidate];
    render(<WorldBibleView novel={novel} />);

    fireEvent.click(await screen.findByRole('button', { name: '拒绝世界观候选' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/novels/n1/artifacts/candidates/world-candidate-1/reject',
      expect.objectContaining({ method: 'POST' }),
    ));
    await waitFor(() => expect(screen.queryByRole('button', { name: '拒绝世界观候选' })).toBeNull());
    expect(mocks.updateNovel).not.toHaveBeenCalled();
  });

  test('consumes a world launch once and generates a review candidate', async () => {
    const consume = vi.fn();
    const launch = worldIntent();
    const view = render(<WorldBibleView novel={novel} capabilityLaunchIntent={launch} onCapabilityLaunchConsumed={consume} />);

    await waitFor(() => expect(mocks.startWorldJob).toHaveBeenCalledWith(
      '/api/generate-outline',
      expect.objectContaining({ novelId: 'n1', techniqueId: 'bible-world-builder' }),
      expect.any(Object),
      expect.any(AbortSignal),
    ));
    expect(await screen.findByRole('region', { name: '世界观候选审阅' })).toBeTruthy();
    expect(consume).toHaveBeenCalledWith(101);

    view.rerender(<WorldBibleView novel={novel} capabilityLaunchIntent={launch} onCapabilityLaunchConsumed={consume} />);
    expect(mocks.startWorldJob).toHaveBeenCalledTimes(1);
  });

  test('includes the assistant setting seed in the governed world candidate request', async () => {
    const launch = { ...worldIntent({ launchToken: 105 }), seedText: '月蚀时不能点灯' };

    render(<WorldBibleView novel={novel} capabilityLaunchIntent={launch} />);

    await waitFor(() => expect(mocks.startWorldJob).toHaveBeenCalledWith(
      '/api/generate-outline',
      expect.objectContaining({
        novelId: 'n1',
        techniqueId: 'bible-world-builder',
        seedOutline: '月蚀时不能点灯',
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    ));
  });

  test('requires an explicit character target when the protagonist is ambiguous', async () => {
    mocks.characters = [
      { id: 'c1', novelId: 'n1', name: '甲', role: 'protagonist', summary: '', bio: '', traits: [] },
      { id: 'c2', novelId: 'n1', name: '乙', role: 'protagonist', summary: '', bio: '', traits: [] },
    ];
    const launch = worldIntent({ launchToken: 102, capabilityId: 'bible-character-arc', artifactKind: 'character' });
    render(<WorldBibleView novel={novel} capabilityLaunchIntent={launch} />);

    expect(await screen.findByRole('region', { name: '选择角色候选目标' })).toBeTruthy();
    expect(mocks.startWorldJob).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: '角色目标' }), { target: { value: 'c2' } });
    fireEvent.click(screen.getByRole('button', { name: '生成所选角色候选' }));

    await waitFor(() => expect(mocks.startWorldJob).toHaveBeenCalledWith(
      '/api/generate-outline',
      expect.objectContaining({ novelId: 'n1', techniqueId: 'bible-character-arc', characterId: 'c2' }),
      expect.any(Object),
    ));
  });

  test('auto-selects only a unique protagonist for a character launch', async () => {
    mocks.characters = [
      { id: 'c1', novelId: 'n1', name: '唯一主角', role: 'protagonist', summary: '', bio: '', traits: [] },
      { id: 'c2', novelId: 'n1', name: '配角', role: 'supporting', summary: '', bio: '', traits: [] },
    ];
    const launch = worldIntent({ launchToken: 103, capabilityId: 'bible-character-arc', artifactKind: 'character' });
    render(<WorldBibleView novel={novel} capabilityLaunchIntent={launch} />);

    await waitFor(() => expect(mocks.startWorldJob).toHaveBeenCalledWith(
      '/api/generate-outline',
      expect.objectContaining({ novelId: 'n1', techniqueId: 'bible-character-arc', characterId: 'c1' }),
      expect.any(Object),
    ));
    expect(screen.queryByRole('region', { name: '选择角色候选目标' })).toBeNull();
  });

  test('does not replace an invalid explicit character target with the unique protagonist', async () => {
    mocks.characters = [
      { id: 'c1', novelId: 'n1', name: '唯一主角', role: 'protagonist', summary: '', bio: '', traits: [] },
    ];
    const launch = worldIntent({
      launchToken: 104,
      capabilityId: 'bible-character-arc',
      artifactKind: 'character',
      targetEntityId: 'missing-character',
    });

    render(<WorldBibleView novel={novel} capabilityLaunchIntent={launch} />);

    expect(await screen.findByRole('region', { name: '选择角色候选目标' })).toBeTruthy();
    expect(mocks.startWorldJob).not.toHaveBeenCalled();
  });

  test('discards a mixed database-generation snapshot instead of rendering it', async () => {
    localStorage.setItem('inkflow-world-bible-active-tab', 'characters');
    mocks.characters = [
      { id: 'c1', novelId: 'n1', name: '混合快照角色', role: 'protagonist', summary: '', bio: '', traits: [] },
    ];
    mocks.getDatabaseGenerationSnapshot.mockReset()
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(8);

    render(<WorldBibleView novel={novel} />);

    expect((await screen.findByRole('alert')).textContent).toContain('数据库已变化');
    expect(screen.queryByDisplayValue('混合快照角色')).toBeNull();
  });

  test('keeps a local character edit visible when the frozen generation conflicts', async () => {
    localStorage.setItem('inkflow-world-bible-active-tab', 'characters');
    mocks.characters = [
      { id: 'c1', novelId: 'n1', name: '原角色名', role: 'protagonist', summary: '', bio: '', traits: [] },
    ];
    mocks.updateCharacter.mockRejectedValue(Object.assign(new Error('generation conflict'), {
      status: 409,
      code: 'DB_GENERATION_CONFLICT',
    }));

    render(<WorldBibleView novel={novel} />);
    const nameInput = await screen.findByDisplayValue('原角色名');
    fireEvent.change(nameInput, { target: { value: '保留的本地角色名' } });

    await waitFor(() => expect(mocks.updateCharacter).toHaveBeenCalledWith('c1', { name: '保留的本地角色名' }, 7));
    expect(screen.getByDisplayValue('保留的本地角色名')).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('已保留本地输入');
  });

  test('uses the accepted snapshot generation for character create and delete', async () => {
    localStorage.setItem('inkflow-world-bible-active-tab', 'characters');
    mocks.characters = [
      { id: 'c1', novelId: 'n1', name: '待删除角色', role: 'supporting', summary: '', bio: '', traits: [] },
    ];

    render(<WorldBibleView novel={novel} />);
    await screen.findByDisplayValue('待删除角色');
    fireEvent.click(screen.getByRole('button', { name: '新增角色' }));

    await waitFor(() => expect(mocks.createCharacter).toHaveBeenCalledWith(expect.objectContaining({ name: '新人物' }), 7));
    expect(await screen.findByDisplayValue('新人物')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: '删除角色' })[0]);
    await waitFor(() => expect(mocks.deleteCharacter).toHaveBeenCalledWith('c1', 7));
    expect(screen.queryByDisplayValue('待删除角色')).toBeNull();
  });

  test('uses the accepted snapshot generation when saving global world fields', async () => {
    localStorage.setItem('inkflow-world-bible-active-tab', 'global');
    render(<WorldBibleView novel={novel} />);

    fireEvent.click(await screen.findByRole('button', { name: '保存全局设定' }));

    await waitFor(() => expect(mocks.updateNovel).toHaveBeenCalledWith('n1', {
      globalOutline: '新大纲',
      worldRules: '新规则',
    }, 7));
  });

  test('uses the accepted generation for the bio request and final character update', async () => {
    localStorage.setItem('inkflow-world-bible-active-tab', 'characters');
    mocks.characters = [
      { id: 'c-bio', novelId: 'n1', name: '小传角色', role: 'protagonist', summary: '', bio: '旧小传', traits: [] },
    ];
    mocks.getDatabaseGenerationSnapshot.mockReset()
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(7)
      .mockResolvedValue(8);

    render(<WorldBibleView novel={novel} />);
    await screen.findByDisplayValue('小传角色');
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成背景故事' }));

    await waitFor(() => expect(mocks.updateCharacter).toHaveBeenCalledWith('c-bio', { bio: '生成小传' }, 7));
    const bioRequest = vi.mocked(fetch).mock.calls.find(([input]) => String(input) === '/api/generate-bio');
    expect(JSON.parse(String(bioRequest?.[1]?.body))).toMatchObject({ databaseGeneration: 7 });
  });

  test('uses the accepted page generation when parsed import data reports a newer generation', async () => {
    localStorage.setItem('inkflow-world-bible-active-tab', 'global');
    mocks.parseDocAsync.mockResolvedValue({ databaseGeneration: 8, globalOutline: '导入大纲' });
    vi.stubGlobal('FileReader', class {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      readAsDataURL() {
        this.onload?.({ target: { result: 'data:text/plain;base64,6K6+5a6a' } } as unknown as ProgressEvent<FileReader>);
      }
    });
    vi.stubGlobal('alert', vi.fn());

    render(<WorldBibleView novel={novel} />);
    await waitFor(() => expect(mocks.getDatabaseGenerationSnapshot).toHaveBeenCalledTimes(2));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['设定'], '设定.txt', { type: 'text/plain' })] } });

    await waitFor(() => expect(mocks.importWorldExtraction).toHaveBeenCalledWith(expect.objectContaining({
      databaseGeneration: 7,
      globalOutline: '导入大纲',
    })));
  });

});
