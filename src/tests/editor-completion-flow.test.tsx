import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ChapterCompletionReview } from '../components/ChapterCompletionReview';
import { WritingSurface } from '../components/WritingSurface';
import type { Chapter } from '../../shared/types/novel';
import type { AgentTab } from '../../shared/types';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow';

const result = {
  quality: 'unknown' as const,
  phase: 'facts-proposed' as const,
  gate: {
    contentHash: 'content-hash', planHash: 'plan-hash', quality: 'unknown' as const,
    completionGate: 'review-required' as const, deterministicIssues: ['issue-1'], unknownChecks: ['ai-review'],
    reviewRequired: true, canAcceptLocalRevision: true,
  },
};

const reviewIssue = {
  id: 'issue-1', source: 'chapter-audit' as const, severity: 'major' as const,
  explanation: '冲突不足', snippet: '他走进门', suggestedFix: '补充阻力', recommendedCapabilityIds: [],
  status: 'open' as const, contentHash: 'content-hash', createdAt: 1, updatedAt: 1,
};

const novel = { id: 'novel-1', title: '测试作品', authorId: 'local', summary: '', status: 'ongoing' as const, createdAt: 1, updatedAt: 1 };
const chapter = (workflowMeta?: Chapter['workflowMeta']): Chapter => ({
  id: 'chapter-1', novelId: novel.id, title: '第一章', content: '正文', sceneBeats: '分镜', order: 1,
  wordCount: 2, createdAt: 1, updatedAt: 1, workflowMeta,
});

function renderWritingSurface(currentChapter: Chapter, actions: {
  complete?: () => Promise<void>;
  facts?: () => Promise<void>;
  audit?: () => Promise<void>;
  setTab?: (tab: AgentTab) => void;
  setOpen?: (open: boolean) => void;
} = {}) {
  const noop = vi.fn().mockResolvedValue(undefined);
  return render(<WritingSurface
    novel={novel} currentChapter={currentChapter}
    isGeneratingBeats={false} isGeneratingCritique={false} isGeneratingContent={false}
    generationStatus={null} auditStatus={null} isChapterEmpty={false} mountedSkillsCount={0}
    runCopilotAction={noop} contentRef={React.createRef()} onGenerateBeats={noop} onRunAudit={actions.audit || noop}
    onCompleteChapter={actions.complete || noop} onConfirmFacts={actions.facts || noop}
    onUpdateContent={vi.fn()} onQueueContentWrite={vi.fn()} onAddFirstChapter={noop} onAddChapter={noop}
    setAgentTab={actions.setTab || vi.fn()} setIsAgentSidebarOpen={actions.setOpen || vi.fn()} packStatus="none" syncState="not-required"
  />);
}

describe('ChapterCompletionReview', () => {
  test('显示问题和不完整状态，证据默认折叠且不显示分数', () => {
    render(<ChapterCompletionReview result={result} reviewIssues={[reviewIssue]} onReturnToEditing={vi.fn()} onAcceptRisk={vi.fn()} />);
    expect(screen.getByText('发现问题')).toBeTruthy();
    expect(screen.getByText(/AI 检查未完成/)).toBeTruthy();
    expect(screen.getByText('冲突不足')).toBeTruthy();
    expect(screen.getByText('查看证据').parentElement?.hasAttribute('open')).toBe(false);
    expect(screen.queryByText(/分数|score/i)).toBeNull();
  });

  test('统一主动作调用完成和事实确认，且正文保持可编辑', () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const first = renderWritingSurface(chapter(), { complete: onComplete });
    const editor = screen.getByRole('textbox');
    expect(editor.hasAttribute('disabled')).toBe(false);
    expect(editor.hasAttribute('readonly')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '完成本章' }));
    expect(onComplete).toHaveBeenCalledOnce();

    first.unmount();
    const onFacts = vi.fn().mockResolvedValue(undefined);
    renderWritingSurface(chapter({ version: 1, completionGate: 'ready', completionContentHash: computeChapterWorkflowHash('正文', '分镜'), factCandidateId: 'candidate-1', factCandidateRunId: 'run-1' }), { facts: onFacts });
    fireEvent.click(screen.getByRole('button', { name: '确认事实' }));
    expect(onFacts).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox').hasAttribute('readonly')).toBe(false);
  });

  test('处理审阅问题打开质量面板，不重复运行审稿', () => {
    const contentHash = computeChapterWorkflowHash('正文', '分镜');
    const audit = vi.fn().mockResolvedValue(undefined);
    const setTab = vi.fn<(tab: AgentTab) => void>();
    const setOpen = vi.fn<(open: boolean) => void>();
    renderWritingSurface(chapter({ version: 1, reviewState: { schemaVersion: 1, contentHash, issues: [reviewIssue], gate: 'needs-action' } }), { audit, setTab, setOpen });
    fireEvent.click(screen.getByRole('button', { name: '处理审阅问题' }));
    expect(audit).not.toHaveBeenCalled();
    expect(setTab).toHaveBeenCalledWith('quality');
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  test('有正文证据的问题可以启动局部修订预览', () => {
    const onPreviewRevision = vi.fn();
    render(<ChapterCompletionReview result={result} reviewIssues={[reviewIssue]} onReturnToEditing={vi.fn()} onPreviewRevision={onPreviewRevision} />);
    fireEvent.click(screen.getByRole('button', { name: '预览局部修订' }));
    expect(onPreviewRevision).toHaveBeenCalledWith('issue-1');
  });

  test('未审阅风险默认不可接受，确认后绑定当前结果且只能提交一次', async () => {
    const onReturnToEditing = vi.fn();
    const onAcceptRisk = vi.fn();
    render(<ChapterCompletionReview result={result} onReturnToEditing={onReturnToEditing} onAcceptRisk={onAcceptRisk} />);
    fireEvent.click(screen.getByRole('button', { name: '返回编辑' }));
    const accept = screen.getByRole('button', { name: '接受未审阅风险' });
    expect(accept.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: '确认接受未审阅风险' }));
    expect(accept.hasAttribute('disabled')).toBe(false);
    fireEvent.click(accept);
    await waitFor(() => expect(onAcceptRisk).toHaveBeenCalledOnce());
    fireEvent.click(accept);
    expect(onReturnToEditing).toHaveBeenCalledOnce();
    expect(onAcceptRisk).toHaveBeenCalledOnce();
  });

  test('接受请求进行中防双击，失败后保留确认并可重试', async () => {
    let resolve!: (value: boolean) => void;
    const onAcceptRisk = vi.fn(() => new Promise<boolean>((next) => { resolve = next; }));
    render(<ChapterCompletionReview result={result} onReturnToEditing={vi.fn()} onAcceptRisk={onAcceptRisk} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '确认接受未审阅风险' }));
    const accept = screen.getByRole('button', { name: '接受未审阅风险' });
    fireEvent.click(accept);
    fireEvent.click(accept);
    expect(onAcceptRisk).toHaveBeenCalledOnce();
    expect(accept.hasAttribute('disabled')).toBe(true);
    resolve(false);
    await waitFor(() => expect(accept.hasAttribute('disabled')).toBe(false));
    expect((screen.getByRole('checkbox', { name: '确认接受未审阅风险' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(accept);
    expect(onAcceptRisk).toHaveBeenCalledTimes(2);
  });

  test('接受成功后不能再次提交', async () => {
    const onAcceptRisk = vi.fn().mockResolvedValue(true);
    render(<ChapterCompletionReview result={result} onReturnToEditing={vi.fn()} onAcceptRisk={onAcceptRisk} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '确认接受未审阅风险' }));
    const accept = screen.getByRole('button', { name: '接受未审阅风险' });
    fireEvent.click(accept);
    await waitFor(() => expect(accept.hasAttribute('disabled')).toBe(true));
    fireEvent.click(accept);
    expect(onAcceptRisk).toHaveBeenCalledOnce();
  });

  test('格式通过但语义审阅未知时不显示整体检查通过', () => {
    const partiallyReviewed = { ...result, quality: 'pass' as const, gate: { ...result.gate, deterministicIssues: [], unknownChecks: ['ai-review'], completionGate: 'review-required' as const } };
    render(<ChapterCompletionReview result={partiallyReviewed} onReturnToEditing={vi.fn()} onAcceptRisk={vi.fn()} />);
    expect(screen.getByText('格式检查通过，语义审阅未完成')).toBeTruthy();
    expect(screen.queryByText('检查通过')).toBeNull();
  });

  test('结果哈希变化后必须重新确认风险', () => {
    const onAcceptRisk = vi.fn();
    const { rerender } = render(<ChapterCompletionReview result={result} onReturnToEditing={vi.fn()} onAcceptRisk={onAcceptRisk} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '确认接受未审阅风险' }));
    const changed = { ...result, gate: { ...result.gate, contentHash: 'new-content-hash' } };
    rerender(<ChapterCompletionReview result={changed} onReturnToEditing={vi.fn()} onAcceptRisk={onAcceptRisk} />);
    expect(screen.getByRole('button', { name: '接受未审阅风险' }).hasAttribute('disabled')).toBe(true);
    expect(onAcceptRisk).not.toHaveBeenCalled();
  });
});
