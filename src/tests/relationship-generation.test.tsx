import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const clients = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../lib/world-client', () => ({
  createEntityRelationshipClient: clients.create,
  updateEntityRelationshipClient: clients.update,
  deleteEntityRelationshipClient: clients.remove,
}));

import { RelationshipFormDialog } from '../components/world-bible/RelationshipFormDialog';

const characters = [
  { id: 'character-1', novelId: 'novel-1', name: '甲', role: 'protagonist' as const, summary: '', traits: [], bio: '', createdAt: 1, updatedAt: 1 },
  { id: 'character-2', novelId: 'novel-1', name: '乙', role: 'supporting' as const, summary: '', traits: [], bio: '', createdAt: 1, updatedAt: 1 },
];
const relationship = {
  id: 'relationship-1',
  novelId: 'novel-1',
  sourceType: 'character' as const,
  sourceId: 'character-1',
  targetType: 'character' as const,
  targetId: 'character-2',
  relationshipType: '盟友',
  description: '旧说明',
  createdAt: 1,
};

describe('relationship generation guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('rejects a non-numeric database generation at runtime', () => {
    expect(() => render(
      <RelationshipFormDialog
        open
        mode="create"
        novelId="novel-1"
        databaseGeneration={'7' as unknown as number}
        characters={characters}
        locations={[]}
        items={[]}
        factions={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )).toThrow('databaseGeneration must be a number or null');
  });

  test('keeps the relationship draft open when a generation conflict rejects creation', async () => {
    clients.create.mockRejectedValue(Object.assign(new Error('generation conflict'), {
      status: 409,
      code: 'DB_GENERATION_CONFLICT',
    }));
    const onClose = vi.fn();
    const onSaved = vi.fn();

    render(
      <RelationshipFormDialog
        open
        mode="create"
        novelId="novel-1"
        databaseGeneration={7}
        characters={characters}
        locations={[]}
        items={[]}
        factions={[]}
        onClose={onClose}
        onSaved={onSaved}
        onDeleted={vi.fn()}
      />,
    );

    fireEvent.change(document.querySelector('#source-id')!, { target: { value: 'character-1' } });
    fireEvent.change(document.querySelector('#target-id')!, { target: { value: 'character-2' } });
    fireEvent.click(screen.getByRole('button', { name: '盟友' }));
    fireEvent.change(screen.getByPlaceholderText('补充关系细节...'), { target: { value: '不会丢失的本地说明' } });
    fireEvent.click(screen.getByRole('button', { name: '创建关系' }));

    await waitFor(() => expect(clients.create).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'character-1',
      targetId: 'character-2',
      description: '不会丢失的本地说明',
    }), 7));
    expect(await screen.findByText('数据库已变化，已保留本地输入。请刷新后重试。')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByDisplayValue('不会丢失的本地说明')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('forwards the accepted generation when updating a relationship', async () => {
    clients.update.mockResolvedValue(true);

    render(
      <RelationshipFormDialog
        open
        mode="edit"
        novelId="novel-1"
        databaseGeneration={7}
        characters={characters}
        locations={[]}
        items={[]}
        factions={[]}
        existingRelationship={relationship}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('补充关系细节...'), { target: { value: '新说明' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(clients.update).toHaveBeenCalledWith(
      'relationship-1',
      expect.objectContaining({ description: '新说明' }),
      7,
    ));
  });

  test('keeps the relationship edit dialog and fields when a generation conflict rejects updating', async () => {
    clients.update.mockRejectedValue(Object.assign(new Error('generation conflict'), {
      status: 409,
      code: 'DATABASE_GENERATION_STALE',
    }));
    const onClose = vi.fn();
    const onSaved = vi.fn();

    render(
      <RelationshipFormDialog
        open
        mode="edit"
        novelId="novel-1"
        databaseGeneration={7}
        characters={characters}
        locations={[]}
        items={[]}
        factions={[]}
        existingRelationship={relationship}
        onClose={onClose}
        onSaved={onSaved}
        onDeleted={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('补充关系细节...'), { target: { value: '编辑冲突后保留' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(clients.update).toHaveBeenCalledWith(
      'relationship-1',
      expect.objectContaining({ description: '编辑冲突后保留' }),
      7,
    ));
    expect(await screen.findByText('数据库已变化，已保留本地输入。请刷新后重试。')).toBeTruthy();
    expect(screen.getByDisplayValue('编辑冲突后保留')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('forwards the accepted generation when deleting a relationship', async () => {
    clients.remove.mockResolvedValue(true);

    render(
      <RelationshipFormDialog
        open
        mode="delete"
        novelId="novel-1"
        databaseGeneration={7}
        characters={characters}
        locations={[]}
        items={[]}
        factions={[]}
        existingRelationship={relationship}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(clients.remove).toHaveBeenCalledWith('relationship-1', 7));
  });

  test('keeps the relationship delete dialog when a generation conflict rejects deleting', async () => {
    clients.remove.mockRejectedValue(Object.assign(new Error('generation conflict'), {
      status: 409,
      code: 'DATABASE_GENERATION_MISMATCH',
    }));
    const onClose = vi.fn();
    const onDeleted = vi.fn();

    render(
      <RelationshipFormDialog
        open
        mode="delete"
        novelId="novel-1"
        databaseGeneration={7}
        characters={characters}
        locations={[]}
        items={[]}
        factions={[]}
        existingRelationship={relationship}
        onClose={onClose}
        onSaved={vi.fn()}
        onDeleted={onDeleted}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(clients.remove).toHaveBeenCalledWith('relationship-1', 7));
    expect(await screen.findByText('数据库已变化，已保留本地输入。请刷新后重试。')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
