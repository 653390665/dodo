import { beforeEach, describe, expect, test, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  call: vi.fn(),
  callForGeneration: vi.fn(),
}));

vi.mock('../lib/db-transport', () => transport);

import {
  createEntityRelationshipClient,
  deleteCharacter,
  deleteEntityRelationshipClient,
  deleteFaction,
  deleteItem,
  deleteLocation,
  deletePowerLevel,
  deleteTimelineEvent,
  updateEntityRelationshipClient,
  updateFaction,
  updateItem,
  updateLocation,
  updatePowerLevel,
  updateTimelineEvent,
} from '../lib/world-client';

describe('world client database generation forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transport.call.mockResolvedValue(true);
    transport.callForGeneration.mockResolvedValue(true);
  });

  test('forwards the frozen generation for every extended entity update and delete wrapper', async () => {
    await updateLocation('location-1', { name: '地点' }, 7);
    await updateItem('item-1', { name: '道具' }, 7);
    await updateFaction('faction-1', { name: '势力' }, 7);
    await updatePowerLevel('power-1', { name: '境界' }, 7);
    await updateTimelineEvent('event-1', { title: '事件' }, 7);
    await deleteCharacter('character-1', 7);
    await deleteLocation('location-1', 7);
    await deleteItem('item-1', 7);
    await deleteFaction('faction-1', 7);
    await deletePowerLevel('power-1', 7);
    await deleteTimelineEvent('event-1', 7);

    expect(transport.callForGeneration.mock.calls).toEqual([
      [7, 'updateLocation', 'location-1', { name: '地点' }],
      [7, 'updateItem', 'item-1', { name: '道具' }],
      [7, 'updateFaction', 'faction-1', { name: '势力' }],
      [7, 'updatePowerLevel', 'power-1', { name: '境界' }],
      [7, 'updateTimelineEvent', 'event-1', { title: '事件' }],
      [7, 'deleteCharacter', 'character-1'],
      [7, 'deleteLocation', 'location-1'],
      [7, 'deleteItem', 'item-1'],
      [7, 'deleteFaction', 'faction-1'],
      [7, 'deletePowerLevel', 'power-1'],
      [7, 'deleteTimelineEvent', 'event-1'],
    ]);
  });

  test('forwards the frozen generation for relationship create update and delete', async () => {
    const relationship = {
      id: 'relationship-1',
      novelId: 'novel-1',
      sourceType: 'character' as const,
      sourceId: 'character-1',
      targetType: 'character' as const,
      targetId: 'character-2',
      relationshipType: '盟友',
      createdAt: 1,
    };

    await createEntityRelationshipClient(relationship, 7);
    await updateEntityRelationshipClient('relationship-1', { description: '并肩作战' }, 7);
    await deleteEntityRelationshipClient('relationship-1', 7);

    expect(transport.callForGeneration.mock.calls).toEqual([
      [7, 'createEntityRelationship', relationship],
      [7, 'updateEntityRelationship', 'relationship-1', { description: '并肩作战' }],
      [7, 'deleteEntityRelationship', 'relationship-1'],
    ]);
  });

  test('keeps the compatibility path when generation is omitted', async () => {
    await updateLocation('location-1', { name: '旧调用方' });

    expect(transport.call).toHaveBeenCalledWith('updateLocation', 'location-1', { name: '旧调用方' });
    expect(transport.callForGeneration).not.toHaveBeenCalled();
  });
});
