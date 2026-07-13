import type { Character, Item, Location } from '../../shared/types';
import { createCharacter, createItem, createLocation } from './world-client';

export type QuickSettingType = 'character' | 'location' | 'item';
export type PersistedQuickSetting =
  | { type: 'character'; entity: Character }
  | { type: 'location'; entity: Location }
  | { type: 'item'; entity: Item };

export async function persistQuickSetting(input: {
  novelId: string;
  type: QuickSettingType;
  name: string;
  description: string;
}): Promise<PersistedQuickSetting> {
  const id = crypto.randomUUID();
  const now = Date.now();

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
    return { type: 'character', entity };
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
    return { type: 'location', entity };
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
  return { type: 'item', entity };
}
