import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { RelationshipGraph } from '../components/RelationshipGraph';
import { filterRelationshipsByActiveEntities } from '../lib/relationship-filter';
import { RelationshipFormDialog } from '../components/world-bible/RelationshipFormDialog';
import type { Character, Location, Item, Faction, EntityRelationship } from '../../shared/types';

vi.mock('../lib/world-client', () => ({
  createEntityRelationshipClient: vi.fn().mockResolvedValue(undefined),
  updateEntityRelationshipClient: vi.fn().mockResolvedValue(true),
  deleteEntityRelationshipClient: vi.fn().mockResolvedValue(true),
  listEntityRelationshipsClient: vi.fn().mockResolvedValue([]),
}));

const mockCharacters: Character[] = [
  { id: 'c1', novelId: 'n1', name: '张三', role: 'protagonist', summary: '', traits: [], bio: '', createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'c2', novelId: 'n1', name: '李四', role: 'supporting', summary: '', traits: [], bio: '', createdAt: Date.now(), updatedAt: Date.now() },
];

const mockLocations: Location[] = [];
const mockItems: Item[] = [];
const mockFactions: Faction[] = [];

const mockRelationships: EntityRelationship[] = [
  {
    id: 'r1',
    novelId: 'n1',
    sourceType: 'character',
    sourceId: 'c1',
    targetType: 'character',
    targetId: 'c2',
    relationshipType: '盟友',
    description: '同门师兄',
    createdAt: Date.now(),
  },
];

describe('RelationshipGraph', () => {
  test('empty state — no global relationships shows hint text', () => {
    const { container } = render(
      <RelationshipGraph
        relationships={[]}
        characters={[]}
        locations={[]}
        items={[]}
        factions={[]}
        totalEntities={2}
        hasGlobalRelationships={false}
      />
    );
    expect(container.textContent).toContain('已有实体，暂无关系数据');
  });

  test('empty state — has global but unmatched shows different hint', () => {
    const { container } = render(
      <RelationshipGraph
        relationships={[]}
        characters={[]}
        locations={[]}
        items={[]}
        factions={[]}
        totalEntities={2}
        hasGlobalRelationships={true}
      />
    );
    expect(container.textContent).toContain('当前正文未提及已设定的实体关系');
  });

  test('renders SVG nodes and edges with relationship data', () => {
    const { container } = render(
      <RelationshipGraph
        relationships={mockRelationships}
        characters={mockCharacters}
        locations={mockLocations}
        items={mockItems}
        factions={mockFactions}
      />
    );
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThanOrEqual(2);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(1);
    expect(container.textContent).toContain('盟友');
  });

  test('clicking a node calls onSelectEntity', () => {
    const onSelectEntity = vi.fn();
    const { container } = render(
      <RelationshipGraph
        relationships={mockRelationships}
        characters={mockCharacters}
        locations={mockLocations}
        items={mockItems}
        factions={mockFactions}
        onSelectEntity={onSelectEntity}
      />
    );
    const nodeGroups = container.querySelectorAll('g.cursor-pointer');
    expect(nodeGroups.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(nodeGroups[0]);
    expect(onSelectEntity).toHaveBeenCalled();
    const [type, id] = (onSelectEntity.mock.calls[0] as [string, string]);
    expect(['character']).toContain(type);
    expect(['c1', 'c2']).toContain(id);
  });
});

describe('filterRelationshipsByActiveEntities', () => {
  test('filters relationships matching active entities', () => {
    const result = filterRelationshipsByActiveEntities(
      mockRelationships,
      ['张三'],
      mockCharacters,
      mockLocations,
      mockItems,
      mockFactions,
    );
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('r1');
  });

  test('empty active names returns empty array', () => {
    const result = filterRelationshipsByActiveEntities(
      mockRelationships,
      [],
      mockCharacters,
      mockLocations,
      mockItems,
      mockFactions,
    );
    expect(result).toEqual([]);
  });
});

describe('RelationshipFormDialog', () => {
  const baseProps = {
    novelId: 'n1',
    databaseGeneration: 7,
    characters: mockCharacters,
    locations: mockLocations,
    items: mockItems,
    factions: mockFactions,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onDeleted: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('create mode renders form fields', () => {
    render(
      <RelationshipFormDialog
        {...baseProps}
        open={true}
        mode="create"
      />
    );
    expect(screen.getByText('新建关系')).toBeDefined();
    expect(screen.getByText('起始实体')).toBeDefined();
    expect(screen.getByText('目标实体')).toBeDefined();
    expect(screen.getByText('关系类型')).toBeDefined();
  });

  test('edit mode pre-fills data from existingRelationship', () => {
    render(
      <RelationshipFormDialog
        {...baseProps}
        open={true}
        mode="edit"
        existingRelationship={mockRelationships[0]}
      />
    );
    expect(screen.getByText('编辑关系')).toBeDefined();
    const sourceSelect = document.getElementById('source-id') as HTMLSelectElement;
    expect(sourceSelect.value).toBe('c1');
    const targetSelect = document.getElementById('target-id') as HTMLSelectElement;
    expect(targetSelect.value).toBe('c2');
  });

  test('delete mode shows confirmation with entity names', () => {
    render(
      <RelationshipFormDialog
        {...baseProps}
        open={true}
        mode="delete"
        existingRelationship={mockRelationships[0]}
      />
    );
    expect(screen.getByText('删除关系')).toBeDefined();
    expect(screen.getByText(/确定要删除/)).toBeDefined();
    expect(screen.getByText(/张三/)).toBeDefined();
    expect(screen.getByText(/李四/)).toBeDefined();
  });

  test('Escape key triggers onClose', async () => {
    render(
      <RelationshipFormDialog
        {...baseProps}
        open={true}
        mode="create"
      />
    );
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(baseProps.onClose).toHaveBeenCalled();
  });
});
