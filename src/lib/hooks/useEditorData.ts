import { useState, useEffect, useRef, useCallback } from 'react';
import { useEditorDataStore } from '../../stores/editor-data-store';
import { useOutlineContentStore } from '../../stores/outline-content-store';
import { Chapter, PowerLevel, TimelineEvent, MountedSkillLoadoutItem, ProjectPreferenceProfile, Foreshadowing } from '../../../shared/types';
import {
  listChaptersMetadata, getChapter, listCharacters, listLocations, listItems, listFactions,
  listPowerLevels, listTimelineEvents, syncSkillFeedbackScores, listSkillUsageRecords,
  getNovel, subscribeToChanges, listEntityRelationshipsClient
} from '../api';
import { resolveSkillLoadout } from '../skill-model';
import { clearStaleEditorWrites, hasPendingWriteForExactKey } from '../editor-write-queue';
import { normalizeProjectPreferenceProfile } from '../../../shared/lib/project-preference-profile';
import { getDatabaseGenerationSnapshot } from '../db-transport';
import { listForeshadowings } from '../foreshadowing-client';

export function useEditorData(novelId: string, initialChapterId?: string) {
  const chapters = useEditorDataStore((state) => state.chapters);
  const setChapters = useEditorDataStore((state) => state.setChapters);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(initialChapterId || null);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [chapterLoading, setChapterLoading] = useState(false);
  const characters = useEditorDataStore((state) => state.characters);
  const setCharacters = useEditorDataStore((state) => state.setCharacters);
  const locations = useEditorDataStore((state) => state.locations);
  const setLocations = useEditorDataStore((state) => state.setLocations);
  const items = useEditorDataStore((state) => state.items);
  const setItems = useEditorDataStore((state) => state.setItems);
  const factions = useEditorDataStore((state) => state.factions);
  const setFactions = useEditorDataStore((state) => state.setFactions);
  const librarySkills = useEditorDataStore((state) => state.librarySkills);
  const setLibrarySkills = useEditorDataStore((state) => state.setLibrarySkills);
  const skillUsageRecords = useEditorDataStore((state) => state.skillUsageRecords);
  const setSkillUsageRecords = useEditorDataStore((state) => state.setSkillUsageRecords);
  const relationships = useEditorDataStore((state) => state.relationships);
  const setRelationships = useEditorDataStore((state) => state.setRelationships);
  const [powerLevels, setPowerLevels] = useState<PowerLevel[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [foreshadowings, setForeshadowings] = useState<Foreshadowing[]>([]);
  const [mountedSkillLoadout, setMountedSkillLoadout] = useState<MountedSkillLoadoutItem[]>([]);
  const [pendingSkillIds, setPendingSkillIds] = useState<string[]>([]);
  const projectPreferenceProfile = useEditorDataStore((state) => state.projectPreferenceProfile);
  const setProjectPreferenceProfile = useEditorDataStore((state) => state.setProjectPreferenceProfile);
  // 011 Phase 2：主纲值入 outline-content-store；revision 自增/清零语义由 store 承担
  const globalOutline = useOutlineContentStore((state) => state.globalOutline);
  const [databaseGeneration, setDatabaseGeneration] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const dataRequestSeqRef = useRef(0);
  const chapterRequestSeqRef = useRef(0);
  const selectedChapterIdRef = useRef<string | null>(initialChapterId || null);
  const currentChapterRef = useRef<Chapter | null>(null);
  const setGlobalOutlineRaw = useOutlineContentStore((state) => state.setGlobalOutlineRaw);
  const setGlobalOutline = useOutlineContentStore((state) => state.setGlobalOutline);

  const readGeneration = useCallback(async (): Promise<number | null> => {
    try {
      const generation = await getDatabaseGenerationSnapshot();
      return generation ?? null;
    } catch (error) {
      console.warn('[useEditorData] Database generation unavailable:', error);
      return null;
    }
  }, []);

  const hasConsistentGeneration = (before: number | null, after: number | null) =>
    Number.isInteger(before) && Number.isInteger(after) && before === after;

  useEffect(() => {
    currentChapterRef.current = currentChapter;
    if (currentChapter) {
      selectedChapterIdRef.current = currentChapter.id;
    }
  }, [currentChapter]);

  const selectChapter = useCallback(async (chapterId: string): Promise<Chapter | null> => {
    const requestSeq = ++chapterRequestSeqRef.current;
    const previousChapter = currentChapterRef.current;
    const previousSelectedChapterId = selectedChapterIdRef.current;
    selectedChapterIdRef.current = chapterId;
    setSelectedChapterId(chapterId);
    currentChapterRef.current = null;
    setCurrentChapter(null);
    setChapterLoading(true);

    try {
      const generationBefore = await readGeneration();
      const fullChapter = await getChapter(chapterId);
      const generationAfter = await readGeneration();
      if (
        requestSeq !== chapterRequestSeqRef.current
        || selectedChapterIdRef.current !== chapterId
      ) {
        return null;
      }

      if (!hasConsistentGeneration(generationBefore, generationAfter)) {
        selectedChapterIdRef.current = previousSelectedChapterId;
        setSelectedChapterId(previousSelectedChapterId);
        currentChapterRef.current = previousChapter;
        setCurrentChapter(previousChapter);
        return null;
      }

      if (!fullChapter) {
        selectedChapterIdRef.current = null;
        setSelectedChapterId(null);
        currentChapterRef.current = null;
        setCurrentChapter(null);
        setChapters((previous) => previous.filter((chapter) => chapter.id !== chapterId));
        return null;
      }

      currentChapterRef.current = fullChapter;
      setCurrentChapter(fullChapter);
      return fullChapter;
    } finally {
      if (requestSeq === chapterRequestSeqRef.current) {
        setChapterLoading(false);
      }
    }
  }, [readGeneration, setChapters]);

  const loadAuxiliaryData = useCallback(async (requestSeq: number) => {
    const generationBefore = await readGeneration();
    const results = await Promise.allSettled([
      listCharacters(novelId),
      listLocations(novelId),
      listItems(novelId),
      listFactions(novelId),
      listPowerLevels(novelId),
      listTimelineEvents(novelId),
      listForeshadowings(novelId),
      syncSkillFeedbackScores(),
      listSkillUsageRecords(),
      listEntityRelationshipsClient(novelId),
    ] as const);
    const generationAfter = await readGeneration();

    if (
      requestSeq !== dataRequestSeqRef.current
      || !hasConsistentGeneration(generationBefore, generationAfter)
    ) return;

    const [
      characterResult,
      locationResult,
      itemResult,
      factionResult,
      powerLevelResult,
      timelineResult,
      foreshadowingResult,
      skillResult,
      usageResult,
      relationshipResult,
    ] = results;

    if (characterResult.status === 'fulfilled') setCharacters(characterResult.value);
    if (locationResult.status === 'fulfilled') setLocations(locationResult.value);
    if (itemResult.status === 'fulfilled') setItems(itemResult.value);
    if (factionResult.status === 'fulfilled') setFactions(factionResult.value);
    if (powerLevelResult.status === 'fulfilled') setPowerLevels(powerLevelResult.value);
    if (timelineResult.status === 'fulfilled') setTimelineEvents(timelineResult.value);
    if (foreshadowingResult.status === 'fulfilled') setForeshadowings(foreshadowingResult.value);
    if (skillResult.status === 'fulfilled') setLibrarySkills(skillResult.value);
    if (usageResult.status === 'fulfilled') setSkillUsageRecords(usageResult.value);
    if (relationshipResult.status === 'fulfilled') setRelationships(relationshipResult.value);

    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.warn('[useEditorData] Auxiliary editor data unavailable:', result.reason);
      }
    });
  }, [novelId, readGeneration, setCharacters, setFactions, setItems, setLibrarySkills, setLocations, setRelationships, setSkillUsageRecords]);

  const fetchAll = useCallback(async () => {
    const requestSeq = ++dataRequestSeqRef.current;
    const revisionAtStart = useOutlineContentStore.getState().outlineRevision;

    try {
      const generationBefore = await readGeneration();
      const [freshChapters, freshNovel] = await Promise.all([
        listChaptersMetadata(novelId),
        getNovel(novelId),
      ]);
      const generationResult = await readGeneration();

      if (
        requestSeq !== dataRequestSeqRef.current
        || !hasConsistentGeneration(generationBefore, generationResult)
      ) return;

      setChapters(freshChapters);
      if (generationResult !== null) setDatabaseGeneration(generationResult);
      if (generationResult !== null) clearStaleEditorWrites();
      if (freshNovel) {
        const resolved = resolveSkillLoadout({
          profileVersion: (freshNovel.projectPreferenceProfile as (ProjectPreferenceProfile & { skillLoadoutSchemaVersion?: number }) | undefined)?.skillLoadoutSchemaVersion,
          mountedSkillLoadout: freshNovel.mountedSkillLoadout,
          mountedSkillIds: freshNovel.mountedSkillIds,
        });
        setMountedSkillLoadout(resolved.loadout);
        setPendingSkillIds(resolved.pendingSkillIds);
        setProjectPreferenceProfile(
          freshNovel.projectPreferenceProfile
            ? normalizeProjectPreferenceProfile(freshNovel.projectPreferenceProfile)
            : undefined,
        );
        if (
          freshNovel.globalOutline !== undefined
          && revisionAtStart === useOutlineContentStore.getState().outlineRevision
          && !hasPendingWriteForExactKey(`novel:${novelId}:globalOutline`)
        ) {
          setGlobalOutlineRaw(freshNovel.globalOutline || '');
        }
      }

      const selectedId = selectedChapterIdRef.current;
      const selectedStillExists = selectedId
        ? freshChapters.some((chapter) => chapter.id === selectedId)
        : false;
      const targetChapterId = selectedStillExists ? selectedId : freshChapters[0]?.id ?? null;

      if (!targetChapterId) {
        chapterRequestSeqRef.current += 1;
        selectedChapterIdRef.current = null;
        currentChapterRef.current = null;
        setSelectedChapterId(null);
        setCurrentChapter(null);
        setChapterLoading(false);
      } else if (currentChapterRef.current?.id === targetChapterId) {
        const metadata = freshChapters.find((chapter) => chapter.id === targetChapterId);
        if (metadata) {
          setCurrentChapter((previous) => {
            if (!previous || previous.id !== targetChapterId) return previous;
            const next = { ...previous, ...metadata };
            currentChapterRef.current = next;
            return next;
          });
        }
      } else {
        void selectChapter(targetChapterId).catch((error) => {
          console.warn('[useEditorData] Failed to load selected chapter:', error);
        });
      }

      setIsLoading(false);
      void loadAuxiliaryData(requestSeq);
    } catch (error) {
      console.warn('Failed to fetch core editor data:', error);
      if (requestSeq === dataRequestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [loadAuxiliaryData, novelId, readGeneration, selectChapter, setChapters, setGlobalOutlineRaw, setProjectPreferenceProfile]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reset visible editor state before loading a different project */
    dataRequestSeqRef.current += 1;
    chapterRequestSeqRef.current += 1;
    selectedChapterIdRef.current = initialChapterId || null;
    currentChapterRef.current = null;
    setSelectedChapterId(initialChapterId || null);
    setCurrentChapter(null);
    useOutlineContentStore.getState().resetOutlineContent();
    setDatabaseGeneration(null);
    setIsLoading(true);
    setChapterLoading(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    void fetchAll();
    const unsubscribe = subscribeToChanges(fetchAll);
    return () => {
      dataRequestSeqRef.current += 1;
      chapterRequestSeqRef.current += 1;
      unsubscribe();
    };
  }, [novelId, initialChapterId, fetchAll]);

  return {
    chapters,
    setChapters,
    selectedChapterId: currentChapter?.id ?? selectedChapterId,
    currentChapter,
    setCurrentChapter,
    selectChapter,
    chapterLoading,
    characters,
    setCharacters,
    locations,
    setLocations,
    items,
    setItems,
    factions,
    setFactions,
    powerLevels,
    setPowerLevels,
    timelineEvents,
    setTimelineEvents,
    foreshadowings,
    setForeshadowings,
    librarySkills,
    setLibrarySkills,
    skillUsageRecords,
    setSkillUsageRecords,
    mountedSkillLoadout,
    setMountedSkillLoadout,
    pendingSkillIds,
    setPendingSkillIds,
    relationships,
    setRelationships,
    projectPreferenceProfile,
    setProjectPreferenceProfile,
    globalOutline,
    setGlobalOutline,
    databaseGeneration,
    isLoading,
    refreshEditorData: fetchAll
  };
}
