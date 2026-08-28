import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { Sidebar } from '../components/Sidebar';

describe('Sidebar advanced tools', () => {
  test('keeps continuation direct and advanced tools collapsed until requested', () => {
    const onNavigate = vi.fn();
    render(<Sidebar currentView="welcome" onNavigate={onNavigate} user={{ uid: 'local' }} />);

    expect(screen.getByRole('button', { name: '资料续写' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '拆书工厂' })).toBeNull();
    expect(screen.queryByRole('button', { name: '作品能力中心' })).toBeNull();

    const toggle = screen.getByRole('button', { name: '高级工具' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('sidebar-advanced-tools');

    fireEvent.click(screen.getByRole('button', { name: '拆书工厂' }));
    expect(onNavigate).toHaveBeenCalledWith('factory', undefined);
  });

  test('reveals the active advanced destination', () => {
    render(<Sidebar currentView="skills" onNavigate={vi.fn()} user={{ uid: 'local' }} />);
    expect(screen.getByRole('button', { name: '高级工具' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: '作品能力中心' })).toBeTruthy();
  });
});
