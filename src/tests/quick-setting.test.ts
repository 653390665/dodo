import { beforeEach, describe, expect, test, vi } from 'vitest';

const clients = vi.hoisted(() => ({
  createCharacter: vi.fn(),
  createLocation: vi.fn(),
  createItem: vi.fn(),
  updateCharacter: vi.fn(),
  updateLocation: vi.fn(),
  updateItem: vi.fn(),
}));

vi.mock('../lib/world-client', () => clients);

import { persistQuickSetting } from '../lib/quick-setting';

describe('persistQuickSetting', () => {
  beforeEach(() => {
    Object.values(clients).forEach((mock) => mock.mockReset().mockResolvedValue(undefined));
    clients.updateCharacter.mockResolvedValue(true);
    clients.updateLocation.mockResolvedValue(true);
    clients.updateItem.mockResolvedValue(true);
  });

  test.each(['character', 'location', 'item'] as const)('persists %s before returning it to local state', async (type) => {
    const result = await persistQuickSetting({ novelId: 'novel-1', type, name: 'Name', description: 'Details' });
    const expectedClient = type === 'character'
      ? clients.createCharacter
      : type === 'location'
        ? clients.createLocation
        : clients.createItem;
    expect(expectedClient).toHaveBeenCalledTimes(1);
    expect(expectedClient).toHaveBeenCalledWith(expect.objectContaining({ novelId: 'novel-1', name: 'Name' }));
    expect(result.type).toBe(type);
    expect(result.created).toBe(true);
  });

  test('rejects without returning a local-only entity when the database fails', async () => {
    clients.createCharacter.mockRejectedValue(new Error('database unavailable'));
    await expect(persistQuickSetting({
      novelId: 'novel-1', type: 'character', name: 'Name', description: 'Details',
    })).rejects.toThrow('database unavailable');
  });

  test('editing an existing character updates the same row instead of creating a duplicate', async () => {
    const existing = {
      id: 'character-1', novelId: 'novel-1', name: 'Old', role: 'supporting' as const,
      summary: '', traits: [], bio: '', createdAt: 1, updatedAt: 1,
    };
    const result = await persistQuickSetting({
      novelId: 'novel-1',
      type: 'character',
      name: 'Updated',
      description: 'New bio',
      existing,
    });

    expect(clients.createCharacter).not.toHaveBeenCalled();
    expect(clients.updateCharacter).toHaveBeenCalledWith(
      'character-1',
      expect.objectContaining({ name: 'Updated', bio: 'New bio' }),
    );
    expect(result.created).toBe(false);
    expect(result.entity.id).toBe('character-1');
  });

  test('editing database-loaded entities strips raw SQLite column names', async () => {
    const character = {
      id: 'character-1', novelId: 'novel-1', name: 'Old', role: 'supporting' as const,
      summary: '', traits: [], bio: '', createdAt: 1, updatedAt: 1,
      novel_id: 'novel-1', created_at: 1, updated_at: 1,
    };
    const location = {
      id: 'location-1', novelId: 'novel-1', name: 'Old', description: '', region: '',
      createdAt: 1, updatedAt: 1, novel_id: 'novel-1', created_at: 1, updated_at: 1,
    };
    const item = {
      id: 'item-1', novelId: 'novel-1', name: 'Old', description: '', type: '',
      createdAt: 1, updatedAt: 1, novel_id: 'novel-1', created_at: 1, updated_at: 1,
    };

    await Promise.all([
      persistQuickSetting({ novelId: 'novel-1', type: 'character', name: 'New', description: 'Details', existing: character }),
      persistQuickSetting({ novelId: 'novel-1', type: 'location', name: 'New', description: 'Details', existing: location }),
      persistQuickSetting({ novelId: 'novel-1', type: 'item', name: 'New', description: 'Details', existing: item }),
    ]);

    const payloads = [
      clients.updateCharacter.mock.calls[0]?.[1],
      clients.updateLocation.mock.calls[0]?.[1],
      clients.updateItem.mock.calls[0]?.[1],
    ];
    for (const payload of payloads) {
      expect(payload).not.toHaveProperty('novel_id');
      expect(payload).not.toHaveProperty('created_at');
      expect(payload).not.toHaveProperty('updated_at');
    }
  });

  test('editing reports failure when the target row no longer exists', async () => {
    clients.updateCharacter.mockResolvedValue(false);
    await expect(persistQuickSetting({
      novelId: 'novel-1',
      type: 'character',
      name: 'Updated',
      description: 'New bio',
      existing: {
        id: 'missing', novelId: 'novel-1', name: 'Old', role: 'supporting',
        summary: '', traits: [], bio: '', createdAt: 1, updatedAt: 1,
      },
    })).rejects.toThrow('人物已不存在');
  });
});
