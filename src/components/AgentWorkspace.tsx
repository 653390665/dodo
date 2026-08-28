import React from 'react';
import {
  Activity,
  Bot,
  Check,
  Brain,
  ChevronDown,
  Eye,
  Globe,
  History,
  Lightbulb,
  ListOrdered,
  MessageSquareWarning,
  MoreHorizontal,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';

import {
  Novel,
  Chapter,
  ChapterMetadata,
  Character,
  Item,
  Location,
  ChapterVersion,
  Skill,
  SkillUsageRecord,
  MountedSkillLoadoutItem,
  ProjectPreferenceProfile,
  ContinuationPack,
  ChapterProductionRun,
  AgentTab,
  CopilotSuggestion,
  CopilotActionKey,
  SniffedEntities,
  EntityRelationship,
  Faction,
  WritingStyleCandidate,
  WritingStyleMode,
  WritingStyleResolution,
  ReviewIssue,
  ViewType,
} from '../../shared/types';
import { cn } from '../lib/utils';
import { IdeaFragmentBoard } from './IdeaFragmentBoard';
import { ForeshadowingPanel } from './ForeshadowingPanel';
import { PacingDashboard } from './PacingDashboard';
import { AgentWorkspaceProductionPanel } from './AgentWorkspaceProductionPanel';
import { AgentWorkspaceKnowledgePanel } from './AgentWorkspaceKnowledgePanel';
import { AgentWorkspaceTracePanel } from './AgentWorkspaceTracePanel';
import { AgentWorkspaceVersionsPanel } from './AgentWorkspaceVersionsPanel';
import { CopilotHomePanel } from './copilot/CopilotHomePanel';
import { RelationshipGraph } from './RelationshipGraph';
import { filterRelationshipsByActiveEntities } from '../lib/relationship-filter';
import { writeContinuationSyncIntent } from '../lib/continuation-sync-intent';
import { recordProductEvent } from '../lib/product-events-client';
import { getNovel } from '../lib/api';
import { normalizeProjectPreferenceProfile } from '../../shared/lib/project-preference-profile';
import { getProjectCapabilityCardIds } from '../lib/capability-card-count';
import { resolveCapabilityDisplayName } from '../lib/capability-stage-cards';
import { ErrorBoundary } from './ErrorBoundary';
import type { AiContentCandidate } from '../lib/generation-action-state';
import { DRAFT_QUALITY_SEMANTIC_LABELS } from '../../shared/lib/quality-contract';
import { MIN_COMPLETE_CHAPTER_CHARS } from '../../shared/lib/draft-quality';

type CandidateQualityStatus = 'eligible' | 'blocked' | 'review-required' | 'fallback';

function getCandidateQualityState(candidate: AiContentCandidate): {
  status: CandidateQualityStatus;
  label: string;
  detail: string;
} {
  const quality = candidate.quality;
  const source = candidate.source;
  if (source === 'fallback') {
    return { status: 'fallback', label: '保底结果', detail: '当前结果来自保底流程，不能冒充模型审阅结果。' };
  }
  if (!quality) {
    return { status: 'review-required', label: '待复核', detail: '尚未取得完整质量报告，暂不能写入。' };
  }
  if (!quality.ok || quality.mechanicalReview?.status === 'needs-action') {
    return { status: 'blocked', label: '质量阻断', detail: '存在硬性或机械质量问题，需精修后重新审阅。' };
  }
  if (candidate.operation === 'rewrite' && candidate.content.replace(/\s/g, '').length < MIN_COMPLETE_CHAPTER_CHARS) {
    return { status: 'eligible', label: '可写入片段', detail: '局部改写通过确定性检查，可写入选区；整章质量仍需单独审阅。' };
  }
  if (quality.semanticReview.status !== 'pass') {
    return { status: 'review-required', label: '待复核', detail: quality.semanticReview.status === 'needs-action' ? '语义审阅发现问题，需处理后重新审阅。' : '语义审阅尚未完成，暂不能确认写入。' };
  }
  return { status: 'eligible', label: '可写入', detail: '硬性、机械和语义审阅均已通过。' };
}

function isProductionAgentTab(
  tab: AgentTab
): tab is Extract<AgentTab, 'production' | 'outline' | 'planning' | 'quality'> {
  return tab === 'production' || tab === 'outline' || tab === 'planning' || tab === 'quality';
}

function isKnowledgeAgentTab(tab: AgentTab): tab is Extract<AgentTab, 'bible' | 'skills'> {
  return tab === 'bible' || tab === 'skills';
}

type MoreMenuItem = readonly [AgentTab, string, React.ElementType];
const MORE_MENU_GROUPS: ReadonlyArray<{ label: string; items: readonly MoreMenuItem[] }> = [
  {
    label: '写前准备',
    items: [
      ['outline', '全书大纲', ListOrdered],
      ['skills', '写法与能力', Wand2],
    ],
  },
  {
    label: '过程管理',
    items: [
      ['pacing', '节奏检查', Activity],
      ['foreshadowing', '故事记忆', Eye],
    ],
  },
  {
    label: '素材与恢复',
    items: [
      ['ideas', '创意草稿箱', Lightbulb],
      ['versions', '章节版本', History],
    ],
  },
];
const MORE_MENU_ITEMS = MORE_MENU_GROUPS.flatMap((group) => group.items);
const GLOBAL_RELATIONSHIP_PREVIEW_LIMIT = 6;

function hashEntityScanInput(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

interface AgentWorkspaceProps {
  novel: Novel;
  chapters: ChapterMetadata[];
  currentChapter: Chapter | null;
  onSelectChapter: (chapter: ChapterMetadata) => void | Promise<void>;
  isAgentSidebarOpen: boolean;
  setIsAgentSidebarOpen: (open: boolean) => void;
  agentTab: AgentTab;
  setAgentTab: (tab: AgentTab) => void;
  copilotSuggestion: CopilotSuggestion | null;
  runCopilotAction: (key: CopilotActionKey) => Promise<void>;
  activeProductionRun: ChapterProductionRun | null;
  productionIntent: string;
  setProductionIntent: (intent: string) => void;
  isProductionRunning: boolean;
  isApplyingProductionRun: boolean;
  productionError: string | null;
  productionBeatsSource?: 'fallback' | 'model' | null;
  productionDraftSource?: 'fallback' | 'model' | null;
  productionAuditSource?: 'fallback' | 'model' | null;
  productionStatusMessage?: string | null;
  continuationPacks: ContinuationPack[];
  selectedContinuationPackId: string;
  setSelectedContinuationPackId: (packId: string) => void;
  onStartProductionRun: () => Promise<void>;
  onStopProductionRun?: () => void;
  onApplyProductionRun: (runOverride?: ChapterProductionRun) => Promise<void>;
  onOpenBibleAssistant?: (prompt: string) => void;
  expectedWordCount: number | '';
  setExpectedWordCount: (count: number | '') => void;
  projectTechniqueId?: string;
  onGenerateOutline: (outline?: string, options?: {
    techniqueId?: string;
    outlineSourceSelection?: {
      continuationPackId: string;
      primaryDocumentId: string;
      referenceDocumentIds: string[];
    };
  }) => Promise<{ candidateId: string; content: string; databaseGeneration: number } | void>;
  onAdoptOutline: (outline: string) => Promise<boolean>;
  onCanonicalOutlineChange?: (outline: string) => void;
  outlineError?: string | null;
  isGeneratingOutline: boolean;
  globalOutline: string;
  onGlobalOutlineChange: (outline: string) => void;
  onGenerateBeats: () => Promise<void>;
  isGeneratingBeats: boolean;
  userIntent: string;
  setUserIntent: (intent: string) => void;
  isGeneratingContent: boolean;
  generationStatus: string | null;
  onGenerateContent: () => Promise<void>;
  onRewriteSelectedText: () => Promise<void>;
  onUpdateChapterBeats: (beats: string) => void;
  onRunAudit: () => Promise<void>;
  isGeneratingCritique: boolean;
  onPolishChapterFromAudit: () => Promise<void>;
  onCreateChapter?: () => Promise<void>;
  characters: Character[];
  locations: Location[];
  items: Item[];
  factions: Faction[];
  librarySkills: Skill[];
  skillUsageRecords: SkillUsageRecord[];
  mountedSkillLoadout: MountedSkillLoadoutItem[];
  pendingSkillIds?: string[];
  onResolvePendingSkill?: (skillId: string, slot: number) => void;
  onAssignSkill: (slot: number, skillId: string) => Promise<void>;
  onRemoveSkill: (slot: number) => Promise<void>;
  projectPreferenceProfile: ProjectPreferenceProfile;
  onPreferenceProfileChange: (profile: ProjectPreferenceProfile) => Promise<void>;
  versions: ChapterVersion[];
  onSaveVersion: (author: 'user' | 'writer-agent') => Promise<void>;
  onRestoreVersion: (version: ChapterVersion) => void;
  isSniffing: boolean;
  sniffedEntities: SniffedEntities | null;
  onSniffEntities: () => Promise<void>;
  onAddSniffedEntity: (ent: { name: string; type: string; context: string }) => Promise<void>;
  addingEntityNames: string[];
  relationships: EntityRelationship[];
  isDocked?: boolean;
  activeEntityNames?: string[];
  contentRef?: React.RefObject<HTMLTextAreaElement | null>;
  skippedAssetIds?: string[];
  stackedDeconstructionCardIds?: string[];
  onStackDeconstructionCard?: (assetId: string) => Promise<void>;
  onUnstackDeconstructionCard?: (assetId: string) => Promise<void>;
  onSkipAsset?: (assetId: string) => Promise<void>;
  onNavigate?: (view: ViewType, context?: { targetChapterId?: string }) => void;
  writingStyleResolution?: WritingStyleResolution | null;
  writingStyleCandidates?: WritingStyleCandidate[];
  onConfirmWritingStyle?: (mode: WritingStyleMode) => Promise<string | void> | string | void;
  onGenerateWithWritingStyle?: (fingerprint?: string) => Promise<void> | void;
  onOpenWritingStyle?: () => void;
  reviewIssues?: ReviewIssue[];
  onPreviewReviewIssue?: (issueId: string) => void | Promise<void>;
  onFixReviewIssues?: (issueIds: string[], scope?: string) => void | Promise<void>;
  onAcceptReviewIssueRisk?: (issueId: string, reason?: string) => void | Promise<void>;
  onDeferReviewIssue?: (issueId: string) => void | Promise<void>;
  aiContentCandidate?: AiContentCandidate | null;
  onAcceptAiContentCandidate?: () => Promise<void>;
  onDiscardAiContentCandidate?: () => void;
  isAcceptingAiContentCandidate?: boolean;
}

export const AgentWorkspace = React.memo(function AgentWorkspace({
  novel,
  chapters,
  currentChapter,
  onSelectChapter,
  isAgentSidebarOpen: _isAgentSidebarOpen,
  setIsAgentSidebarOpen,
  agentTab,
  setAgentTab,
  copilotSuggestion,
  runCopilotAction,
  activeProductionRun,
  productionIntent,
  setProductionIntent,
  isProductionRunning,
  isApplyingProductionRun,
  productionError,
  productionBeatsSource,
  productionDraftSource,
  productionAuditSource,
  productionStatusMessage,
  continuationPacks,
  selectedContinuationPackId,
  setSelectedContinuationPackId,
  onStartProductionRun,
  onStopProductionRun,
  onApplyProductionRun,
  onOpenBibleAssistant,
  expectedWordCount,
  setExpectedWordCount,
  onGenerateOutline,
  projectTechniqueId,
  onAdoptOutline,
  onCanonicalOutlineChange,
  outlineError,
  isGeneratingOutline,
  globalOutline,
  onGlobalOutlineChange,
  onGenerateBeats,
  isGeneratingBeats,
  userIntent,
  setUserIntent,
  isGeneratingContent,
  generationStatus,
  onGenerateContent,
  onRewriteSelectedText,
  onUpdateChapterBeats,
  onRunAudit,
  isGeneratingCritique,
  onPolishChapterFromAudit,
  onCreateChapter,
  characters,
  locations,
  items,
  librarySkills,
  skillUsageRecords,
  mountedSkillLoadout,
  pendingSkillIds,
  onResolvePendingSkill,
  onAssignSkill,
  onRemoveSkill,
  projectPreferenceProfile,
  onPreferenceProfileChange,
  versions,
  onSaveVersion,
  onRestoreVersion,
  isSniffing,
  sniffedEntities,
  onSniffEntities,
  onAddSniffedEntity,
  addingEntityNames,
  relationships,
  isDocked = false,
  activeEntityNames: propActiveEntityNames,
  contentRef,
  factions,
  skippedAssetIds,
  stackedDeconstructionCardIds,
  onStackDeconstructionCard,
  onUnstackDeconstructionCard,
  onSkipAsset,
  onNavigate,
  writingStyleResolution,
  writingStyleCandidates,
  onConfirmWritingStyle,
  onGenerateWithWritingStyle,
  onOpenWritingStyle,
  reviewIssues,
  onPreviewReviewIssue,
  onFixReviewIssues,
  onAcceptReviewIssueRisk,
  onDeferReviewIssue,
  aiContentCandidate,
  onAcceptAiContentCandidate,
  onDiscardAiContentCandidate,
  isAcceptingAiContentCandidate = false,
}: AgentWorkspaceProps) {
  const [bibleSearch, setBibleSearch] = React.useState('');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = React.useState(false);
  const [skillsPanelRevision, setSkillsPanelRevision] = React.useState(0);
  const [skillsProfileOverride, setSkillsProfileOverride] = React.useState<ProjectPreferenceProfile | null>(null);
  const skillsPanelContextRef = React.useRef('');
  const skillsPanelRequestRef = React.useRef(0);
  const moreMenuRef = React.useRef<HTMLDivElement>(null);

  skillsPanelContextRef.current = `${novel.id}:${currentChapter?.id || ''}`;

  React.useEffect(() => {
    setSkillsProfileOverride(null);
  }, [novel.id]);

  const profileForSkills = skillsProfileOverride || projectPreferenceProfile;

  const reloadWritingProfile = React.useCallback(async () => {
    const requestContext = `${novel.id}:${currentChapter?.id || ''}`;
    const requestId = skillsPanelRequestRef.current + 1;
    skillsPanelRequestRef.current = requestId;
    try {
      const freshNovel = await getNovel(novel.id);
      if (skillsPanelContextRef.current !== requestContext || skillsPanelRequestRef.current !== requestId) return;
      setSkillsProfileOverride(normalizeProjectPreferenceProfile(freshNovel?.projectPreferenceProfile));
      setSkillsPanelRevision((revision) => revision + 1);
      void recordProductEvent({
        eventName: 'writing_style_panel_recovered',
        stage: 'drafting',
        result: 'success',
        novelId: novel.id,
        chapterId: currentChapter?.id,
      });
    } catch {
      if (skillsPanelContextRef.current !== requestContext || skillsPanelRequestRef.current !== requestId) return;
      // Keep the current profile when the refresh request is unavailable.
      void recordProductEvent({
        eventName: 'writing_style_panel_error',
        stage: 'drafting',
        result: 'failure',
        novelId: novel.id,
        chapterId: currentChapter?.id,
        errorCode: 'WRITING_STYLE_PROFILE_REFRESH_FAILED',
      });
    }
  }, [currentChapter?.id, novel.id]);

  React.useEffect(() => {
    if (agentTab !== 'skills') return;
    void recordProductEvent({
      eventName: 'writing_style_panel_opened',
      stage: 'drafting',
      result: 'success',
      novelId: novel.id,
      chapterId: currentChapter?.id,
    });
  }, [agentTab, currentChapter?.id, novel.id]);

  const [localActiveEntityNames, setLocalActiveEntityNames] = React.useState<string[]>([]);
  const lastEntityScanHashRef = React.useRef('');
  const [selection, setSelection] = React.useState({ start: -1, end: -1 });
  const approvedContinuationPack = React.useMemo(
    () =>
      continuationPacks.find(
        (pack) => pack.id === selectedContinuationPackId && pack.status === 'approved'
      ) || continuationPacks.find((pack) => pack.status === 'approved'),
    [continuationPacks, selectedContinuationPackId]
  );

  React.useEffect(() => {
    const textarea = contentRef?.current;
    if (!textarea) return;
    const updateSelection = () =>
      setSelection({ start: textarea.selectionStart, end: textarea.selectionEnd });
    updateSelection();
    textarea.addEventListener('select', updateSelection);
    textarea.addEventListener('keyup', updateSelection);
    textarea.addEventListener('mouseup', updateSelection);
    return () => {
      textarea.removeEventListener('select', updateSelection);
      textarea.removeEventListener('keyup', updateSelection);
      textarea.removeEventListener('mouseup', updateSelection);
    };
  }, [contentRef, currentChapter?.id]);

  const entityScanHash = React.useMemo(
    () =>
      hashEntityScanInput(
        [
          currentChapter?.id || '',
          currentChapter?.content || '',
          String(selection.start),
          String(selection.end),
          ...characters.map((entity) => entity.name),
          ...locations.map((entity) => entity.name),
          ...items.map((entity) => entity.name),
          ...factions.map((entity) => entity.name),
        ].join('\u0000')
      ),
    [currentChapter?.id, currentChapter?.content, characters, locations, items, factions, selection]
  );

  React.useEffect(() => {
    if (lastEntityScanHashRef.current === entityScanHash) return;
    const timer = setTimeout(() => {
      lastEntityScanHashRef.current = entityScanHash;
      if (!currentChapter || !currentChapter.content) {
        setLocalActiveEntityNames([]);
        return;
      }

      const fullText = currentChapter.content;
      let textToScan = fullText;
      const textarea = contentRef?.current;
      if (textarea) {
        const cursor = textarea.selectionStart || 0;
        const minIdx = Math.max(0, cursor - 1500);
        const maxIdx = Math.min(fullText.length, cursor + 500);
        textToScan = fullText.substring(minIdx, maxIdx);
      }

      const matched: string[] = [];

      characters.forEach((c) => {
        if (c.name && textToScan.includes(c.name)) {
          matched.push(c.name);
        }
      });
      locations.forEach((l) => {
        if (l.name && textToScan.includes(l.name)) {
          matched.push(l.name);
        }
      });
      items.forEach((i) => {
        if (i.name && textToScan.includes(i.name)) {
          matched.push(i.name);
        }
      });
      factions.forEach((f) => {
        if (f.name && textToScan.includes(f.name)) {
          matched.push(f.name);
        }
      });

      setLocalActiveEntityNames(matched);
    }, 400);

    return () => clearTimeout(timer);
  }, [entityScanHash, currentChapter, characters, locations, items, factions, contentRef]);

  const activeEntityNames = propActiveEntityNames ?? localActiveEntityNames;
  const activeMoreItem = MORE_MENU_ITEMS.find(([tab]) => tab === agentTab);

  React.useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) setIsMoreMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMoreMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMoreMenuOpen]);

  const filteredRelationships = React.useMemo(() => {
    return filterRelationshipsByActiveEntities(
      relationships,
      activeEntityNames,
      characters,
      locations,
      items,
      factions
    );
  }, [relationships, activeEntityNames, characters, locations, items, factions]);
  const showingGlobalRelationships = filteredRelationships.length === 0 && relationships.length > 0;
  const displayedRelationships = showingGlobalRelationships
    ? relationships.slice(0, GLOBAL_RELATIONSHIP_PREVIEW_LIMIT)
    : filteredRelationships;
  const projectCapabilityCardIds = React.useMemo(
    () => getProjectCapabilityCardIds(novel, mountedSkillLoadout),
    [mountedSkillLoadout, novel]
  );
  const navigateToWorldBible = (tab = 'graph') => {
    try {
      localStorage.setItem('inkflow-world-bible-active-tab', tab);
    } catch {}
    if (onNavigate) {
      onNavigate('world');
    } else {
      setAgentTab('bible');
    }
  };

  const matchedEntities = React.useMemo(() => {
    if (!activeEntityNames || activeEntityNames.length === 0) return [];
    const list: Array<{ id: string; name: string; typeLabel: string; description: string }> = [];

    characters.forEach((c) => {
      if (activeEntityNames.includes(c.name)) {
        list.push({
          id: c.id,
          name: c.name,
          typeLabel: '角色',
          description: c.summary || c.bio || '',
        });
      }
    });
    locations.forEach((l) => {
      if (activeEntityNames.includes(l.name)) {
        list.push({ id: l.id, name: l.name, typeLabel: '地点', description: l.description || '' });
      }
    });
    items.forEach((i) => {
      if (activeEntityNames.includes(i.name)) {
        list.push({ id: i.id, name: i.name, typeLabel: '道具', description: i.description || '' });
      }
    });
    factions.forEach((f) => {
      if (activeEntityNames.includes(f.name)) {
        list.push({ id: f.id, name: f.name, typeLabel: '势力', description: f.description || '' });
      }
    });

    return list;
  }, [activeEntityNames, characters, locations, items, factions]);

  return (
    <div
      data-testid="agent-workspace"
      role="complementary"
      aria-label="智能管家"
      className={cn(
        'flex min-h-0 flex-col border-theme-border bg-theme-sidebar shrink-0 overflow-hidden relative',
        isDocked
          ? 'md:w-[360px] md:h-full md:border-l md:relative max-md:absolute max-md:inset-y-3 max-md:right-3 max-md:w-[min(360px,calc(100%-1.5rem))] max-md:rounded-3xl max-md:border max-md:z-30 max-md:bg-theme-sidebar/95 max-md:shadow-2xl max-md:backdrop-blur-sm'
          : 'absolute inset-y-3 right-3 w-[min(400px,calc(100%-1.5rem))] rounded-3xl border bg-theme-sidebar/95 z-30 backdrop-blur-sm shadow-2xl'
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-theme-border bg-theme-sidebar/90 shrink-0">
        <div>
          <div className="text-xs font-bold text-theme-text">智能管家工作台</div>
          <div className="text-[10px] text-theme-muted mt-1">需要时展开，用完即可随手收回。</div>
        </div>
        <button
          type="button"
          onClick={() => setIsAgentSidebarOpen(false)}
          aria-label="收起智能管家"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-theme-border bg-theme-sidebar text-theme-text text-[11px] font-bold hover:bg-theme-sidebar/40 transition-colors"
        >
          <X size={12} />
          收起
        </button>
      </div>

      {/* Tabs — grouped by writing phase */}
      <div className="grid shrink-0 grid-cols-3 gap-1 border-b border-theme-border bg-transparent p-3">
        <button
          type="button"
          aria-pressed={agentTab === 'context' || agentTab === 'copilot-home'}
          onClick={() => setAgentTab('context')}
          className={cn(
            'min-w-0 py-1.5 px-2 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1',
            agentTab === 'context' || agentTab === 'copilot-home'
              ? 'bg-theme-text text-white'
              : 'text-theme-muted hover:bg-theme-sidebar hover:text-theme-text'
          )}
        >
          <Brain size={11} /> <span className="truncate">当前</span>
        </button>
        <button
          type="button"
          aria-pressed={agentTab === 'planning'}
          onClick={() => setAgentTab('planning')}
          className={cn(
            'min-w-0 py-1.5 px-2 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1',
            agentTab === 'planning'
              ? 'bg-theme-text text-white'
              : 'text-theme-muted hover:bg-theme-sidebar hover:text-theme-text'
          )}
        >
          <ListOrdered size={11} /> <span className="truncate">分镜</span>
        </button>
        <button
          type="button"
          aria-pressed={agentTab === 'production'}
          onClick={() => setAgentTab('production')}
          className={cn(
            'min-w-0 py-1.5 px-2 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1',
            agentTab === 'production'
              ? 'bg-theme-text text-white'
              : 'text-theme-muted hover:bg-theme-sidebar hover:text-theme-text'
          )}
        >
          <Sparkles size={11} /> <span className="truncate">生成正文</span>
        </button>
        <button
          type="button"
          aria-pressed={agentTab === 'quality'}
          onClick={() => setAgentTab('quality')}
          className={cn(
            'min-w-0 py-1.5 px-2 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1',
            agentTab === 'quality'
              ? 'bg-theme-text text-white'
              : 'text-theme-muted hover:bg-theme-sidebar hover:text-theme-text'
          )}
        >
          <MessageSquareWarning size={11} /> <span className="truncate">审稿</span>
        </button>
        <button
          type="button"
          aria-pressed={agentTab === 'bible' || agentTab === 'trace'}
          onClick={() => setAgentTab('bible')}
          className={cn(
            'min-w-0 py-1.5 px-2 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1',
            agentTab === 'bible' || agentTab === 'trace'
              ? 'bg-theme-text text-white'
              : 'text-theme-muted hover:bg-theme-sidebar hover:text-theme-text'
          )}
        >
          <Globe size={11} /> <span className="truncate">查设定</span>
        </button>
        <div ref={moreMenuRef} className="relative min-w-0">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={isMoreMenuOpen}
            aria-pressed={Boolean(activeMoreItem)}
            onClick={() => setIsMoreMenuOpen((open) => !open)}
            className={cn(
              'w-full min-w-0 py-1.5 px-2 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1',
              isMoreMenuOpen || activeMoreItem
                ? 'bg-theme-text text-white'
                : 'text-theme-muted hover:bg-theme-sidebar hover:text-theme-text'
            )}
          >
            <MoreHorizontal size={11} /> <span>{activeMoreItem?.[1] || '更多'}</span>
            <ChevronDown size={10} />
          </button>
          {isMoreMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1 min-w-[140px] rounded-xl border border-theme-border bg-theme-sidebar p-1 shadow-xl"
            >
              {MORE_MENU_GROUPS.map((group) => (
                <div key={group.label} role="group" aria-label={group.label}>
                  <div className="px-3 py-1.5 text-[9px] font-bold text-theme-muted">
                    {group.label}
                  </div>
                  {group.items.map(([tab, label, Icon]) => (
                    <button
                      key={tab}
                      type="button"
                      role="menuitem"
                      aria-current={agentTab === tab ? 'page' : undefined}
                      onClick={() => {
                        setAgentTab(tab);
                        setIsMoreMenuOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[11px] text-theme-text hover:bg-theme-border/30',
                        agentTab === tab && 'bg-theme-border/30'
                      )}
                    >
                      <Icon size={12} /> {label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {aiContentCandidate && aiContentCandidate.chapterId === currentChapter?.id ? (
        <section aria-label="智能管家正文候选" className="shrink-0 border-b border-theme-accent/30 bg-theme-accent/5 px-4 py-3">
          {(() => {
            const qualityState = getCandidateQualityState(aiContentCandidate);
            const canAccept = qualityState.status === 'eligible';
            const canPolish = qualityState.status !== 'eligible';
            return (
              <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-theme-text">正文候选待确认</span>
            <span className="min-w-0 flex-1 text-theme-muted">当前正文尚未修改，确认后才会写入。</span>
            <span className={qualityState.status === 'eligible' ? 'rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700' : qualityState.status === 'fallback' ? 'rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700' : 'rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700'} role="status">{qualityState.label}</span>
            <span className="basis-full text-[10px] text-theme-muted">{qualityState.detail}</span>
            {aiContentCandidate.quality?.semanticReview.status === 'unknown' ? (
              <span className="basis-full text-[10px] text-amber-700" role="status">
                硬性格式检查已通过；人物、世界规则和章节目标仍需语义审阅。
              </span>
            ) : null}
            {aiContentCandidate.quality && aiContentCandidate.quality.findings.some((finding) => finding.severity === 'P2') ? (
              <span className="basis-full text-[10px] text-amber-700" role="status">
                还有 {aiContentCandidate.quality.findings.filter((finding) => finding.severity === 'P2').length} 项文风建议，可在审稿后精修。
              </span>
            ) : null}
            {aiContentCandidate.quality?.mechanicalReview?.status === 'needs-action' ? (
              <span className="basis-full text-[10px] text-red-700" role="alert">
                机械审查 {aiContentCandidate.quality.mechanicalReview.score.toFixed(1)}/{aiContentCandidate.quality.mechanicalReview.threshold}：{aiContentCandidate.quality.mechanicalReview.summary}，需精修后才能写入。
              </span>
            ) : null}
            {aiContentCandidate.quality?.semanticReview ? (
              <details className="basis-full rounded border border-theme-border/70 bg-theme-sidebar/50 px-2 py-1">
                <summary className="cursor-pointer text-[10px] font-semibold text-theme-text">
                  语义审阅：{aiContentCandidate.quality.semanticReview.status === 'pass' ? '已通过' : aiContentCandidate.quality.semanticReview.status === 'needs-action' ? '需要处理' : '尚未运行'}
                </summary>
                <ul className="mt-1 grid gap-1 text-[10px] text-theme-muted sm:grid-cols-2">
                  {aiContentCandidate.quality.semanticReview.checks.map((check) => (
                    <li key={check.id} className={check.status === 'needs-action' ? 'text-amber-700' : undefined}>
                      <div>{DRAFT_QUALITY_SEMANTIC_LABELS[check.id]}：{check.status === 'pass' ? '通过' : check.status === 'needs-action' ? '需处理' : '未知'}。{check.reason}</div>
                      {check.evidence?.map((evidence) => (
                        <div key={`${check.id}:${evidence.quote}`} className="mt-1 border-l-2 border-theme-border pl-2 text-[10px] text-theme-muted">
                          “{evidence.quote}”{evidence.location ? `（${evidence.location}）` : ''}：{evidence.explanation} 建议：{evidence.suggestedFix}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {aiContentCandidate.quality?.findings.length ? (
              <details className="basis-full rounded border border-theme-border/70 bg-theme-sidebar/50 px-2 py-1">
                <summary className="cursor-pointer text-[10px] font-semibold text-theme-text">硬性检查证据（{aiContentCandidate.quality.findings.length}）</summary>
                <ul className="mt-1 grid gap-1 text-[10px] text-theme-muted">
                  {aiContentCandidate.quality.findings.map((finding) => (
                    <li key={finding.code}>
                      <div>[{finding.severity}] {finding.message}</div>
                      {finding.evidence?.map((evidence, index) => (
                        <div key={`${finding.code}:${index}`} className="mt-1 border-l-2 border-theme-border pl-2 text-theme-muted">
                          {evidence.line ? `第 ${evidence.line} 行：` : ''}“{evidence.snippet}”{evidence.suggestion ? ` 建议：${evidence.suggestion}` : ''}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <button
              type="button"
              disabled={isAcceptingAiContentCandidate || !canAccept}
              onClick={() => {
                const pending = onAcceptAiContentCandidate?.();
                if (pending) void pending.catch(() => undefined);
              }}
              className="inline-flex h-7 items-center gap-1 border border-theme-accent px-2 font-bold text-theme-text hover:bg-theme-accent/10 disabled:opacity-50"
            >
              <Check size={13} aria-hidden="true" />接受并写入
            </button>
            {canPolish ? (
              <button
                type="button"
                disabled={isAcceptingAiContentCandidate}
                onClick={() => {
                  const issueIds = aiContentCandidate.reviewIssueIds || [];
                  const pending = issueIds.length && onFixReviewIssues
                    ? onFixReviewIssues(issueIds, '本章')
                    : onPolishChapterFromAudit?.();
                  if (pending) void Promise.resolve(pending).catch(() => undefined);
                }}
                className="inline-flex h-7 items-center border border-theme-accent px-2 text-theme-accent hover:bg-theme-accent/10 disabled:opacity-50"
              >
                {qualityState.status === 'fallback' ? '重新审阅' : '前往精修'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={isAcceptingAiContentCandidate}
              onClick={onDiscardAiContentCandidate}
              className="inline-flex h-7 items-center border border-theme-border px-2 text-theme-muted hover:bg-theme-border/30 disabled:opacity-50"
            >
              放弃预览
            </button>
          </div>
          <details className="mt-2 rounded-lg border border-theme-border/70 bg-theme-sidebar/60">
            <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-semibold text-theme-text">查看候选正文预览</summary>
            <div role="region" aria-label="智能管家正文候选预览" className="grid max-h-64 gap-2 overflow-y-auto border-t border-theme-border/60 p-2 text-[11px] leading-5 md:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-1 font-bold text-theme-muted">当前正文（未修改）</div>
                <pre className="whitespace-pre-wrap break-words font-sans text-theme-muted">{aiContentCandidate.baselineContent}</pre>
              </div>
              <div className="min-w-0">
                <div className="mb-1 font-bold text-theme-text">候选正文</div>
                <pre className="whitespace-pre-wrap break-words font-sans text-theme-text">{aiContentCandidate.content}</pre>
              </div>
            </div>
          </details>
              </>
            );
          })()}
        </section>
      ) : null}

      {/* Content */}
      <div
        data-testid="agent-workspace-scroll-region"
        className="min-h-0 flex-1 overflow-y-auto p-5 scroll-smooth"
      >
        {agentTab === 'context' &&
          (!currentChapter ? (
            <div className="bg-theme-sidebar/40 p-5 rounded-xl border border-theme-border/40 shadow-sm text-left space-y-4">
              <div className="text-xs font-bold text-theme-text flex items-center gap-1.5 justify-start">
                <Activity size={12} className="text-theme-accent" />
                创作启动 Checklist
              </div>
              <p className="text-[11px] text-theme-muted leading-relaxed">
                您目前没有打开任何章节。请按照以下步骤启动本章创作：
              </p>
              <div className="space-y-4 pt-2">
                <div className="flex items-start gap-2 text-[11px]">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-theme-accent/10 text-theme-accent font-bold text-[9px] mt-0.5">
                    1
                  </span>
                  <div>
                    <span className="font-bold text-theme-text block">新建章节</span>
                    <span className="text-theme-muted text-[10px] block mt-0.5">
                      在左侧目录栏点击「新建章节」按钮，建立当前写作条目。
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-[11px]">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-theme-accent/10 text-theme-accent font-bold text-[9px] mt-0.5">
                    2
                  </span>
                  <div>
                    <span className="font-bold text-theme-text block">生成分镜 Beats</span>
                    <span className="text-theme-muted text-[10px] block mt-0.5">
                      前往「大纲」或「分镜」模块生成本章的分镜动作与目标，提供大纲牵引。
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-[11px]">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-theme-accent/10 text-theme-accent font-bold text-[9px] mt-0.5">
                    3
                  </span>
                  <div>
                    <span className="font-bold text-theme-text block">补充设定与角色</span>
                    <span className="text-theme-muted text-[10px] block mt-0.5">
                      在「设定集」录入即将登场的主角与场景背景，有助于关系网图谱在写作时识别并高亮。
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-[11px]">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-theme-accent/10 text-theme-accent font-bold text-[9px] mt-0.5">
                    4
                  </span>
                  <div>
                    <span className="font-bold text-theme-text block">确认本章写法</span>
                    <span className="text-theme-muted text-[10px] block mt-0.5">
                      在生成正文前核对当前写法与本章使用卡，必要时前往作品能力中心调整长期配置。
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div key="context" className="space-y-4 pb-8 text-left">
              {/* 1. 当前分镜 Beats */}
              <div className="bg-theme-sidebar/40 p-4 rounded-xl border border-theme-border/40 shadow-sm text-left">
                <div className="text-xs font-bold text-theme-text mb-2 flex items-center gap-1.5 justify-start">
                  <Activity size={12} className="text-theme-accent" />
                  当前章分镜 Beats
                </div>
                {currentChapter?.sceneBeats ? (
                  <div className="text-[11px] text-theme-muted/90 leading-relaxed whitespace-pre-wrap font-serif">
                    {currentChapter.sceneBeats}
                  </div>
                ) : (
                  <div className="text-[11px] text-theme-muted/50 italic">
                    暂无本章分镜。可前往「大纲」或「分镜」生成。
                  </div>
                )}
              </div>

              {/* 2. 当前场景图谱 */}
              <div className="bg-theme-sidebar/40 p-4 rounded-xl border border-theme-border/40 shadow-sm space-y-2 text-left">
                <div className="text-xs font-bold text-theme-text flex items-center justify-between">
                  <div className="flex items-center gap-1.5 justify-start">
                    <Globe size={12} className="text-theme-accent" />
                    {showingGlobalRelationships ? '作品全局关系预览' : '当前场景上下文图谱'}
                  </div>
                  <div className="text-[9px] bg-theme-border/30 text-theme-muted px-1.5 py-0.5 rounded font-mono">
                    {showingGlobalRelationships
                      ? `预览: ${displayedRelationships.length} / ${relationships.length}`
                      : `匹配实体: ${activeEntityNames?.length || 0}`}
                  </div>
                </div>

                {showingGlobalRelationships && (
                  <div className="text-[10px] text-theme-muted/80 leading-relaxed">
                    本章正文暂未命中关系，先展示 {displayedRelationships.length} 条作品全局关系
                  </div>
                )}

                <RelationshipGraph
                  relationships={displayedRelationships}
                  characters={characters}
                  locations={locations}
                  items={items}
                  factions={factions}
                  totalEntities={
                    characters.length + locations.length + items.length + factions.length
                  }
                  onSelectEntity={() => {}}
                  activeEntityNames={activeEntityNames}
                  onGoToWorldBible={navigateToWorldBible}
                  onSyncFromContinuationPack={
                    approvedContinuationPack
                      ? () => {
                          try {
                            localStorage.setItem(
                              'inkflow-world-bible-active-tab',
                              'pack-management'
                            );
                          } catch {}
                          writeContinuationSyncIntent({
                            intentId: '',
                            createdAt: 0,
                            novelId: novel.id,
                            packId: approvedContinuationPack.id,
                          });
                          if (onNavigate) onNavigate('world');
                          else setAgentTab('bible');
                        }
                      : undefined
                  }
                  hasGlobalRelationships={relationships.length > 0}
                />
                {showingGlobalRelationships && (
                  <button
                    type="button"
                    onClick={() => navigateToWorldBible('graph')}
                    className="w-full rounded-lg border border-theme-border/60 px-3 py-2 text-[10px] font-bold text-theme-muted hover:bg-theme-border/20 transition-colors"
                  >
                    查看完整关系图
                  </button>
                )}
              </div>

              {/* 3. 出场实体卡片 */}
              <div className="space-y-2 text-left">
                <div className="text-xs font-bold text-theme-text flex items-center gap-1.5 justify-start">
                  <Bot size={12} className="text-theme-accent" />
                  出场设定详情
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {matchedEntities.map((ent) => (
                    <div
                      key={ent.id}
                      className="bg-theme-sidebar p-3 rounded-xl border border-theme-border/30 text-left"
                    >
                      <div className="flex items-center gap-2 mb-1 justify-start">
                        <span className="text-xs font-bold text-theme-text">{ent.name}</span>
                        <span className="text-[9px] px-1.5 py-0.2 bg-theme-border/40 text-theme-muted rounded">
                          {ent.typeLabel}
                        </span>
                      </div>
                      {ent.description && (
                        <p className="text-[11px] text-theme-muted leading-relaxed line-clamp-3">
                          {ent.description}
                        </p>
                      )}
                    </div>
                  ))}
                  {matchedEntities.length === 0 && (
                    <div className="text-center py-4 text-[11px] text-theme-muted/50 border border-dashed border-theme-border/50 rounded-xl">
                      正文中未检测到已登记的设定实体。在左侧键入人名/地名即可自动识别。
                    </div>
                  )}
                </div>
              </div>

              {/* 4. 作品默认能力卡与伏笔参考 */}
              <div className="grid grid-cols-2 gap-2 text-left">
                <div className="bg-theme-sidebar/40 p-3 rounded-xl border border-theme-border/40 shadow-sm text-left">
                  <div className="text-[10px] font-bold text-theme-text mb-1.5">
                    作品默认能力卡 ({projectCapabilityCardIds.length})
                  </div>
                  <div className="space-y-1">
                    {projectCapabilityCardIds.map((skillId) => {
                      const skillName = resolveCapabilityDisplayName(skillId, librarySkills);
                      return (
                        <div key={skillId} className="text-[10px] text-theme-muted truncate">
                          • {skillName}
                        </div>
                      );
                    })}
                    {projectCapabilityCardIds.length === 0 && (
                      <div className="text-[10px] text-theme-muted/60 italic">使用系统默认写法</div>
                    )}
                  </div>
                </div>

                <div className="bg-theme-sidebar/40 p-3 rounded-xl border border-theme-border/40 shadow-sm text-left">
                  <div className="text-[10px] font-bold text-theme-text mb-1.5">字数篇幅提示</div>
                  <div className="text-[10px] text-theme-muted leading-relaxed">
                    {currentChapter &&
                    currentChapter.content &&
                    currentChapter.content.length > 2000 ? (
                      <span className="text-yellow-600 font-medium">
                        ⚠️ 本章篇幅较长，建议适时收尾并开启新章。
                      </span>
                    ) : (
                      <span className="text-green-600 font-medium">
                        ✅ 本章篇幅适中，适合继续创作。
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        {agentTab === 'copilot-home' && (
          <div key="copilot-home">
            {copilotSuggestion ? (
              <CopilotHomePanel
                suggestion={copilotSuggestion}
                onAction={(key) => void runCopilotAction(key)}
              />
            ) : (
              <div className="text-center py-12 text-theme-muted text-xs">暂无智能建议</div>
            )}
          </div>
        )}
        {isProductionAgentTab(agentTab) && (
          <div key={agentTab}>
            <AgentWorkspaceProductionPanel
              agentTab={agentTab}
              novel={novel}
              chapters={chapters}
              currentChapter={currentChapter}
              onSelectChapter={onSelectChapter}
              activeProductionRun={activeProductionRun}
              productionIntent={productionIntent}
              setProductionIntent={setProductionIntent}
              isProductionRunning={isProductionRunning}
              isApplyingProductionRun={isApplyingProductionRun}
              productionError={productionError}
              productionBeatsSource={productionBeatsSource}
              productionDraftSource={productionDraftSource}
              productionAuditSource={productionAuditSource}
              productionStatusMessage={productionStatusMessage}
              continuationPacks={continuationPacks}
              selectedContinuationPackId={selectedContinuationPackId}
              setSelectedContinuationPackId={setSelectedContinuationPackId}
              onStartProductionRun={onStartProductionRun}
              onStopProductionRun={onStopProductionRun}
              onApplyProductionRun={onApplyProductionRun}
              onOpenBibleAssistant={onOpenBibleAssistant}
              expectedWordCount={expectedWordCount}
              setExpectedWordCount={setExpectedWordCount}
              projectTechniqueId={projectTechniqueId}
              onGenerateOutline={onGenerateOutline}
              onAdoptOutline={onAdoptOutline}
              onCanonicalOutlineChange={onCanonicalOutlineChange}
              outlineError={outlineError}
              isGeneratingOutline={isGeneratingOutline}
              globalOutline={globalOutline}
              onGlobalOutlineChange={onGlobalOutlineChange}
              onGenerateBeats={onGenerateBeats}
              isGeneratingBeats={isGeneratingBeats}
              userIntent={userIntent}
              setUserIntent={setUserIntent}
              isGeneratingContent={isGeneratingContent}
              generationStatus={generationStatus}
              onGenerateContent={async () => {
                setIsAgentSidebarOpen(false);
                requestAnimationFrame(() => {
                  document.querySelector<HTMLTextAreaElement>('.writing-surface')?.focus();
                });
                await onGenerateContent();
              }}
              onRewriteSelectedText={onRewriteSelectedText}
              onUpdateChapterBeats={onUpdateChapterBeats}
              onRunAudit={onRunAudit}
              isGeneratingCritique={isGeneratingCritique}
              onPolishChapterFromAudit={onPolishChapterFromAudit}
              onCreateChapter={onCreateChapter}
              mountedSkillLoadout={mountedSkillLoadout}
              librarySkills={librarySkills}
              relationships={relationships}
              characters={characters}
              locations={locations}
              items={items}
              factions={factions}
              skippedAssetIds={skippedAssetIds}
              stackedDeconstructionCardIds={stackedDeconstructionCardIds}
              onStackDeconstructionCard={onStackDeconstructionCard}
              onUnstackDeconstructionCard={onUnstackDeconstructionCard}
              onSkipAsset={onSkipAsset}
              onSwitchTab={setAgentTab}
              projectPreferenceProfile={projectPreferenceProfile}
              onPreferenceProfileChange={onPreferenceProfileChange}
              writingStyleResolution={writingStyleResolution}
              writingStyleCandidates={writingStyleCandidates}
              onConfirmWritingStyle={onConfirmWritingStyle}
              onGenerateWithWritingStyle={onGenerateWithWritingStyle}
              onOpenWritingStyle={onOpenWritingStyle}
              reviewIssues={reviewIssues}
              onPreviewReviewIssue={onPreviewReviewIssue}
              onFixReviewIssues={onFixReviewIssues}
              onAcceptReviewIssueRisk={onAcceptReviewIssueRisk}
              onDeferReviewIssue={onDeferReviewIssue}
            />
          </div>
        )}
        {agentTab === 'ideas' && (
          <div key="ideas">
            <IdeaFragmentBoard novelId={novel.id} compact />
          </div>
        )}
        {agentTab === 'foreshadowing' && (
          <div key="foreshadowing">
            <ForeshadowingPanel novelId={novel.id} currentChapterId={currentChapter?.id} />
          </div>
        )}
        {agentTab === 'pacing' && (
          <div key="pacing">
            <PacingDashboard novelId={novel.id} />
          </div>
        )}
        {isKnowledgeAgentTab(agentTab) && (
          <div key={agentTab}>
            <ErrorBoundary
              key={`knowledge-panel-${agentTab}-${agentTab === 'skills' ? skillsPanelRevision : 0}`}
              onError={agentTab === 'skills' ? () => {
                void recordProductEvent({
                  eventName: 'writing_style_panel_error',
                  stage: 'drafting',
                  result: 'failure',
                  novelId: novel.id,
                  chapterId: currentChapter?.id,
                  errorCode: 'WRITING_STYLE_PANEL_RENDER_FAILED',
                });
              } : undefined}
              fallback={agentTab === 'skills' ? (
                <div role="alert" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900">
                  <p>写法面板暂时不可用，正文仍可继续编辑。</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void reloadWritingProfile()}
                      className="rounded-lg border border-amber-400 px-3 py-1.5 font-semibold"
                    >
                      重新读取写法画像
                    </button>
                    <button
                      type="button"
                      onClick={() => setAgentTab('production')}
                      className="rounded-lg border border-theme-border px-3 py-1.5 font-semibold text-theme-text"
                    >
                      返回写作
                    </button>
                  </div>
                </div>
              ) : undefined}
            >
              <AgentWorkspaceKnowledgePanel
                agentTab={agentTab}
                novel={novel}
                currentChapter={currentChapter}
                bibleSearch={bibleSearch}
                setBibleSearch={setBibleSearch}
                characters={characters}
                locations={locations}
                items={items}
                continuationPacks={continuationPacks}
                selectedContinuationPackId={selectedContinuationPackId}
                librarySkills={librarySkills}
                skillUsageRecords={skillUsageRecords}
                mountedSkillLoadout={mountedSkillLoadout}
                pendingSkillIds={pendingSkillIds}
                onResolvePendingSkill={onResolvePendingSkill}
                onAssignSkill={onAssignSkill}
                onRemoveSkill={onRemoveSkill}
                projectPreferenceProfile={profileForSkills}
                onPreferenceProfileChange={onPreferenceProfileChange}
                onOpenTrace={() => setAgentTab('trace')}
                onOpenCapabilityCenter={() => {
                  if (currentChapter?.id) {
                    onNavigate?.('skills', { targetChapterId: currentChapter.id });
                    return;
                  }
                  onNavigate?.('skills');
                }}
              />
            </ErrorBoundary>
          </div>
        )}
        {agentTab === 'versions' && (
          <div key="versions">
            <AgentWorkspaceVersionsPanel
              currentChapter={currentChapter}
              versions={versions}
              onSaveVersion={onSaveVersion}
              onRestoreVersion={onRestoreVersion}
            />
          </div>
        )}
        {agentTab === 'trace' && (
          <div key="trace">
            <AgentWorkspaceTracePanel
              currentChapter={currentChapter}
              isSniffing={isSniffing}
              sniffedEntities={sniffedEntities}
              onSniffEntities={onSniffEntities}
              onAddSniffedEntity={onAddSniffedEntity}
              addingEntityNames={addingEntityNames}
            />
          </div>
        )}
      </div>
    </div>
  );
});
