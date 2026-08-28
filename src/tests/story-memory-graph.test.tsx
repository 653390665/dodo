import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { StoryMemoryProjection } from '../../shared/types/story-memory';
import { RelationshipGraph } from '../components/RelationshipGraph';
import { ForeshadowingPanel } from '../components/ForeshadowingPanel';
import { listChapters } from '../lib/chapter-client';
import { createForeshadowing, listForeshadowings } from '../lib/foreshadowing-client';
import { startWorldJob } from '../lib/world-job-client';

vi.mock('../lib/chapter-client', () => ({ listChapters: vi.fn() }));
vi.mock('../lib/foreshadowing-client', () => ({
  createForeshadowing: vi.fn(),
  listForeshadowings: vi.fn(),
  updateForeshadowing: vi.fn(),
  deleteForeshadowing: vi.fn(),
}));
vi.mock('../lib/world-job-client', () => ({ startWorldJob: vi.fn() }));
vi.mock('../lib/db-transport', () => ({ subscribeToChanges: () => () => {} }));

const storyMemory: StoryMemoryProjection = {
  novelId: 'n1',
  generatedAt: 1,
  nodes: [
    { id: 'n1:chapter:c1', novelId: 'n1', kind: 'chapter', source: { kind: 'chapter', id: 'c1' }, label: '第一章' },
    { id: 'n1:narrative-promise:p1', novelId: 'n1', kind: 'narrative-promise', source: { kind: 'narrative-promise', id: 'p1' }, label: '戒指秘密' },
  ],
  edges: [{ id: 'n1:edge:planted-in:c1:p1', novelId: 'n1', kind: 'planted-in', source: 'n1:chapter:c1', target: 'n1:narrative-promise:p1' }],
};

describe('RelationshipGraph story memory', () => {
  test('renders chapter and narrative promise nodes with accessible labels', () => {
    render(
      <RelationshipGraph
        relationships={[]}
        characters={[]}
        locations={[]}
        items={[]}
        factions={[]}
        storyMemory={storyMemory}
      />,
    );

    expect(screen.getByRole('img', { name: '故事记忆关系图谱' })).toBeDefined();
    expect(screen.getByRole('button', { name: '章节：第一章' })).toBeDefined();
    expect(screen.getByRole('button', { name: '叙事承诺：戒指秘密' })).toBeDefined();
    expect(screen.getAllByText('planted-in')).toHaveLength(2);
  });

  test('preserves relationship type, tooltip, and enemy styling with story memory', () => {
    const relationship = {
      id: 'rel-1', novelId: 'n1', sourceType: 'character', sourceId: 'c1', targetType: 'character', targetId: 'c2',
      relationshipType: 'enemy', description: '旧怨', createdAt: 1,
    };
    const memory: StoryMemoryProjection = {
      novelId: 'n1', generatedAt: 1,
      nodes: [
        { id: 'n1:character:c1', novelId: 'n1', kind: 'character', source: { kind: 'character', id: 'c1' }, label: '甲' },
        { id: 'n1:character:c2', novelId: 'n1', kind: 'character', source: { kind: 'character', id: 'c2' }, label: '乙' },
      ],
      edges: [{
        id: 'n1:edge:relates-to:rel-1', novelId: 'n1', kind: 'relates-to', source: 'n1:character:c1', target: 'n1:character:c2',
        sourceArtifact: { kind: 'world', id: 'rel-1', version: 1 },
      }],
    };
    const { container } = render(<RelationshipGraph relationships={[relationship]} characters={[]} locations={[]} items={[]} factions={[]} storyMemory={memory} />);

    expect(screen.getAllByText('enemy')).toHaveLength(1);
    expect(screen.getByText('旧怨')).toBeDefined();
    const line = container.querySelector('line');
    expect(line?.getAttribute('stroke')).toBe('#ef4444');
    expect(line?.getAttribute('stroke-dasharray')).toBe('4 2');
  });
});

describe('ForeshadowingPanel legacy recovery', () => {
  test('keeps scan results pending until the author confirms recovery', async () => {
    vi.mocked(listChapters).mockResolvedValue([{
      id: 'chapter-1', novelId: 'n1', title: '第一章', content: '戒指亮起', order: 1, wordCount: 4, createdAt: 1, updatedAt: 1,
    }]);
    vi.mocked(listForeshadowings).mockResolvedValue([]);
    vi.mocked(createForeshadowing).mockResolvedValue();
    vi.mocked(startWorldJob).mockResolvedValue({
      result: [{ title: '戒指秘密', description: '戒面异光', type: 'plant' }],
      databaseGeneration: 7,
    });

    render(<ForeshadowingPanel novelId="n1" currentChapterId="chapter-1" />);
    await waitFor(() => expect(listChapters).toHaveBeenCalledWith('n1'));
    fireEvent.click(screen.getByRole('button', { name: 'AI 扫描当前章节伏笔' }));

    await waitFor(() => expect(startWorldJob).toHaveBeenCalled());
    expect(createForeshadowing).not.toHaveBeenCalled();
    expect(screen.getByText('待确认恢复结果：1 条')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '确认恢复 1 条' }));
    await waitFor(() => expect(createForeshadowing).toHaveBeenCalledTimes(1));
    expect(createForeshadowing).toHaveBeenCalledWith(expect.objectContaining({
      novelId: 'n1', title: '戒指秘密', plantedChapterId: 'chapter-1', status: 'planted',
    }), 7);
  });
});
