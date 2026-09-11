import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act, waitFor } from '@testing-library/react';
import { ForeshadowingPanel } from '../components/ForeshadowingPanel';
import type { Foreshadowing } from '../../shared/types';

const mocks = vi.hoisted(() => ({
  mockAppConfirm: vi.fn(),
  mockListForeshadowings: vi.fn(),
  mockDeleteForeshadowing: vi.fn(),
}));

vi.mock('../components/ui/app-confirm', () => ({
  appConfirm: (...args: unknown[]) => mocks.mockAppConfirm(...args),
}));

vi.mock('../lib/foreshadowing-client', () => ({
  listForeshadowings: (...args: unknown[]) => mocks.mockListForeshadowings(...args),
  deleteForeshadowing: (...args: unknown[]) => mocks.mockDeleteForeshadowing(...args),
}));

vi.mock('../lib/chapter-client', () => ({
  listChapters: vi.fn().mockResolvedValue([]),
  // ForeshadowingPanel.refresh 会并发调用 listChaptersMetadata；
  // 缺这个导出会变成 unhandled rejection 拖红整个 coverage 跑批。
  listChaptersMetadata: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/db-transport', () => ({
  subscribeToChanges: vi.fn(() => () => {}),
}));

vi.mock('../lib/world-job-client', () => ({
  startWorldJob: vi.fn(),
}));

const sampleForeshadowing: Foreshadowing = {
  id: 'foreshadowing-1',
  novelId: 'novel-1',
  title: '主角身世之谜',
  description: '主角的胎记暗含秘密',
  status: 'planted',
  relatedCharacterIds: [],
  createdAt: 1,
  updatedAt: 1,
};

async function renderAndClickDelete() {
  render(<ForeshadowingPanel novelId="novel-1" />);
  const deleteButton = await screen.findByLabelText('删除伏笔');
  fireEvent.click(deleteButton);
}

describe('破坏性删除确认（ForeshadowingPanel）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockListForeshadowings.mockResolvedValue([sampleForeshadowing]);
    mocks.mockDeleteForeshadowing.mockResolvedValue(true);
  });

  test('appConfirm 返回 false 时不调用删除 client', async () => {
    mocks.mockAppConfirm.mockResolvedValue(false);
    await renderAndClickDelete();
    await waitFor(() => expect(mocks.mockAppConfirm).toHaveBeenCalledTimes(1));
    // 冲刷微任务，确保没有延迟触发的删除调用
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.mockDeleteForeshadowing).not.toHaveBeenCalled();
  });

  test('appConfirm 返回 true 时删除 client 被调用一次', async () => {
    mocks.mockAppConfirm.mockResolvedValue(true);
    await renderAndClickDelete();
    await waitFor(() => expect(mocks.mockDeleteForeshadowing).toHaveBeenCalledTimes(1));
    expect(mocks.mockAppConfirm).toHaveBeenCalledTimes(1);
    expect(mocks.mockAppConfirm).toHaveBeenCalledWith('删除该伏笔？', '删除后不可撤销。', {
      confirmLabel: '删除',
    });
    expect(mocks.mockDeleteForeshadowing).toHaveBeenCalledWith('foreshadowing-1');
  });
});
