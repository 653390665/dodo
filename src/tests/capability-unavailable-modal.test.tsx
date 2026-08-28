import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PremiumUpgradeModal } from '../components/commercial/PremiumUpgradeModal';

function emit(name: string, detail: unknown) {
  act(() => window.dispatchEvent(new CustomEvent(name, { detail })));
}

describe('capability unavailable modal', () => {
  it('handles malformed payloads without crashing and stays neutral', () => {
    render(<PremiumUpgradeModal />);
    emit('local-capability-unavailable', { packageName: {}, error: {}, count: Number.NaN });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('当前版本未开放在线购买')).toBeTruthy();
  });

  it('renders valid package details and closes via Escape and legacy event', () => {
    render(<PremiumUpgradeModal />);
    emit('local-capability-unavailable', { limitType: 'extractSkill', packageName: '测试包', packageDesc: '本地说明', error: '不可用' });
    expect(screen.getByText(/测试包/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    emit('trigger-premium-modal', { limitType: 'generateProse', error: 'legacy' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' }).at(-1)!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
