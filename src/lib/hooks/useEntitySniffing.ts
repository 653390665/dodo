import { useRef, useState } from 'react';

import type { Chapter, Character, Item, Location, SniffedEntities } from '../../../shared/types';
import { createCharacter, createItem, createLocation } from '../world-client';

interface UseEntitySniffingArgs {
  novelId: string;
  currentChapter: Chapter | null;
  characters: Character[];
  locations: Location[];
  items: Item[];
}

export function useEntitySniffing({
  novelId,
  currentChapter,
  characters,
  locations,
  items,
}: UseEntitySniffingArgs) {
  const [isSniffing, setIsSniffing] = useState(false);
  const [sniffedEntities, setSniffedEntities] = useState<SniffedEntities | null>(null);
  const [addingEntityNames, setAddingEntityNames] = useState<string[]>([]);

  const requestSeqRef = useRef(0);

  const handleAddSniffedEntity = async (entity: SniffedEntities['newEntities'][number]) => {
    setAddingEntityNames((prev) => [...prev, entity.name]);
    try {
      const response = await fetch('/api/generate-entity-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entity),
      });
      const data = await response.json();

      const now = Date.now();

      if (data.entityType === 'character') {
        await createCharacter({
          id: Date.now().toString(),
          novelId,
          name: data.name,
          role: data.role || 'supporting',
          summary: data.summary || '',
          traits: data.traits || [],
          bio: data.bio || '',
          createdAt: now,
          updatedAt: now,
        });
      } else if (data.entityType === 'location') {
        await createLocation({
          id: Date.now().toString(),
          novelId,
          name: data.name,
          region: data.region || '',
          description: data.description || '',
          createdAt: now,
          updatedAt: now,
        });
      } else if (data.entityType === 'item') {
        await createItem({
          id: Date.now().toString(),
          novelId,
          name: data.name,
          type: data.type || '',
          description: data.description || '',
          createdAt: now,
          updatedAt: now,
        });
      }

      setSniffedEntities((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          newEntities: prev.newEntities.filter((candidate) => candidate.name !== entity.name),
        };
      });
    } catch (error) {
      console.error('Failed to add entity', error);
      alert(`添加失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAddingEntityNames((prev) => prev.filter((name) => name !== entity.name));
    }
  };

  const handleSniffEntities = async () => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter) return;

    const currentSeq = ++requestSeqRef.current;

    setIsSniffing(true);
    try {
      const existingNames = [
        ...characters.map((character) => character.name),
        ...locations.map((location) => location.name),
        ...items.map((item) => item.name),
      ].filter(Boolean);
      const textToScan = `${currentChapter.sceneBeats || ''}\n${currentChapter.content || ''}`;

      const response = await fetch('/api/extract-entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToScan, existingNames }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (currentChapter?.id !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setSniffedEntities(data);
    } catch (error) {
      console.error(error);
      alert('嗅探失败');
    } finally {
      setIsSniffing(false);
    }
  };

  return {
    isSniffing,
    sniffedEntities,
    addingEntityNames,
    handleSniffEntities,
    handleAddSniffedEntity,
  };
}
