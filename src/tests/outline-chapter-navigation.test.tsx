import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { ChapterMetadata } from '../../shared/types';
import { OutlineTab } from '../components/book-factory/OutlineTab';

const chapter: ChapterMetadata = {
  id: 'chapter-2',
  novelId: 'novel-1',
  title: '第二章',
  volumeName: '正文卷',
  order: 2,
  wordCount: 120,
  createdAt: 1,
  updatedAt: 1,
};

describe('outline chapter navigation', () => {
  test('delegates chapter changes to the guarded async selector', () => {
    const onSelectChapter = vi.fn(async () => {});
    render(
      <OutlineTab
        expectedWordCount=""
        setExpectedWordCount={vi.fn()}
        onGenerateOutline={vi.fn(async () => {})}
        isGeneratingOutline={false}
        globalOutline=""
        onGlobalOutlineChange={vi.fn()}
        chapters={[chapter]}
        currentChapter={null}
        onSelectChapter={onSelectChapter}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /第二章/ }));

    expect(onSelectChapter).toHaveBeenCalledWith(chapter);
  });
});
