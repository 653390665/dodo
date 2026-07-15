import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';

import type { ChapterMetadata, ContinuationPack } from '../../shared/types';
import { OutlineTab } from '../components/book-factory/OutlineTab';

const chapter: ChapterMetadata = {
  id: 'chapter-1',
  novelId: 'novel-1',
  title: '第一章',
  volumeName: '正文卷',
  order: 1,
  wordCount: 100,
  createdAt: 1,
  updatedAt: 1,
};

const approvedPackWithManuscript: ContinuationPack = {
  id: 'pack-1',
  novelId: 'novel-1',
  title: '续写资料包',
  status: 'approved',
  sourceDocuments: [
    { id: 'doc-1', packId: 'pack-1', filename: '正文.txt', kind: 'manuscript', text: '内容', excerpt: '摘要', createdAt: 1 },
    { id: 'doc-2', packId: 'pack-1', filename: '设定.txt', kind: 'world', text: '内容', excerpt: '摘要', createdAt: 1 },
  ],
  canonFacts: [],
  characterStates: [],
  plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
  styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
  contradictions: [],
  continuationTask: '',
  createdAt: 1,
  updatedAt: 1,
};

const approvedPackWithoutManuscript: ContinuationPack = {
  ...approvedPackWithManuscript,
  id: 'pack-2',
  sourceDocuments: [
    { id: 'doc-3', packId: 'pack-2', filename: '设定.txt', kind: 'world', text: '内容', excerpt: '摘要', createdAt: 1 },
  ],
};

const draftPack: ContinuationPack = {
  ...approvedPackWithManuscript,
  id: 'pack-3',
  status: 'draft',
};

describe('OutlineTab - Plan 135 Behavior Tests', () => {
  const defaultProps = {
    expectedWordCount: '' as number | '',
    setExpectedWordCount: vi.fn(),
    onGenerateOutline: vi.fn(async () => {}),
    isGeneratingOutline: false,
    globalOutline: '',
    onGlobalOutlineChange: vi.fn(),
    chapters: [chapter],
    currentChapter: null,
    onSelectChapter: vi.fn(async () => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('approved pack with empty outline shows source counts and manuscript hint', () => {
    render(
      <OutlineTab
        {...defaultProps}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    expect(screen.getByText('资料已读取，尚未生成作品大纲')).toBeDefined();
    expect(screen.getByText(/正文资料: 1 份/)).toBeDefined();
    expect(screen.getByText(/世界设定: 1 份/)).toBeDefined();
    expect(screen.getByText(/导入正文仅作为续写参考，尚未拆分成章节/)).toBeDefined();
  });

  test('approved pack without manuscript docs does not show manuscript hint', () => {
    render(
      <OutlineTab
        {...defaultProps}
        selectedContinuationPack={approvedPackWithoutManuscript}
      />,
    );

    expect(screen.getByText('资料已读取，尚未生成作品大纲')).toBeDefined();
    expect(screen.queryByText(/导入正文仅作为续写参考/)).toBeNull();
  });

  test('draft pack does not show approved pack hint', () => {
    render(
      <OutlineTab
        {...defaultProps}
        selectedContinuationPack={draftPack}
      />,
    );

    expect(screen.queryByText('资料已读取，尚未生成作品大纲')).toBeNull();
  });

  test('no pack does not show approved pack hint', () => {
    render(
      <OutlineTab
        {...defaultProps}
        selectedContinuationPack={null}
      />,
    );

    expect(screen.queryByText('资料已读取，尚未生成作品大纲')).toBeNull();
  });

  test('button shows "根据导入资料生成大纲" for approved pack', () => {
    render(
      <OutlineTab
        {...defaultProps}
        expectedWordCount={100000}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    expect(screen.getByText('根据导入资料生成大纲')).toBeDefined();
  });

  test('button shows "AI 智能排盘" without approved pack', () => {
    render(
      <OutlineTab
        {...defaultProps}
        expectedWordCount={100000}
        selectedContinuationPack={null}
      />,
    );

    expect(screen.getByText('AI 智能排盘')).toBeDefined();
  });

  test('button disabled without expectedWordCount shows tooltip', () => {
    render(
      <OutlineTab
        {...defaultProps}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    const button = screen.getByRole('button', { name: /根据导入资料生成大纲/ });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('title')).toBe('请先填写预计总字数');
  });

  test('button enabled with expectedWordCount', () => {
    render(
      <OutlineTab
        {...defaultProps}
        expectedWordCount={100000}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    const button = screen.getByRole('button', { name: /根据导入资料生成大纲/ });
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  test('textarea disabled during generation', () => {
    render(
      <OutlineTab
        {...defaultProps}
        isGeneratingOutline={true}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea.hasAttribute('disabled')).toBe(true);
  });

  test('input disabled during generation', () => {
    render(
      <OutlineTab
        {...defaultProps}
        isGeneratingOutline={true}
        selectedContinuationPack={approvedPackWithManuscript}
      />,
    );

    const input = screen.getByRole('spinbutton');
    expect(input.hasAttribute('disabled')).toBe(true);
  });
});
