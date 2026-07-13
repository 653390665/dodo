import type { Character, Item, Location } from '../../shared/types';
import {
  createCharacter,
  createItem,
  createLocation,
  updateCharacter,
  updateItem,
  updateLocation,
} from './world-client';

export type QuickSettingType = 'character' | 'location' | 'item';
export type PersistedQuickSetting =
  | { type: 'character'; entity: Character; created: boolean }
  | { type: 'location'; entity: Location; created: boolean }
  | { type: 'item'; entity: Item; created: boolean };

export async function persistQuickSetting(input: {
  novelId: string;
  type: QuickSettingType;
  name: string;
  description: string;
  existing?: Character | Location | Item;
}): Promise<PersistedQuickSetting> {
  const now = Date.now();

  if (input.existing) {
    if (input.type === 'character') {
      const entity = {
        ...(input.existing as Character),
        name: input.name,
        summary: input.description,
        bio: input.description,
        updatedAt: now,
      };
      if (!await updateCharacter(entity.id, entity)) throw new Error('人物已不存在');
      return { type: 'character', entity, created: false };
    }
    if (input.type === 'location') {
      const entity = {
        ...(input.existing as Location),
        name: input.name,
        description: input.description,
        updatedAt: now,
      };
      if (!await updateLocation(entity.id, entity)) throw new Error('地点已不存在');
      return { type: 'location', entity, created: false };
    }
    const entity = {
      ...(input.existing as Item),
      name: input.name,
      description: input.description,
      updatedAt: now,
    };
    if (!await updateItem(entity.id, entity)) throw new Error('道具已不存在');
    return { type: 'item', entity, created: false };
  }

  const id = crypto.randomUUID();

  if (input.type === 'character') {
    const entity: Character = {
      id,
      novelId: input.novelId,
      name: input.name,
      role: 'supporting',
      summary: input.description,
      traits: [],
      bio: input.description,
      createdAt: now,
      updatedAt: now,
    };
    await createCharacter(entity);
    return { type: 'character', entity, created: true };
  }

  if (input.type === 'location') {
    const entity: Location = {
      id,
      novelId: input.novelId,
      name: input.name,
      description: input.description,
      region: '',
      createdAt: now,
      updatedAt: now,
    };
    await createLocation(entity);
    return { type: 'location', entity, created: true };
  }

  const entity: Item = {
    id,
    novelId: input.novelId,
    name: input.name,
    description: input.description,
    type: '',
    createdAt: now,
    updatedAt: now,
  };
  await createItem(entity);
  return { type: 'item', entity, created: true };
}
