import { useState, useEffect, useRef, useCallback } from 'react';
import { Chapter, ChapterMetadata, Character, Location, Item, Faction, PowerLevel, TimelineEvent, Skill, SkillUsageRecord, MountedSkillLoadoutItem, ProjectPreferenceProfile, EntityRelationship } from '../../../shared/types';
import { metadataToChapter } from '../chapter-utils';
import {
  listChaptersMetadata, getChapter, listCharacters, listLocations, listItems, listFactions,
  listPowerLevels, listTimelineEvents, syncSkillFeedbackScores, listSkillUsageRecords,
  getNovel, subscribeToChanges, listEntityRelationshipsClient
} from '../api';
import { coerceMountedSkillLoadout } from '../skill-model';

export function useEditorData(novelId: string) {
  const [chapters, setChapters] = useState<ChapterMetadata[]>([]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
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

  const requestSeqRef = useRef(0);

  const fetchAll = useCallback(async () => {
    const currentSeq = ++requestSeqRef.current;

    try {
      const [
        freshChapters,
        freshCharacters,
        freshLocations,
        freshItems,
        freshFactions,
        freshPowerLevels,
        freshTimelineEvents,
        freshLibrarySkills,
        freshUsageRecords,
        freshNovel,
        freshRelationships
      ] = await Promise.all([
        listChaptersMetadata(novelId),
        listCharacters(novelId),
        listLocations(novelId),
        listItems(novelId),
        listFactions(novelId),
        listPowerLevels(novelId),
        listTimelineEvents(novelId),
        syncSkillFeedbackScores(),
        listSkillUsageRecords(),
        getNovel(novelId),
        listEntityRelationshipsClient(novelId)
      ]);

      if (currentSeq !== requestSeqRef.current) return;

      setChapters(freshChapters);
      setCharacters(freshCharacters);
      setLocations(freshLocations);
      setItems(freshItems);
      setFactions(freshFactions);
      setPowerLevels(freshPowerLevels);
      setTimelineEvents(freshTimelineEvents);
      setLibrarySkills(freshLibrarySkills);
      setSkillUsageRecords(freshUsageRecords);
      setRelationships(freshRelationships);

      if (freshNovel) {
        setMountedSkillLoadout(
          freshNovel.mountedSkillLoadout?.length
            ? freshNovel.mountedSkillLoadout
            : coerceMountedSkillLoadout(freshNovel.mountedSkillIds)
        );
        setProjectPreferenceProfile(freshNovel.projectPreferenceProfile);
      }

      // Sync current chapter if already selected
      setCurrentChapter(prev => {
        if (!prev && freshChapters.length > 0) return metadataToChapter(freshChapters[0]);
        if (prev) {
          const matched = freshChapters.find(c => c.id === prev.id);
          if (matched) {
            // Preserve the memory-only content if we are in the middle of editing
            // (The DB might be slightly behind due to debounce)
            return { ...metadataToChapter(matched), content: prev.content };
          }
        }
        return prev;
      });

      setIsLoading(false);
    } catch (error) {
      console.warn('Failed to fetch editor data:', error);
      if (currentSeq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [novelId]);

  useEffect(() => {
    if (!currentChapter) return;
    if (currentChapter.content === undefined) {
      let active = true;
      getChapter(currentChapter.id).then(fullCh => {
        if (active && fullCh) {
          setCurrentChapter(prev => {
            if (prev && prev.id === fullCh.id) {
              return fullCh;
            }
            return prev;
          });
        }
      });
      return () => { active = false; };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter?.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- set loading state before fetch
    setIsLoading(true);
    fetchAll();
    const unsubscribe = subscribeToChanges(fetchAll);
    return () => {
      unsubscribe();
    };
  }, [novelId, fetchAll]);

  return {
    chapters,
    setChapters,
    currentChapter,
    setCurrentChapter,
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
