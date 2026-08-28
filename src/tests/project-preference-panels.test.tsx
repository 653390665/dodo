import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Novel, ProjectPreferenceProfile } from '../../shared/types';
import { ProjectPreferencePanel } from '../components/skills/ProjectPreferencePanel';
import { SkillLoadoutBoard } from '../components/skills/SkillLoadoutBoard';

const malformedProfile = {
  tags: null,
  weights: null,
  acceptedDimensions: null,
  rejectedDimensions: 'style',
  notes: null,
  evidenceCount: 3,
} as unknown as ProjectPreferenceProfile;

describe('project preference panel reliability', () => {
  test.each([
    {},
    { tags: [] },
    { evidenceCount: 3 },
    malformedProfile,
  ])('renders a partial profile without throwing', (profile) => {
    render(<ProjectPreferencePanel profile={profile as ProjectPreferenceProfile} />);
    expect(screen.getByText('作品写法画像')).toBeTruthy();
    expect(screen.getByText(/画像形成中/)).toBeTruthy();
  });

  test('SkillLoadoutBoard keeps the default writing mode for a malformed profile', () => {
    const novel = {
      id: 'novel-partial-profile',
      projectPreferenceProfile: malformedProfile,
    } as Novel;

    render(
      <SkillLoadoutBoard
        novel={novel}
        currentChapter={null}
        skills={[]}
        usageRecords={[]}
        loadout={[]}
        onAssignSkill={vi.fn()}
        onRemoveSkill={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/系统默认笔调/).length).toBeGreaterThan(0);
    expect(screen.getByText('能力摘要')).toBeTruthy();
    expect(screen.queryByText('装配卡槽')).toBeNull();
    expect(screen.queryByText(/拖拽技能卡|卡槽 [123]/)).toBeNull();
  });

  test('SkillLoadoutBoard is a read-only historical adapter', () => {
    const skill = {
      id: 'skill-1', name: '旧卡', description: '旧数据', style: '', pacing: '',
      stabilityScore: 80, evaluationFeedback: '', version: 1, createdAt: 1,
    };
    render(
      <SkillLoadoutBoard
        novel={{ id: 'novel-1' } as Novel}
        currentChapter={null}
        skills={[skill]}
        loadout={[{ slot: 1, skillId: 'skill-1', weight: 1, lockedDimensions: [] }]}
        onAssignSkill={vi.fn()}
        onRemoveSkill={vi.fn()}
      />,
    );
    expect(screen.getByText('能力摘要')).toBeTruthy();
    expect(screen.getByText('旧卡')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /装配|卸载|卡槽/ })).toBeNull();
  });

  test('SkillLoadoutBoard keeps unresolved v2 entries visible as pending cleanup', () => {
    render(
      <SkillLoadoutBoard
        novel={{ id: 'novel-legacy' } as Novel}
        currentChapter={null}
        skills={[]}
        loadout={[{ slot: 0, skillId: 'legacy-missing', weight: 1, lockedDimensions: [] }]}
      />,
    );

    expect(screen.getByText('旧配置待整理')).toBeTruthy();
    expect(screen.getByText(/1 项历史能力卡无法解析/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /迁移|装配|卸载|卡槽/ })).toBeNull();
  });
});
