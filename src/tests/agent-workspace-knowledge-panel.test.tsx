import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { AgentWorkspaceKnowledgePanel } from '../components/AgentWorkspaceKnowledgePanel';
import type { Novel, ProjectPreferenceProfile } from '../../shared/types';

describe('AgentWorkspaceKnowledgePanel Debounce and Sync Suite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const dummyNovel: Novel = {
    id: 'novel-1',
    title: 'Test Novel',
    authorId: 'author-1',
    summary: 'A test novel',
    status: 'ongoing',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const dummyProfile: ProjectPreferenceProfile = {
    tags: [],
    weights: {
      styleWeight: 1,
      characterWeight: 1,
      worldWeight: 1,
      plotWeight: 1,
      pacingWeight: 1,
    },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    commercialMode: 'free',
  };

  test('localSearch updates instantly on user input, but setBibleSearch is debounced by 150ms', () => {
    const setBibleSearchMock = vi.fn();

    render(
      <AgentWorkspaceKnowledgePanel
        agentTab="bible"
        novel={dummyNovel}
        currentChapter={null}
        bibleSearch=""
        setBibleSearch={setBibleSearchMock}
        characters={[]}
        locations={[]}
        items={[]}
        continuationPacks={[]}
        selectedContinuationPackId=""
        librarySkills={[]}
        skillUsageRecords={[]}
        mountedSkillLoadout={[]}
        onAssignSkill={async () => {}}
        onRemoveSkill={async () => {}}
        projectPreferenceProfile={dummyProfile}
        onPreferenceProfileChange={async () => {}}
      />
    );

    const input = screen.getByPlaceholderText('检索资料包、角色、地点、道具...') as HTMLInputElement;
    expect(input.value).toBe('');

    // Simulate user typing a character
    fireEvent.change(input, { target: { value: '林' } });

    // Value must update instantly in local search
    expect(input.value).toBe('林');

    // Parent search should not be updated immediately
    expect(setBibleSearchMock).not.toHaveBeenCalled();

    // Advance timers by 100ms (less than 150ms)
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(setBibleSearchMock).not.toHaveBeenCalled();

    // Advance remaining 50ms (total 150ms)
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(setBibleSearchMock).toHaveBeenCalledWith('林');
    expect(setBibleSearchMock).toHaveBeenCalledTimes(1);
  });

  test('multiple keystrokes within 150ms are debounced and only execute once with the final value', () => {
    const setBibleSearchMock = vi.fn();

    render(
      <AgentWorkspaceKnowledgePanel
        agentTab="bible"
        novel={dummyNovel}
        currentChapter={null}
        bibleSearch=""
        setBibleSearch={setBibleSearchMock}
        characters={[]}
        locations={[]}
        items={[]}
        continuationPacks={[]}
        selectedContinuationPackId=""
        librarySkills={[]}
        skillUsageRecords={[]}
        mountedSkillLoadout={[]}
        onAssignSkill={async () => {}}
        onRemoveSkill={async () => {}}
        projectPreferenceProfile={dummyProfile}
        onPreferenceProfileChange={async () => {}}
      />
    );

    const input = screen.getByPlaceholderText('检索资料包、角色、地点、道具...') as HTMLInputElement;

    // Fast sequential typing
    fireEvent.change(input, { target: { value: '林' } });
    act(() => { vi.advanceTimersByTime(50); });

    fireEvent.change(input, { target: { value: '林砚' } });
    act(() => { vi.advanceTimersByTime(50); });

    fireEvent.change(input, { target: { value: '林砚的' } });
    act(() => { vi.advanceTimersByTime(50); });

    // Since each stroke is within 50ms, parent should not have been called yet
    expect(setBibleSearchMock).not.toHaveBeenCalled();

    // Now let 150ms pass without typing
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(setBibleSearchMock).toHaveBeenCalledTimes(1);
    expect(setBibleSearchMock).toHaveBeenCalledWith('林砚的');
  });

  test('hot synchronization: parent prop update is synced to localSearch but does NOT trigger feedback loop', () => {
    const setBibleSearchMock = vi.fn();

    const { rerender } = render(
      <AgentWorkspaceKnowledgePanel
        agentTab="bible"
        novel={dummyNovel}
        currentChapter={null}
        bibleSearch=""
        setBibleSearch={setBibleSearchMock}
        characters={[]}
        locations={[]}
        items={[]}
        continuationPacks={[]}
        selectedContinuationPackId=""
        librarySkills={[]}
        skillUsageRecords={[]}
        mountedSkillLoadout={[]}
        onAssignSkill={async () => {}}
        onRemoveSkill={async () => {}}
        projectPreferenceProfile={dummyProfile}
        onPreferenceProfileChange={async () => {}}
      />
    );

    // Parent forces a new search term down to the component
    rerender(
      <AgentWorkspaceKnowledgePanel
        agentTab="bible"
        novel={dummyNovel}
        currentChapter={null}
        bibleSearch="掌柜"
        setBibleSearch={setBibleSearchMock}
        characters={[]}
        locations={[]}
        items={[]}
        continuationPacks={[]}
        selectedContinuationPackId=""
        librarySkills={[]}
        skillUsageRecords={[]}
        mountedSkillLoadout={[]}
        onAssignSkill={async () => {}}
        onRemoveSkill={async () => {}}
        projectPreferenceProfile={dummyProfile}
        onPreferenceProfileChange={async () => {}}
      />
    );

    const input = screen.getByPlaceholderText('检索资料包、角色、地点、道具...') as HTMLInputElement;

    // The input value must be updated instantly to match the prop
    expect(input.value).toBe('掌柜');

    // Advance time by full 150ms to ensure NO feedback loop (calling setBibleSearch) is triggered
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Parent should NOT be called back because the change was driven by the parent in the first place
    expect(setBibleSearchMock).not.toHaveBeenCalled();
  });
});
