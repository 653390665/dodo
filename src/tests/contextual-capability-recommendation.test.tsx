// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextualCapabilityRecommendation } from '../components/ContextualCapabilityRecommendation';

const result = { fingerprint: 'x', context: { issue: { fingerprint: 'issue-x' }, artifactKind: 'chapter-outline' as const, operation: 'optimize' as const, scope: 'chapter' as const, artifactVersion: 1 }, primary: { capabilityId: 'de-ai-slop-shield', manifest: { output: 'transform-preview', artifactContract: { output: 'transform-preview' } } as never, reason: '补足动作链', usageMode: 'single-run' as const }, alternatives: [], recommendations: [], eligibleCapabilityIds: [] };

describe('ContextualCapabilityRecommendation', () => {
  test('leads with issue and artifact change, keeps store secondary, and does not execute automatically', () => {
    const onSelect = vi.fn();
    render(<ContextualCapabilityRecommendation result={result} onSelect={onSelect} onOpenStore={vi.fn()} />);
    expect(screen.getByText('补足动作链')).toBeTruthy();
    expect(screen.getByText(/预期产物变化/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /前往能力商店/ })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /单次能力/ }));
    expect(onSelect).toHaveBeenCalledWith('de-ai-slop-shield');
  });
});
