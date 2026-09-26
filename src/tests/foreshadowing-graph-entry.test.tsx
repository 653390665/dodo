/**
 * Plan 262 D2 · 伏笔面板图谱维护入口（ForeshadowingPanel × KnowledgeMaintenancePanel）。
 *
 * 验收：
 * ① 入口默认收起、不挂载维护面板（无网络调用）；
 * ② 展开后出现「从资料包重跑摄入」，且展开本身不触发重跑；
 * ③ 点击重跑以 novelId 调用 runKnowledgeExtract，成功后刷新伏笔列表（onCompleted）；
 * ④ 再次点击入口收起，面板从 DOM 移除。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { runKnowledgeExtractMock, listForeshadowingsMock, toastMock } = vi.hoisted(() => ({
  runKnowledgeExtractMock: vi.fn(),
  listForeshadowingsMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('../lib/knowledge-client', () => ({
  runKnowledgeExtract: runKnowledgeExtractMock,
  KnowledgeCapabilityRequestError: class KnowledgeCapabilityRequestError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'KnowledgeCapabilityRequestError';
      this.status = status;
      this.code = code;
    }
  },
}));
vi.mock('../lib/chapter-client', () => ({
  listChapters: vi.fn(),
  listChaptersMetadata: vi.fn().mockResolvedValue([]),
  getChapter: vi.fn(),
}));
vi.mock('../lib/foreshadowing-client', () => ({
  listForeshadowings: listForeshadowingsMock,
  createForeshadowing: vi.fn(),
  updateForeshadowing: vi.fn(),
  deleteForeshadowing: vi.fn(),
}));
vi.mock('../lib/world-job-client', () => ({ startWorldJob: vi.fn() }));
vi.mock('../lib/db-transport', () => ({ subscribeToChanges: () => () => {} }));
vi.mock('../lib/toast', () => ({ toast: toastMock }));

import { ForeshadowingPanel } from '../components/ForeshadowingPanel';

const successReport = {
  capabilityId: 'knowledge-extract',
  kind: 'coverage' as const,
  coverage: {
    xigangEntries: 4,
    ledgerInserted: 2,
    ledgerSkipped: 1,
    ledgerBackfilled: 0,
    powerEdgesAdded: 1,
    relicEdgesAdded: 0,
    affinityEdgesAdded: 0,
    residenceEdgesAdded: 0,
    relicUnmatched: [],
    relationshipTypesNormalized: 0,
    coverage: {
      characters: 1,
      items: 0,
      locations: 0,
      factions: 0,
      powerLevels: 0,
      timelineEvents: 0,
      foreshadowings: 2,
      edges: 3,
      staleLedger: 0,
      staleEdges: 0,
    },
  },
};

beforeEach(() => {
  runKnowledgeExtractMock.mockReset();
  listForeshadowingsMock.mockReset();
  toastMock.mockReset();
  listForeshadowingsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('ForeshadowingPanel 图谱维护入口（D2）', () => {
  test('默认收起：入口可见、维护面板未挂载、零网络调用', async () => {
    render(<ForeshadowingPanel novelId="novel-1" />);
    const entry = await screen.findByRole('button', { name: /图谱维护：资料包知识谱系/ });
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('knowledge-maintenance-panel')).toBeNull();
    expect(runKnowledgeExtractMock).not.toHaveBeenCalled();
  });

  test('展开后出现重跑按钮，展开本身不触发重跑', async () => {
    render(<ForeshadowingPanel novelId="novel-1" />);
    const entry = await screen.findByRole('button', { name: /图谱维护：资料包知识谱系/ });
    fireEvent.click(entry);
    expect(await screen.findByTestId('knowledge-maintenance-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: /从资料包重跑摄入/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /图谱维护：资料包知识谱系/ }).getAttribute('aria-expanded')).toBe('true');
    expect(runKnowledgeExtractMock).not.toHaveBeenCalled();
  });

  test('重跑以 novelId 调内核，成功后刷新伏笔列表', async () => {
    runKnowledgeExtractMock.mockResolvedValue(successReport);
    render(<ForeshadowingPanel novelId="novel-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /图谱维护：资料包知识谱系/ }));
    const callsBefore = listForeshadowingsMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /从资料包重跑摄入/ }));
    await waitFor(() => expect(runKnowledgeExtractMock).toHaveBeenCalledWith('novel-1'));
    await waitFor(() =>
      expect(listForeshadowingsMock.mock.calls.length).toBeGreaterThan(callsBefore)
    );
    expect(await screen.findByText(/台账新增 2/)).toBeTruthy();
  });

  test('再次点击入口收起，面板从 DOM 移除', async () => {
    render(<ForeshadowingPanel novelId="novel-1" />);
    const entry = await screen.findByRole('button', { name: /图谱维护：资料包知识谱系/ });
    fireEvent.click(entry);
    expect(await screen.findByTestId('knowledge-maintenance-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /图谱维护：资料包知识谱系/ }));
    await waitFor(() => expect(screen.queryByTestId('knowledge-maintenance-panel')).toBeNull());
  });
});
