/**
 * 批次 D · 记忆健康度看板挂载验收：驾驶舱右栏渲染面板，且数值来自客户端取数（服务端快照）。
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Chapter, Novel } from '../../shared/types';

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
const productEvents = vi.hoisted(() => ({
  recordProductEvent: vi.fn().mockResolvedValue(undefined),
}));
const { fetchMemoryHealthMock } = vi.hoisted(() => ({ fetchMemoryHealthMock: vi.fn() }));

vi.mock('../lib/api', () => api);
vi.mock('../lib/product-events-client', () => productEvents);
vi.mock('../lib/download-client', () => ({ downloadDbBackup: vi.fn() }));
vi.mock('../lib/knowledge-client', () => ({ fetchMemoryHealth: fetchMemoryHealthMock }));

import { ProjectCockpitView } from '../components/ProjectCockpitView';
import { buildMemoryHealthMetrics } from '../../shared/lib/memory-health';

const novel: Novel = {
  id: 'novel-1',
  title: '测试作品',
  authorId: 'local-user',
  summary: '',
  status: 'ongoing',
  createdAt: 1,
  updatedAt: 1,
};

const chapter: Chapter = {
  id: 'chapter-1',
  novelId: novel.id,
  title: '第一章',
  volumeName: '正文',
  content: '',
  sceneBeats: '',
  critique: '',
  order: 1,
  wordCount: 0,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  productEvents.recordProductEvent.mockClear();
  fetchMemoryHealthMock.mockReset();
  api.getNovel.mockResolvedValue(novel);
  api.listChaptersMetadata.mockResolvedValue([
    { ...chapter, content: undefined, sceneBeats: undefined, critique: undefined },
  ]);
  api.getChapter.mockResolvedValue(chapter);
  api.listCharacters.mockResolvedValue([]);
  api.listLocations.mockResolvedValue([]);
  api.listItems.mockResolvedValue([]);
  api.listFactions.mockResolvedValue([]);
  api.listContinuationPacks.mockResolvedValue([]);
  api.listSkills.mockResolvedValue([]);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ hasApiKey: true, livenessStatus: 'connected' }), {
          status: 200,
        })
    )
  );
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('驾驶舱记忆健康度挂载', () => {
  test('驾驶舱渲染面板，并显示服务端返回的五项指标', async () => {
    fetchMemoryHealthMock.mockResolvedValue({
      novelId: novel.id,
      computedAt: '2026-09-27T00:00:00.000Z',
      metrics: buildMemoryHealthMetrics({
        openForeshadowings: 3,
        foreshadowArrears: 2,
        orphanNodes: 2,
        staleLedger: 1,
        staleEdges: 1,
        ragHits: 4,
      }),
      evidence: {
        packDocuments: 1,
        foreshadowingRows: 3,
        relationshipRows: 1,
        entityRows: 4,
        orphanRows: 2,
        indexedChunks: 6,
        embeddingStatus: 'ready',
        ragQueryChapterId: 'chapter-1',
      },
    });

    render(<ProjectCockpitView novel={novel} onNavigate={vi.fn()} />);

    const panel = await screen.findByTestId('memory-health-panel');
    expect(fetchMemoryHealthMock).toHaveBeenCalledWith(novel.id, expect.anything());
    await waitFor(() =>
      expect(screen.getByTestId('memory-health-metric-openForeshadowings').textContent).toContain('3')
    );
    expect(panel.textContent).toContain('未回收伏笔');
    expect(screen.getByTestId('memory-health-metric-orphanNodes').textContent).toContain('2');
    expect(screen.getByTestId('memory-health-metric-staleKnowledge').textContent).toContain('2');
    expect(screen.getByTestId('memory-health-metric-ragHits').textContent).toContain('4');
  });

  test('读取失败时面板仍可见且五项显示未知', async () => {
    fetchMemoryHealthMock.mockRejectedValue(new Error('记忆健康度读取失败，请稍后重试。'));

    render(<ProjectCockpitView novel={novel} onNavigate={vi.fn()} />);

    await screen.findByTestId('memory-health-panel');
    await waitFor(() => expect(screen.getAllByText('未知').length).toBe(5));
  });
});
