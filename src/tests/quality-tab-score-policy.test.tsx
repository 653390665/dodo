/**
 * Plan 262 B2：治理推荐卡面的评分口径展示（口径文案与徽标都取自单源模块）。
 */
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { QualityTab } from '../components/book-factory/QualityTab';
import { SCORE_POLICY_SUMMARY, scoreBadgeLabel } from '../../shared/lib/prompt-score-policy';
import type { Chapter, Novel } from '../../shared/types';

vi.mock('../../shared/lib/prompt-assets-governed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/lib/prompt-assets-governed')>();
  const catalog = await import('../../shared/lib/prompt-governance-catalog');
  const base = catalog.PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === 'opening-templates-library');
  if (!base) throw new Error('夹具来源卡缺失');
  return {
    ...actual,
    recommendPromptAssets: () => [
      { ...base, id: 'score-policy-fixture-78', score: 78, sourceType: 'built-in' },
      { ...base, id: 'score-policy-fixture-63', score: 63, sourceType: 'built-in' },
    ],
  };
});

vi.mock('../lib/capability-governance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/capability-governance')>();
  return { ...actual, getOptionalStyleAssets: () => [] };
});

const novel: Novel = {
  id: 'novel-1',
  title: '作品',
  authorId: 'local',
  summary: '',
  status: 'ongoing',
  createdAt: 1,
  updatedAt: 1,
};

const chapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  title: '第一章',
  content: '正文',
  order: 1,
  wordCount: 2,
  createdAt: 1,
  updatedAt: 1,
  critique: '审计报告',
};

function renderQualityTab() {
  return render(
    <QualityTab
      currentChapter={chapter}
      novel={novel}
      onRunAudit={async () => {}}
      isGeneratingCritique={false}
      onPolishChapterFromAudit={async () => {}}
      isGeneratingContent={false}
    />
  );
}

describe('QualityTab 评分口径（Plan 262 B2）', () => {
  test('推荐区展示单源口径说明，卡面徽标带分档与准入结论', () => {
    renderQualityTab();
    const note = screen.getByTestId('score-policy-note');
    expect(note.textContent).toBe(SCORE_POLICY_SUMMARY);
    expect(SCORE_POLICY_SUMMARY).toContain('≥70 分可装配');
    expect(SCORE_POLICY_SUMMARY).toContain('60–69 分仅候选');

    const adoptable = screen.getByText(scoreBadgeLabel(78));
    expect(scoreBadgeLabel(78)).toBe('C级 (78分) · 可装配');
    expect(adoptable.getAttribute('title')).toBe(SCORE_POLICY_SUMMARY);

    expect(screen.getByText(scoreBadgeLabel(63))).toBeTruthy();
    expect(scoreBadgeLabel(63)).toBe('D级 (63分) · 仅候选');
  });
});
