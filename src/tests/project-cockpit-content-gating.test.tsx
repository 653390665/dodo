import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Chapter, ContinuationPack, Novel } from '../../shared/types';

const api = vi.hoisted(() => ({
  getNovel: vi.fn(),
  listChaptersMetadata: vi.fn(),
  getChapter: vi.fn(),
  listCharacters: vi.fn(),
  listLocations: vi.fn(),
  listItems: vi.fn(),
  listFactions: vi.fn(),
  listContinuationPacks: vi.fn(),
  listSkills: vi.fn(),
}));
const productEvents = vi.hoisted(() => ({ recordProductEvent: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../lib/api', () => api);
vi.mock('../lib/product-events-client', () => productEvents);
vi.mock('../lib/download-client', () => ({ downloadDbBackup: vi.fn() }));

import { ProjectCockpitView } from '../components/ProjectCockpitView';

const novel: Novel = {
  id: 'novel-1', title: '测试作品', authorId: 'local-user', summary: '',
  status: 'ongoing', createdAt: 1, updatedAt: 1,
};

const pack = (id: string, syncStatus: 'not_started' | 'partial' | 'synced' | 'stale' = 'not_started'): ContinuationPack => ({
  id, novelId: novel.id, title: '已确认资料包', status: 'approved',
  sourceDocuments: [], canonFacts: [], characterStates: [], plotState: {
    currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '',
  },
  styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' }, contradictions: [],
  continuationTask: '', createdAt: 1, updatedAt: 2,
  syncState: { status: syncStatus, contentHash: '', pendingRelationshipCount: 0, summary: { characters: 0, locations: 0, items: 0, factions: 0, powerLevels: 0, timelineEvents: 0, relationships: 0 } },
});

const chapter = (overrides: Partial<Chapter> = {}): Chapter => ({
  id: 'chapter-1', novelId: novel.id, title: '第一章', volumeName: '正文', content: '',
  sceneBeats: '', critique: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1, ...overrides,
});

function renderCockpit(
  overrides: Partial<Chapter>,
  packs: ContinuationPack[] = [],
  onStartContinuationWriting = vi.fn(),
  onNavigate = vi.fn(),
  onStartCockpitAction = vi.fn(),
  onSelectChapter = vi.fn(),
  cockpitNovel: Novel = novel,
) {
  const fullChapter = chapter(overrides);
  api.getNovel.mockResolvedValue(cockpitNovel);
  api.listChaptersMetadata.mockResolvedValue([{ ...fullChapter, content: undefined, sceneBeats: undefined, critique: undefined }]);
  api.getChapter.mockResolvedValue(fullChapter);
  api.listContinuationPacks.mockResolvedValue(packs);
  return render(
    <ProjectCockpitView
      novel={cockpitNovel}
      onNavigate={onNavigate}
      onStartCockpitAction={onStartCockpitAction}
      onSelectChapter={onSelectChapter}
      onStartContinuationWriting={onStartContinuationWriting}
    />,
  );
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  productEvents.recordProductEvent.mockClear();
  api.listCharacters.mockResolvedValue([]);
  api.listLocations.mockResolvedValue([]);
  api.listItems.mockResolvedValue([]);
  api.listFactions.mockResolvedValue([]);
  api.listSkills.mockResolvedValue([]);
  api.listContinuationPacks.mockResolvedValue([]);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ hasApiKey: true, livenessStatus: 'connected' }), { status: 200 })));
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('ProjectCockpitView content gating', () => {
  test.each([
    [{ hasApiKey: true, livenessStatus: 'connected' }, 'AI 状态：已连接', 'AI 生成与审阅可用。'],
    [{ hasApiKey: false, livenessStatus: 'disconnected' }, 'AI 状态：未配置', '可继续本地写作、保存和整理设定'],
    [{ hasApiKey: true, livenessStatus: 'unknown' }, 'AI 状态：暂时无法确认', '网络或配置检测暂时不可确认'],
  ])('AI action exposes the shared %s availability state without hiding local editing', async (config, label, helper) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(config), { status: 200 })));
    renderCockpit({ content: '正文内容', sceneBeats: '分镜', wordCount: 4 });

    await waitFor(() => expect(screen.getByTestId('cockpit-llm-availability').textContent).toContain(label));
    expect(screen.getByTestId('cockpit-llm-availability').textContent).toContain(helper);
    expect(screen.getByRole('button', { name: '进入正文编辑' })).toBeTruthy();
  });

  test('network failure shows unknown while preserving the local writing action', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    renderCockpit({ content: '正文内容', sceneBeats: '分镜', wordCount: 4 });

    await waitFor(() => expect(screen.getByTestId('cockpit-llm-availability').textContent).toContain('AI 状态：暂时无法确认'));
    expect(screen.getByRole('button', { name: '进入正文编辑' })).toBeTruthy();
  });

  test('切换作品后旧请求晚返回不会覆盖新作品', async () => {
    const novel2 = { ...novel, id: 'novel-2', title: '第二部' };
    let resolveOldNovel!: (value: Novel) => void;
    let resolveNewNovel!: (value: Novel) => void;
    api.getNovel
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldNovel = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNewNovel = resolve; }));
    api.listChaptersMetadata.mockResolvedValue([]);
    api.listCharacters.mockResolvedValue([]);
    api.listLocations.mockResolvedValue([]);
    api.listItems.mockResolvedValue([]);
    api.listFactions.mockResolvedValue([]);
    api.listContinuationPacks.mockResolvedValue([]);
    api.listSkills.mockResolvedValue([]);

    const { rerender } = render(<ProjectCockpitView novel={novel} onNavigate={vi.fn()} />);
    rerender(<ProjectCockpitView novel={novel2} onNavigate={vi.fn()} />);
    resolveNewNovel(novel2);
    await waitFor(() => expect(screen.getByText('第二部')).toBeTruthy());
    resolveOldNovel(novel);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('第二部')).toBeTruthy();
    expect(screen.queryByText('测试作品')).toBeNull();
  });

  test('资料概览不冒充运行时注入或健康度证明', async () => {
    renderCockpit({});
    await waitFor(() => expect(screen.getByText('作品资料概览 / 已配置')).toBeTruthy());

    expect(screen.getByText(/不代表运行时注入、同步或模型读取证明/)).toBeTruthy();
    expect(screen.queryByText(/Context Receipt|注入矩阵|Live Syncing|Healthy/)).toBeNull();
  });

  test('能力摘要优先显示 v3 生效流程而不是旧流程字段', async () => {
    const v3Novel: Novel = {
      ...novel,
      projectPreferenceProfile: {
        tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
        acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
        activeSeriesId: 'xiaofeiji-novel-flow',
        capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          activeFlowId: 'tomato-platform-flow',
          projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
          favoriteTechniqueIds: [],
        },
      },
    };
    renderCockpit({}, [], vi.fn(), vi.fn(), vi.fn(), vi.fn(), v3Novel);
    await waitFor(() => expect(screen.getByText('流程 · 番茄平台流')).toBeTruthy());

    expect(screen.queryByText('流程 · 长篇商业连载流程')).toBeNull();
  });

  test('unsynced approved pack keeps sync primary and editor entry secondary', async () => {
    const onStartContinuationWriting = vi.fn();
    const onNavigate = vi.fn();
    renderCockpit({}, [pack('pack-approved')], onStartContinuationWriting, onNavigate);
    await waitFor(() => expect(screen.getByRole('button', { name: '接入本章上下文' })).toBeTruthy());

    expect(screen.getByRole('button', { name: '进入正文编辑' })).toBeTruthy();
    expect(screen.getByText(/接入本章上下文是推荐准备动作；也可以先打开编辑器手写正文/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '规划本章分镜' })).toBeNull();
    expect(screen.queryByText('审计本章正文')).toBeNull();
    expect(screen.queryByText('按审稿意见精修')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '进入正文编辑' }));
    expect(productEvents.recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'continuation_skip', stage: 'sync', result: 'success', novelId: novel.id,
      chapterId: 'chapter-1', objectId: 'pack-approved',
    }));
    productEvents.recordProductEvent.mockClear();

    // The component forwards the approved pack ID through its callback.
    fireEvent.click(screen.getByRole('button', { name: '接入本章上下文' }));
    expect(onStartContinuationWriting).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith('world');
    expect(JSON.parse(localStorage.getItem('inkflow-world-bible-sync-intent') || '')).toEqual(expect.objectContaining({ novelId: novel.id, packId: 'pack-approved' }));
  });

  test('有章节时进入正文编辑只选择最新章并启动 resume', async () => {
    const onStartCockpitAction = vi.fn();
    const onSelectChapter = vi.fn();
    const onNavigate = vi.fn();
    renderCockpit({}, [], vi.fn(), onNavigate, onStartCockpitAction, onSelectChapter);
    await waitFor(() => expect(screen.getByRole('button', { name: '进入正文编辑' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '进入正文编辑' }));

    expect(onSelectChapter).toHaveBeenCalledWith(expect.objectContaining({ id: 'chapter-1' }));
    expect(onStartCockpitAction).toHaveBeenCalledWith('resume', 'chapter-1');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(productEvents.recordProductEvent).not.toHaveBeenCalled();
  });

  test('无章节时创建第一章并开始写作触发 resume 且无目标章节', async () => {
    const onStartCockpitAction = vi.fn();
    const onNavigate = vi.fn();
    api.listChaptersMetadata.mockResolvedValue([]);
    api.getChapter.mockResolvedValue(null);
    api.listContinuationPacks.mockResolvedValue([]);
    render(
      <ProjectCockpitView
        novel={novel}
        onNavigate={onNavigate}
        onStartCockpitAction={onStartCockpitAction}
      />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: '创建第一章并开始写作' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '创建第一章并开始写作' }));

    expect(onStartCockpitAction).toHaveBeenCalledWith('resume');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('separates approved and draft packs and exposes writing actions only for approved packs', async () => {
    const draftPack: ContinuationPack = { ...pack('pack-draft'), title: '待审核资料包', status: 'draft' };
    renderCockpit({}, [pack('pack-approved'), draftPack]);
    await waitFor(() => expect(screen.getAllByText('已确认 1 · 待审核 1').length).toBeGreaterThan(0));

    expect(screen.getAllByRole('button', { name: '接入续写' })).toHaveLength(1);
    expect(screen.getByText(/待审核 · 本章接入：未接入/)).toBeTruthy();
  });

  test('chapter with content but no trusted workflow metadata offers audit and continue editing', async () => {
    const onStartCockpitAction = vi.fn();
    renderCockpit({ content: '正文内容', sceneBeats: '分镜', wordCount: 4 }, [], vi.fn(), vi.fn(), onStartCockpitAction);
    await waitFor(() => expect(screen.getByRole('button', { name: '进入正文编辑' })).toBeTruthy());

    expect(screen.getByTestId('cockpit-primary-action')).toBeTruthy();
    expect(screen.getByRole('button', { name: '完成本章' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '进入正文编辑' })).toBeTruthy();
    expect(screen.getByText('精修卡 · 深度AI句式与套话物理抹除器')).toBeTruthy();
    expect(screen.getByText('审稿卡 · 去AI腔腔调与废话净化质检仪')).toBeTruthy();
    expect(screen.queryByText('系统护栏 · 段落情节逻辑检测分析器')).toBeNull();
    expect(screen.queryByText('系统护栏 · 深度AI句式与套话物理抹除器')).toBeNull();
    expect(screen.queryByText('按审稿意见精修')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '完成本章' }));
    expect(onStartCockpitAction).toHaveBeenCalledWith('complete-chapter', 'chapter-1');
  });

  test('synced approved pack does not replace chapter stage with sync', async () => {
    renderCockpit({}, [pack('pack-synced', 'synced')]);
    await waitFor(() => expect(screen.getByRole('button', { name: '进入正文编辑' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: '同步资料包' })).toBeNull();
    expect(screen.getByRole('button', { name: '规划本章分镜' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '进入正文编辑' })).toBeTruthy();
  });

  test('legacy critique without trusted audit metadata still offers audit', async () => {
    renderCockpit({ content: '正文内容', sceneBeats: '分镜', wordCount: 4, critique: '审稿意见' });
    await waitFor(() => expect(screen.getByRole('button', { name: '进入正文编辑' })).toBeTruthy());

    expect(screen.getByRole('button', { name: '完成本章' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '按审稿意见精修' })).toBeNull();
  });
});
