import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkillMapPanel } from '../components/skills/SkillMapPanel';
import { SkillLoadoutBoard } from '../components/skills/SkillLoadoutBoard';
import { SkillCardDetails } from '../components/book-factory/SkillCardDetails';
import type { Skill } from '../../shared/types';
import type { Novel } from '../../shared/types';

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-1', name: '测试技能', description: '测试描述', style: '', pacing: '',
  stabilityScore: 80, executionScore: 80, evaluationFeedback: '', version: 1,
  createdAt: 1, dimensionTags: ['style'], primaryDimension: 'style', ...overrides,
});

describe('Plan 150 score channels', () => {
  test('SkillMap uses cold-start average and counts only skills with observed feedback', () => {
    render(<SkillMapPanel skills={[
      makeSkill({ id: 'unused', feedbackScore: 50, usageStats: undefined }),
      makeSkill({ id: 'used', feedbackScore: 0, usageStats: { mountedCount: 1, acceptedCount: 0, rejectedCount: 1, revisedCount: 0, averageFitScore: 0 } }),
    ]} />);
    expect(screen.getByText('有使用反馈的能力卡').previousElementSibling?.textContent).toBe('1');
    expect(screen.getByText('冷启动均分').previousElementSibling?.textContent).toBe('80');
  });

  test('SkillMap counts a skill once when dimension tags repeat', () => {
    render(<SkillMapPanel skills={[makeSkill({ dimensionTags: ['style', 'style'] })]} />);
    const dimensionLabel = screen.getByText('文风', { exact: true });
    expect(dimensionLabel.parentElement?.textContent).toContain('1');
  });

  test('SkillLoadout distinguishes absent feedback from explicit zero feedback', () => {
    const baseNovel = { id: 'novel-1', projectPreferenceProfile: undefined } as Novel;
    const callbacks = { onAssignSkill: vi.fn(), onRemoveSkill: vi.fn() };
    const skills = [
      makeSkill({ id: 'unused', feedbackScore: 50, usageStats: undefined }),
      makeSkill({ id: 'used', feedbackScore: 0, usageStats: { mountedCount: 1, acceptedCount: 0, rejectedCount: 1, revisedCount: 0, averageFitScore: 0 } }),
    ];
    render(<SkillLoadoutBoard novel={baseNovel} currentChapter={null} skills={skills} loadout={[
      { slot: 0, skillId: 'unused', weight: 1, lockedDimensions: [] },
      { slot: 1, skillId: 'used', weight: 1, lockedDimensions: [] },
    ]} {...callbacks} />);
    expect(screen.getAllByText('暂无使用反馈').length).toBeGreaterThan(0);
    expect(screen.getAllByText('使用反馈 0（1次）').length).toBeGreaterThan(0);
    expect(screen.queryByText('使用反馈 50')).toBeNull();
  });

  test('SkillCardDetails labels cold-start and evidence channels honestly', () => {
    render(<SkillCardDetails
      selectedSkill={makeSkill({ feedbackScore: 50, usageStats: undefined })}
      selectedSkillIndex={0}
      totalCards={1}
      deck={null}
      segmentLabels={[]}
    />);
    expect(screen.getByText('冷启动分')).toBeTruthy();
    expect(screen.getByText(/证据稳定度/)).toBeTruthy();
    expect(screen.getByText('暂无使用反馈')).toBeTruthy();
    expect(screen.getByText('治理门禁')).toBeTruthy();
    expect(screen.getByText('当前场景适配')).toBeTruthy();
    expect(screen.getByText('作品能力中心应用配置后计算')).toBeTruthy();
  });

  test('SkillLoadout labels fit as current scene adaptation without composite card score', () => {
    const baseNovel = { id: 'novel-1', projectPreferenceProfile: undefined } as Novel;
    render(<SkillLoadoutBoard novel={baseNovel} currentChapter={null} skills={[makeSkill()]} loadout={[]} onAssignSkill={vi.fn()} onRemoveSkill={vi.fn()} />);
    expect(screen.getByText('当前场景适配')).toBeTruthy();
    expect(screen.queryByText('综合卡牌分')).toBeNull();
  });

  test('Book Factory score surfaces do not restore synthetic feedback 50', async () => {
    const [{ readFile }, { resolve }] = await Promise.all([import('node:fs/promises'), import('node:path')]);
    const files = [
      resolve(process.cwd(), 'src/components/book-factory/BookFactoryOutput.tsx'),
      resolve(process.cwd(), 'src/components/book-factory/SkillCardDetails.tsx'),
    ];
    const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
    expect(source).not.toMatch(/feedbackScore\s*(?:\|\||\?\?)\s*50/);
    expect(source).toContain('冷启动');
    expect(source).toContain('证据稳定');
  });
});
