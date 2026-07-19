import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { ChapterProductionRun } from '../../shared/types';
import { ProductionRunReview } from '../components/ProductionRunReview';

const listChapterProductionRunsMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/chapter-production-db-client', () => ({
  listChapterProductionRuns: listChapterProductionRunsMock,
}));

function createRun(
  id: string,
  status: ChapterProductionRun['status'],
  draftContent: string,
): ChapterProductionRun {
  return {
    id,
    novelId: 'novel-1',
    status,
    userIntent: `${id} intent`,
    sceneBeats: `${id} beats`,
    draftContent,
    styleAudit: '',
    continuityReport: {
      score: 100,
      issues: [],
      proposedPatch: {
        characterUpdates: [],
        itemUpdates: [],
        foreshadowingUpdates: [],
        timelineEventsToCreate: [],
        foreshadowingsToCreate: [],
      },
    },
    createdAt: id === 'old-run' ? 1 : 2,
    updatedAt: id === 'old-run' ? 1 : 2,
  };
}

function renderReview(
  run: ChapterProductionRun,
  running: boolean,
  onApply = vi.fn(),
) {
  render(
    <ProductionRunReview
      run={run}
      userIntent=""
      running={running}
      applying={false}
      novelId="novel-1"
      onIntentChange={vi.fn()}
      onStart={vi.fn()}
      onApply={onApply}
    />,
  );
  return onApply;
}

describe('ProductionRunReview', () => {
  beforeEach(() => {
    listChapterProductionRunsMock.mockReset();
  });

  test('does not expose an older review result while a new production run is active', async () => {
    const oldRun = createRun('old-run', 'review_required', 'old completed draft');
    const newRun = createRun('new-run', 'running', '');
    listChapterProductionRunsMock.mockResolvedValue([oldRun]);
    const onApply = renderReview(newRun, true);

    await waitFor(() => expect(listChapterProductionRunsMock).toHaveBeenCalledWith('novel-1'));

    expect(screen.queryByText('old completed draft')).toBeNull();
    const applyButton = screen.getByRole('button', { name: '接受并写入' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
  });

  test('does not apply a recovered historical run as the active run', async () => {
    const oldRun = createRun('old-run', 'review_required', 'old completed draft');
    const stalePlaceholder = createRun('new-run', 'running', '');
    listChapterProductionRunsMock.mockResolvedValue([oldRun]);
    const onApply = renderReview(stalePlaceholder, false);

    await screen.findByText('old completed draft');

    const applyButton = screen.getByRole('button', { name: '接受并写入' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
  });

  test('allows applying the completed active review run', async () => {
    const activeRun = createRun('active-run', 'review_required', 'active completed draft');
    listChapterProductionRunsMock.mockResolvedValue([]);
    const onApply = renderReview(activeRun, false);

    await waitFor(() => expect(listChapterProductionRunsMock).toHaveBeenCalledWith('novel-1'));
    const applyButton = screen.getByRole('button', { name: '接受并写入' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(false);
    fireEvent.click(applyButton);
    expect(onApply).toHaveBeenCalledWith(activeRun);
  });
});
