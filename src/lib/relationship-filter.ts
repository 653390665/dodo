import type { EntityRelationship, Character, Location, Item, Faction } from '../../shared/types';

export function filterRelationshipsByActiveEntities(
  relationships: EntityRelationship[],
  activeEntityNames: string[],
  characters: Character[],
  locations: Location[],
  items: Item[],
  factions: Faction[],
): EntityRelationship[] {
  if (!activeEntityNames || activeEntityNames.length === 0) return [];

  const activeCharIds = characters.filter(c => activeEntityNames.includes(c.name)).map(c => c.id);
  const activeLocIds = locations.filter(l => activeEntityNames.includes(l.name)).map(l => l.id);
  const activeItemIds = items.filter(i => activeEntityNames.includes(i.name)).map(i => i.id);
  const activeFactionIds = factions.filter(f => activeEntityNames.includes(f.name)).map(f => f.id);

  return relationships.filter((rel) => {
    const isSourceActive =
      (rel.sourceType === 'character' && activeCharIds.includes(rel.sourceId)) ||
      (rel.sourceType === 'location' && activeLocIds.includes(rel.sourceId)) ||
      (rel.sourceType === 'item' && activeItemIds.includes(rel.sourceId)) ||
      (rel.sourceType === 'faction' && activeFactionIds.includes(rel.sourceId));

    const isTargetActive =
      (rel.targetType === 'character' && activeCharIds.includes(rel.targetId)) ||
      (rel.targetType === 'location' && activeLocIds.includes(rel.targetId)) ||
      (rel.targetType === 'item' && activeItemIds.includes(rel.targetId)) ||
      (rel.targetType === 'faction' && activeFactionIds.includes(rel.targetId));

    return isSourceActive || isTargetActive;
  });
}
