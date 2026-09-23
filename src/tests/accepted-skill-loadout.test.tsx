import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildAcceptedSkillLoadout } from '../lib/onboarding-model';
import { WorldBibleOnboarding } from '../components/WorldBibleOnboarding';
import type { MountedSkillLoadoutItem } from '../../shared/types';

afterEach(() => cleanup());

const slotItem = (slot: number, skillId: string): MountedSkillLoadoutItem => ({
  slot,
  skillId,
  weight: 1,
  lockedDimensions: [],
});

describe('buildAcceptedSkillLoadout', () => {
  test('空卡槽：接受的卡按推荐顺序占满 0-2 槽', () => {
    const result = buildAcceptedSkillLoadout([], ['a', 'b', 'c']);
    expect(result.additions.map((entry) => entry.slot)).toEqual([0, 1, 2]);
    expect(result.additions.map((entry) => entry.skillId)).toEqual(['a', 'b', 'c']);
    expect(result.nextSkillIds).toEqual(['a', 'b', 'c']);
    expect(result.nextLoadout.every((entry) => entry.weight === 1)).toBe(true);
  });

  test('已挂载的卡按 skillId 跳过，不重复占槽', () => {
    const result = buildAcceptedSkillLoadout([slotItem(0, 'a')], ['a', 'b']);
    expect(result.additions).toEqual([slotItem(1, 'b')]);
    expect(result.nextSkillIds).toEqual(['a', 'b']);
  });

  test('已有卡槽占用时只填空闲槽位，超出一律丢弃', () => {
    const result = buildAcceptedSkillLoadout([slotItem(1, 'x')], ['a', 'b', 'c', 'd']);
    expect(result.additions.map((entry) => entry.slot)).toEqual([0, 2]);
    expect(result.additions.map((entry) => entry.skillId)).toEqual(['a', 'b']);
    expect(result.nextSkillIds).toEqual(['a', 'x', 'b']);
  });

  test('卡槽全满时 additions 为空（无写库变更）', () => {
    const result = buildAcceptedSkillLoadout(
      [slotItem(0, 'x'), slotItem(1, 'y'), slotItem(2, 'z')],
      ['a']
    );
    expect(result.additions).toEqual([]);
    expect(result.nextSkillIds).toEqual(['x', 'y', 'z']);
  });
});

describe('WorldBibleOnboarding 推荐能力卡文案', () => {
  const baseOnboarding = {
    tasks: [],
    assistantInput: '',
    onAssistantInputChange: vi.fn(),
    onAssistantSubmit: vi.fn(),
    onSelectTask: vi.fn(),
    onConfirmTask: vi.fn(),
    assistantLoading: false,
    completedCount: 0,
    canEnterEditor: false,
    onEnterEditor: vi.fn(),
    recommendedSkills: [
      { skillId: 'sk-1', skillName: '世界观构建卡', score: 90, reason: '能补强世界规则表达' },
    ],
  };

  test('推荐面板明示「确认后将挂载到当前作品卡槽」，按钮为「挂载到当前作品」', () => {
    const onAcceptRecommendedSkills = vi.fn();
    render(
      <WorldBibleOnboarding
        onboarding={{
          ...baseOnboarding,
          acceptedSkillIds: [],
          acceptedRecommendedSkills: false,
          onAcceptRecommendedSkills,
        }}
        isGlobalAssistantOpen={false}
      />
    );

    expect(screen.getByText(/确认后将挂载到当前作品卡槽/)).toBeTruthy();
    expect(screen.queryByText(/不会自动写入作品/)).toBeNull();

    const mountButton = screen.getByRole('button', { name: '挂载到当前作品' });
    expect((mountButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(mountButton);
    expect(onAcceptRecommendedSkills).toHaveBeenCalledTimes(1);
  });

  test('接受后按钮翻转为已挂载态且不可重复提交', () => {
    render(
      <WorldBibleOnboarding
        onboarding={{
          ...baseOnboarding,
          acceptedSkillIds: ['sk-1'],
          acceptedRecommendedSkills: true,
          onAcceptRecommendedSkills: vi.fn(),
        }}
        isGlobalAssistantOpen={false}
      />
    );

    const mountedButton = screen.getByRole('button', { name: '已挂载到作品卡槽' });
    expect((mountedButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('待确认')).toBeNull();
  });
});
