import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QualityTab } from '../components/book-factory/QualityTab';
import type { Chapter, Novel } from '../../shared/types';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow';

const novel: Novel = { id: 'novel-1', title: '作品', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 };
const chapter: Chapter = { id: 'chapter-1', novelId: 'novel-1', title: '第一章', content: '正文', order: 1, wordCount: 2, createdAt: 1, updatedAt: 1, critique: '审计报告' };

describe('QualityTab review issue journey', () => {
  test('shows severity, status, recommendation and scope and routes issue actions', () => {
    const onPreview = vi.fn();
    const onFix = vi.fn();
    const onAccept = vi.fn();
    const onDefer = vi.fn();
    render(
      <QualityTab
        currentChapter={chapter}
        novel={novel}
        onRunAudit={vi.fn().mockResolvedValue(undefined)}
        isGeneratingCritique={false}
        onPolishChapterFromAudit={vi.fn().mockResolvedValue(undefined)}
        isGeneratingContent={false}
        reviewIssues={[{ id: 'issue-1', source: 'utility', severity: 'critical', status: 'open', explanation: '动作断裂', suggestedFix: '补足动作链', recommendedCapabilityIds: [], contentHash: 'hash', createdAt: 1, updatedAt: 1 }]}
        onPreviewReviewIssue={onPreview}
        onFixReviewIssues={onFix}
        onAcceptReviewIssueRisk={onAccept}
        onDeferReviewIssue={onDefer}
      />
    );
    expect(screen.getByText('严重')).toBeTruthy();
    expect(screen.getByText('待处理')).toBeTruthy();
    expect(screen.getByText('补足动作链')).toBeTruthy();
    expect(screen.getByText('作用域：本章')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '预览修正：动作断裂' }));
    fireEvent.click(screen.getByRole('button', { name: '修正并复审：动作断裂' }));
    fireEvent.click(screen.getByRole('button', { name: '接受风险：动作断裂' }));
    fireEvent.click(screen.getByRole('button', { name: '延期到后续章节：动作断裂' }));
    expect(onPreview).toHaveBeenCalledWith('issue-1');
    expect(onFix).toHaveBeenCalledWith(['issue-1'], '本章');
    expect(onAccept).toHaveBeenCalledWith('issue-1');
    expect(onDefer).toHaveBeenCalledWith('issue-1');
  });

  test('updates sync action results and rolls back rejected async decisions', async () => {
    render(
      <QualityTab
        currentChapter={chapter}
        novel={novel}
        onRunAudit={vi.fn().mockResolvedValue(undefined)}
        isGeneratingCritique={false}
        onPolishChapterFromAudit={vi.fn().mockResolvedValue(undefined)}
        isGeneratingContent={false}
        reviewIssues={[{ id: 'issue-1', source: 'utility', severity: 'major', status: 'open', explanation: '动作断裂', suggestedFix: '补足动作链', recommendedCapabilityIds: [], contentHash: 'hash', createdAt: 1, updatedAt: 1 }]}
        onFixReviewIssues={vi.fn()}
        onAcceptReviewIssueRisk={vi.fn().mockRejectedValue(new Error('保存失败'))}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '修正并复审：动作断裂' }));
    expect(screen.getByText('修正候选待确认')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '接受风险：动作断裂' }));
    await waitFor(() => expect(screen.getByText('修正候选待确认')).toBeTruthy());
    expect(screen.queryByText('已接受风险')).toBeNull();
  });

  test('shows semantic evidence only while the reviewed content hash is current', () => {
    const contentHash = computeChapterWorkflowHash(chapter.content, chapter.sceneBeats);
    const reviewedChapter: Chapter = {
      ...chapter,
      workflowMeta: {
        version: 1,
        reviewState: {
          schemaVersion: 1,
          contentHash,
          gate: 'needs-action',
          issues: [],
          semanticReview: {
            status: 'needs-action',
            checks: [{
              id: 'character-consistency', status: 'needs-action', category: 'semantic-review',
              reason: '人物一致性存在审稿证据，需要修复后复核。',
              evidence: [{ quote: '他答应了', explanation: '动机没有铺垫', suggestedFix: '补充犹豫与代价', severity: 'medium', location: '第 2 段' }],
            }],
          },
        },
      },
    };
    const props = {
      novel,
      onRunAudit: vi.fn().mockResolvedValue(undefined),
      isGeneratingCritique: false,
      onPolishChapterFromAudit: vi.fn().mockResolvedValue(undefined),
      isGeneratingContent: false,
    };
    const view = render(<QualityTab {...props} currentChapter={reviewedChapter} />);

    expect(screen.getByText('人物一致性：需处理')).toBeTruthy();
    expect(screen.getByText(/“他答应了”（第 2 段）：动机没有铺垫 建议：补充犹豫与代价/)).toBeTruthy();

    view.rerender(<QualityTab {...props} currentChapter={{ ...reviewedChapter, content: '正文已修改' }} />);
    expect(screen.getByText('当前正文尚无有效语义审阅，或正文已在审稿后变化，请重新审稿。')).toBeTruthy();
    expect(screen.queryByText('人物一致性：需处理')).toBeNull();
  });
});
