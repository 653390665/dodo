import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { OutlineTab } from '../components/book-factory/OutlineTab';

const pack = {
  id: 'pack-1', novelId: 'novel-1', title: '资料包', status: 'approved' as const,
  sourceDocuments: [
    { id: 'outline-1', packId: 'pack-1', kind: 'outline' as const, filename: '主纲.md', text: '主纲', excerpt: '', createdAt: 1 },
    { id: 'report-1', packId: 'pack-1', kind: 'outline' as const, filename: '审稿报告.md', text: '审稿问题清单', excerpt: '', createdAt: 1 },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `ref-${i}`, packId: 'pack-1', kind: 'world' as const, filename: `参考${i}`, text: `参考${i}`, excerpt: '', createdAt: 1 })),
  ],
  canonFacts: [], characterStates: [],
  plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
  styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
  contradictions: [], continuationTask: '', createdAt: 1, updatedAt: 1,
};

describe('OutlineTab input selection', () => {
  test('keeps reports out of primary choices and limits references to five', () => {
    render(<OutlineTab expectedWordCount={100} setExpectedWordCount={vi.fn()} onGenerateOutline={vi.fn(async () => {})} isGeneratingOutline={false} globalOutline="" onGlobalOutlineChange={vi.fn()} chapters={[]} currentChapter={null} onSelectChapter={vi.fn()} selectedContinuationPack={pack} />);
    expect(screen.queryByRole('radio', { name: /审稿报告/ })).toBeNull();
    const references = screen.getAllByRole('checkbox');
    expect(references.length).toBeGreaterThan(0);
    references.slice(0, 6).forEach((input) => fireEvent.click(input));
    expect(references.filter((input) => (input as HTMLInputElement).disabled)).toHaveLength(1);
  });
});
