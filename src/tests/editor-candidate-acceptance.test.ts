import { act, renderHook } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import type { Chapter, Novel } from '../../shared/types';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow';
import { DEFAULT_SEMANTIC_REVIEW } from '../../shared/lib/quality-contract';

const semanticPass = {
  ...DEFAULT_SEMANTIC_REVIEW,
  status: 'pass' as const,
  checks: DEFAULT_SEMANTIC_REVIEW.checks.map((check) => ({ ...check, status: 'pass' as const, reason: 'fixture pass' })),
};
const polishedContent = Array.from({ length: 110 }, (_, index) => {
  const variants = [
    `雨水从第${index + 1}道石缝里退下去，林舟把铜片贴近门锁，听见里面的回声比潮声慢了半拍。`,
    `守门人移开火把，${index + 1}号墙上的影子断成两截；林舟没有追问，只把袖口的线头压进掌心，给自己留下退路。`,
    `巷口${index + 1}号的脚步停在看不见的位置，桌面那盏灯却向左偏了寸。林舟据此改了站位，门闩随即松动。`,
    `${index + 1}枚铜片边缘刮过锁芯，发出的轻响让屋里的人同时安静。要说的话没有落下，窗纸后的手先收了回去。`,
  ];
  return variants[index % variants.length];
}).join('\n\n');

const mocks = vi.hoisted(() => ({
  acceptChapterContentCandidate: vi.fn(async () => true),
  recordProductEvent: vi.fn(async () => undefined),
  handleRunAudit: vi.fn(async () => undefined),
}));

vi.mock('../lib/chapter-client', () => ({
  acceptChapterContentCandidate: mocks.acceptChapterContentCandidate,
}));
vi.mock('../lib/product-events-client', () => ({ recordProductEvent: mocks.recordProductEvent }));
vi.mock('../lib/hooks/generation/useOutlineGeneration', () => ({
  useOutlineGeneration: () => ({ handleGenerateOutline: vi.fn() }),
}));
vi.mock('../lib/hooks/generation/useDraftGeneration', () => ({
  useDraftGeneration: (args: { setCandidate: (candidate: unknown) => void }) => ({
    handleGenerateBeats: vi.fn(),
    handleGenerateContent: vi.fn(async () => {
      args.setCandidate({
        id: 'candidate-1',
        operation: 'draft',
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        databaseGeneration: 1,
        createdAt: Date.now(),
        baselineHash: computeChapterWorkflowHash('baseline', 'beats'),
        baselineContent: 'baseline',
        content: Array.from({ length: 40 }, (_, index) => [
          `候选场景${index + 1}从一声门响开始，林舟先确认水痕方向，再把手从桌沿收回。`,
          '对方的停顿托住了下一句对白，灯影沿着地面移动，逼得两人的站位同时改变。',
          '他将线索压回袖中，听见远处锁舌回应，局势因此向门外又推进一步。',
          '雨声盖住半句话，留下的空白反而指向更近的危险。',
        ].join('')).join('\n\n'),
        source: 'model',
        quality: { ok: true, violations: [], findings: [], semanticReview: semanticPass, mechanicalReview: { status: 'pass', score: 90, threshold: 85, summary: 'fixture pass', hits: [] } },
      });
    }),
  }),
}));
vi.mock('../lib/hooks/generation/useAuditPolishActions', () => ({
  useAuditPolishActions: (args: { setCandidate: (candidate: unknown) => void }) => ({
    handleRunAudit: mocks.handleRunAudit,
    handleRewriteSelectedText: vi.fn(),
    handlePolishChapterFromAudit: vi.fn(async () => {
      args.setCandidate({
        id: 'candidate-polish', operation: 'polish', novelId: 'novel-1', chapterId: 'chapter-1',
        databaseGeneration: 1, createdAt: Date.now(), baselineHash: computeChapterWorkflowHash('baseline', 'beats'),
        baselineContent: 'baseline', content: polishedContent, reviewIssueIds: ['issue-1'], reviewRecheck: true, source: 'model',
        quality: { ok: true, violations: [], findings: [], semanticReview: semanticPass, mechanicalReview: { status: 'pass', score: 90, threshold: 85, summary: 'fixture pass', hits: [] } },
        workflowMeta: {
          version: 1,
          reviewState: {
            schemaVersion: 1,
            contentHash: computeChapterWorkflowHash(polishedContent, 'beats'),
            gate: 'needs-action',
            lastReviewedAt: 1,
            issues: [{
              id: 'issue-1', source: 'chapter-audit', category: 'style-slop', issueType: 'style-slop',
              severity: 'major', snippet: 'baseline', explanation: 'test issue', recommendedCapabilityIds: [],
              contentHash: computeChapterWorkflowHash('baseline', 'beats'), createdAt: 1, updatedAt: 1, status: 'previewed',
            }],
          },
        },
      });
    }),
  }),
}));

import { useEditorGenerationFlow } from '../lib/hooks/useEditorGenerationFlow';

const novel: Novel = {
  id: 'novel-1', title: '测试作品', authorId: 'user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1,
};
const chapter: Chapter = {
  id: 'chapter-1', novelId: novel.id, title: '第一章', content: 'baseline', sceneBeats: 'beats',
  order: 1, wordCount: 8, createdAt: 1, updatedAt: 1,
};
const otherChapter: Chapter = {
  ...chapter,
  id: 'chapter-2',
  title: '第二章',
  content: 'other baseline',
};

function renderFlow() {
  return renderHook(({ activeChapter }) => {
    const [currentChapter, setCurrentChapter] = useState<Chapter | null>(chapter);
    useEffect(() => {
      if (activeChapter.id !== currentChapter?.id) setCurrentChapter(activeChapter);
    }, [activeChapter, currentChapter?.id]);
    return useEditorGenerationFlow({
      novel,
      currentChapter,
      userIntent: '',
      globalOutline: '',
      expectedWordCount: 1000,
      contentRef: { current: { value: 'baseline' } as HTMLTextAreaElement },
      selectedContinuationPackId: '',
      approvedOutlinePackId: '',
      buildAgentContext: () => ({} as never),
      handleUpdateContent: vi.fn(),
      pushToUndoHistory: vi.fn(),
      setCurrentChapter,
      setGlobalOutline: vi.fn(),
      setUserIntent: vi.fn(),
      getCurrentFitScore: () => 100,
      recordSkillUsage: vi.fn(async () => undefined),
      formatAiFailure: () => 'failed',
      flushPendingEditorWrites: vi.fn(async () => undefined),
      databaseGeneration: 1,
    });
  }, { initialProps: { activeChapter: chapter } });
}

describe('editor manuscript candidate acceptance', () => {
  test('concurrent accept clicks persist the candidate once', async () => {
    mocks.acceptChapterContentCandidate.mockClear();
    mocks.recordProductEvent.mockClear();
    const hook = renderFlow();

    await act(async () => { await hook.result.current.handleGenerateContent(); });
    expect(hook.result.current.aiContentCandidate?.content).toMatch(/候选场景1/);

    let resolveAcceptance!: () => void;
    mocks.acceptChapterContentCandidate.mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolveAcceptance = () => resolve(true); }));
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    await act(async () => {
      first = hook.result.current.acceptAiContentCandidate();
      second = hook.result.current.acceptAiContentCandidate();
      await Promise.resolve();
    });
    expect(mocks.acceptChapterContentCandidate).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAcceptance();
      await Promise.all([first, second]);
    });
    expect(mocks.acceptChapterContentCandidate).toHaveBeenCalledTimes(1);
    expect(mocks.recordProductEvent).toHaveBeenCalledTimes(1);
    expect(hook.result.current.aiContentCandidate).toBeNull();
  });

  test('accepted polish candidate triggers an affected-issue audit recheck', async () => {
    mocks.acceptChapterContentCandidate.mockClear();
    mocks.handleRunAudit.mockClear();
    mocks.acceptChapterContentCandidate.mockResolvedValueOnce(true);
    const hook = renderFlow();

    await act(async () => { await hook.result.current.handlePolishChapterFromAudit(); });
    expect(hook.result.current.aiContentCandidate).toMatchObject({ reviewIssueIds: ['issue-1'], reviewRecheck: true });

    await act(async () => { await hook.result.current.acceptAiContentCandidate(); });
    await act(async () => { await Promise.resolve(); });

    expect(mocks.acceptChapterContentCandidate).toHaveBeenCalledWith(expect.objectContaining({
      workflowMeta: expect.objectContaining({
        reviewState: expect.objectContaining({
          issues: [expect.objectContaining({ id: 'issue-1', status: 'applied' })],
        }),
      }),
    }), 1);

    expect(mocks.handleRunAudit).toHaveBeenCalledWith(expect.objectContaining({
      reviewIssueIds: ['issue-1'],
      reviewScope: 'affected',
      reviewContentHash: computeChapterWorkflowHash(polishedContent, 'beats'),
    }));
    expect(mocks.handleRunAudit).toHaveBeenCalledTimes(1);
  });

  test('chapter switch while acceptance is pending does not recheck the old chapter', async () => {
    mocks.acceptChapterContentCandidate.mockClear();
    mocks.handleRunAudit.mockClear();
    let resolveAcceptance!: (saved: boolean) => void;
    mocks.acceptChapterContentCandidate.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      resolveAcceptance = resolve;
    }));
    const hook = renderFlow();

    await act(async () => { await hook.result.current.handlePolishChapterFromAudit(); });
    let acceptance: Promise<void> | undefined;
    await act(async () => {
      acceptance = hook.result.current.acceptAiContentCandidate();
      await Promise.resolve();
    });
    hook.rerender({ activeChapter: otherChapter });
    await act(async () => {
      resolveAcceptance(true);
      await acceptance;
      await Promise.resolve();
    });

    expect(mocks.handleRunAudit).not.toHaveBeenCalled();
  });

  test('unmount while acceptance is pending does not recheck the old chapter', async () => {
    mocks.acceptChapterContentCandidate.mockClear();
    mocks.handleRunAudit.mockClear();
    let resolveAcceptance!: (saved: boolean) => void;
    mocks.acceptChapterContentCandidate.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      resolveAcceptance = resolve;
    }));
    const hook = renderFlow();

    await act(async () => { await hook.result.current.handlePolishChapterFromAudit(); });
    let acceptance: Promise<void> | undefined;
    await act(async () => {
      acceptance = hook.result.current.acceptAiContentCandidate();
      await Promise.resolve();
    });
    hook.unmount();
    await act(async () => {
      resolveAcceptance(true);
      await acceptance;
      await Promise.resolve();
    });

    expect(mocks.handleRunAudit).not.toHaveBeenCalled();
  });
});
