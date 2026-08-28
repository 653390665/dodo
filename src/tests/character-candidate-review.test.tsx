import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { CharactersTab } from '../components/world-bible/CharactersTab';
import type { ArtifactCandidate, CharacterCore } from '../../shared/types/creative-artifacts';

const candidate: ArtifactCandidate<CharacterCore> = {
  id: 'candidate-1', novelId: 'n1', target: { kind: 'character', id: 'c1', version: 0 }, operation: 'restructure', goal: '', baseFingerprint: 'fp', sourceCapabilityVersions: [],
  proposedCore: { schemaVersion: 1, desire: '回家', externalGoal: '', internalNeed: '', fear: '', woundOrFalseBelief: '', strengths: [], flaws: [], contradictions: [], speechPattern: '', habitualActions: [], decisionPattern: '', relationshipTensions: [], arc: { start: '', turns: [], target: '' }, immutableFacts: [] },
  diff: { changed: true, fields: [{ path: 'desire', kind: 'added', after: '回家' }] }, impactReport: { downstream: [], reviewRequired: [], manuscriptConflict: false, reasons: [] }, status: 'pending',
};

describe('character candidate review', () => {
  test('renders compact gaps and routes explicit candidate actions', () => {
    const preview = vi.fn(); const accept = vi.fn(); const reject = vi.fn();
    render(<CharactersTab characters={[{ id: 'c1', novelId: 'n1', name: '阿青', role: 'protagonist', summary: '', bio: '当前小传', traits: [] }]} addEntity={vi.fn()} deleteEntity={vi.fn()} updateEntity={vi.fn()} handleGenerateBio={vi.fn()} generatingBioIds={[]} candidatesByCharacterId={{ c1: candidate }} onPreviewCandidate={preview} onAcceptCandidate={accept} onRejectCandidate={reject} />);
    expect(screen.getByText('当前小传：', { exact: false })).toBeTruthy();
    expect(screen.getByText(/核心欲望/)).toBeTruthy();
    expect(screen.getByText(/desire：added/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '预览角色候选' }));
    expect(screen.getByRole('region', { name: '角色候选预览' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '接受角色候选' }));
    fireEvent.click(screen.getByRole('button', { name: '拒绝角色候选' }));
    expect(preview).toHaveBeenCalledWith(candidate);
    expect(accept).toHaveBeenCalledWith(candidate);
    expect(reject).toHaveBeenCalledWith(candidate);
  });

  test('offers the governed candidate action when no pending candidate exists', () => {
    const generate = vi.fn();
    const character = { id: 'c1', novelId: 'n1', name: '阿青', role: 'protagonist' as const, summary: '', bio: '当前小传', traits: [] };
    render(<CharactersTab characters={[character]} addEntity={vi.fn()} deleteEntity={vi.fn()} updateEntity={vi.fn()} handleGenerateBio={vi.fn()} generatingBioIds={[]} onGenerateCandidate={generate} />);
    fireEvent.click(screen.getByRole('button', { name: '生成角色结构候选' }));
    expect(generate).toHaveBeenCalledWith(character);
  });
});
