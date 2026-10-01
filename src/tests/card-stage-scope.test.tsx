import React from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SkillCardDetails } from '../components/book-factory/SkillCardDetails';
import { summarizeCardStageScope } from '../lib/capability-stage-cards';
import type { Skill } from '../../shared/types';

afterEach(() => cleanup());

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-1',
  name: '测试技能',
  description: '测试描述',
  style: '',
  pacing: '',
  stabilityScore: 80,
  executionScore: 80,
  evaluationFeedback: '',
  version: 1,
  createdAt: 1,
  dimensionTags: ['style'],
  primaryDimension: 'style',
  ...overrides,
});

describe('Plan 267 card stage scope', () => {
  test('hook cards are planner-only and say so', () => {
    const scope = summarizeCardStageScope('hook-card');
    expect(scope.stages).toEqual(['planner']);
    expect(scope.label).toBe('分镜');
    expect(scope.writerEffective).toBe(false);
    expect(scope.hint).toContain('不进入写作');
  });

  test('writer-effective cards report their stages', () => {
    const style = summarizeCardStageScope('style-card');
    expect(style.label).toBe('写作');
    expect(style.writerEffective).toBe(true);
    const pacing = summarizeCardStageScope('pacing-card');
    expect(pacing.label).toBe('分镜 + 写作');
    expect(pacing.writerEffective).toBe(true);
  });

  test('SkillCardDetails warns when a card never reaches the writer', () => {
    render(
      <SkillCardDetails
        selectedSkill={makeSkill({ deconstructionCardType: 'hook-card' })}
        selectedSkillIndex={0}
        totalCards={1}
        deck={null}
        segmentLabels={[]}
      />,
    );
    const badge = screen.getByTestId('card-stage-scope');
    expect(badge.textContent).toContain('生效阶段：分镜');
    expect(badge.textContent).toContain('不进入写作提示');
  });

  test('SkillCardDetails reports the writer stage without the warning', () => {
    render(
      <SkillCardDetails
        selectedSkill={makeSkill({ deconstructionCardType: 'style-card' })}
        selectedSkillIndex={0}
        totalCards={1}
        deck={null}
        segmentLabels={[]}
      />,
    );
    const badge = screen.getByTestId('card-stage-scope');
    expect(badge.textContent).toContain('生效阶段：写作');
    expect(badge.textContent).not.toContain('不进入写作提示');
  });

  test('book factory card list surfaces the same stage scope', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/book-factory/BookFactoryOutput.tsx'),
      'utf8',
    );
    expect(source).toContain('summarizeCardStageScope');
    expect(source).toContain('data-testid="card-stage-scope"');
  });
});
