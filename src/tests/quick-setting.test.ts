import { beforeEach, describe, expect, test, vi } from 'vitest';

const clients = vi.hoisted(() => ({
  createCharacter: vi.fn(),
  createLocation: vi.fn(),
  createItem: vi.fn(),
}));

vi.mock('../lib/world-client', () => clients);

import { persistQuickSetting } from '../lib/quick-setting';

describe('persistQuickSetting', () => {
  beforeEach(() => Object.values(clients).forEach((mock) => mock.mockReset().mockResolvedValue(undefined)));

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
  });

  test('rejects without returning a local-only entity when the database fails', async () => {
    clients.createCharacter.mockRejectedValue(new Error('database unavailable'));
    await expect(persistQuickSetting({
      novelId: 'novel-1', type: 'character', name: 'Name', description: 'Details',
    })).rejects.toThrow('database unavailable');
  });
});
