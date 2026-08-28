import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { AgentWorkspaceKnowledgePanel } from '../components/AgentWorkspaceKnowledgePanel';
import type { Chapter, Novel, ProjectPreferenceProfile, Skill } from '../../shared/types';

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

  function renderSkillsPanel(options: {
    profile: ProjectPreferenceProfile;
    currentChapter: Chapter | null;
    librarySkills: Skill[];
  }) {
    return render(
      <AgentWorkspaceKnowledgePanel
        agentTab="skills"
        novel={{ ...dummyNovel, projectPreferenceProfile: options.profile }}
        currentChapter={options.currentChapter}
        bibleSearch=""
        setBibleSearch={vi.fn()}
        characters={[]}
        locations={[]}
        items={[]}
        continuationPacks={[]}
        selectedContinuationPackId=""
        librarySkills={options.librarySkills}
        skillUsageRecords={[]}
        mountedSkillLoadout={[{ slot: 1, skillId: 'main-card', weight: 1, lockedDimensions: [] }]}
        onAssignSkill={async () => {}}
        onRemoveSkill={async () => {}}
        projectPreferenceProfile={options.profile}
        onPreferenceProfileChange={async () => {}}
      />
    );
  }

  function makeChapter(id: string, overlayCardIds: string[]): Chapter {
    return {
      id,
      novelId: dummyNovel.id,
      title: id,
      content: '',
      order: 1,
      wordCount: 0,
      createdAt: 1,
      updatedAt: 1,
      workflowMeta: {
        version: 1,
        capabilityState: {
          techniqueIds: [],
          overlayCardIds,
          updatedAt: 1,
        },
      },
    };
  }

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

  test('skills panel shows the v3 capability summary without legacy role slots', () => {
    const profile: ProjectPreferenceProfile = {
      ...dummyProfile,
      capabilityModelVersion: 3,
      writingStyleConfirmation: {
        mode: 'skill-deck',
        fingerprint: 'f'.repeat(64),
        confirmedAt: 1,
      },
      capabilityProfile: {
        version: 3,
        activeFlowId: 'tomato-platform-flow',
        projectSkillDeck: {
          mainCardId: 'main-card',
          supportCardIds: ['support-card'],
          updatedAt: 1,
        },
        favoriteTechniqueIds: ['prose-mouth-flavor'],
        guardrailIds: [],
      },
    };

    renderSkillsPanel({
      profile,
      currentChapter: {
        ...makeChapter('chapter-1', ['chapter-card']),
        workflowMeta: {
          version: 1,
          capabilityState: {
            techniqueIds: ['prose-mouth-flavor'],
            overlayCardIds: ['chapter-card'],
            updatedAt: 1,
          },
        },
      },
      librarySkills: [
        { id: 'main-card', name: '主卡', description: '', style: '', pacing: '', stabilityScore: 80, evaluationFeedback: '', version: 1, deconstructionCardType: 'style-card', createdAt: 1 },
        { id: 'support-card', name: '辅卡', description: '', style: '', pacing: '', stabilityScore: 80, evaluationFeedback: '', version: 1, deconstructionCardType: 'worldview-card', createdAt: 1 },
        { id: 'prose-mouth-flavor', name: '口语化技法', description: '', style: '', pacing: '', stabilityScore: 80, evaluationFeedback: '', version: 1, createdAt: 1 },
        { id: 'chapter-card', name: '本章卡', description: '', style: '', pacing: '', stabilityScore: 80, evaluationFeedback: '', version: 1, deconstructionCardType: 'style-card', createdAt: 1 },
      ],
    });

    expect(screen.getByText('作品主卡')).toBeDefined();
    expect(screen.getByLabelText('本章能力来源摘要')).toBeDefined();
    expect(screen.getByText('番茄平台流')).toBeDefined();
    expect(screen.queryByText('tomato-platform-flow')).toBeNull();
    expect(screen.getByText('作品默认 1 · 本章 1 · 作品技法 1 · 本章技法 0 · 系统护栏 12')).toBeDefined();
    expect(screen.getByText('主卡、本章卡、口语化技法、灵感助手、故事方案卡 等 10 项')).toBeDefined();
    expect(screen.getByText('主卡决定后续正文的主导口吻与节奏；辅卡补充世界观、人物或钩子约束。')).toBeDefined();
    expect(screen.getByText('常用技法')).toBeDefined();
    expect(screen.getByText('口语化技法')).toBeDefined();
    expect(screen.getByText('常用技法会作为作品偏好参与后续正文生成；本章使用规则只影响当前章节。')).toBeDefined();
    expect(screen.getByText('本章使用规则 1 项')).toBeDefined();
    expect(screen.getByText('主卡')).toBeDefined();
    expect(screen.getByText('本章使用卡')).toBeDefined();
    expect(screen.getByText('本章卡')).toBeDefined();
    expect(screen.getByText('系统检查规则')).toBeDefined();
    expect(screen.getByText('系统检查规则').nextElementSibling?.textContent).toContain('灵感助手');
    expect(screen.queryByText(/Planner（规划）|Writer（写作）|Critic（审稿）/)).toBeNull();
  });

  test('skills panel resolves catalog project deck ids without a persisted clone', () => {
    const profile: ProjectPreferenceProfile = {
      ...dummyProfile,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { mainCardId: 'style-ancient-elegance', supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    };

    renderSkillsPanel({
      profile,
      currentChapter: makeChapter('chapter-catalog-deck', []),
      librarySkills: [],
    });

    expect(screen.getAllByText('古言华美辞藻典雅国风参考包').length).toBeGreaterThan(0);
    expect(screen.queryByText('style-ancient-elegance')).toBeNull();
  });

  test('skills panel shows automatic system guardrails without project configuration', () => {
    renderSkillsPanel({
      profile: {
        ...dummyProfile,
        capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          favoriteTechniqueIds: [],
          projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        },
      },
      currentChapter: makeChapter('chapter-empty-guardrails', []),
      librarySkills: [],
    });

    expect(screen.getByText('作品默认 0 · 本章 0 · 作品技法 0 · 本章技法 0 · 系统护栏 12')).toBeDefined();
    expect(screen.getByText('系统检查规则').nextElementSibling?.textContent).toContain('灵感助手');
    expect(screen.queryByText('未配置系统检查规则')).toBeNull();
    expect(screen.queryByText('未启用系统检查规则')).toBeNull();
  });

  test('skills panel updates the effective chapter cards after chapter switch', () => {
    const profile: ProjectPreferenceProfile = {
      ...dummyProfile,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        activeFlowId: 'flow-1',
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    };
    const librarySkills: Skill[] = [
      { id: 'chapter-card-a', name: '第一章卡', description: '', style: '', pacing: '', stabilityScore: 80, evaluationFeedback: '', version: 1, deconstructionCardType: 'style-card', createdAt: 1 },
      { id: 'chapter-card-b', name: '第二章卡', description: '', style: '', pacing: '', stabilityScore: 80, evaluationFeedback: '', version: 1, deconstructionCardType: 'style-card', createdAt: 1 },
      { id: 'chapter-card-c', name: '第二章节奏卡', description: '', style: '', pacing: '', stabilityScore: 80, evaluationFeedback: '', version: 1, deconstructionCardType: 'pacing-card', createdAt: 1 },
    ];

    const view = renderSkillsPanel({
      profile,
      currentChapter: makeChapter('chapter-1', ['chapter-card-a']),
      librarySkills,
    });

    expect(screen.getByText('作品默认 0 · 本章 1 · 作品技法 0 · 本章技法 0 · 系统护栏 12')).toBeDefined();
    expect(screen.getAllByText('第一章卡').length).toBeGreaterThanOrEqual(1);

    view.rerender(
      <AgentWorkspaceKnowledgePanel
        agentTab="skills"
        novel={{ ...dummyNovel, projectPreferenceProfile: profile }}
        currentChapter={makeChapter('chapter-2', ['chapter-card-b', 'chapter-card-c'])}
        bibleSearch=""
        setBibleSearch={vi.fn()}
        characters={[]}
        locations={[]}
        items={[]}
        continuationPacks={[]}
        selectedContinuationPackId=""
        librarySkills={librarySkills}
        skillUsageRecords={[]}
        mountedSkillLoadout={[]}
        onAssignSkill={async () => {}}
        onRemoveSkill={async () => {}}
        projectPreferenceProfile={profile}
        onPreferenceProfileChange={async () => {}}
      />
    );

    expect(screen.getByText('作品默认 0 · 本章 2 · 作品技法 0 · 本章技法 0 · 系统护栏 12')).toBeDefined();
    expect(screen.getAllByText('第二章卡、第二章节奏卡').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('第一章卡')).toBeNull();
  });
});
