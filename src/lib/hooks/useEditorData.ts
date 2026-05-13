import { useState, useEffect, useRef } from 'react';
import { Novel, Chapter, Character, Location, Item, Faction, PowerLevel, TimelineEvent, Skill, SkillUsageRecord, MountedSkillLoadoutItem, ProjectPreferenceProfile } from '../../types';
import {
  listChapters, listCharacters, listLocations, listItems, listFactions,
  listPowerLevels, listTimelineEvents, syncSkillFeedbackScores, listSkillUsageRecords,
  getNovel, subscribeToChanges
} from '../api';
import { coerceMountedSkillLoadout } from '../skill-model';

export function useEditorData(novelId: string) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
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
  const [projectPreferenceProfile, setProjectPreferenceProfile] = useState<ProjectPreferenceProfile | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  const requestSeqRef = useRef(0);

  const fetchAll = async () => {
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
        freshNovel
      ] = await Promise.all([
        listChapters(novelId),
        listCharacters(novelId),
        listLocations(novelId),
        listItems(novelId),
        listFactions(novelId),
        listPowerLevels(novelId),
        listTimelineEvents(novelId),
        syncSkillFeedbackScores(),
        listSkillUsageRecords(),
        getNovel(novelId)
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
        if (!prev && freshChapters.length > 0) return freshChapters[0];
        if (prev) {
          const matched = freshChapters.find(c => c.id === prev.id);
          if (matched) {
            // Preserve the memory-only content if we are in the middle of editing
            // (The DB might be slightly behind due to debounce)
            return { ...matched, content: prev.content };
          }
        }
        return prev;
      });

      setIsLoading(false);
    } catch (error) {
      console.error('Failed to fetch editor data:', error);
      if (currentSeq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    setIsLoading(true);
    fetchAll();
    const unsubscribe = subscribeToChanges(fetchAll);
    return () => {
      unsubscribe();
    };
  }, [novelId]);

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
    projectPreferenceProfile,
    setProjectPreferenceProfile,
    isLoading,
    refreshEditorData: fetchAll
  };
}
