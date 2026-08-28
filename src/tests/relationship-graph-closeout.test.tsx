import React from 'react';
import { afterEach, describe, test, expect, vi } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { RelationshipGraph } from '../components/RelationshipGraph';
import { filterRelationshipsByActiveEntities } from '../lib/relationship-filter';
import type { Character, Location, EntityRelationship } from '../../shared/types';

vi.mock('../lib/world-client', () => ({
  createEntityRelationshipClient: vi.fn().mockResolvedValue(undefined),
  updateEntityRelationshipClient: vi.fn().mockResolvedValue(true),
  deleteEntityRelationshipClient: vi.fn().mockResolvedValue(true),
  listEntityRelationshipsClient: vi.fn().mockResolvedValue([]),
}));

afterEach(() => cleanup());

const makeChar = (id: string, name: string): Character => ({
  id,
  novelId: 'n1',
  name,
  role: 'protagonist',
  summary: '',
  traits: [],
  bio: '',
});

const makeRel = (id: string, srcType: string, srcId: string, tgtType: string, tgtId: string, relType: string): EntityRelationship => ({
  id,
  novelId: 'n1',
  sourceType: srcType as EntityRelationship['sourceType'],
  sourceId: srcId,
  targetType: tgtType as EntityRelationship['targetType'],
  targetId: tgtId,
  relationshipType: relType,
  createdAt: 1,
});

describe('RelationshipGraph — empty states (Plan 136 closeout)', () => {
  test('0 entities shows add character guidance', () => {
    const onGoToWorldBible = vi.fn();
    const { container } = render(
      <RelationshipGraph
        relationships={[]}
        characters={[]}
        locations={[]}
        items={[]}
        factions={[]}
        totalEntities={0}
        hasGlobalRelationships={false}
        onGoToWorldBible={onGoToWorldBible}
      />
    );
    expect(container.textContent).toContain('尚未创建任何设定实体');
    expect(container.textContent).toContain('去添加人物');
  });

  test('1 entity shows add more guidance', () => {
    const onGoToWorldBible = vi.fn();
    const { container } = render(
      <RelationshipGraph
        relationships={[]}
        characters={[makeChar('c1', '张三')]}
        locations={[]}
        items={[]}
        factions={[]}
        totalEntities={1}
        hasGlobalRelationships={false}
        onGoToWorldBible={onGoToWorldBible}
      />
    );
    expect(container.textContent).toContain('还需要至少一个实体');
    expect(container.textContent).toContain('去添加更多实体');
  });

  test('2+ entities with no relationships shows go to world bible', () => {
    const onGoToWorldBible = vi.fn();
    const { container } = render(
      <RelationshipGraph
        relationships={[]}
        characters={[makeChar('c1', '张三'), makeChar('c2', '李四')]}
        locations={[]}
        items={[]}
        factions={[]}
        totalEntities={2}
        hasGlobalRelationships={false}
        onGoToWorldBible={onGoToWorldBible}
      />
    );
    expect(container.textContent).toContain('已有实体，暂无关系数据');
    expect(container.textContent).toContain('去世界观补充关系');
  });

  test('2+ entities with global relationships shows view global graph', () => {
    const onGoToWorldBible = vi.fn();
    const { container } = render(
      <RelationshipGraph
        relationships={[]}
        characters={[makeChar('c1', '张三'), makeChar('c2', '李四')]}
        locations={[]}
        items={[]}
        factions={[]}
        totalEntities={2}
        hasGlobalRelationships={true}
        onGoToWorldBible={onGoToWorldBible}
      />
    );
    expect(container.textContent).toContain('当前正文未提及已设定的实体关系');
    expect(container.textContent).toContain('查看全局关系图');
  });
});

describe('RelationshipGraph — CTA button navigation', () => {
  test('approved pack empty state exposes sync and manual CTAs', () => {
    const onSync = vi.fn();
    const onGoToWorldBible = vi.fn();
    const { getByRole } = render(
      <RelationshipGraph
        relationships={[]}
        characters={[]}
        locations={[]}
        items={[]}
        factions={[]}
        totalEntities={0}
        onSyncFromContinuationPack={onSync}
        onGoToWorldBible={onGoToWorldBible}
      />
    );

    fireEvent.click(getByRole('button', { name: '从资料包同步' }));
    fireEvent.click(getByRole('button', { name: '手动添加人物' }));
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onGoToWorldBible).toHaveBeenCalledWith('characters');
  });

  test('CTA button calls onGoToWorldBible callback', () => {
    const onGoToWorldBible = vi.fn();
    const { getByText } = render(
      <RelationshipGraph
        relationships={[]}
        characters={[]}
        locations={[]}
        items={[]}
        factions={[]}
        totalEntities={0}
        hasGlobalRelationships={false}
        onGoToWorldBible={onGoToWorldBible}
      />
    );
    fireEvent.click(getByText('去添加人物'));
    expect(onGoToWorldBible).toHaveBeenCalledTimes(1);
  });

  test('no CTA button rendered when onGoToWorldBible not provided', () => {
    const { queryByText } = render(
      <RelationshipGraph
        relationships={[]}
        characters={[]}
        locations={[]}
        items={[]}
        factions={[]}
        totalEntities={0}
        hasGlobalRelationships={false}
      />
    );
    expect(queryByText('去添加人物')).toBeNull();
  });
});

describe('filterRelationshipsByActiveEntities — closeout coverage', () => {
  const chars: Character[] = [
    makeChar('c1', '张三'),
    makeChar('c2', '李四'),
  ];

  test('filters relationships where source matches active name', () => {
    const rels = [makeRel('r1', 'character', 'c1', 'character', 'c2', '盟友')];
    const result = filterRelationshipsByActiveEntities(rels, ['张三'], chars, [], [], []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
  });

  test('filters relationships where target matches active name', () => {
    const rels = [makeRel('r1', 'character', 'c2', 'character', 'c1', '敌对')];
    const result = filterRelationshipsByActiveEntities(rels, ['张三'], chars, [], [], []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
  });

  test('filters relationships with bidirectional matches (both directions)', () => {
    const rels = [
      makeRel('r1', 'character', 'c1', 'character', 'c2', '盟友'),
      makeRel('r2', 'character', 'c2', 'character', 'c1', '敌对'),
    ];
    const result = filterRelationshipsByActiveEntities(rels, ['张三'], chars, [], [], []);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toEqual(expect.arrayContaining(['r1', 'r2']));
  });

  test('empty active names returns empty array', () => {
    const rels = [makeRel('r1', 'character', 'c1', 'character', 'c2', '盟友')];
    const result = filterRelationshipsByActiveEntities(rels, [], chars, [], [], []);
    expect(result).toEqual([]);
  });

  test('no matching names returns empty array', () => {
    const rels = [makeRel('r1', 'character', 'c1', 'character', 'c2', '盟友')];
    const result = filterRelationshipsByActiveEntities(rels, ['王五'], chars, [], [], []);
    expect(result).toEqual([]);
  });

  test('filters mixed entity types (location + character)', () => {
    const locs: Location[] = [
      { id: 'l1', novelId: 'n1', name: '京城', description: '', region: '', createdAt: 1, updatedAt: 1 },
    ];
    const rels = [
      makeRel('r1', 'character', 'c1', 'location', 'l1', '驻守'),
      makeRel('r2', 'character', 'c2', 'location', 'l1', '巡访'),
    ];
    const result = filterRelationshipsByActiveEntities(rels, ['张三', '京城'], chars, locs, [], []);
    expect(result).toHaveLength(2);
  });

  test('single active name filters correctly from multi-relationship set', () => {
    const rels = [
      makeRel('r1', 'character', 'c1', 'character', 'c2', '盟友'),
      makeRel('r2', 'character', 'c2', 'character', 'c1', '敌对'),
      makeRel('r3', 'character', 'c1', 'character', 'c2', '师徒'),
    ];
    const result = filterRelationshipsByActiveEntities(rels, ['李四'], chars, [], [], []);
    expect(result).toHaveLength(3);
  });
});
