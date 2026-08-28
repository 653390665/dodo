import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '../lib/client-logger';
import { BookOpen, Clock, FileText, Globe, Loader2, MapPin, Package, Scroll, Shield, Upload, Users, Zap, GitBranch, Sparkles, Trash2, Plus, Pen } from 'lucide-react';
import { Character, Location, Item, Novel, TimelineEvent, Faction, PowerLevel, SetupTaskDraft, StoryIdeaCard, ContinuationPack, ContinuationGap, ProjectPreferenceProfile, EntityRelationship, ChapterMetadata, Foreshadowing } from '../../shared/types';
import type { AssistantMode, AssistantSurfaceContext, WorldCapabilityLaunchIntent } from '../../shared/types';
import { StoryContractPanel } from './StoryContractPanel';
import {
  listCharacters, createCharacter, updateCharacter, deleteCharacter,
  listLocations, createLocation, updateLocation, deleteLocation,
  listItems, createItem, updateItem, deleteItem,
  listFactions, createFaction, updateFaction, deleteFaction,
  listPowerLevels, createPowerLevel, updatePowerLevel, deletePowerLevel,
  listTimelineEvents, createTimelineEvent, updateTimelineEvent, deleteTimelineEvent,
  listEntityRelationshipsClient,
  importWorldExtraction,
} from '../lib/world-client';
import { listChaptersMetadata } from '../lib/chapter-client';
import { listForeshadowings } from '../lib/foreshadowing-client';
import { projectStoryMemory } from '../../shared/lib/story-memory-projection';
import { listContinuationPacks } from '../lib/continuation-client';
import { getNovel, updateNovel } from '../lib/novel-client';
import { getDatabaseGenerationSnapshot, requireResponseDatabaseGeneration, subscribeToChanges } from '../lib/db-transport';
import type { ArtifactCandidate, CharacterCore, StructuredWorldCore } from '../../shared/types/creative-artifacts';
import { parseDocAsync } from '../lib/prompt-client';
import { startWorldJob } from '../lib/world-job-client';

import { cn } from '../lib/utils';
import { buildContinuationOverviewState } from '../lib/continuation-overview';
import { buildCreationIntentDraft } from '../lib/continuation-pack';
import { WorldBibleOnboarding } from './WorldBibleOnboarding';
import { ContinuationOverviewPanel } from './ContinuationOverviewPanel';
import { ContinuationPackView } from './ContinuationPackView';
import { CharactersTab } from './world-bible/CharactersTab';
import { LocationsTab } from './world-bible/LocationsTab';
import { ItemsTab } from './world-bible/ItemsTab';
import { FactionsTab } from './world-bible/FactionsTab';
import { PowerLevelsTab } from './world-bible/PowerLevelsTab';
import { TimelineTab } from './world-bible/TimelineTab';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction } from './ui/alert-dialog';
import { GlobalSetupTab } from './world-bible/GlobalSetupTab';
import { WorldCandidateReview } from './world-bible/WorldCandidateReview';
import { RelationshipGraph } from './RelationshipGraph';
import { RelationshipFormDialog } from './world-bible/RelationshipFormDialog';
import { enqueueLatestCharacterBioCommit, streamCharacterBio } from '../lib/character-bio-stream';
import { readContinuationSyncIntent, clearContinuationSyncIntent } from '../lib/continuation-sync-intent';
import { diagnoseCharacterCore } from '../../shared/lib/character-core';
import { buildCapabilityRecommendationDismissal, buildCapabilityRecommendations } from '../../shared/lib/capability-recommendation';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import { toast } from '../lib/toast';
import { generateClientId } from '../lib/id';

type EditableWorldEntityType = 'character' | 'location' | 'item' | 'timeline' | 'faction' | 'powerLevel';

const WORLD_GENERATION_CONFLICT_MESSAGE = '数据库已变化，已保留本地输入。请刷新后重试。';

function entityDraftKey(type: EditableWorldEntityType, id: string): string {
  return `${type}:${id}`;
}

function mergeEntityDrafts<T extends { id: string }>(
  type: EditableWorldEntityType,
  entities: T[],
  drafts: Map<string, Record<string, unknown>>,
): T[] {
  return entities.map((entity) => ({ ...entity, ...(drafts.get(entityDraftKey(type, entity.id)) || {}) }));
}

function isDatabaseGenerationConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { status?: unknown; code?: unknown };
  return record.status === 409
    || record.code === 'DB_GENERATION_CONFLICT'
    || record.code === 'DATABASE_GENERATION_STALE'
    || record.code === 'DATABASE_GENERATION_MISMATCH';
}

function getEntityName(type: string, id: string, characters: Character[], locations: Location[], items: Item[], factions: Faction[]): string {
  if (type === 'character') return characters.find(c => c.id === id)?.name || id.slice(0, 8);
  if (type === 'location') return locations.find(l => l.id === id)?.name || id.slice(0, 8);
  if (type === 'item') return items.find(i => i.id === id)?.name || id.slice(0, 8);
  if (type === 'faction') return factions.find(f => f.id === id)?.name || id.slice(0, 8);
  return id.slice(0, 8);
}

export function WorldBibleView({
  novel,
  onboarding,
  isGlobalAssistantOpen,
  onStartContinuationWriting,
  onEnterStoryboard,
  onOpenAssistant,
  onOpenGapAssistant,
  onOpenGapAssistantBatch,
  onOpenCapabilityStore,
  capabilityLaunchIntent,
  onCapabilityLaunchConsumed,
}: {
  novel: Novel;
  onboarding?: {
    card?: StoryIdeaCard;
    tasks: SetupTaskDraft[];
    activeTask?: SetupTaskDraft;
    onSelectTask: (key: SetupTaskDraft['key']) => void;
    onConfirmTask: (key: SetupTaskDraft['key']) => void;
    assistantInput: string;
    onAssistantInputChange: (value: string) => void;
    onAssistantSubmit: () => void;
    assistantLoading: boolean;
    assistantError?: string | null;
    completedCount: number;
    canEnterEditor: boolean;
    onEnterEditor: () => void;
    acceptedSkillIds: string[];
    recommendedSkills: Array<{
      skillId: string;
      skillName: string;
      reason: string;
    }>;
    acceptedRecommendedSkills: boolean;
    onAcceptRecommendedSkills: () => void;
  };
  isGlobalAssistantOpen?: boolean;
  onStartContinuationWriting?: (approvedPackId: string, prefillIntent?: string) => void | Promise<void>;
  onEnterStoryboard?: (approvedPackId: string, continuationTask?: string) => void;
  onOpenAssistant?: (mode: AssistantMode, context: AssistantSurfaceContext) => void;
  onOpenGapAssistant?: (gap: ContinuationGap, packTitle: string, continuationPackId?: string) => void;
  onOpenGapAssistantBatch?: (gaps: ContinuationGap[], packTitle: string, continuationPackId?: string) => void;
  onOpenCapabilityStore?: () => void;
  capabilityLaunchIntent?: WorldCapabilityLaunchIntent | null;
  onCapabilityLaunchConsumed?: (launchToken: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'pack-management' | 'contract' | 'characters' | 'locations' | 'items' | 'factions' | 'powerLevels' | 'global' | 'timeline' | 'graph'>(() => {
    try {
      const saved = localStorage.getItem('inkflow-world-bible-active-tab');
      if (saved) {
        localStorage.removeItem('inkflow-world-bible-active-tab');
        return saved as 'overview' | 'pack-management' | 'contract' | 'characters' | 'locations' | 'items' | 'factions' | 'powerLevels' | 'global' | 'timeline' | 'graph';
      }
    } catch {}
    return 'overview';
  });
  const [requestedReviewPackId, setRequestedReviewPackId] = useState<string | null>(null);
  const [requestedAutoSyncPackId, setRequestedAutoSyncPackId] = useState<string | null>(null);
  const [showRelationshipAlert, setShowRelationshipAlert] = useState(false);

  const [relDialogOpen, setRelDialogOpen] = useState(false);
  const [relDialogMode, setRelDialogMode] = useState<'create' | 'edit' | 'delete'>('create');
  const [editingRel, setEditingRel] = useState<EntityRelationship | null>(null);

  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [powerLevels, setPowerLevels] = useState<PowerLevel[]>([]);
  const [continuationPacks, setContinuationPacks] = useState<ContinuationPack[]>([]);
  const [relationships, setRelationships] = useState<EntityRelationship[]>([]);
  const [chapters, setChapters] = useState<ChapterMetadata[]>([]);
  const [narrativePromises, setNarrativePromises] = useState<Foreshadowing[]>([]);

  const totalEntities = characters.length + locations.length + items.length + factions.length;

  const [globalOutline, setGlobalOutline] = useState(novel.globalOutline || '');
  const [worldRules, setWorldRules] = useState(novel.worldRules || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStageText, setImportStageText] = useState('');
  const [generatingBioIds, setGeneratingBioIds] = useState<string[]>([]);
  const [generatingCharacterCandidateIds, setGeneratingCharacterCandidateIds] = useState<string[]>([]);
  const [characterCandidatesById, setCharacterCandidatesById] = useState<Record<string, ArtifactCandidate<CharacterCore>>>({});
  const [worldCandidate, setWorldCandidate] = useState<ArtifactCandidate<StructuredWorldCore> | null>(null);
  const [worldCore, setWorldCore] = useState<{ core: StructuredWorldCore; version: number } | null>(null);
  const [isGeneratingWorldCandidate, setIsGeneratingWorldCandidate] = useState(false);
  const [worldCandidateError, setWorldCandidateError] = useState<string | null>(null);
  const [worldDataError, setWorldDataError] = useState<string | null>(null);
  const [databaseGeneration, setDatabaseGeneration] = useState<number | null>(null);
  const [artifactGovernanceLoaded, setArtifactGovernanceLoaded] = useState(false);
  const [pendingCharacterLaunch, setPendingCharacterLaunch] = useState<{ launchToken: number; capabilityId: string; selectedCharacterId: string } | null>(null);
  const [dismissedCharacterRecommendations, setDismissedCharacterRecommendations] = useState<Set<string>>(() => new Set());
  const bioRequestSeqRef = React.useRef(new Map<string, number>());
  const bioAbortControllersRef = React.useRef(new Map<string, AbortController>());
  const bioCommitChainsRef = React.useRef(new Map<string, Promise<void>>());
  const worldCandidateAbortControllerRef = React.useRef<AbortController | null>(null);
  const importControllerRef = React.useRef<AbortController | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const consumedSyncIntentPackRef = React.useRef<string | null>(null);
  const checkedCharacterRecommendationFingerprintsRef = React.useRef(new Set<string>());
  const consumedCapabilityLaunchTokensRef = React.useRef(new Set<number>());
  const databaseGenerationRef = React.useRef<number | null>(null);
  const entityDraftsRef = React.useRef(new Map<string, Record<string, unknown>>());
  const fetchRequestSeqRef = React.useRef(0);

  useEffect(() => {
    setDismissedCharacterRecommendations(new Set()); // eslint-disable-line react-hooks/set-state-in-effect -- dismissal scope is per novel
    checkedCharacterRecommendationFingerprintsRef.current.clear();
    consumedCapabilityLaunchTokensRef.current.clear();
    setArtifactGovernanceLoaded(false);
    setWorldCandidate(null);
    setWorldCore(null);
    setWorldCandidateError(null);
    setWorldDataError(null);
    setDatabaseGeneration(null);
    databaseGenerationRef.current = null;
    entityDraftsRef.current.clear();
    setPendingCharacterLaunch(null);
  }, [novel.id]);

  useEffect(() => () => {
    worldCandidateAbortControllerRef.current?.abort(new Error('作品上下文已变化，世界观候选任务已取消'));
    worldCandidateAbortControllerRef.current = null;
  }, [novel.id]);

  const rawCharacterRecommendations = useMemo(() => {
    const manifest = getCatalogCapabilityManifest('bible-character-arc');
    if (!manifest) return {};
    return Object.fromEntries(characters.flatMap((character) => {
      const gaps = diagnoseCharacterCore(character.core || {});
      if (gaps.length === 0) return [];
      const result = buildCapabilityRecommendations({
        issue: {
          fingerprint: `character-gaps:${character.id}:${character.coreVersion || 0}:${gaps.join(',')}:${character.updatedAt || 0}`,
          explanation: `角色结构缺少${gaps.length}项关键信息`,
          suggestedFix: '补齐欲望、矛盾、行为模式与成长弧，生成可审阅的角色结构候选。',
          recommendedCapabilityIds: ['bible-character-arc'],
        },
        artifactKind: 'character',
        operation: 'restructure',
        scope: 'project',
        artifactVersion: character.coreVersion || 0,
        upstreamVersion: character.updatedAt || 0,
        capabilities: [manifest],
        availableArtifacts: [{ kind: 'character', id: character.id, version: character.coreVersion || 0 }],
        accessibleCapabilityIds: ['bible-character-arc'],
      });
      return [[character.id, result]];
    }));
  }, [characters]);

  const characterRecommendations = useMemo(() => Object.fromEntries(
    Object.entries(rawCharacterRecommendations).filter(([, result]) => !dismissedCharacterRecommendations.has(result.fingerprint)),
  ), [dismissedCharacterRecommendations, rawCharacterRecommendations]);

  useEffect(() => {
    let cancelled = false;
    const pending = Object.values(rawCharacterRecommendations).filter((result) => !checkedCharacterRecommendationFingerprintsRef.current.has(result.fingerprint));
    pending.forEach((result) => checkedCharacterRecommendationFingerprintsRef.current.add(result.fingerprint));
    if (pending.length === 0) return () => { cancelled = true; };
    void getDatabaseGenerationSnapshot().then(async (databaseGeneration) => {
      const dismissed = await Promise.all(pending.map(async (result) => {
        const response = await fetch('/api/capability-recommendations/dismissed', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildCapabilityRecommendationDismissal(result, novel.id, databaseGeneration)),
        });
        if (!response.ok) return undefined;
        const body = await response.json() as { dismissed?: boolean };
        return body.dismissed ? result.fingerprint : undefined;
      }));
      if (!cancelled) setDismissedCharacterRecommendations((current) => new Set([...current, ...dismissed.filter((value): value is string => Boolean(value))]));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [novel.id, rawCharacterRecommendations]);

  const dismissCharacterRecommendation = async (result: ReturnType<typeof buildCapabilityRecommendations>) => {
    const databaseGeneration = await getDatabaseGenerationSnapshot();
    const response = await fetch('/api/capability-recommendations/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildCapabilityRecommendationDismissal(result, novel.id, databaseGeneration)),
    });
    if (!response.ok) throw new Error('暂时无法忽略该推荐');
    setDismissedCharacterRecommendations((current) => new Set(current).add(result.fingerprint));
  };

  const fetchAll = useCallback(async () => {
    const requestSeq = ++fetchRequestSeqRef.current;
    try {
      const beforeGeneration = await getDatabaseGenerationSnapshot();
      if (!Number.isInteger(beforeGeneration)) throw new Error('设定读取缺少有效数据库代次，请刷新后重试。');
      const fetchGovernance = async <T,>(url: string, label: string): Promise<T> => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${label}读取失败（${response.status}），请刷新后重试。`);
        try {
          return await response.json() as T;
        } catch {
          throw new Error(`${label}响应无效，请刷新后重试。`);
        }
      };
      const characterGovernancePromise = fetchGovernance<{
        cores: Array<{ artifactId: string; version: number; core: CharacterCore }>;
        candidates: Array<ArtifactCandidate<CharacterCore>>;
      }>(`/api/novels/${encodeURIComponent(novel.id)}/artifacts?kind=character&status=pending`, '角色治理');
      const worldGovernancePromise = fetchGovernance<{
        cores: Array<{ artifactId: string; version: number; core: StructuredWorldCore }>;
        candidates: Array<ArtifactCandidate<StructuredWorldCore>>;
      }>(`/api/novels/${encodeURIComponent(novel.id)}/artifacts?kind=world&status=pending`, '世界治理');
      const [characters, locations, items, timelineEvents, factions, powerLevels, packs, relationships, chapters, narrativePromises, freshNovel] = await Promise.all([
        listCharacters(novel.id),
        listLocations(novel.id),
        listItems(novel.id),
        listTimelineEvents(novel.id),
        listFactions(novel.id),
        listPowerLevels(novel.id),
        listContinuationPacks(novel.id),
        listEntityRelationshipsClient(novel.id),
        listChaptersMetadata(novel.id),
        listForeshadowings(novel.id),
        getNovel(novel.id),
      ]);
      const [characterGovernanceResult, worldGovernanceResult] = await Promise.allSettled([
        characterGovernancePromise,
        worldGovernancePromise,
      ]);
      const afterGeneration = await getDatabaseGenerationSnapshot();
      if (requestSeq !== fetchRequestSeqRef.current) return;
      if (!Number.isInteger(afterGeneration) || beforeGeneration !== afterGeneration) {
        setWorldDataError(WORLD_GENERATION_CONFLICT_MESSAGE);
        return;
      }
      const characterGovernance = characterGovernanceResult.status === 'fulfilled'
        ? characterGovernanceResult.value
        : { cores: [], candidates: [] };
      const worldGovernance = worldGovernanceResult.status === 'fulfilled'
        ? worldGovernanceResult.value
        : { cores: [], candidates: [] };
      const governanceReady = characterGovernanceResult.status === 'fulfilled' && worldGovernanceResult.status === 'fulfilled';
      const cores = new Map(characterGovernance.cores.map((core) => [core.artifactId, core]));
      const governedCharacters = characters.map((character) => {
        const stored = cores.get(character.id);
        return stored ? { ...character, core: stored.core, coreVersion: stored.version } : character;
      });
      databaseGenerationRef.current = beforeGeneration;
      setDatabaseGeneration(beforeGeneration);
      setCharacters(mergeEntityDrafts('character', governedCharacters, entityDraftsRef.current));
      setCharacterCandidatesById(Object.fromEntries(characterGovernance.candidates.map((candidate) => [candidate.target.id, candidate])));
      const storedWorldCore = worldGovernance.cores.find((entry) => entry.artifactId === novel.id);
      setWorldCore(storedWorldCore ? { core: storedWorldCore.core, version: storedWorldCore.version } : null);
      setWorldCandidate(worldGovernance.candidates.find((candidate) => candidate.target.id === novel.id) || null);
      setArtifactGovernanceLoaded(governanceReady);
      setLocations(mergeEntityDrafts('location', locations, entityDraftsRef.current));
      setItems(mergeEntityDrafts('item', items, entityDraftsRef.current));
      setTimelineEvents(mergeEntityDrafts('timeline', timelineEvents, entityDraftsRef.current));
      setFactions(mergeEntityDrafts('faction', factions, entityDraftsRef.current));
      setPowerLevels(mergeEntityDrafts('powerLevel', powerLevels, entityDraftsRef.current));
      setContinuationPacks(packs);
      setRelationships(relationships);
      setChapters(chapters);
      setNarrativePromises(narrativePromises);
      const novelData = freshNovel || novel;
      setGlobalOutline(novelData.globalOutline || '');
      setWorldRules(novelData.worldRules || '');
      setWorldDataError(governanceReady ? null : '设定治理状态读取失败，普通设定仍可查看；请刷新后重试。');
    } catch (error) {
      if (requestSeq !== fetchRequestSeqRef.current) return;
      setWorldDataError(error instanceof Error ? error.message : '设定读取失败，请刷新后重试。');
    }
  }, [novel]);

  useEffect(() => {
    fetchAll(); // eslint-disable-line react-hooks/set-state-in-effect
    return subscribeToChanges(fetchAll);
  }, [fetchAll]);

  useEffect(() => {
    const intent = readContinuationSyncIntent();
    if (!intent || intent.novelId !== novel.id || !intent.packId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consume one-shot navigation intent
    setRequestedReviewPackId(intent.packId);
    setRequestedAutoSyncPackId(intent.packId);
    setActiveTab('pack-management');
  }, [novel.id]);

  useEffect(() => () => {
    fetchRequestSeqRef.current += 1;
    for (const controller of bioAbortControllersRef.current.values()) controller.abort();
    bioAbortControllersRef.current.clear();
    bioRequestSeqRef.current.clear();
    importControllerRef.current?.abort();
    importControllerRef.current = null;
  }, [novel.id]);

  const handleSaveGlobalInfo = async (outline: string, rules: string) => {
    setIsSaving(true);
    try {
      const generation = databaseGenerationRef.current;
      if (generation === null) throw new Error('设定尚未完成一致性读取，请刷新后重试。');
      const updated = await updateNovel(novel.id, { globalOutline: outline, worldRules: rules }, generation);
      if (!updated) throw new Error('作品已不存在，世界设定未保存。');
      setGlobalOutline(outline);
      setWorldRules(rules);
      setWorldDataError(null);
    } catch (error) {
      setWorldDataError(isDatabaseGenerationConflict(error)
        ? WORLD_GENERATION_CONFLICT_MESSAGE
        : error instanceof Error ? error.message : '世界设定保存失败，请重试。');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePackSyncComplete = async (packId: string) => {
    void fetchAll();
    const intent = readContinuationSyncIntent();
    if (
      !onStartContinuationWriting
      || !intent
      || intent.novelId !== novel.id
      || intent.packId !== packId
      || consumedSyncIntentPackRef.current === packId
    ) return;
    const pack = continuationPacks.find((item) => item.id === packId);
    if (!pack) return;
    try {
      consumedSyncIntentPackRef.current = packId;
      await onStartContinuationWriting(packId, buildCreationIntentDraft(pack));
      clearContinuationSyncIntent();
    } catch {
      consumedSyncIntentPackRef.current = null;
    }
  };

  const requireAcceptedGeneration = () => {
    const generation = databaseGenerationRef.current;
    if (generation === null) throw new Error('设定尚未完成一致性读取，请刷新后重试。');
    return generation;
  };

  const reportWorldWriteError = (error: unknown, fallback: string) => {
    setWorldDataError(isDatabaseGenerationConflict(error)
      ? WORLD_GENERATION_CONFLICT_MESSAGE
      : error instanceof Error ? error.message : fallback);
  };

  const applyLocalEntityPatch = (type: EditableWorldEntityType, id: string, data: Record<string, unknown>) => {
    if (type === 'character') setCharacters((current) => current.map((entity) => entity.id === id ? { ...entity, ...data } as Character : entity));
    else if (type === 'location') setLocations((current) => current.map((entity) => entity.id === id ? { ...entity, ...data } as Location : entity));
    else if (type === 'item') setItems((current) => current.map((entity) => entity.id === id ? { ...entity, ...data } as Item : entity));
    else if (type === 'timeline') setTimelineEvents((current) => current.map((entity) => entity.id === id ? { ...entity, ...data } as TimelineEvent : entity));
    else if (type === 'faction') setFactions((current) => current.map((entity) => entity.id === id ? { ...entity, ...data } as Faction : entity));
    else setPowerLevels((current) => current.map((entity) => entity.id === id ? { ...entity, ...data } as PowerLevel : entity));
  };

  const clearCommittedEntityDraft = (type: EditableWorldEntityType, id: string, data: Record<string, unknown>) => {
    const key = entityDraftKey(type, id);
    const current = entityDraftsRef.current.get(key);
    if (!current) return;
    const next = { ...current };
    for (const [field, value] of Object.entries(data)) {
      if (Object.is(next[field], value)) delete next[field];
    }
    if (Object.keys(next).length === 0) entityDraftsRef.current.delete(key);
    else entityDraftsRef.current.set(key, next);
  };

  const addEntity = async (type: 'character' | 'location' | 'item' | 'timeline' | 'faction' | 'powerLevel') => {
    try {
      const generation = requireAcceptedGeneration();
      const now = Date.now();
      const id = generateClientId();
      if (type === 'character') {
        const entity: Character = { id, novelId: novel.id, name: '新人物', role: 'supporting', summary: '', traits: [], bio: '', createdAt: now, updatedAt: now };
        await createCharacter(entity, generation);
        setCharacters((current) => [...current, entity]);
      } else if (type === 'location') {
        const entity: Location = { id, novelId: novel.id, name: '新地点', region: '未知区域', description: '', createdAt: now, updatedAt: now };
        await createLocation(entity, generation);
        setLocations((current) => [...current, entity]);
      } else if (type === 'item') {
        const entity: Item = { id, novelId: novel.id, name: '新道具', type: '普通道具', description: '', createdAt: now, updatedAt: now };
        await createItem(entity, generation);
        setItems((current) => [...current, entity]);
      } else if (type === 'timeline') {
        const highestOrder = timelineEvents.length > 0 ? Math.max(...timelineEvents.map(e => e.order)) : 0;
        const entity: TimelineEvent = { id, novelId: novel.id, title: '新事件', description: '', timestamp: '未知时间', statusTag: '发生中', order: highestOrder + 1, createdAt: now, updatedAt: now };
        await createTimelineEvent(entity, generation);
        setTimelineEvents((current) => [...current, entity]);
      } else if (type === 'faction') {
        const entity: Faction = { id, novelId: novel.id, name: '新势力', leader: '未知', territory: '未知', description: '', createdAt: now, updatedAt: now };
        await createFaction(entity, generation);
        setFactions((current) => [...current, entity]);
      } else if (type === 'powerLevel') {
        const highestTier = powerLevels.length > 0 ? Math.max(...powerLevels.map(e => e.tier)) : 0;
        const entity: PowerLevel = { id, novelId: novel.id, name: '新境界', tier: highestTier + 1, characteristics: '', description: '', createdAt: now, updatedAt: now };
        await createPowerLevel(entity, generation);
        setPowerLevels((current) => [...current, entity]);
      }
      setWorldDataError(null);
    } catch (error) {
      reportWorldWriteError(error, '设定条目创建失败，请重试。');
    }
  };

  const deleteEntity = async (type: 'character' | 'location' | 'item' | 'timeline' | 'faction' | 'powerLevel', id: string) => {
    try {
      const generation = requireAcceptedGeneration();
      let deleted = false;
      if (type === 'character') deleted = await deleteCharacter(id, generation);
      else if (type === 'location') deleted = await deleteLocation(id, generation);
      else if (type === 'item') deleted = await deleteItem(id, generation);
      else if (type === 'timeline') deleted = await deleteTimelineEvent(id, generation);
      else if (type === 'faction') deleted = await deleteFaction(id, generation);
      else if (type === 'powerLevel') deleted = await deletePowerLevel(id, generation);
      if (!deleted) throw new Error('设定条目已不存在，删除未生效。');
      entityDraftsRef.current.delete(entityDraftKey(type, id));
      if (type === 'character') setCharacters((current) => current.filter((entity) => entity.id !== id));
      else if (type === 'location') setLocations((current) => current.filter((entity) => entity.id !== id));
      else if (type === 'item') setItems((current) => current.filter((entity) => entity.id !== id));
      else if (type === 'timeline') setTimelineEvents((current) => current.filter((entity) => entity.id !== id));
      else if (type === 'faction') setFactions((current) => current.filter((entity) => entity.id !== id));
      else setPowerLevels((current) => current.filter((entity) => entity.id !== id));
      setWorldDataError(null);
    } catch (error) {
      reportWorldWriteError(error, '设定条目删除失败，请重试。');
    }
  };

  const updateEntity = async (type: 'character' | 'location' | 'item' | 'timeline' | 'faction' | 'powerLevel', id: string, data: Record<string, unknown>) => {
    const key = entityDraftKey(type, id);
    entityDraftsRef.current.set(key, { ...(entityDraftsRef.current.get(key) || {}), ...data });
    applyLocalEntityPatch(type, id, data);
    try {
      const generation = requireAcceptedGeneration();
      let updated = false;
      if (type === 'character') updated = await updateCharacter(id, data, generation);
      else if (type === 'location') updated = await updateLocation(id, data, generation);
      else if (type === 'item') updated = await updateItem(id, data, generation);
      else if (type === 'timeline') updated = await updateTimelineEvent(id, data, generation);
      else if (type === 'faction') updated = await updateFaction(id, data, generation);
      else if (type === 'powerLevel') updated = await updatePowerLevel(id, data, generation);
      if (!updated) throw new Error('设定条目已不存在，修改未保存。');
      clearCommittedEntityDraft(type, id, data);
      setWorldDataError(null);
    } catch (error) {
      reportWorldWriteError(error, '设定条目修改失败，请重试。');
    }
  };

  const handleGenerateBio = async (char: Character) => {
    if (!char.name || char.name === '新人物') {
      toast('请先设置角色姓名', 'info');
      return;
    }

    const requestSeq = (bioRequestSeqRef.current.get(char.id) ?? 0) + 1;
    bioRequestSeqRef.current.set(char.id, requestSeq);
    bioAbortControllersRef.current.get(char.id)?.abort();
    const abortController = new AbortController();
    bioAbortControllersRef.current.set(char.id, abortController);
    const isCurrent = () => bioRequestSeqRef.current.get(char.id) === requestSeq;

    setGeneratingBioIds(prev => prev.includes(char.id) ? prev : [...prev, char.id]);
    try {
      const requestDatabaseGeneration = requireAcceptedGeneration();
      const response = await fetch('/api/generate-bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...char, globalOutline, worldRules, databaseGeneration: requestDatabaseGeneration }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');
      const responseDatabaseGeneration = requireResponseDatabaseGeneration(response);
      if (responseDatabaseGeneration !== requestDatabaseGeneration) {
        throw new Error(WORLD_GENERATION_CONFLICT_MESSAGE);
      }

      await streamCharacterBio({
        response,
        originalBio: char.bio,
        isCurrent,
        onPreview: (bio) => {
          setCharacters(prev => prev.map(item => item.id === char.id ? { ...item, bio } : item));
        },
        onCommit: async (bio) => {
          await enqueueLatestCharacterBioCommit(
            bioCommitChainsRef.current,
            char.id,
            isCurrent,
            async () => {
              if (!await updateCharacter(char.id, { bio }, requestDatabaseGeneration)) {
                throw new Error('人物已不存在，小传未保存。');
              }
            },
          );
        },
      });
    } catch (e) {
      if (!isCurrent()) return;
      logger.error("WorldBibleView error:", e);
      toast("生成故事设定失败，请重试：" + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      if (isCurrent()) {
        bioAbortControllersRef.current.delete(char.id);
        setGeneratingBioIds(prev => prev.filter(id => id !== char.id));
      }
    }
  };

  const handleGenerateCharacterCandidate = async (char: Character, capabilityId = 'bible-character-arc') => {
    setGeneratingCharacterCandidateIds((current) => current.includes(char.id) ? current : [...current, char.id]);
    try {
      const { result } = await startWorldJob<{ candidate?: ArtifactCandidate<CharacterCore> }>(
        '/api/generate-outline',
        {
          novelId: novel.id,
          techniqueId: capabilityId,
          characterId: char.id,
          title: novel.title,
          seedOutline: [char.summary, char.bio, char.traits.join('、')].filter(Boolean).join('\n'),
        },
        { intervalMs: 250 },
      );
      if (!result.candidate) throw new Error('角色候选任务未返回候选');
      setCharacterCandidatesById((current) => ({ ...current, [char.id]: result.candidate! }));
    } catch (error) {
      toast(error instanceof Error ? error.message : '角色候选生成失败', 'error');
    } finally {
      setGeneratingCharacterCandidateIds((current) => current.filter((id) => id !== char.id));
    }
  };

  const handleGenerateWorldCandidate = async (capabilityId = 'bible-world-builder', seedText?: string) => {
    if (isGeneratingWorldCandidate) return;
    worldCandidateAbortControllerRef.current?.abort(new Error('世界观候选任务已被新的请求替换'));
    const controller = new AbortController();
    worldCandidateAbortControllerRef.current = controller;
    setIsGeneratingWorldCandidate(true);
    setWorldCandidateError(null);
    try {
      const { result } = await startWorldJob<{ candidate?: ArtifactCandidate<StructuredWorldCore> }>(
        '/api/generate-outline',
        {
          novelId: novel.id,
          techniqueId: capabilityId,
          title: novel.title,
          seedOutline: [seedText?.trim(), globalOutline, worldRules].filter(Boolean).join('\n'),
        },
        { intervalMs: 250, maxRetries: 480 },
        controller.signal,
      );
      if (!result.candidate) throw new Error('世界观候选任务未返回候选');
      setWorldCandidate(result.candidate);
    } catch (error) {
      if (!controller.signal.aborted) {
        setWorldCandidateError(error instanceof Error ? error.message : '世界观候选生成失败');
      }
    } finally {
      if (worldCandidateAbortControllerRef.current === controller) {
        worldCandidateAbortControllerRef.current = null;
        setIsGeneratingWorldCandidate(false);
      }
    }
  };

  const decideCharacterCandidate = async (candidate: ArtifactCandidate<CharacterCore>, action: 'accept' | 'reject') => {
    try {
      const databaseGeneration = await getDatabaseGenerationSnapshot();
      const response = await fetch(`/api/novels/${encodeURIComponent(novel.id)}/artifacts/candidates/${encodeURIComponent(candidate.id)}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ databaseGeneration }),
      });
      const result = await response.json() as { error?: string; core?: { core: CharacterCore; version: number } };
      if (!response.ok) throw new Error(result.error || '角色候选处理失败');
      setCharacterCandidatesById((current) => {
        const next = { ...current };
        delete next[candidate.target.id];
        return next;
      });
      if (action === 'accept' && result.core) {
        setCharacters((current) => current.map((character) => character.id === candidate.target.id
          ? { ...character, core: result.core!.core, coreVersion: result.core!.version }
          : character));
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : '角色候选处理失败', 'error');
    }
  };

  const decideWorldCandidate = async (candidate: ArtifactCandidate<StructuredWorldCore>, action: 'accept' | 'reject') => {
    try {
      setWorldCandidateError(null);
      const databaseGeneration = await getDatabaseGenerationSnapshot();
      const response = await fetch(`/api/novels/${encodeURIComponent(novel.id)}/artifacts/candidates/${encodeURIComponent(candidate.id)}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ databaseGeneration }),
      });
      const result = await response.json() as { error?: string; core?: { core: StructuredWorldCore; version: number } };
      if (!response.ok) throw new Error(result.error || '世界观候选处理失败');
      setWorldCandidate(null);
      if (action === 'accept' && result.core) setWorldCore(result.core);
    } catch (error) {
      setWorldCandidateError(error instanceof Error ? error.message : '世界观候选处理失败');
    }
  };

  useEffect(() => {
    const intent = capabilityLaunchIntent;
    if (!artifactGovernanceLoaded || !intent || intent.novelId !== novel.id) return;
    if (consumedCapabilityLaunchTokensRef.current.has(intent.launchToken)) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || consumedCapabilityLaunchTokensRef.current.has(intent.launchToken)) return;
      consumedCapabilityLaunchTokensRef.current.add(intent.launchToken);
      onCapabilityLaunchConsumed?.(intent.launchToken);

      if (intent.artifactKind === 'world') {
        setActiveTab('global');
        setPendingCharacterLaunch(null);
        if (!worldCandidate) void handleGenerateWorldCandidate(intent.capabilityId, intent.seedText);
        return;
      }

      setActiveTab('characters');
      const hasExplicitTarget = Boolean(intent.targetEntityId);
      const explicitTarget = hasExplicitTarget
        ? characters.find((character) => character.id === intent.targetEntityId)
        : undefined;
      const protagonists = characters.filter((character) => character.role === 'protagonist');
      const target = hasExplicitTarget
        ? explicitTarget
        : protagonists.length === 1 ? protagonists[0] : undefined;
      if (target) {
        setPendingCharacterLaunch(null);
        if (!characterCandidatesById[target.id]) void handleGenerateCharacterCandidate(target, intent.capabilityId);
        return;
      }
      setPendingCharacterLaunch({ launchToken: intent.launchToken, capabilityId: intent.capabilityId, selectedCharacterId: '' });
    });
    return () => { cancelled = true; };
  // The launch token guard makes the one-shot effect safe when handler identities change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactGovernanceLoaded, capabilityLaunchIntent, characterCandidatesById, characters, novel.id, onCapabilityLaunchConsumed, worldCandidate]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let acceptedGeneration: number;
    try {
      acceptedGeneration = requireAcceptedGeneration();
    } catch (error) {
      alert(error instanceof Error ? error.message : '导入失败，请刷新后重试。');
      return;
    }

    setIsImporting(true);
    setImportProgress(10);
    setImportStageText('正在提取文档内容...');
    importControllerRef.current?.abort();
    const importController = new AbortController();
    importControllerRef.current = importController;
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const result = event.target?.result as string;
          const base64Data = result.split(',')[1];

          const extractedRaw = await parseDocAsync(
            {
              novelId: novel.id,
              filename: file.name,
              filedata: base64Data
            },
            (progress, stageText) => {
              setImportProgress(progress);
              setImportStageText(stageText);
            },
            importController.signal,
          );
          // LLM extraction output is dynamically shaped; assert to the entity
          // arrays consumed below. Individual fields are best-effort and the
          // backend fills in defaults for missing required fields.
          const extracted = extractedRaw as {
            databaseGeneration: number;
            globalOutline?: string;
            worldRules?: string;
            characters?: Character[];
            locations?: Location[];
            items?: Item[];
            factions?: Faction[];
            powerLevels?: PowerLevel[];
            timelineEvents?: TimelineEvent[];
          };

          setImportStageText('解析成功，正在写入本地设定集...');
          setImportProgress(95);

          const newGlobalOutline = extracted.globalOutline || globalOutline;
          const newWorldRules = extracted.worldRules || worldRules;

          // One server-side SQLite transaction owns the outline and all
          // extracted entities. A malformed entity or failed insert rolls the
          // entire import back instead of leaving a half-imported world bible.
          await importWorldExtraction({
            databaseGeneration: acceptedGeneration,
            novelId: novel.id,
            globalOutline: newGlobalOutline,
            worldRules: newWorldRules,
            characters: extracted.characters || [],
            locations: extracted.locations || [],
            items: extracted.items || [],
            factions: extracted.factions || [],
            powerLevels: extracted.powerLevels || [],
            timelineEvents: extracted.timelineEvents || [],
          });
          setGlobalOutline(newGlobalOutline);
          setWorldRules(newWorldRules);

          setImportProgress(100);
          setImportStageText('设定文档导入解析成功！');
          setTimeout(() => {
            setIsImporting(false);
          }, 800);
        } catch (err) {
          logger.error('WorldBibleView error:', err);
          alert(err instanceof Error ? err.message : "导入失败，文档格式不正确或解析出错");
          setIsImporting(false);
        } finally {
          if (importControllerRef.current === importController) importControllerRef.current = null;
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      logger.error('WorldBibleView error:', err);
      alert("导入失败，文档格式不正确或解析出错");
      setIsImporting(false);
    }
  };

  const overviewState = buildContinuationOverviewState(continuationPacks);
  const storyMemory = useMemo(() => projectStoryMemory({
    novelId: novel.id,
    characters,
    locations,
    items,
    factions,
    chapters,
    timelineEvents,
    relationships,
    narrativePromises,
  }), [novel.id, characters, locations, items, factions, chapters, timelineEvents, relationships, narrativePromises]);

  const isWorldBibleEmpty =
    characters.length === 0 &&
    locations.length === 0 &&
    items.length === 0 &&
    factions.length === 0 &&
    powerLevels.length === 0 &&
    timelineEvents.length === 0 &&
    relationships.length === 0;

  const renderColdStart = () => {
    return (
      <div className="max-w-3xl mx-auto py-16 px-6 flex flex-col items-center justify-center text-center space-y-8 bg-transparent">
        <div className="w-16 h-16 bg-theme-accent/10 text-theme-accent rounded-full flex items-center justify-center animate-pulse">
          <Globe size={32} />
        </div>
        <div className="space-y-3">
          <h2 className="text-3xl font-serif font-black text-theme-text">初始化您的《{novel.title}》设定集</h2>
          <p className="text-sm text-theme-muted max-w-lg leading-relaxed mx-auto">
            当前设定集内空空如也。AI 无法在此嗅探到您笔下世界的人物和规则。推荐通过以下动作快速冷启动，让您的作品拥有丰满的底蕴：
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full pt-4">
          <button
            onClick={async () => {
              await addEntity('character');
              setActiveTab('characters');
            }}
            className="flex flex-col items-center p-6 bg-theme-sidebar/60 rounded-3xl border border-theme-border hover:border-theme-accent hover:bg-theme-sidebar transition-all text-center group cursor-pointer"
          >
            <div className="size-12 rounded-2xl bg-theme-accent/10 text-theme-accent flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Users size={22} />
            </div>
            <span className="text-sm font-bold text-theme-text mb-1">添加第一个人物</span>
            <span className="text-[11px] text-theme-muted leading-relaxed">设定主角姓名、身份和背景小传</span>
          </button>

          <button
            onClick={async () => {
              await addEntity('location');
              setActiveTab('locations');
            }}
            className="flex flex-col items-center p-6 bg-theme-sidebar/60 rounded-3xl border border-theme-border hover:border-theme-accent hover:bg-theme-sidebar transition-all text-center group cursor-pointer"
          >
            <div className="size-12 rounded-2xl bg-theme-accent/10 text-theme-accent flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <MapPin size={22} />
            </div>
            <span className="text-sm font-bold text-theme-text mb-1">添加第一个地点</span>
            <span className="text-[11px] text-theme-muted leading-relaxed">勾勒故事发生的新手村或世界地理</span>
          </button>

          <button
            onClick={() => {
              const totalEntities = characters.length + locations.length + items.length + factions.length;
              if (totalEntities < 2) {
                setShowRelationshipAlert(true);
              } else {
                setActiveTab('graph');
              }
            }}
            className="flex flex-col items-center p-6 bg-theme-sidebar/60 rounded-3xl border border-theme-border hover:border-theme-accent hover:bg-theme-sidebar transition-all text-center group cursor-pointer"
          >
            <div className="size-12 rounded-2xl bg-theme-accent/10 text-theme-accent flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <GitBranch size={22} />
            </div>
            <span className="text-sm font-bold text-theme-text mb-1">建立第一条关系</span>
            <span className="text-[11px] text-theme-muted leading-relaxed">关联主角与配角的爱恨情仇或阵营归属</span>
          </button>
        </div>

        <div className="pt-6 text-xs text-theme-muted">
          或者您也可以点击右上角的 <strong className="text-theme-text font-bold">“智能导入设定文档”</strong>，由 AI 生成大纲与设定拆解草稿，确认后再导入。
        </div>
      </div>
    );
  };
  const tabs = [
    { id: 'overview', icon: FileText, label: '总览' },
    { id: 'pack-management', icon: Upload, label: '资料包管理' },
    { id: 'contract', icon: Scroll, label: '写作合同' },
    { id: 'global', icon: BookOpen, label: '世界设定' },
    { id: 'characters', icon: Users, label: '人物档案' },
    { id: 'locations', icon: MapPin, label: '地点副本' },
    { id: 'items', icon: Package, label: '道具设定' },
    { id: 'factions', icon: Shield, label: '势力设定' },
    { id: 'powerLevels', icon: Zap, label: '力量体系' },
    { id: 'timeline', icon: Clock, label: '纪元与时间线' },
    { id: 'graph', icon: GitBranch, label: '关系图谱' },
  ] as const;

  if (onboarding) {
    return <WorldBibleOnboarding onboarding={onboarding} isGlobalAssistantOpen={isGlobalAssistantOpen} />;
  }

  return (
    <div className="h-full flex flex-col bg-transparent">
      <header className="px-8 py-6 border-b border-theme-border flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-theme-text flex items-center gap-3">
            <Globe className="text-theme-accent" />
            设定与续写
          </h1>
          <p className="text-sm text-theme-muted mt-1">先看当前续写状态，再进入资料包管理或设定资产维护。</p>
        </div>

        <div className="flex items-center gap-4">
          <input
            type="file"
            accept=".txt,.md,.json,.docx"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-2 px-4 py-2 bg-theme-bg border border-theme-border/80 text-theme-text rounded-xl shadow-sm hover:bg-theme-sidebar transition-all font-medium text-sm disabled:opacity-50"
          >
            {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {isImporting ? 'AI 解析中...' : '智能导入设定文档'}
          </button>
          <button
            type="button"
            onClick={() => onOpenAssistant?.('bible', {
              surface: 'world',
              novelId: novel.id,
              worldBibleTab: activeTab,
            })}
            aria-label="打开智能管家"
            title="打开智能管家"
            className="size-10 inline-flex items-center justify-center border border-theme-border/80 bg-theme-bg text-theme-text rounded-xl shadow-sm hover:bg-theme-sidebar transition-all"
          >
            <Sparkles size={16} />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Tabs */}
        <div className="w-56 border-r border-theme-border/50 bg-theme-sidebar flex flex-col py-4 px-3 shrink-0 gap-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-sm",
                activeTab === tab.id
                  ? "bg-theme-accent text-white shadow-md shadow-theme-accent/20"
                  : "text-theme-muted hover:bg-theme-sidebar/50 hover:text-theme-text hover:translate-x-1"
              )}
              >
                <tab.icon size={18} />
                {tab.label}
                <span className="ml-auto text-xs opacity-60">
                  {tab.id === 'pack-management' && continuationPacks.length > 0 && continuationPacks.length}
                  {tab.id === 'characters' && characters.length > 0 && characters.length}
                  {tab.id === 'locations' && locations.length > 0 && locations.length}
                  {tab.id === 'items' && items.length > 0 && items.length}
                  {tab.id === 'factions' && factions.length > 0 && factions.length}
                  {tab.id === 'powerLevels' && powerLevels.length > 0 && powerLevels.length}
                  {tab.id === 'timeline' && timelineEvents.length > 0 && timelineEvents.length}
                  {tab.id === 'graph' && relationships.length > 0 && relationships.length}
                </span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8 relative">
          {worldDataError ? (
            <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 border-y border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span>{worldDataError}</span>
              <button
                type="button"
                onClick={() => void fetchAll()}
                className="rounded-md border border-amber-400 px-3 py-1.5 text-xs font-bold hover:bg-amber-100"
              >
                刷新后重试
              </button>
            </div>
          ) : null}
          {isWorldBibleEmpty &&
          activeTab !== 'pack-management' &&
          activeTab !== 'contract' &&
          activeTab !== 'global' &&
          activeTab !== 'graph' ? (
            renderColdStart()
          ) : (
            <>
              {activeTab === 'overview' && (
                <div key="overview">
                  <ContinuationOverviewPanel
                    state={overviewState}
                    onImport={() => setActiveTab('pack-management')}
                    onReviewDraft={(packId) => {
                      setRequestedReviewPackId(packId);
                      setActiveTab('pack-management');
                    }}
                    onOpenPackManagement={(packId) => {
                      setRequestedReviewPackId(packId || null);
                      setActiveTab('pack-management');
                    }}
                    onOpenWorldSetup={() => setActiveTab('global')}
                    onStartWriting={(packId, prefillIntent) => onStartContinuationWriting?.(packId, prefillIntent)}
                    onStartStoryboard={(packId, prefillIntent) => {
                      const pack = continuationPacks.find((p) => p.id === packId);
                      onEnterStoryboard?.(packId, prefillIntent || (pack ? buildCreationIntentDraft(pack) : undefined));
                    }}
                  />
                </div>
              )}

              {activeTab === 'global' && (
                <div className="space-y-6">
                  <WorldCandidateReview
                    candidate={worldCandidate}
                    activeVersion={worldCore?.version}
                    isGenerating={isGeneratingWorldCandidate}
                    error={worldCandidateError}
                    onGenerate={() => void handleGenerateWorldCandidate()}
                    onAccept={(candidate) => void decideWorldCandidate(candidate, 'accept')}
                    onReject={(candidate) => void decideWorldCandidate(candidate, 'reject')}
                  />
                  <GlobalSetupTab
                    initialGlobalOutline={globalOutline}
                    initialWorldRules={worldRules}
                    isSaving={isSaving}
                    onSave={handleSaveGlobalInfo}
                  />
                </div>
              )}

              {activeTab === 'timeline' && (
                <TimelineTab
                  timelineEvents={timelineEvents}
                  addEntity={addEntity}
                  deleteEntity={deleteEntity}
                  updateEntity={updateEntity}
                />
              )}

              {activeTab === 'characters' && (
                <div className="space-y-4">
                  {pendingCharacterLaunch ? (
                    <section role="region" aria-label="选择角色候选目标" className="border-y border-theme-border bg-theme-sidebar/40 px-5 py-4">
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="min-w-56 flex-1 text-xs font-bold text-theme-text">
                          角色目标
                          <select
                            aria-label="角色目标"
                            value={pendingCharacterLaunch.selectedCharacterId}
                            onChange={(event) => setPendingCharacterLaunch((current) => current
                              ? { ...current, selectedCharacterId: event.target.value }
                              : current)}
                            className="mt-2 w-full rounded-md border border-theme-border bg-theme-bg px-3 py-2 text-sm text-theme-text"
                          >
                            <option value="">请选择角色</option>
                            {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                          </select>
                        </label>
                        <button
                          type="button"
                          disabled={!pendingCharacterLaunch.selectedCharacterId}
                          onClick={() => {
                            const target = characters.find((character) => character.id === pendingCharacterLaunch.selectedCharacterId);
                            if (!target) return;
                            const capabilityId = pendingCharacterLaunch.capabilityId;
                            setPendingCharacterLaunch(null);
                            if (!characterCandidatesById[target.id]) void handleGenerateCharacterCandidate(target, capabilityId);
                          }}
                          className="min-h-9 rounded-md bg-theme-text px-3 py-2 text-xs font-bold text-theme-bg disabled:opacity-50"
                        >
                          生成所选角色候选
                        </button>
                      </div>
                    </section>
                  ) : null}
                  <CharactersTab
                    characters={characters}
                    addEntity={addEntity}
                    deleteEntity={deleteEntity}
                    updateEntity={updateEntity}
                    handleGenerateBio={handleGenerateBio}
                    generatingBioIds={generatingBioIds}
                    generatingCandidateIds={generatingCharacterCandidateIds}
                    candidatesByCharacterId={characterCandidatesById}
                    onGenerateCandidate={(character) => void handleGenerateCharacterCandidate(character)}
                    onAcceptCandidate={(candidate) => void decideCharacterCandidate(candidate, 'accept')}
                    onRejectCandidate={(candidate) => void decideCharacterCandidate(candidate, 'reject')}
                    recommendationsByCharacterId={characterRecommendations}
                    onDismissRecommendation={(_character, result) => { void dismissCharacterRecommendation(result).catch((error) => alert(error instanceof Error ? error.message : '暂时无法忽略该推荐')); }}
                    onOpenCapabilityStore={onOpenCapabilityStore}
                  />
                </div>
              )}

              {activeTab === 'locations' && (
                <LocationsTab
                  locations={locations}
                  addEntity={addEntity}
                  deleteEntity={deleteEntity}
                  updateEntity={updateEntity}
                />
              )}

              {activeTab === 'items' && (
                <ItemsTab
                  items={items}
                  addEntity={addEntity}
                  deleteEntity={deleteEntity}
                  updateEntity={updateEntity}
                />
              )}

              {activeTab === 'factions' && (
                <FactionsTab
                  factions={factions}
                  addEntity={addEntity}
                  deleteEntity={deleteEntity}
                  updateEntity={updateEntity}
                />
              )}

              {activeTab === 'pack-management' && (
                <div key="pack-management">
                  <ContinuationPackView
                    novel={novel}
                    onOpenGapAssistant={onOpenGapAssistant}
                    onOpenGapAssistantBatch={onOpenGapAssistantBatch}
                    initialActivePackId={requestedReviewPackId}
                    initialAutoSyncPackId={requestedAutoSyncPackId}
                    onAutoSyncConsumed={(packId) => {
                      setRequestedAutoSyncPackId((current) => current === packId ? null : current);
                    }}
                    onSyncComplete={handlePackSyncComplete}
                  />
                </div>
              )}

              {activeTab === 'contract' && (
                <div key="contract" className="max-w-3xl mx-auto bg-theme-sidebar rounded-2xl border border-theme-border/50 shadow-md">
                  <StoryContractPanel
                    contract={novel.projectPreferenceProfile?.contract || null}
                    onSave={async (newContract) => {
                      const updatedProfile: ProjectPreferenceProfile = {
                        contract: newContract,
                        tags: novel.projectPreferenceProfile?.tags || [],
                        weights: novel.projectPreferenceProfile?.weights || {
                          styleWeight: 1,
                          characterWeight: 1,
                          worldWeight: 1,
                          plotWeight: 1,
                          pacingWeight: 1,
                        },
                        acceptedDimensions: novel.projectPreferenceProfile?.acceptedDimensions || [],
                        rejectedDimensions: novel.projectPreferenceProfile?.rejectedDimensions || [],
                        notes: novel.projectPreferenceProfile?.notes || [],
                        evidenceCount: novel.projectPreferenceProfile?.evidenceCount || 0,
                      };
                      try {
                        const generation = requireAcceptedGeneration();
                        const updated = await updateNovel(novel.id, {
                          projectPreferenceProfile: updatedProfile,
                        }, generation);
                        if (!updated) throw new Error('作品已不存在，写作合同未保存。');
                        setWorldDataError(null);
                      } catch (error) {
                        reportWorldWriteError(error, '写作合同保存失败，请重试。');
                      }
                    }}
                    onClose={() => setActiveTab('overview')}
                  />
                </div>
              )}

              {activeTab === 'powerLevels' && (
                <PowerLevelsTab
                  powerLevels={powerLevels}
                  addEntity={addEntity}
                  deleteEntity={deleteEntity}
                  updateEntity={updateEntity}
                />
              )}

              {activeTab === 'graph' && (
                <div className="h-[calc(100vh-12rem)] bg-theme-sidebar/20 border border-theme-border/30 rounded-2xl p-6 overflow-hidden shadow-inner flex flex-col gap-4">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <h3 className="text-base font-bold text-theme-text flex items-center gap-2">
                        <GitBranch size={16} className="text-theme-accent" />
                        <span>全局实体关系图谱</span>
                      </h3>
                      <p className="text-xs text-theme-muted">点击节点跳转至对应实体，新增/编辑/删除关系维护世界观关联。</p>
                    </div>
                    <button
                      onClick={() => {
                        setRelDialogMode('create');
                        setEditingRel(null);
                        setRelDialogOpen(true);
                      }}
                      disabled={totalEntities < 2}
                      title={totalEntities < 2 ? '请先添加至少两个实体' : '新增关系'}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-theme-accent text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus size={14} />
                      新增关系
                    </button>
                  </div>

                  {/* Graph */}
                  <div className="flex-1 min-h-0 relative rounded-xl border border-theme-border/40 bg-theme-sidebar/10 overflow-hidden">
                    <RelationshipGraph
                      relationships={relationships}
                      characters={characters}
                      locations={locations}
                      items={items}
                      factions={factions}
                      storyMemory={storyMemory}
                      totalEntities={characters.length + locations.length + items.length + factions.length}
                      onSelectEntity={(type) => {
                        if (type === 'character') setActiveTab('characters');
                        else if (type === 'location') setActiveTab('locations');
                        else if (type === 'item') setActiveTab('items');
                        else if (type === 'faction') setActiveTab('factions');
                      }}
                    />
                  </div>

                  {/* Relationship List */}
                  <div className="shrink-0 max-h-48 overflow-y-auto rounded-xl border border-theme-border/30 bg-theme-sidebar/10">
                    {relationships.length === 0 ? (
                      <div className="p-4 text-center text-xs text-theme-muted">
                        暂无关系，点击上方按钮添加
                      </div>
                    ) : (
                      <div className="divide-y divide-theme-border/20">
                        {relationships.map((rel) => {
                          const srcName = getEntityName(rel.sourceType, rel.sourceId, characters, locations, items, factions);
                          const tgtName = getEntityName(rel.targetType, rel.targetId, characters, locations, items, factions);
                          return (
                            <div key={rel.id} className="flex items-center justify-between px-4 py-2.5 gap-3 hover:bg-theme-sidebar/30 transition-colors">
                              <div className="flex items-center gap-2 text-xs min-w-0">
                                <span className="font-bold text-theme-text truncate">{srcName}</span>
                                <span className="text-theme-muted shrink-0">→</span>
                                <span className="text-theme-accent font-bold shrink-0">{rel.relationshipType}</span>
                                <span className="text-theme-muted shrink-0">→</span>
                                <span className="font-bold text-theme-text truncate">{tgtName}</span>
                                {rel.description && (
                                  <span className="text-theme-muted truncate hidden sm:inline">（{rel.description}）</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => {
                                    setRelDialogMode('edit');
                                    setEditingRel(rel);
                                    setRelDialogOpen(true);
                                  }}
                                  className="p-1.5 text-theme-muted hover:text-theme-accent rounded-lg hover:bg-theme-sidebar/50 transition-all"
                                  title="编辑关系"
                                >
                                  <Pen size={13} />
                                </button>
                                <button
                                  onClick={() => {
                                    setRelDialogMode('delete');
                                    setEditingRel(rel);
                                    setRelDialogOpen(true);
                                  }}
                                  className="p-1.5 text-theme-muted hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-all"
                                  title="删除关系"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Relationship Form Dialog */}
                  <RelationshipFormDialog
                    open={relDialogOpen}
                    mode={relDialogMode}
                    novelId={novel.id}
                    databaseGeneration={databaseGeneration}
                    characters={characters}
                    locations={locations}
                    items={items}
                    factions={factions}
                    existingRelationship={editingRel}
                    onClose={() => setRelDialogOpen(false)}
                    onSaved={(rel) => {
                      setRelationships(prev => {
                        const idx = prev.findIndex(r => r.id === rel.id);
                        if (idx >= 0) {
                          const next = [...prev];
                          next[idx] = rel;
                          return next;
                        }
                        return [...prev, rel];
                      });
                    }}
                    onDeleted={(id) => {
                      setRelationships(prev => prev.filter(r => r.id !== id));
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>

      <AlertDialog open={showRelationshipAlert} onOpenChange={setShowRelationshipAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>无法建立关系</AlertDialogTitle>
            <AlertDialogDescription>
              请先添加至少两个设定实体（如人物或地点），然后才能在对应档案中建立它们之间的关系。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => {
              setShowRelationshipAlert(false);
              setActiveTab('characters');
            }}>去添加人物</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isImporting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md animate-fade-in">
          <div className="w-[420px] bg-theme-sidebar/85 border border-theme-border/60 p-7 rounded-2xl shadow-2xl backdrop-blur-xl relative overflow-hidden flex flex-col gap-5 text-center">
            {/* Top decorative gradient border line */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-theme-accent via-violet-500 to-cyan-500" />
            
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="size-12 rounded-full bg-theme-accent/10 border border-theme-accent/20 flex items-center justify-center text-theme-accent animate-bounce">
                <Sparkles size={22} className="animate-pulse" />
              </div>
              <h3 className="text-base font-serif font-bold text-theme-text mt-1">智能设定导入与深度解析</h3>
              <p className="text-xs text-theme-muted px-2">
                我们正在使用 AI 深入阅读和解构您上传的设定文档，并在本地持久化建立各实体索引与逻辑关联。
              </p>
            </div>

            <div className="space-y-2 text-left">
              <div className="flex justify-between items-center text-xs px-0.5">
                <span className="text-theme-muted font-medium animate-pulse">{importStageText || '正在读取文档内容...'}</span>
                <span className="font-mono font-bold text-theme-text text-sm">{importProgress}%</span>
              </div>
              <div className="h-2 w-full bg-theme-border/30 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-theme-accent rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>

            <div className="text-[10px] text-theme-muted leading-relaxed pt-1 border-t border-theme-border/20">
              ⚡ 基于 SQLite WAL 事务快照一致性架构
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
