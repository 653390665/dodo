import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { WorldBibleOnboarding } from '../components/WorldBibleOnboarding';

const onboarding = {
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
  acceptedSkillIds: [],
  recommendedSkills: [],
  acceptedRecommendedSkills: false,
  onAcceptRecommendedSkills: vi.fn(),
};

describe('WorldBible onboarding assistant mutex', () => {
  afterEach(() => cleanup());

  test('allows entering the editor before three setup items are confirmed', () => {
    const onEnterEditor = vi.fn();
    render(
      <WorldBibleOnboarding
        onboarding={{
          ...onboarding,
          completedCount: 0,
          canEnterEditor: false,
          onEnterEditor,
        }}
        isGlobalAssistantOpen={false}
      />,
    );

    const enterButton = screen.getByRole('button', { name: '先写正文' });
    expect((enterButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('设定可以稍后补全，先进入编辑器写第一版正文。')).toBeTruthy();

    fireEvent.click(enterButton);

    expect(onEnterEditor).toHaveBeenCalledTimes(1);
  });

  test('hides the local assistant while the global assistant is open without clearing input', () => {
    const view = render(
      <WorldBibleOnboarding onboarding={onboarding} isGlobalAssistantOpen={false} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '智能管家' }));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '保留这段设定' } });

    view.rerender(
      <WorldBibleOnboarding onboarding={{ ...onboarding, assistantInput: '保留这段设定' }} isGlobalAssistantOpen />,
    );

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: '智能管家' })).toBeNull();

    view.rerender(
      <WorldBibleOnboarding onboarding={{ ...onboarding, assistantInput: '保留这段设定' }} isGlobalAssistantOpen={false} />,
    );
    expect(screen.getByRole('button', { name: '智能管家' })).toBeTruthy();
  });
});
