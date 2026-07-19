import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ContinuationPack, Novel } from '../../shared/types';
import { ContinuationImportView } from '../components/ContinuationImportView';

const mocks = vi.hoisted(() => ({
  listNovels: vi.fn(),
  createContinuationImportSession: vi.fn(),
  parseContinuationPack: vi.fn(),
  approveContinuationImport: vi.fn(),
}));

vi.mock('../lib/novel-client', () => ({ listNovels: mocks.listNovels }));
vi.mock('../lib/prompt-client', () => ({
  createContinuationImportSession: mocks.createContinuationImportSession,
  parseContinuationPack: mocks.parseContinuationPack,
}));
vi.mock('../lib/continuation-client', () => ({
  approveContinuationImport: mocks.approveContinuationImport,
}));

const parsedPack: ContinuationPack = {
  id: 'pack-1',
  novelId: 'draft-1',
  title: '测试资料包',
  status: 'draft',
  sourceDocuments: [],
  canonFacts: [],
  characterStates: [],
  plotState: {
    currentTimeline: '当前时间线',
    latestScene: '最新场景',
    unresolvedHooks: [],
    immediateConflict: '当前冲突',
    nextLikelyMove: '下一步',
  },
  styleProfile: {
    pov: '第三人称',
    tense: '过去时',
    pacing: '中等',
    dialogueDensity: '中等',
    proseTraits: [],
    avoidTraits: [],
    sampleEvidence: '',
  },
  contradictions: [],
  continuationTask: '继续写下一章',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const parsedPackWithHighConflict: ContinuationPack = {
  ...parsedPack,
  canonFacts: [{
    id: 'fact-1',
    priority: 'hard',
    category: 'plot',
    text: '主角已经离开王城',
    evidence: '第三章写明主角出城',
  }],
  contradictions: [{
    id: 'conflict-1',
    severity: 'high',
    summary: '主角是否仍在王城',
    conflictingEvidence: ['第三章：主角已出城', '人物小传：主角留在王城'],
    suggestedResolution: '以第三章正文为准',
  }, {
    id: 'conflict-2',
    severity: 'high',
    summary: '关键道具归属冲突',
    conflictingEvidence: ['设定集：道具归主角', '大纲：道具已被反派夺走'],
    suggestedResolution: '以最新大纲为准',
  }],
};

const approvedNovel: Novel = {
  id: 'novel-1',
  title: '测试作品',
  authorId: 'local-user',
  summary: '',
  status: 'ongoing',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

async function renderWithDocument() {
  render(
    <ContinuationImportView
      onBack={() => {}}
      onEnterEditor={() => {}}
    />,
  );
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, {
    target: { files: [new File(['测试正文'], 'story.txt', { type: 'text/plain' })] },
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}

describe('ContinuationImportView parsing state', () => {
  beforeEach(() => {
    mocks.listNovels.mockReset().mockResolvedValue([]);
    mocks.createContinuationImportSession.mockReset().mockResolvedValue('draft-1');
    mocks.parseContinuationPack.mockReset();
    mocks.approveContinuationImport.mockReset();
  });

  test('leaves the 100% parsing screen after a successful parse', async () => {
    mocks.parseContinuationPack.mockImplementation(async (_payload, onProgress) => {
      onProgress?.(100, '解析完成');
      return parsedPack;
    });
    await renderWithDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始解析资料' }));
    expect(screen.getByText('AI 灵感解析控制台')).toBeDefined();

    await waitFor(
      () => expect(screen.queryByText('AI 灵感解析控制台')).toBeNull(),
      { timeout: 1_500 },
    );
    expect(screen.getByText('确认导入并进入续写')).toBeDefined();
  });

  test('returns to the upload screen when parsing fails', async () => {
    mocks.parseContinuationPack.mockRejectedValue(new Error('模型解析失败'));
    await renderWithDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始解析资料' }));
    await waitFor(() => expect(screen.queryByText('AI 灵感解析控制台')).toBeNull());
    expect(screen.getByText('模型解析失败')).toBeDefined();
    const retryButton = screen.getByRole('button', { name: '开始解析资料' }) as HTMLButtonElement;
    expect(retryButton.disabled).toBe(false);
  });

  test('blocks approval until every high conflict has an accepted resolution', async () => {
    mocks.parseContinuationPack.mockResolvedValue(parsedPackWithHighConflict);
    mocks.approveContinuationImport.mockResolvedValue({
      novel: approvedNovel,
      pack: parsedPackWithHighConflict,
    });
    await renderWithDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始解析资料' }));
    await waitFor(
      () => expect(screen.getByText('确认导入并进入续写')).toBeDefined(),
      { timeout: 1_500 },
    );

    expect(screen.getAllByText('高风险')).toHaveLength(2);
    expect(screen.getByText('主角是否仍在王城')).toBeDefined();
    expect(screen.getByText(/第三章：主角已出城/)).toBeDefined();
    expect(screen.getByText(/人物小传：主角留在王城/)).toBeDefined();

    const blockedButton = screen.getByRole('button', { name: '先处理 2 个高风险冲突' }) as HTMLButtonElement;
    expect(blockedButton.disabled).toBe(true);

    const resolutionInput = screen.getByRole('textbox', { name: '冲突方案：主角是否仍在王城' }) as HTMLTextAreaElement;
    const secondResolutionInput = screen.getByRole('textbox', { name: '冲突方案：关键道具归属冲突' }) as HTMLTextAreaElement;
    expect(resolutionInput.value).toBe('以第三章正文为准');
    expect(secondResolutionInput.value).toBe('以最新大纲为准');

    const acceptButtons = screen.getAllByRole('button', { name: '采用此方案' });
    fireEvent.click(acceptButtons[0]);
    expect((screen.getByRole('button', { name: '先处理 1 个高风险冲突' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '采用此方案' }));
    const confirmButton = screen.getByRole('button', { name: '确认并进入续写' }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);

    fireEvent.change(resolutionInput, { target: { value: '以人物小传为准' } });
    expect((screen.getByRole('button', { name: '先处理 1 个高风险冲突' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '采用此方案' }));
    fireEvent.click(screen.getByRole('button', { name: '确认并进入续写' }));

    await waitFor(() => expect(mocks.approveContinuationImport).toHaveBeenCalledTimes(1));
    expect(mocks.approveContinuationImport).toHaveBeenCalledWith(expect.objectContaining({
      packId: 'pack-1',
      conflictResolutions: [{
        contradictionId: 'conflict-1',
        resolution: '以人物小传为准',
      }, {
        contradictionId: 'conflict-2',
        resolution: '以最新大纲为准',
      }],
    }));
  });

  test('keeps approval blocked when no canon facts were extracted', async () => {
    mocks.parseContinuationPack.mockResolvedValue(parsedPack);
    await renderWithDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始解析资料' }));
    await waitFor(
      () => expect(screen.getByText('确认导入并进入续写')).toBeDefined(),
      { timeout: 1_500 },
    );

    expect(screen.getByText(/未提取出足够的关键硬设定/)).toBeDefined();
    const blockedButton = screen.getByRole('button', { name: '需先补充关键硬设定' }) as HTMLButtonElement;
    expect(blockedButton.disabled).toBe(true);
  });
});
