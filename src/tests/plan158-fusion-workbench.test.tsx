import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Skill } from '../../shared/types';
import { SkillFusionWorkbench } from '../components/skills/SkillFusionWorkbench';

function skill(id: string, overrides: Partial<Skill> = {}): Skill {
  return {
    id,
    name: id,
    description: '',
    style: `${id} style`,
    pacing: `${id} pacing`,
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 2,
    createdAt: 1,
    primaryDimension: 'style',
    dimensionTags: ['style'],
    deconstructionCardType: 'style-card',
    evidenceCoverage: 'full-book-stable',
    evidenceMoments: ['opening'],
    sourceBadge: 'book-extracted',
    sourceType: 'plaza',
    ...( {
      isRuntimeReady: true,
      sanitizationStatus: 'runtime-ready',
      runtimeStatus: 'active',
    } as unknown as Partial<Skill>),
    ...overrides,
  };
}

describe('Plan 158 fusion workbench', () => {
  it('keeps source selection separate from explicit candidate preview generation', () => {
    const onPreview = vi.fn();
    render(
      <SkillFusionWorkbench
        baseSkill={skill('main')}
        candidates={[skill('support', { style: '', primaryDimension: 'plot', dimensionTags: ['plot'], plotPattern: 'hidden cost' })]}
        onPreview={onPreview}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: '选择融合辅卡' }), { target: { value: 'support' } });
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('主卡：main · 辅卡：support')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '生成融合候选' }));
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ sourceBadge: 'fused' }));
  });
});
