import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ContinuationPack } from '../../shared/types';
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
});
