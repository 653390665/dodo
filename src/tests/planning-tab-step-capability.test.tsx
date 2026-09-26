/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 批次 C 第 4 条「步骤引用图谱能力卡」（Plan 262 C5）· 推进页运行入口。
 *
 * 只测外部行为：入口可见性（能力步骤 vs 非能力步骤）、点击后调用的能力 id、
 * 成功摘要与失败文案（`code：message`）——不测组件内部 state。
 */
import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { PlanningTab } from '../components/book-factory/PlanningTab';
import { KnowledgeCapabilityRequestError } from '../lib/knowledge-client';

const { runKnowledgeCapabilityMock } = vi.hoisted(() => ({
  runKnowledgeCapabilityMock: vi.fn(),
}));

vi.mock('../lib/knowledge-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/knowledge-client')>();
  return { ...actual, runKnowledgeCapability: runKnowledgeCapabilityMock };
});

vi.mock('../components/ui/app-confirm', () => ({
  appConfirm: vi.fn(async () => true),
  appPrompt: vi.fn(async () => ''),
}));

const mockNovel = {
  id: 'novel-1',
  title: '测试小说',
  projectPreferenceProfile: {
    tags: ['current-step:xiaofeiji-novel-flow:xiaofeiji-novel-flow-step1'],
    weights: { styleWeight: 0.2, characterWeight: 0.2, worldWeight: 0.2, plotWeight: 0.2, pacingWeight: 0.2 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
  },
};

const mockCurrentChapter = {
  id: 'ch-1',
  novelId: 'novel-1',
  title: '第一章',
  content: '',
  sceneBeats: '',
  wordCount: 0,
  order: 1,
  createdAt: 0,
  updatedAt: 0,
};

const defaultProps = {
  renderContextReceipt: () => <div data-testid="context-receipt" />,
  userIntent: '',
  setUserIntent: vi.fn(),
  currentChapter: mockCurrentChapter,
  onGenerateBeats: vi.fn().mockResolvedValue(undefined),
  isGeneratingBeats: false,
  onGenerateContent: vi.fn().mockResolvedValue(undefined),
  isGeneratingContent: false,
  onRewriteSelectedText: vi.fn().mockResolvedValue(undefined),
  onUpdateChapterBeats: vi.fn(),
  generationStatus: null,
  novel: mockNovel as any,
};

function novelAt(flowId: string, stepId: string) {
  return {
    ...mockNovel,
    projectPreferenceProfile: {
      ...mockNovel.projectPreferenceProfile,
      tags: [`current-step:${flowId}:${stepId}`],
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        activeFlowId: flowId,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    },
  };
}

describe('推进页可执行能力（批次 C 第 4 条）', () => {
  beforeEach(() => {
    runKnowledgeCapabilityMock.mockReset();
  });

  test('能力步骤显示运行入口，点击后按声明的 assetId 触发并渲染摘要', async () => {
    runKnowledgeCapabilityMock.mockResolvedValue({
      capabilityId: 'knowledge-extract',
      kind: 'coverage',
      coverage: {
        xigangEntries: 3,
        ledgerInserted: 2,
        ledgerSkipped: 1,
        powerEdgesAdded: 1,
        relicEdgesAdded: 0,
        affinityEdgesAdded: 2,
        residenceEdgesAdded: 0,
        coverage: { characters: 2, items: 1, locations: 3 },
      },
    });

    render(
      <PlanningTab
        {...defaultProps}
        novel={novelAt('book-deconstruction-flow', 'book-deconstruction-flow-step3') as any}
      />
    );

    expect(screen.getByText('可执行能力')).toBeDefined();
    expect(screen.getByText('运行「知识谱系抽取器」')).toBeDefined();

    fireEvent.click(screen.getByTestId('step-capability-run'));

    const result = await screen.findByTestId('step-capability-result');
    expect(result.textContent).toContain('细纲条目 3');
    expect(result.textContent).toContain('图谱边 +3');
    expect(runKnowledgeCapabilityMock).toHaveBeenCalledTimes(1);
    expect(runKnowledgeCapabilityMock.mock.calls[0][0]).toBe('novel-1');
    expect(runKnowledgeCapabilityMock.mock.calls[0][1]).toBe('knowledge-extract');
  });

  test('伏笔诊断步骤渲染核对清单摘要（欠账条数可见）', async () => {
    runKnowledgeCapabilityMock.mockResolvedValue({
      capabilityId: 'foreshadow-settle',
      kind: 'checklist',
      checklist: {
        entries: [],
        arrears: 2,
        openCount: 5,
        settledCount: 1,
        currentChapterOrder: 8,
        summary: '未回收 5 条（其中欠账 2 条）/ 已回收 1 条',
      },
    });

    render(
      <PlanningTab
        {...defaultProps}
        novel={novelAt('xiaofeiji-novel-flow', 'xiaofeiji-novel-flow-step9') as any}
      />
    );

    fireEvent.click(screen.getByTestId('step-capability-run'));

    const result = await screen.findByTestId('step-capability-result');
    expect(result.textContent).toContain('未回收 5 条');
    expect(result.textContent).toContain('欠账 2 条');
    expect(runKnowledgeCapabilityMock.mock.calls[0][1]).toBe('foreshadow-settle');
  });

  test('非能力步骤不显示运行入口（旧行为不变）', () => {
    render(
      <PlanningTab
        {...defaultProps}
        novel={novelAt('xiaofeiji-novel-flow', 'xiaofeiji-novel-flow-step1') as any}
      />
    );

    expect(screen.queryByTestId('step-capability-run')).toBeNull();
    expect(screen.queryByText('可执行能力')).toBeNull();
    expect(runKnowledgeCapabilityMock).not.toHaveBeenCalled();
  });

  test('失败时展示服务端错误码与文案，不假装成功', async () => {
    runKnowledgeCapabilityMock.mockRejectedValue(
      new KnowledgeCapabilityRequestError(409, 'DATABASE_GENERATION_STALE', '数据已更新，请重试')
    );

    render(
      <PlanningTab
        {...defaultProps}
        novel={novelAt('book-deconstruction-flow', 'book-deconstruction-flow-step3') as any}
      />
    );

    fireEvent.click(screen.getByTestId('step-capability-run'));

    const error = await screen.findByTestId('step-capability-error');
    expect(error.textContent).toBe('DATABASE_GENERATION_STALE：数据已更新，请重试');
    expect(screen.queryByTestId('step-capability-result')).toBeNull();
  });
});
