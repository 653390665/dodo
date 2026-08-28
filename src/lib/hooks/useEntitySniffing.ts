import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Chapter, Character, Item, Location, SniffedEntities } from '../../../shared/types';
import { createCharacter, createItem, createLocation } from '../world-client';
import { startWorldJob } from '../world-job-client';
import { generateClientId } from '../id';

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

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
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
  const sniffScopeRef = useRef({ novelId, chapterId: currentChapter?.id });
  const lastSniffStartedAtRef = useRef(0);

  const chapterSceneBeats = currentChapter?.sceneBeats || '';
  const chapterContent = currentChapter?.content || '';
  const chapterText = useMemo(
    () => `${chapterSceneBeats}\n${chapterContent}`,
    [chapterSceneBeats, chapterContent],
  );
  const chapterTextHash = useMemo(() => stableHash(chapterText), [chapterText]);
  const chapterId = currentChapter?.id;
  // Hashes keep object identity changes from rebuilding the scan input.
  /* eslint-disable react-hooks/exhaustive-deps -- dependencies are stable hashes, not mutable entity objects */
  const chapterInput = useMemo(() => chapterId ? {
    id: chapterId,
    text: chapterText,
  } : null, [chapterId, chapterTextHash, chapterText]);
  const existingNamesSignature = [
    ...characters.map((character) => character.name),
    ...locations.map((location) => location.name),
    ...items.map((item) => item.name),
  ].filter(Boolean).sort().join('\u001f');
  const existingNamesHash = useMemo(() => stableHash(existingNamesSignature), [existingNamesSignature]);
  const stableExistingNames = useMemo(() => existingNamesSignature ? existingNamesSignature.split('\u001f') : [], [existingNamesHash]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reset chapter-scoped scan state */
    sniffScopeRef.current = { novelId, chapterId };
    requestSeqRef.current += 1;
    sniffControllerRef.current?.abort();
    sniffControllerRef.current = null;
    sniffDatabaseGenerationRef.current = null;
    setSniffedEntities(null);
    setAddingEntityNames([]);
    setIsSniffing(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [chapterId, novelId]);

  useEffect(() => () => {
    requestSeqRef.current += 1;
    sniffControllerRef.current?.abort();
  }, []);

  const handleAddSniffedEntity = async (entity: SniffedEntities['newEntities'][number]) => {
    const scopeAtStart = sniffScopeRef.current;
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
          id: generateClientId(),
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
          id: generateClientId(),
          novelId,
          name: data.name || entity.name,
          region: data.region || '',
          description: data.description || '',
          createdAt: now,
          updatedAt: now,
        }, databaseGeneration);
      } else if (data.entityType === 'item') {
        await createItem({
          id: generateClientId(),
          novelId,
          name: data.name || entity.name,
          type: data.type || '',
          description: data.description || '',
          createdAt: now,
          updatedAt: now,
        }, databaseGeneration);
      }

      if (scopeAtStart.novelId !== sniffScopeRef.current.novelId || scopeAtStart.chapterId !== sniffScopeRef.current.chapterId) return;
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

  const handleSniffEntities = useCallback(async () => {
    const startingChapterId = chapterInput?.id;
    if (!chapterInput) return;
    const now = Date.now();
    if (now - lastSniffStartedAtRef.current < 280) return;
    lastSniffStartedAtRef.current = now;

    const currentSeq = ++requestSeqRef.current;
    sniffControllerRef.current?.abort();
    const controller = new AbortController();
    sniffControllerRef.current = controller;

    setIsSniffing(true);
    try {
      const { result: data, databaseGeneration } = await startWorldJob<SniffedEntities>(
        '/api/extract-entities',
        { novelId, text: chapterInput.text, existingNames: stableExistingNames },
        {},
        controller.signal,
      );
      if (chapterInput.id !== startingChapterId || requestSeqRef.current !== currentSeq) return;
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
  }, [chapterInput, novelId, stableExistingNames]);

  return {
    isSniffing,
    sniffedEntities,
    addingEntityNames,
    handleSniffEntities,
    handleAddSniffedEntity,
  };
}
