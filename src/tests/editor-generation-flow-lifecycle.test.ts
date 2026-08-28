import { act, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, test, vi } from 'vitest';
import type { Chapter, Novel } from '../../shared/types';

vi.mock('../lib/hooks/generation/useOutlineGeneration', () => ({
  useOutlineGeneration: () => ({ handleGenerateOutline: vi.fn() }),
}));

type RunningAction = {
  status: 'running';
  operation: 'draft' | 'audit';
  message: string;
};

type DraftHookArgs = {
  requestSeqRef: { current: number };
  setIsGeneratingContent: (value: boolean) => void;
  setGenerationStatus: (value: string | null) => void;
  setAiActionState: (value: RunningAction) => void;
};

type AuditHookArgs = {
  requestSeqRef: { current: number };
  setIsGeneratingCritique: (value: boolean) => void;
  setAuditStatus: (value: string | null) => void;
  setAiActionState: (value: RunningAction) => void;
};

vi.mock('../lib/hooks/generation/useDraftGeneration', () => ({
  useDraftGeneration: (args: DraftHookArgs) => ({
    handleGenerateBeats: vi.fn(),
    handleGenerateContent: vi.fn(async () => {
      args.requestSeqRef.current += 1;
      args.setIsGeneratingContent(true);
      args.setGenerationStatus('正在生成正文');
      args.setAiActionState({ status: 'running', operation: 'draft', message: '正在生成正文' });
    }),
  }),
}));

vi.mock('../lib/hooks/generation/useAuditPolishActions', () => ({
  useAuditPolishActions: (args: AuditHookArgs) => ({
    handleRunAudit: vi.fn(async () => {
      args.requestSeqRef.current += 1;
      args.setIsGeneratingCritique(true);
      args.setAuditStatus('正在审稿');
      args.setAiActionState({ status: 'running', operation: 'audit', message: '正在审稿' });
    }),
    handleRewriteSelectedText: vi.fn(),
    handlePolishChapterFromAudit: vi.fn(),
  }),
}));

import { useEditorGenerationFlow } from '../lib/hooks/useEditorGenerationFlow';

const novel: Novel = {
  id: 'novel-1', title: 'Novel', authorId: 'user', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1,
};
const chapter: Chapter = {
  id: 'chapter-1', novelId: novel.id, title: 'Chapter', content: 'baseline', sceneBeats: 'beats',
  order: 1, wordCount: 8, createdAt: 1, updatedAt: 1,
};

function renderFlow(databaseGeneration = 1) {
  return renderHook(({ generation, autoStart }) => {
    const flow = useEditorGenerationFlow({
      novel,
      currentChapter: chapter,
      userIntent: '',
      globalOutline: '',
      expectedWordCount: 100000,
      contentRef: { current: null },
      selectedContinuationPackId: '',
      approvedOutlinePackId: '',
      buildAgentContext: () => ({} as never),
      handleUpdateContent: vi.fn(),
      pushToUndoHistory: vi.fn(),
      setCurrentChapter: vi.fn(),
      setGlobalOutline: vi.fn(),
      setUserIntent: vi.fn(),
      getCurrentFitScore: () => 100,
      recordSkillUsage: vi.fn(async () => undefined),
      formatAiFailure: () => 'failed',
      flushPendingEditorWrites: vi.fn(async () => undefined),
      databaseGeneration: generation,
    });
    useEffect(() => {
      if (autoStart) void flow.handleGenerateContent();
      // The test intentionally models a later parent effect, such as cockpit auto-start.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoStart, generation]);
    return flow;
  }, { initialProps: { generation: databaseGeneration, autoStart: false } });
}

describe('editor generation flow invalidation', () => {
  test('database generation changes clear every active loading and status flag', async () => {
    const { result, rerender } = renderFlow();
    await act(async () => Promise.resolve());
    await act(async () => result.current.handleGenerateContent());
    expect(result.current.isGeneratingContent).toBe(true);
    expect(result.current.aiActionState.status).toBe('running');

    rerender({ generation: 2, autoStart: false });
    await act(async () => Promise.resolve());

    expect(result.current.isGeneratingContent).toBe(false);
    expect(result.current.isGeneratingOutline).toBe(false);
    expect(result.current.isGeneratingBeats).toBe(false);
    expect(result.current.isGeneratingCritique).toBe(false);
    expect(result.current.generationStatus).toBeNull();
    expect(result.current.auditStatus).toBeNull();
    expect(result.current.aiActionState.status).toBe('idle');
  });

  test('invalidation cleanup cannot erase an action started later in the same effect flush', async () => {
    const { result, rerender } = renderFlow();
    await act(async () => Promise.resolve());

    await act(async () => result.current.handleRunAudit());
    expect(result.current.isGeneratingCritique).toBe(true);
    expect(result.current.aiActionState).toMatchObject({ status: 'running', operation: 'audit' });

    rerender({ generation: 2, autoStart: true });
    await act(async () => Promise.resolve());

    expect(result.current.isGeneratingCritique).toBe(false);
    expect(result.current.isGeneratingContent).toBe(true);
    expect(result.current.aiActionState).toMatchObject({ status: 'running', operation: 'draft' });
  });
});
