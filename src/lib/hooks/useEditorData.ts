import { useState, useEffect, useRef, useCallback } from 'react';
import { Chapter, ChapterMetadata, Character, Location, Item, Faction, PowerLevel, TimelineEvent, Skill, SkillUsageRecord, MountedSkillLoadoutItem, ProjectPreferenceProfile, EntityRelationship } from '../../../shared/types';
import {
  listChaptersMetadata, getChapter, listCharacters, listLocations, listItems, listFactions,
  listPowerLevels, listTimelineEvents, syncSkillFeedbackScores, listSkillUsageRecords,
  getNovel, subscribeToChanges, listEntityRelationshipsClient
} from '../api';
import { coerceMountedSkillLoadout } from '../skill-model';

export function useEditorData(novelId: string) {
  const [chapters, setChapters] = useState<ChapterMetadata[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [powerLevels, setPowerLevels] = useState<PowerLevel[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [librarySkills, setLibrarySkills] = useState<Skill[]>([]);
  const [skillUsageRecords, setSkillUsageRecords] = useState<SkillUsageRecord[]>([]);
  const [mountedSkillLoadout, setMountedSkillLoadout] = useState<MountedSkillLoadoutItem[]>([]);
  const [relationships, setRelationships] = useState<EntityRelationship[]>([]);
  const [projectPreferenceProfile, setProjectPreferenceProfile] = useState<ProjectPreferenceProfile | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  const dataRequestSeqRef = useRef(0);
  const chapterRequestSeqRef = useRef(0);
  const selectedChapterIdRef = useRef<string | null>(null);
  const currentChapterRef = useRef<Chapter | null>(null);

  useEffect(() => {
    currentChapterRef.current = currentChapter;
    if (currentChapter) {
      selectedChapterIdRef.current = currentChapter.id;
    }
  }, [currentChapter]);

  const selectChapter = useCallback(async (chapterId: string): Promise<Chapter | null> => {
    const requestSeq = ++chapterRequestSeqRef.current;
    selectedChapterIdRef.current = chapterId;
    setSelectedChapterId(chapterId);
    currentChapterRef.current = null;
    setCurrentChapter(null);
    setChapterLoading(true);

    try {
      const fullChapter = await getChapter(chapterId);
      if (
        requestSeq !== chapterRequestSeqRef.current
        || selectedChapterIdRef.current !== chapterId
      ) {
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
  }, []);

  const loadAuxiliaryData = useCallback(async (requestSeq: number) => {
    const results = await Promise.allSettled([
      listCharacters(novelId),
      listLocations(novelId),
      listItems(novelId),
      listFactions(novelId),
      listPowerLevels(novelId),
      listTimelineEvents(novelId),
      syncSkillFeedbackScores(),
      listSkillUsageRecords(),
      listEntityRelationshipsClient(novelId),
    ] as const);

    if (requestSeq !== dataRequestSeqRef.current) return;

    const [
      characterResult,
      locationResult,
      itemResult,
      factionResult,
      powerLevelResult,
      timelineResult,
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
    if (skillResult.status === 'fulfilled') setLibrarySkills(skillResult.value);
    if (usageResult.status === 'fulfilled') setSkillUsageRecords(usageResult.value);
    if (relationshipResult.status === 'fulfilled') setRelationships(relationshipResult.value);

    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.warn('[useEditorData] Auxiliary editor data unavailable:', result.reason);
      }
    });
  }, [novelId]);

  const fetchAll = useCallback(async () => {
    const requestSeq = ++dataRequestSeqRef.current;

    try {
      const [freshChapters, freshNovel] = await Promise.all([
        listChaptersMetadata(novelId),
        getNovel(novelId),
      ]);

      if (requestSeq !== dataRequestSeqRef.current) return;

      setChapters(freshChapters);
      if (freshNovel) {
        setMountedSkillLoadout(
          freshNovel.mountedSkillLoadout?.length
            ? freshNovel.mountedSkillLoadout
            : coerceMountedSkillLoadout(freshNovel.mountedSkillIds)
        );
        setProjectPreferenceProfile(freshNovel.projectPreferenceProfile);
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
  }, [loadAuxiliaryData, novelId, selectChapter]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reset visible editor state before loading a different project */
    dataRequestSeqRef.current += 1;
    chapterRequestSeqRef.current += 1;
    selectedChapterIdRef.current = null;
    currentChapterRef.current = null;
    setSelectedChapterId(null);
    setCurrentChapter(null);
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
  }, [novelId, fetchAll]);

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
    librarySkills,
    setLibrarySkills,
    skillUsageRecords,
    setSkillUsageRecords,
    mountedSkillLoadout,
    setMountedSkillLoadout,
    relationships,
    setRelationships,
    projectPreferenceProfile,
    setProjectPreferenceProfile,
    isLoading,
    refreshEditorData: fetchAll
  };
}
