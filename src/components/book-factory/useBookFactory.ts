import { useState, useEffect, useRef } from 'react';
import { toast } from '../../lib/toast';
import { logger } from '../../lib/client-logger';
import { listNovels } from '../../lib/novel-client';
import { createSkill } from '../../lib/skill-client';
import { extractSkill, checkSkillExtractionJob, cancelSkillExtractionJob, QuotaError, type ExtractSkillResponse } from '../../lib/prompt-client';
import { readDraftStream } from '../../lib/draft-stream';
import { useNovelStore } from '../../stores/novel-store';
import { recordProductEvent } from '../../lib/product-events-client';
import { getDatabaseGenerationSnapshot } from '../../lib/db-transport';
import {
  getCapabilityConfigurationBaselineToken,
  loadLatestCapabilityConfigurationSession,
  saveCapabilityConfigurationSession,
} from '../../lib/capability-configuration-session';
import { getProjectCapabilityProfile } from '../../lib/skills-studio-governance';
import type {
  Skill,
  AggregatedSkillDeck,
  Novel,
  BookEvidenceStage,
  MountedSkillLoadoutItem,
  SkillDimension,
  ProjectPreferenceProfile,
  ProjectSkillDeck,
} from '../../../shared/types';
import { CARD_STAGE_MAP, type CapabilityStage } from '../../../shared/types/capability-execution';
import { generateClientId } from '../../lib/id';
import { confirmWritingStyle, type WritingStyleCandidate, type WritingStyleMode, type WritingStyleResolution } from '../../lib/writing-style-client';

const STAGE_SLOT: Record<CapabilityStage, number> = { planner: 0, writer: 1, critic: 2 };

export interface DeckMountConflict {
  slot: number;
  cardIds: string[];
}

export interface BuildDeckMountPlanResult {
  loadout: MountedSkillLoadoutItem[];
  replacementSlots: number[];
  conflicts: DeckMountConflict[];
  requiresStageSelection: boolean;
  unknownCards: Skill[];
}

export function getCardMountStages(cardType?: Skill['deconstructionCardType']): readonly CapabilityStage[] {
  if (!cardType) return [];
  return CARD_STAGE_MAP[cardType] || [];
}

export function buildDeckMountPlan(
  cards: Skill[],
  existingLoadout: MountedSkillLoadoutItem[],
  requestedStage?: CapabilityStage,
): BuildDeckMountPlanResult {
  const nextBySlot = new Map(existingLoadout.map((entry) => [entry.slot, entry]));
  const replacementSlots: number[] = [];
  const unknownCards: Skill[] = [];
  const conflicts: Array<{ slot: number; cardIds: string[] }> = [];
  const plannedSlots = new Map<number, string>();
  let requiresStageSelection = false;

  for (const card of cards) {
    const stages = getCardMountStages(card.deconstructionCardType);
    if (stages.length === 0) {
      unknownCards.push(card);
      continue;
    }
    if (stages.length > 1 && !requestedStage) {
      requiresStageSelection = true;
      continue;
    }
    const stage = stages.length === 1 ? stages[0] : requestedStage;
    if (!stage || !stages.includes(stage)) continue;
    const slot = STAGE_SLOT[stage];
    const plannedCardId = plannedSlots.get(slot);
    if (plannedCardId && plannedCardId !== card.id) {
      const priorConflict = conflicts.find((entry) => entry.slot === slot);
      if (priorConflict) priorConflict.cardIds.push(card.id);
      else conflicts.push({ slot, cardIds: [plannedCardId, card.id] });
      continue;
    }
    plannedSlots.set(slot, card.id);
    for (const [existingSlot, entry] of nextBySlot) {
      if (existingSlot !== slot && entry.skillId === card.id) nextBySlot.delete(existingSlot);
    }
    if (nextBySlot.has(slot) && !replacementSlots.includes(slot)) replacementSlots.push(slot);
    nextBySlot.set(slot, {
      slot,
      skillId: card.id,
      weight: slot === 0 ? 1 : 0.7,
      lockedDimensions: [card.primaryDimension || 'style'],
    });
  }

  return {
    loadout: Array.from(nextBySlot.values()).sort((left, right) => left.slot - right.slot),
    replacementSlots,
    conflicts,
    requiresStageSelection,
    unknownCards,
  };
}

export interface ProjectSkillDeckPreview {
  deck: ProjectSkillDeck;
  acceptedCards: Skill[];
  rejectedCards: Skill[];
  conflicts: string[];
  warnings: string[];
}

export interface ProjectSkillDeckSelection {
  mainCardId?: string;
  supportCardIds?: string[];
}

function isRuntimeReadyDeckCard(card: Skill): boolean {
  const metadata = card as Skill & {
    isRuntimeReady?: boolean;
    sanitizationStatus?: string;
    runtimeStatus?: string;
  };
  const hasExecutableRule = [card.style, card.pacing, card.characterTraits, card.worldBuilding, card.plotPattern, card.foreshadowing, ...(card.corePatterns || []), ...(card.fewShots || [])]
    .some((value) => typeof value === 'string' && value.trim().length > 0);
  const authorizedSource = !card.sourceType || ['built-in', 'licensed', 'plaza', 'book-extracted'].includes(card.sourceType);
  return Boolean(
    card.version > 0
      && authorizedSource
      && card.accessTier !== 'paid'
      && hasExecutableRule
      && metadata.deconstructionCardType
      && metadata.isRuntimeReady === true
      && metadata.sanitizationStatus === 'runtime-ready'
      && metadata.runtimeStatus === 'active',
  );
}

/**
 * A deconstruction Deck is a project card stack, not a projection into the
 * Planner/Writer/Critic role slots. Main/support roles are explicit IDs.
 */
export function buildProjectSkillDeckPreview(
  cards: Skill[],
  updatedAt = Date.now(),
  selection?: ProjectSkillDeckSelection,
): ProjectSkillDeckPreview {
  const uniqueCards: Skill[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (!card.id || seen.has(card.id)) continue;
    seen.add(card.id);
    uniqueCards.push(card);
  }
  const cardCandidates = uniqueCards.filter(isRuntimeReadyDeckCard);
  const nonCardSkills = uniqueCards.filter((card) => !isRuntimeReadyDeckCard(card));
  const selectedMain = selection?.mainCardId
    ? cardCandidates.find((card) => card.id === selection.mainCardId)
    : undefined;
  const selectedSupportIds = Array.from(new Set(selection?.supportCardIds || []));
  const selectedSupports = selectedSupportIds
    .map((id) => cardCandidates.find((card) => card.id === id))
    .filter((card): card is Skill => Boolean(card && card.id !== selectedMain?.id));
  const acceptedCards = selection
    ? [ ...(selectedMain ? [selectedMain] : []), ...selectedSupports ]
    : cardCandidates;
  const acceptedIds = new Set(acceptedCards.map((card) => card.id));
  const rejectedCards = [
    ...nonCardSkills,
    ...cardCandidates.filter((card) => !acceptedIds.has(card.id)),
  ];
  const conflicts = selection
    ? [
      ...(selectedSupportIds.length > 2 ? ['PROJECT_DECK_SUPPORT_LIMIT'] : []),
      ...(selection.mainCardId && !selectedMain ? ['PROJECT_DECK_MAIN_NOT_FOUND'] : []),
      ...selectedSupportIds.filter((id) => !cardCandidates.some((card) => card.id === id)).map(() => 'PROJECT_DECK_SUPPORT_NOT_FOUND'),
    ]
    : [];
  const warnings = [
    nonCardSkills.length > 0 ? '只有拆书卡可以提交到作品卡组待选，写作技法或流程请在能力中心单独使用' : '',
    cardCandidates.length > 3 ? '作品卡组最多包含 1 张主卡和 2 张辅卡，超出卡片请单独保存' : '',
    selectedSupportIds.length > 2 ? '已选择超过 2 张辅卡，请移除多余卡片后再保存' : '',
  ].filter(Boolean);
  return {
    deck: {
      ...(selectedMain ? { mainCardId: selectedMain.id } : {}),
      supportCardIds: selection
        ? acceptedCards.filter((card) => card.id !== selectedMain?.id).map((card) => card.id)
        : [],
      updatedAt,
    },
    acceptedCards,
    rejectedCards,
    // Multiple Planner cards are intentionally valid in a Deck. They are
    // resolved as a stack at execution time and never compete for a role slot.
    conflicts,
    warnings,
  };
}

export const buildSkillDeckPreview = buildProjectSkillDeckPreview;

export function updateProjectSkillDeck(
  profile: ProjectPreferenceProfile | undefined,
  deck: ProjectSkillDeck,
): ProjectPreferenceProfile {
  const supportIds = deck.supportCardIds || [];
  if (!deck.mainCardId || supportIds.length > 2 || new Set(supportIds).size !== supportIds.length || supportIds.includes(deck.mainCardId)) {
    throw new Error('Invalid project skill deck selection');
  }
  const normalizedSupport = supportIds.filter(Boolean);
  const base = profile || {
    tags: [],
    weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
  };
  return {
    ...base,
    capabilityModelVersion: 3,
    capabilityProfile: {
      ...(base.capabilityProfile || {}),
      version: 3,
      projectSkillDeck: {
        mainCardId: deck.mainCardId,
        supportCardIds: normalizedSupport,
        updatedAt: deck.updatedAt,
      },
      favoriteTechniqueIds: base.capabilityProfile?.favoriteTechniqueIds || [],
    },
  };
}

export function buildProjectSkillDeckUpdatePayload(
  profile: ProjectPreferenceProfile | undefined,
  deck: ProjectSkillDeck,
): { projectPreferenceProfile: ProjectPreferenceProfile } {
  return { projectPreferenceProfile: updateProjectSkillDeck(profile, deck) };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v : String(v))) : [];
}

function isQuotaErrorLike(value: unknown): value is {
  quotaExceeded: true;
  limitType?: string;
  count?: number;
  max?: number;
} {
  return Boolean(asRecord(value).quotaExceeded);
}

// 编码自动打分辅助函数
function scoreDecodedText(text: string): number {
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const punctuationCount = (text.match(/[，。！？；：、""'']/g) || []).length;
  return chineseCount * 2 + punctuationCount - replacementCount * 20;
}

// 自动判定编码并解码 Buffer
function decodeTextArrayBuffer(buffer: ArrayBuffer): string {
  const attempts: string[] = ['utf-8', 'gb18030', 'gbk'];
  const decodedCandidates: string[] = [];
  for (const encoding of attempts) {
    try {
      const useFatal = encoding === 'utf-8';
      const text = new TextDecoder(encoding, useFatal ? { fatal: true } : undefined).decode(buffer);
      decodedCandidates.push(text);
    } catch {}
  }
  if (decodedCandidates.length === 0) {
    return new TextDecoder('utf-8').decode(buffer);
  }
  return decodedCandidates.sort((a, b) => scoreDecodedText(b) - scoreDecodedText(a))[0];
}

// 标准化技能配置
export function normalizeSkillConfig(data: Partial<Skill> | Record<string, unknown>): Skill {
  const rec = asRecord(data);
  const primaryDimension = (typeof rec.primaryDimension === 'string' && ['style', 'character', 'world', 'power', 'plot', 'pacing'].includes(rec.primaryDimension))
    ? (rec.primaryDimension as SkillDimension)
    : 'style';
  
  // 修复：检查是否为空数组或过滤后为空
  let dimensionTags: SkillDimension[] = ['style' as const];
  if (Array.isArray(rec.dimensionTags) && rec.dimensionTags.length > 0) {
    const filtered = asStringArray(rec.dimensionTags).filter((t) => ['style', 'character', 'world', 'power', 'plot', 'pacing'].includes(t)) as SkillDimension[];
    if (filtered.length > 0) {
      dimensionTags = filtered;
    }
  }

  const comp = asRecord(rec.compositionProfile);
  const compositionProfile = {
    styleWeight: typeof comp.styleWeight === 'number' ? comp.styleWeight : 0.8,
    characterWeight: typeof comp.characterWeight === 'number' ? comp.characterWeight : 0.4,
    worldWeight: typeof comp.worldWeight === 'number' ? comp.worldWeight : 0.4,
    powerWeight: typeof comp.powerWeight === 'number' ? comp.powerWeight : 0.3,
    plotWeight: typeof comp.plotWeight === 'number' ? comp.plotWeight : 0.5,
    pacingWeight: typeof comp.pacingWeight === 'number' ? comp.pacingWeight : 0.6,
    conflictTags: Array.isArray(comp.conflictTags) ? asStringArray(comp.conflictTags) : [],
    blendHints: Array.isArray(comp.blendHints) ? asStringArray(comp.blendHints) : [],
  };

  return {
    ...(data as Skill),
    primaryDimension,
    dimensionTags,
    compositionProfile,
  };
}

export function normalizeSkillConfigs(data: unknown): Skill[] {
  if (data === null || data === undefined) {
    return [];
  }
  const rec = asRecord(data);
  const rawSkills = Array.isArray(rec.skills)
    ? rec.skills
    : Array.isArray(data)
      ? data
      : [data];
  return (rawSkills as Array<Partial<Skill> | Record<string, unknown>>).map(normalizeSkillConfig);
}

export interface BookFactoryChapterContext {
  chapterId?: string;
  databaseGeneration?: number;
  styleConfirmationFingerprint?: string;
  writingStyleFingerprint?: string;
  onOpenCapabilityCenter?: (novel: Novel) => void;
}

export const MIN_BOOK_FACTORY_TEXT_CHARS = 50;

export function countChineseCharacters(text: string): number {
  return (text.match(/[一-鿿]/g) || []).length;
}

export function useBookFactory(chapterContext: BookFactoryChapterContext = {}) {
  const selectedNovel = useNovelStore(state => state.selectedNovel);
  const [fileContent, setFileContent] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [skillCards, setSkillCards] = useState<Skill[]>([]);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [deckMeta, setDeckMeta] = useState<{ mainCardId?: string; supportCount?: number } | null>(null);
  const [deck, setDeck] = useState<AggregatedSkillDeck | null>(null);
  const [segmentLabels, setSegmentLabels] = useState<Array<{ id: string; stage: BookEvidenceStage; label: string }>>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editableJson, setEditableJson] = useState("");

  // 轮询状态
  const [extractionSource, setExtractionSource] = useState<'fallback' | 'model' | null>(null);
  const [extractionJobId, setExtractionJobId] = useState<string | null>(null);
  const [isModelPending, setIsModelPending] = useState(false);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [extractionStatusNote, setExtractionStatusNote] = useState<string | null>(null);
  const [extractionQuality, setExtractionQuality] = useState<ExtractSkillResponse['quality'] | null>(null);

  // 风格测试状态
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ skillId: string; status: 'idle' | 'running' | 'success' | 'error'; output: string; error?: string }>({ skillId: '', status: 'idle', output: '' });
  const [testStyleResolution, setTestStyleResolution] = useState<WritingStyleResolution | null>(null);
  const [testStyleCandidates, setTestStyleCandidates] = useState<WritingStyleCandidate[]>([]);
  const [testStyleFingerprint, setTestStyleFingerprint] = useState<string | undefined>(chapterContext.styleConfirmationFingerprint || chapterContext.writingStyleFingerprint);
  const testRunRef = useRef<{ seq: number; controller: AbortController | null }>({ seq: 0, controller: null });

  // 装备状态
  const [showEquipPanel, setShowEquipPanel] = useState(false);
  const [equipNovelId, setEquipNovelId] = useState('');
  const [userNovels, setUserNovels] = useState<Novel[]>([]);
  const [lastSavedSkillId, setLastSavedSkillId] = useState('');
  const [savedSkillSourceMap, setSavedSkillSourceMap] = useState<Record<string, string>>({});
  const [savedDeckIds, setSavedDeckIds] = useState<string[]>([]);
  const [savedDeckSourceMap, setSavedDeckSourceMap] = useState<Record<string, string>>({});
  const [deckSelection, setDeckSelection] = useState<ProjectSkillDeckSelection>({});

  const lastSeenInputRef = useRef(fileContent);

  useEffect(() => {
    if (showEquipPanel) {
      listNovels().then(setUserNovels);
    }
  }, [showEquipPanel]);

  useEffect(() => {
    if (fileContent === lastSeenInputRef.current) return;
    lastSeenInputRef.current = fileContent;
    if (isAnalyzing) return;
    setExtractionWarnings([]);
    if (skillCards.length === 0) {
      setExtractionStatusNote(null);
    }
  }, [fileContent, isAnalyzing, skillCards.length]);

  const stageDeckCandidatesForCapabilityCenter = async (novel: Novel, cardIds: string[]) => {
    try {
      const uniqueIds = [...new Set(cardIds.filter(Boolean))];
      if (uniqueIds.length === 0) return false;
      const capabilityProfile = getProjectCapabilityProfile(novel);
      const databaseGeneration = await getDatabaseGenerationSnapshot();
      const baselineToken = getCapabilityConfigurationBaselineToken(capabilityProfile);
      const latest = loadLatestCapabilityConfigurationSession(novel.id);
      const reusableLatest = latest
        && latest.databaseGeneration === databaseGeneration
        && latest.baselineToken === baselineToken
        ? latest
        : null;

      saveCapabilityConfigurationSession({
        version: 1,
        novelId: novel.id,
        databaseGeneration,
        baselineToken,
        configurationDraft: reusableLatest?.configurationDraft || capabilityProfile,
        sessionId: reusableLatest?.sessionId,
        candidateCardIds: [...new Set([...(reusableLatest?.candidateCardIds || []), ...uniqueIds])],
        pendingCandidateId: reusableLatest?.pendingCandidateId || null,
        activeTab: 'mySkills',
        selectedCapability: 'skill-card',
        selectedCategory: 'all',
        selectedAssetId: null,
        scrollTop: reusableLatest?.scrollTop || 0,
        updatedAt: 0,
      });
      return true;
    } catch (error) {
      logger.warn('Failed to stage book-factory deck candidates', error);
      return false;
    }
  };

  // 后台轮询升级
  useEffect(() => {
    if (!extractionJobId || !isModelPending) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_POLL_ATTEMPTS = 60;

    const poll = async () => {
      if (cancelled) return;
      try {
        attempts++;
        const job = await checkSkillExtractionJob(extractionJobId);
        if (job.status === 'completed' && job.skills) {
          if (!cancelled) {
            const normalized = normalizeSkillConfigs({ skills: job.skills });
            setSkillCards(normalized);
            if (job.deck) {
              setDeck(job.deck);
              setDeckSelection({
                supportCardIds: job.deck.supportCards?.map((card: Skill) => card.id) || [],
              });
            }
            if (job.segments) setSegmentLabels(job.segments);
            setExtractionSource('model');
            setExtractionWarnings(job.warnings || []);
            setExtractionQuality(job.quality || null);
            setIsModelPending(false);
            if (normalized[0]) {
              setEditableJson(JSON.stringify(normalized[0], null, 2));
            }
          }
          return;
        }
        if (job.status === 'failed') {
          if (!cancelled) {
            setExtractionWarnings((prev) => [
              ...prev,
              `AI 深度分析未完成：${job.error || '模型响应失败'}。当前显示的是本地保底提炼结果。`,
            ]);
            setExtractionQuality((current) => current || { passed: false, anchoringScore: 0, genericSkillCount: 0, totalSkillCount: 0, genericDetails: [], fieldCompleteness: 0, issue: job.error || 'AI 深度分析失败' });
            setIsModelPending(false);
          }
          return;
        }
        if (!cancelled && attempts < MAX_POLL_ATTEMPTS) {
          setTimeout(poll, 2000);
        } else if (!cancelled) {
          setExtractionWarnings((prev) => [...prev, 'AI 深度分析超时，当前显示的是本地保底提炼结果。']);
          setExtractionQuality((current) => current || { passed: false, anchoringScore: 0, genericSkillCount: 0, totalSkillCount: 0, genericDetails: [], fieldCompleteness: 0, issue: 'AI 深度分析超时' });
          setIsModelPending(false);
        }
      } catch (e) {
        if (!cancelled) {
          setExtractionWarnings((prev) => [...prev, `AI 深度分析轮询出错：${String(e)}。`]);
          setExtractionQuality((current) => current || { passed: false, anchoringScore: 0, genericSkillCount: 0, totalSkillCount: 0, genericDetails: [], fieldCompleteness: 0, issue: 'AI 深度分析轮询失败' });
          setIsModelPending(false);
        }
      }
    };

    const timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      void cancelSkillExtractionJob(extractionJobId).catch(() => {});
    };
  }, [extractionJobId, isModelPending]);

  const selectedSkill = skillCards[selectedSkillIndex] || null;
  const selectedSavedSkillId = selectedSkill ? savedSkillSourceMap[selectedSkill.id] || '' : '';

  useEffect(() => {
    const currentSkillId = selectedSkill?.id || '';
    testRunRef.current.controller?.abort();
    testRunRef.current.controller = null;
    testRunRef.current.seq += 1;
    setIsTesting(false);
    setTestError(null);
    setTestOutput('');
    setTestResult({ skillId: currentSkillId, status: 'idle', output: '' });
    setTestStyleResolution(null);
    setTestStyleCandidates([]);
    setTestStyleFingerprint(chapterContext.styleConfirmationFingerprint || chapterContext.writingStyleFingerprint);
  }, [chapterContext.styleConfirmationFingerprint, chapterContext.writingStyleFingerprint, selectedSkill?.id]);

  const updateSelectedSkill = (updater: (skill: Skill) => Skill) => {
    setSkillCards((current) =>
      current.map((skill, index) => (index === selectedSkillIndex ? updater(skill) : skill)),
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (buffer) {
        setFileContent(decodeTextArrayBuffer(buffer));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleAnalyze = async () => {
    if (!fileContent) return;
    if (!selectedNovel) {
      toast('请先选择要绑定的作品，再开始拆书萃取。', 'error');
      return;
    }
    const chineseCount = countChineseCharacters(fileContent);
    if (chineseCount < MIN_BOOK_FACTORY_TEXT_CHARS) {
      const message = `拆书未开始：当前文本只有 ${chineseCount} 个有效中文字符，至少需要 ${MIN_BOOK_FACTORY_TEXT_CHARS} 个。`;
      setExtractionStatusNote(message);
      setExtractionWarnings([message]);
      return;
    }
    const startedAt = Date.now();
    let completionResult: 'success' | 'failure' = 'success';
    let completionErrorCode: string | undefined;
    void recordProductEvent({ eventName: 'factory_start', stage: 'advanced', result: 'success', objectId: selectedNovel?.id, durationMs: 0 }).catch(() => undefined);
    setIsAnalyzing(true);
    setSkillCards([]);
    setSelectedSkillIndex(0);
    setDeck(null);
    setDeckSelection({});
    setDeckMeta(null);
    setSegmentLabels([]);
    setIsEditing(false);
    setEditableJson("");
    setExtractionSource(null);
    setExtractionJobId(null);
    setIsModelPending(false);
    setExtractionWarnings([]);
    setExtractionStatusNote('正在拆书与提炼本地保底卡……');
    setExtractionQuality(null);

    try {
      const data = await extractSkill(fileContent, selectedNovel.id);
      const normalized = normalizeSkillConfigs(data);
      if (normalized.length === 0) {
        throw new Error('拆书接口返回成功，但没有可展示的拆书卡。');
      }
      setSkillCards(normalized);
      setSelectedSkillIndex(0);
      setDeck(data.deck);
      setDeckSelection({
        supportCardIds: data.deck?.supportCards?.map((card: Skill) => card.id) || [],
      });
      setLastSavedSkillId('');
      setSavedDeckIds([]);
      setSavedDeckSourceMap({});
      setShowEquipPanel(false);
      setDeckMeta({
        mainCardId: data.deck?.mainCard?.id,
        supportCount: Array.isArray(data.deck?.supportCards) ? data.deck.supportCards.length : Math.max(0, normalized.length - 1),
      });
      setSegmentLabels(Array.isArray(data.segments) ? data.segments : []);
      setEditableJson(JSON.stringify(normalized[0] || {}, null, 2));
      setExtractionSource(data.source || 'fallback');
      setExtractionWarnings(data.warnings || []);
      setExtractionStatusNote(data.statusNote || null);
      setExtractionQuality(data.quality || null);

      if (data.source === 'fallback' && data.jobId) {
        setExtractionJobId(data.jobId);
        setIsModelPending(true);
      }
    } catch (e) {
      completionResult = 'failure';
      completionErrorCode = e instanceof QuotaError || isQuotaErrorLike(e) ? 'QUOTA_LIMIT_EXCEEDED' : 'FACTORY_ANALYSIS_FAILED';
      if (e instanceof QuotaError || isQuotaErrorLike(e)) {
        const quotaLike = e instanceof QuotaError ? e : e;
        // 抛出全局自定义事件以触发毛玻璃升舱弹窗
        window.dispatchEvent(new CustomEvent('local-capability-unavailable', {
          detail: {
            limitType: quotaLike.limitType || 'extractSkill',
            count: quotaLike.count ?? 5,
            max: quotaLike.max ?? 5,
            error: e instanceof Error ? e.message : String(e),
            novelId: selectedNovel?.id || undefined, // 带上当前小说ID (Novel ID pass-through for upgrade tracking)
          }
        }));
      }
      const errorMessage = e instanceof Error ? e.message : String(e);
      const isInputError = /文本|字符|中文|过短|输入/i.test(errorMessage);
      const isRateLimitError = /频繁|rate.?limit|429|quota|额度/i.test(errorMessage);
      const statusNote = isInputError
        ? `拆书失败：${errorMessage}`
        : isRateLimitError
          ? '拆书失败：请求过于频繁或额度已用尽，请稍后重试。'
          : '拆书失败：模型或网络服务暂时不可用，请重试。';
      setExtractionStatusNote(statusNote);
      setExtractionWarnings([errorMessage]);
    } finally {
      void recordProductEvent({ eventName: 'factory_complete', stage: 'advanced', result: completionResult, errorCode: completionErrorCode, objectId: selectedNovel?.id, durationMs: Date.now() - startedAt }).catch(() => undefined);
      setIsAnalyzing(false);
    }
  };

  const handleTestDrive = async (fingerprintOverride?: string) => {
    if (!selectedSkill || !testInput) return;
    if (!selectedNovel) {
      toast('请先选择要计费和承载试跑结果的作品。', 'error');
      return;
    }
    if (!chapterContext.chapterId || chapterContext.databaseGeneration === undefined) {
      toast('试跑需要绑定当前章节和数据库版本，请从章节编辑器进入。', 'error');
      return;
    }
    const chineseCount = countChineseCharacters(testInput);
    if (chineseCount < MIN_BOOK_FACTORY_TEXT_CHARS) {
      setTestError(`试跑需要至少 ${MIN_BOOK_FACTORY_TEXT_CHARS} 个有效中文字符，当前为 ${chineseCount} 个。`);
      return;
    }
    const skillId = selectedSkill.id;
    const seq = testRunRef.current.seq + 1;
    testRunRef.current.controller?.abort();
    const controller = new AbortController();
    testRunRef.current = { seq, controller };
    setTestError(null);
    setIsTesting(true);
    setTestOutput('');
    setTestResult({ skillId, status: 'running', output: '' });
    try {
      const savedTestSkillId = savedDeckSourceMap[selectedSkill.id] || savedSkillSourceMap[selectedSkill.id];
      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          draftingSurface: 'workspace-draft',
          reviewSurface: 'chapter-review',
          contextStr: "风格模拟测试场景。",
          sceneBeats: testInput,
          maxIterations: 1,
          draftContent: "",
          includeCritic: false,
          novelId: selectedNovel.id,
          chapterId: chapterContext.chapterId,
          databaseGeneration: chapterContext.databaseGeneration,
          ...((fingerprintOverride || testStyleFingerprint) ? { styleConfirmationFingerprint: fingerprintOverride || testStyleFingerprint, writingStyleFingerprint: fingerprintOverride || testStyleFingerprint } : {}),
          ...(savedTestSkillId ? { sessionCardIds: [savedTestSkillId] } : {}),
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as {
          code?: string;
          error?: string;
          resolution?: WritingStyleResolution;
          candidates?: WritingStyleCandidate[];
        };
        if (response.status === 409 && data.code === 'STYLE_CONFIRMATION_REQUIRED') {
          setTestStyleResolution(data.resolution || null);
          setTestStyleCandidates(data.candidates || []);
          setTestResult({ skillId, status: 'error', output: '', error: '请先确认本次写法' });
          return;
        }
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      let streamedText = '';
      streamedText = await readDraftStream(response, {
          onToken: (token) => {
          if (testRunRef.current.seq !== seq || testRunRef.current.controller !== controller) return;
          streamedText += token;
          setTestOutput(streamedText);
          setTestResult({ skillId, status: 'running', output: streamedText });
        },
      });
      if (testRunRef.current.seq !== seq || testRunRef.current.controller !== controller) return;
      setTestOutput(streamedText);
      setTestResult({ skillId, status: 'success', output: streamedText });
    } catch (error) {
      if (controller.signal.aborted || testRunRef.current.seq !== seq) return;
      const message = error instanceof Error ? error.message : '模拟失败，请重试';
      setTestError(message);
      setTestResult({ skillId, status: 'error', output: '', error: message });
      toast(message, 'error');
    } finally {
      if (testRunRef.current.seq === seq) {
        setIsTesting(false);
        testRunRef.current.controller = null;
      }
    }
  };

  const handleConfirmTestStyle = async (mode: WritingStyleMode) => {
    if (!selectedNovel?.id || !chapterContext.chapterId || chapterContext.databaseGeneration === undefined) {
      throw new Error('试跑需要绑定当前章节和数据库版本');
    }
    const response = await confirmWritingStyle(selectedNovel.id, {
      chapterId: chapterContext.chapterId,
      databaseGeneration: chapterContext.databaseGeneration,
      mode,
    });
    const fingerprint = response.fingerprint || response.resolution?.fingerprint;
    setTestStyleResolution(response.resolution || null);
    setTestStyleCandidates(response.candidates || []);
    if (fingerprint) setTestStyleFingerprint(fingerprint);
    return fingerprint;
  };

  const handleTestInputChange = (value: string) => {
    setTestInput(value);
    setTestError(null);
  };

  const handleSaveSkill = async (targetSkill: Skill, forcedId?: string) => {
    setIsSaving(true);
    try {
      const now = forcedId ? Number(forcedId) || Date.now() : Date.now();
      const id = forcedId || generateClientId();
      await createSkill({
        ...targetSkill,
        id,
        lineageRootId: targetSkill.lineageRootId || id,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    } catch (error) {
      toast(error instanceof Error ? `能力卡保存失败：${error.message}` : '能力卡保存失败，请重试', 'error');
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleEquipSkill = async () => {
    if (!equipNovelId || !selectedSavedSkillId || isSaving) return;
    if (isModelPending || extractionQuality?.passed === false) {
      toast(isModelPending ? 'AI 深度拆书尚未完成，暂不能提交卡片。' : `拆书质量门禁未通过${extractionQuality?.issue ? `：${extractionQuality.issue}` : ''}，请修正或重新拆书。`, 'error');
      return;
    }
    if (!selectedSkill || !isRuntimeReadyDeckCard(selectedSkill)) {
      toast('只有运行时就绪的拆书卡可以提交到作品卡组待选。', 'error');
      return;
    }
    const novel = userNovels.find((n) => n.id === equipNovelId);
    if (!novel) return;
    const staged = await stageDeckCandidatesForCapabilityCenter(novel, [selectedSavedSkillId]);
    if (!staged) {
      toast('提交到作品卡组待选失败，请重试', 'error');
      return;
    }
    setShowEquipPanel(false);
    toast('已提交到作品卡组待选，请前往作品能力中心选择卡组位置并应用配置。', 'success');
    chapterContext.onOpenCapabilityCenter?.(novel);
  };

  const handleSaveSelectedSkill = async () => {
    if (!selectedSkill || isSaving) return;
    if (isModelPending || extractionQuality?.passed === false) {
      toast(isModelPending ? 'AI 深度拆书尚未完成，暂不能保存卡片。' : `拆书质量门禁未通过${extractionQuality?.issue ? `：${extractionQuality.issue}` : ''}，请修正或重新拆书。`, 'error');
      return;
    }
    if (selectedSavedSkillId) {
      setShowEquipPanel(true);
      setEquipNovelId('');
      return;
    }
    const id = generateClientId();
    const deckGroupId = deck ? `single-${id}` : undefined;
    await handleSaveSkill({ ...selectedSkill, deckGroupId } as Skill, id);
    setLastSavedSkillId(id);
    setSavedSkillSourceMap((current) => ({ ...current, [selectedSkill.id]: id }));
    setShowEquipPanel(true);
    setEquipNovelId('');
  };

  const handleSaveDeck = async (): Promise<{ savedIds: string[]; sourceMap: Record<string, string> }> => {
    if (!deck) return { savedIds: [], sourceMap: {} };
    if (isModelPending || extractionQuality?.passed === false) {
      toast(isModelPending ? 'AI 深度拆书尚未完成，暂不能保存卡组。' : `拆书质量门禁未通过${extractionQuality?.issue ? `：${extractionQuality.issue}` : ''}，请修正或重新拆书。`, 'error');
      return { savedIds: [], sourceMap: {} };
    }
    if (savedDeckIds.length > 0) return { savedIds: savedDeckIds, sourceMap: savedDeckSourceMap };
    setIsSaving(true);
    try {
    const deckGroupId = generateClientId();
      const preview = buildProjectSkillDeckPreview(deck.supportCards, Date.now(), deckSelection);
      if (!deckSelection.mainCardId || preview.conflicts.length > 0 || preview.acceptedCards.length === 0) {
        toast('请先选择一张主卡，并确认辅卡不超过 2 张且均可运行。', 'error');
        return { savedIds: [], sourceMap: {} };
      }
      const allCards = preview.acceptedCards;
      const savedIds: string[] = [];
      const sourceMap: Record<string, string> = {};
      const now = Date.now();
      const sourcePairs = allCards.map((card) => {
        const id = generateClientId();
        return {
          sourceId: card.id,
          saved: {
            ...normalizeSkillConfig(card),
            id,
            lineageRootId: card.lineageRootId || id,
            deckGroupId,
            createdAt: now,
            updatedAt: now,
          } as Skill,
        };
      });
      let createBatch: typeof import('../../lib/skill-client').createSkillsBatch | undefined;
      try {
        createBatch = (await import('../../lib/skill-client')).createSkillsBatch;
      } catch {
        createBatch = undefined;
      }
      if (createBatch) {
        await createBatch(sourcePairs.map((pair) => pair.saved));
      } else {
        for (const pair of sourcePairs) await createSkill(pair.saved);
      }
      sourcePairs.forEach(({ sourceId, saved }) => {
        savedIds.push(saved.id);
        sourceMap[sourceId] = saved.id;
      });
      setSavedDeckIds(savedIds);
      setSavedDeckSourceMap(sourceMap);
      setLastSavedSkillId(deckSelection.mainCardId ? sourceMap[deckSelection.mainCardId] || '' : '');
      toast(`卡组草稿已保存：${deckSelection.mainCardId || '待选择主卡'} + ${Math.max(0, allCards.length - 1)} 辅卡；提交到作品卡组待选后仍需应用配置。`, 'success');
      return { savedIds, sourceMap };
    } finally {
      setIsSaving(false);
    }
  };

  const handleEquipDeck = async () => {
    if (!equipNovelId || !deck || isSaving) return;
    if (isModelPending || extractionQuality?.passed === false) {
      toast(isModelPending ? 'AI 深度拆书尚未完成，暂不能提交卡组。' : `拆书质量门禁未通过${extractionQuality?.issue ? `：${extractionQuality.issue}` : ''}，请修正或重新拆书。`, 'error');
      return;
    }
    const novel = userNovels.find((n) => n.id === equipNovelId);
    if (!novel) return;
    const preview = buildProjectSkillDeckPreview(deck.supportCards, Date.now(), deckSelection);
    if (!deckSelection.mainCardId || preview.conflicts.length > 0 || preview.acceptedCards.length === 0) {
      toast('请先选择一张主卡，并确认辅卡不超过 2 张且均可运行。', 'error');
      return;
    }
    const savedDeck = savedDeckIds.length > 0
      ? { savedIds: savedDeckIds, sourceMap: savedDeckSourceMap }
      : await handleSaveDeck();
    if (savedDeck.savedIds.length === 0) return;
    if (preview.rejectedCards.length > 0) {
      toast(preview.warnings[0] || '超出作品卡组上限的卡片仍保留为能力卡', 'error');
    }
    const persistedDeckSelection = {
      mainCardId: savedDeck.sourceMap[deckSelection.mainCardId || ''],
      supportCardIds: (deckSelection.supportCardIds || [])
        .map((sourceId) => savedDeck.sourceMap[sourceId])
        .filter((id): id is string => Boolean(id)),
      updatedAt: Date.now(),
    };

    const staged = await stageDeckCandidatesForCapabilityCenter(novel, [
      persistedDeckSelection.mainCardId,
      ...persistedDeckSelection.supportCardIds,
    ]);
    if (!staged) {
      toast('提交到作品卡组待选失败，请重试', 'error');
      return;
    }
    setShowEquipPanel(false);
    toast('已提交到作品卡组待选，请前往作品能力中心选择主卡或辅卡并应用配置。', 'success');
    chapterContext.onOpenCapabilityCenter?.(novel);
  };

  return {
    fileContent, setFileContent,
    isAnalyzing,
    skillCards,
    selectedSkillIndex, setSelectedSkillIndex,
    deckMeta,
    deck,
    segmentLabels,
    isSaving,
    isEditing, setIsEditing,
    editableJson, setEditableJson,
    extractionSource,
    isModelPending,
    extractionWarnings,
    extractionStatusNote,
    extractionQuality,
    selectedSkill,
    testInput, setTestInput: handleTestInputChange,
    testOutput, setTestOutput,
    testResult,
    testError,
    testStyleResolution,
    testStyleCandidates,
    onConfirmTestStyle: handleConfirmTestStyle,
    onGenerateWithTestStyle: (fingerprint?: string) => handleTestDrive(fingerprint),
    isTesting,
    showEquipPanel, setShowEquipPanel,
    equipNovelId, setEquipNovelId,
    userNovels,
    lastSavedSkillId, selectedSavedSkillId,
    savedDeckIds,
    savedDeckSourceMap,
    deckSelection, setDeckSelection,
    handleFileUpload,
    handleAnalyze,
    handleTestDrive,
    handleSaveSelectedSkill,
    handleSaveDeck,
    handleEquipDeck,
    handleEquipSkill,
    updateSelectedSkill,
  };
}
