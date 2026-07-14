import { useEffect, useRef, useState } from 'react';

import type { Chapter, Character, Item, Location, SniffedEntities } from '../../../shared/types';
import { createCharacter, createItem, createLocation } from '../world-client';
import { startWorldJob } from '../world-job-client';

interface UseEntitySniffingArgs {
  novelId: string;
  currentChapter: Chapter | null;
  characters: Character[];
  locations: Location[];
  items: Item[];
}

interface GeneratedEntityDetails {
  entityType?: 'character' | 'location' | 'item';
  name?: string;
  role?: Character['role'];
  summary?: string;
  traits?: string[];
  bio?: string;
  region?: string;
  description?: string;
  type?: string;
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
  const sniffControllerRef = useRef<AbortController | null>(null);
  const sniffDatabaseGenerationRef = useRef<number | null>(null);

  useEffect(() => () => sniffControllerRef.current?.abort(), []);

  const handleAddSniffedEntity = async (entity: SniffedEntities['newEntities'][number]) => {
    setAddingEntityNames((prev) => [...prev, entity.name]);
    try {
      const { result: data, databaseGeneration } = await startWorldJob<GeneratedEntityDetails>(
        '/api/generate-entity-details',
        {
          ...entity,
          novelId,
          ...(sniffDatabaseGenerationRef.current === null ? {} : { databaseGeneration: sniffDatabaseGenerationRef.current }),
        },
      );

      const now = Date.now();

      if (data.entityType === 'character') {
        await createCharacter({
          id: Date.now().toString(),
          novelId,
          name: data.name || entity.name,
          role: data.role || 'supporting',
          summary: data.summary || '',
          traits: data.traits || [],
          bio: data.bio || '',
          createdAt: now,
          updatedAt: now,
        }, databaseGeneration);
      } else if (data.entityType === 'location') {
        await createLocation({
          id: Date.now().toString(),
          novelId,
          name: data.name || entity.name,
          region: data.region || '',
          description: data.description || '',
          createdAt: now,
          updatedAt: now,
        }, databaseGeneration);
      } else if (data.entityType === 'item') {
        await createItem({
          id: Date.now().toString(),
          novelId,
          name: data.name || entity.name,
          type: data.type || '',
          description: data.description || '',
          createdAt: now,
          updatedAt: now,
        }, databaseGeneration);
      }

      setSniffedEntities((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          newEntities: prev.newEntities.filter((candidate) => candidate.name !== entity.name),
        };
      });
    } catch (error) {
      alert(`添加失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAddingEntityNames((prev) => prev.filter((name) => name !== entity.name));
    }
  };

  const handleSniffEntities = async () => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter) return;

    const currentSeq = ++requestSeqRef.current;
    sniffControllerRef.current?.abort();
    const controller = new AbortController();
    sniffControllerRef.current = controller;

    setIsSniffing(true);
    try {
      const existingNames = [
        ...characters.map((character) => character.name),
        ...locations.map((location) => location.name),
        ...items.map((item) => item.name),
      ].filter(Boolean);
      const textToScan = `${currentChapter.sceneBeats || ''}\n${currentChapter.content || ''}`;

      const { result: data, databaseGeneration } = await startWorldJob<SniffedEntities>(
        '/api/extract-entities',
        { novelId, text: textToScan, existingNames },
        {},
        controller.signal,
      );
      if (currentChapter?.id !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      sniffDatabaseGenerationRef.current = databaseGeneration;
      setSniffedEntities(data);
    } catch {
      if (controller.signal.aborted) return;
      alert('嗅探失败');
    } finally {
      if (sniffControllerRef.current === controller) {
        sniffControllerRef.current = null;
        setIsSniffing(false);
      }
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
