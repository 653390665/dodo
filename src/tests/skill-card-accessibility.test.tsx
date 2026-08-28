import { describe, expect, test, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { SkillCard } from '../components/skills/SkillCard';
import type { Novel } from '../../shared/types';

const skill = { id: 's1', name: '测试技能', description: '描述', style: '', pacing: '', stabilityScore: 80, evaluationFeedback: '', version: 1, createdAt: 0 };

describe('SkillCard accessibility', () => {
  test('uses one keyboard-activatable card surface without nested buttons', () => {
    const onOpen = vi.fn();
    const novel: Novel = { id: 'n1', title: '作品', authorId: 'author', summary: '', status: 'ongoing', createdAt: 0, updatedAt: 0 };
    const { container } = render(<SkillCard skill={skill} selected={false} onOpen={onOpen} onDelete={vi.fn()} userNovels={[novel]} onEquip={vi.fn()} />);
    expect(container.querySelectorAll('button button').length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: `打开能力卡 ${skill.name}` }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
