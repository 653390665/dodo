import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import {
  BrainCircuit,
  CheckCircle2,
  PenLine,
  Sparkles,
  Wand2,
  X,
  ShieldAlert,
  ArrowDown,
  Lock,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { logger } from '../lib/client-logger';
import {
  extractUnresolvedTechniqueIds,
  stripUnresolvedTechniqueRefs,
} from '../lib/capability-technique-cleanup';
import { CAPABILITY_SYMPTOMS, filterBySymptom } from '../lib/capability-symptoms';
import { detectStationConflicts, getCraftSignature } from '../lib/capability-craft';
import { listNovels } from '../lib/novel-client';
import { deleteSkill, syncSkillFeedbackScores, createSkill } from '../lib/skill-client';
import { Skill, Novel, ViewType, ProjectCapabilityProfile } from '../../shared/types';
import { SkillCard } from './skills/SkillCard';
import { SkillDetailDrawer } from './skills/SkillDetailDrawer';
import { SkillMapPanel } from './skills/SkillMapPanel';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './ui/alert-dialog';
import { appConfirm } from './ui/app-confirm';
import { GuardrailPolicyPanel } from './skills/GuardrailPolicyPanel';
import { toast } from '../lib/toast';
import { useSkillsCandidateStore } from '../stores/skills-candidate-store';
import { useSkillsPackageStore } from '../stores/skills-package-store';
import { useSkillsShelfData } from '../lib/hooks/useSkillsShelfData';
import {
  getDatabaseGenerationSafe,
  getInitialCapabilityTab,
  useSkillsConfigurationStore,
  type CapabilityStudioTab,
  type ConfigurationSessionViewBridge,
} from '../stores/skills-configuration-store';
import {
  CURATED_PRODUCT_SKILLS,
  ENHANCEMENT_PACKAGES,
  getEnhancementPackageSteps,
  SKILL_SERIES_FLOWS,
} from '../../shared/lib/public-skill-catalog';
import type {
  CuratedProductSkill,
  EnhancementPackage,
  EnhancementPackageStep,
  SkillSeriesFlow,
} from '../../shared/types/prompt-assets-governed';
import {
  createProductEventId,
  createProductEventSessionId,
  recordProductEvent,
} from '../lib/product-events-client';
import {
  canUseEnhancedCapability,
  dispatchCapabilityUnavailable,
  isLicensedEnhancementGated,
  isMonetizationEnabled,
} from '../lib/entitlements';
import {
  filterGovernedAssets,
  getGovernanceCapabilityType,
  getTrustedSessionCardIds,
  getCapabilityManifest,
  getCapabilitySourceLabel,
  getConfigurableGuardrailAssets,
  getCoreDefaultGuardrailCount,
  getOptionalStyleAssets,
  getSanitizeRequiredAssets,
  partitionShelfBySupply,
  type GovernanceCapabilityType,
  type GovernanceStage,
} from '../lib/capability-governance';
import {
} from '../lib/capability-stage-cards';
import type {
  CapabilityLaunchState,
  WorldCapabilityLaunchIntent,
} from '../../shared/types/capability-manifest';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import {
  addCardToProjectDeck,
  buildV3CapabilityProfile,
  isOutlineCandidateOutput,
  isWorldCandidateArtifact,
  getDeckDimensionSummary,
  getProjectCapabilityProfile,
  getProjectDeckIds,
  upsertCapabilityMembership,
} from '../lib/skills-studio-governance';
import {
  applyCapabilityConfiguration,
  previewCapabilityConfiguration,
} from '../lib/capability-configuration-client';
import {
  applyCapabilityMigration,
  previewCapabilityMigration,
  type CapabilityMigrationPreview,
  CapabilityMigrationError,
} from '../lib/capability-migration-client';
import { CapabilityMigrationPreviewPanel } from './skills/CapabilityMigrationPreviewPanel';
import { PlazaAssetCard } from './skills/PlazaAssetCard';
import { StyleShelf } from './skills/StyleShelf';
import { CandidateTray } from './skills/CandidateTray';
import {
  CAPABILITY_RETURN_EFFECT_HINT,
  PackageConfigDialog,
} from './skills/PackageConfigDialog';
import { LegacyArtifactStructuringPrompt } from './LegacyArtifactStructuringPrompt';
import {
  clearLatestCapabilityConfigurationSession,
  getCapabilityConfigurationBaselineToken,
  loadLatestCapabilityConfigurationSession,
} from '../lib/capability-configuration-session';

type SkillsStudioNavigateContext = {
  capabilityApplied?: boolean;
  targetFocus?: 'workspace-world';
  worldCapabilityLaunch?: WorldCapabilityLaunchIntent;
};
type CapabilityApplyDestination = 'return' | 'world' | 'outline';

// 004：文风与正文货架总数（目录静态，模块级只算一次）。研究口径 74 含 1 张 test-fixture，实际投影 73。
const OPTIONAL_STYLE_SHELF_COUNT = getOptionalStyleAssets().length;

// Plan 220：护栏投影同样目录静态——弹窗按键重渲不再重复扫描治理目录。
const CONFIGURABLE_GUARDRAIL_ASSETS = getConfigurableGuardrailAssets();
const CORE_DEFAULT_GUARDRAIL_COUNT = getCoreDefaultGuardrailCount();

// Plan 230：新用户保底配置——官方去AI味卡（95 分）+ 官方主流程；护栏 12 条 core-default 已自动生效。
const STARTER_PROFILE_PRESET = {
  activeFlowId: 'xiaofeiji-novel-flow',
  favoriteTechniqueIds: ['de-ai-tells-guard'],
};

// 004：消毒落库副本的前端占位（真实持久化以服务端消毒端点为准）。
// 模块级纯数据构造，避免组件体内 Date.now() 触发 react-hooks/purity。
function buildSanitizedSkillStub(asset: CuratedProductSkill, timestamp: number): Skill {
  return {
    id: `sanitized-${asset.id}`,
    name: asset.title,
    description: asset.goal || '',
    style: '',
    pacing: '',
    vocabulary: [],
    imagery: [],
    fewShots: [],
    corePatterns: [],
    bannedElements: [],
    stabilityScore: 0,
    evaluationFeedback: '消毒导入',
    version: 1,
    parentSkillId: asset.id,
    sourceType: 'plaza',
    isRuntimeReady: true,
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  } as Skill;
}

function getPackageUseLabel(packageId: string): string {
  if (packageId.includes('audit') || packageId.includes('diagnostic')) return '审稿包';
  if (packageId.includes('humanization') || packageId.includes('patch')) return '精修包';
  if (packageId.includes('onboarding')) return '设定包';
  if (packageId.includes('continuity') || packageId.includes('deconstruction')) return '拆书包';
  if (packageId.includes('chapter')) return '正文包';
  return '流程包';
}

function getPackageStageSummary(pkg: EnhancementPackage): string {
  const triggers = new Set(getEnhancementPackageSteps(pkg).map((step) => step.trigger));
  if (triggers.has('project-setup')) return '立项配置';
  if (triggers.has('outline')) return '大纲阶段';
  if (triggers.has('before-draft') && triggers.has('after-draft')) return '写前到写后';
  if (triggers.has('before-draft')) return '写前准备';
  if (triggers.has('after-draft')) return '写后处理';
  if (triggers.has('milestone')) return '阶段里程碑';
  return '阶段节点';
}

function getPackageAvailabilityLabel(
  pkg: EnhancementPackage,
  canUsePaidCapabilities: boolean,
  monetizationEnabled: boolean
): string {
  if (pkg.type !== 'paid') return '基础开放';
  if (!monetizationEnabled) return 'Beta 开放';
  return canUsePaidCapabilities ? '授权可用' : '需授权';
}

function getPackageOpenButtonLabel(
  pkg: EnhancementPackage,
  canUsePaidCapabilities: boolean,
  monetizationEnabled: boolean
): string {
  if (pkg.type === 'paid' && monetizationEnabled && !canUsePaidCapabilities) return '查看受限步骤';
  return '展开并选择';
}


type PackageGroupId = 'setup' | 'review' | 'deck' | 'platform' | 'other';

const PACKAGE_GROUPS: readonly { id: PackageGroupId; title: string }[] = [
  { id: 'setup', title: '设定与大纲' },
  { id: 'review', title: '审稿与精修' },
  { id: 'deck', title: '拆书与卡组' },
  { id: 'platform', title: '平台过签' },
  { id: 'other', title: '其他流程' },
];

function getPackageGroupId(packageId: string): PackageGroupId {
  if (packageId.includes('onboarding') || packageId.includes('first-chapter')) return 'setup';
  if (packageId.includes('platform')) return 'platform';
  if (packageId.includes('continuity') || packageId.includes('deconstruction')) return 'deck';
  if (
    packageId.includes('audit') ||
    packageId.includes('diagnostic') ||
    packageId.includes('humanization') ||
    packageId.includes('patch')
  )
    return 'review';
  return 'other';
}



function cloneAssetToSkill(asset: CuratedProductSkill): Skill | null {
  const manifest = getCatalogCapabilityManifest(asset.id);
  if (
    !Number.isFinite(asset.score) ||
    !manifest ||
    manifest.runtimeStatus !== 'active' ||
    !['technique', 'skill-card'].includes(manifest.kind)
  ) {
    return null;
  }

  const baseSkill: Skill = {
    id: `${asset.id}-clone-${Date.now()}`,
    name: asset.title,
    description: asset.goal || '',
    style: 'INKFLOW_CURATED_RUNTIME_DECOUPLED_PLACEHOLDER',
    pacing: asset.successSignal || '',
    stabilityScore: asset.score,
    evaluationFeedback: asset.successSignal || '从能力货架导入',
    version: Number(getCatalogCapabilityManifest(asset.id)?.version) || 1,
    primaryDimension: 'style',
    dimensionTags: ['style'],
    accessTier:
      manifest.sourceType === 'built-in' || manifest.sourceType === 'plaza' ? 'free' : 'paid',
    createdAt: Date.now(),
    executionScore: asset.score,
    parentSkillId: asset.parentSkillId || asset.id,
    sourceType: manifest.sourceType,
    sourceBadge: 'manual',
  };
  if (manifest.kind !== 'skill-card') return baseSkill;
  return {
    ...baseSkill,
    deconstructionCardType: manifest.deconstructionCardType,
    isRuntimeReady: true,
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
  };
}

const goldenFlowMetadata: Record<string, { target: string; output: string; color: string }> = {
  'xiaofeiji-novel-flow': {
    target: '精品长篇写手 / 进阶故事创作者',
    output: '高张力万字大纲 & 极高粘性前三章正文',
    color: 'from-orange-500/10 to-amber-500/10 border-amber-500/30',
  },
  'tomato-platform-flow': {
    target: '番茄平台写手 / 爆款爽文追随者',
    output: '黄金三章快速过签大纲 & 高频金手指爽点正文',
    color: 'from-red-500/10 to-orange-500/10 border-red-500/30',
  },
  'generic-novel-flow': {
    target: '传统网文作者 / 新手通俗写手',
    output: '标准三要素设定 & 结构扎实的百万字通俗大纲',
    color: 'from-blue-500/10 to-teal-500/10 border-blue-500/30',
  },
  'book-deconstruction-flow': {
    target: '大神文风研习者 / 精准流派复刻者',
    output: '神作精髓拆解报告 & 强因果节奏伏笔线索图谱',
    color: 'from-purple-500/10 to-pink-500/10 border-purple-500/30',
  },
  'fenghua-short-flow': {
    target: '短篇网文作者 / 快速完稿创作者',
    output: '短篇高密度大纲 & 紧凑节奏正文',
    color: 'from-cyan-500/10 to-sky-500/10 border-cyan-500/30',
  },
  'tianma-outline-flow': {
    target: '长篇策划作者 / 结构型创作者',
    output: '天马行空创意拆解 & 可执行长篇大纲',
    color: 'from-violet-500/10 to-indigo-500/10 border-violet-500/30',
  },
};

function FlowTimelinePreview({ flow }: { flow: SkillSeriesFlow }) {
  return (
    <div className="mt-3 bg-theme-bg/40 border border-theme-border/20 rounded-lg p-2.5 space-y-2 text-[10px]">
      <div className="flex justify-between items-center text-[9px] text-theme-muted font-bold tracking-wider">
        <span>阶段节点图谱</span>
        <span>共 {flow.steps.length} 步</span>
      </div>
      <div className="relative flex items-center justify-between mt-1">
        {/* Linear Connector Line */}
        <div className="absolute top-[9px] left-2 right-2 h-0.5 bg-theme-border/30 z-0" />
        {flow.steps.map((step) => (
          <div
            key={step.id}
            className="relative z-10 flex flex-col items-center group/dot cursor-pointer"
          >
            <div className="w-5 h-5 rounded-full border border-theme-border/60 bg-theme-sidebar flex items-center justify-center text-[8px] font-bold text-theme-muted font-mono hover:border-theme-accent hover:text-theme-accent hover:shadow-sm transition-all">
              {step.stepNumber}
            </div>
            {/* Hover tooltip */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-theme-sidebar border border-theme-border/80 px-2 py-1 rounded text-[8px] font-sans text-theme-text opacity-0 pointer-events-none group-hover/dot:opacity-100 transition-opacity duration-150 shadow-md whitespace-nowrap z-50">
              {step.name} ({step.input} ➔ {step.output})
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkillsStudioView({
  selectedNovel,
  onNavigate,
  onNovelUpdated,
  returnView = 'workspace',
  initialStage,
  onLaunchCapability,
  targetChapterId,
}: {
  selectedNovel?: Novel | null;
  onNavigate?: (view: ViewType, context?: SkillsStudioNavigateContext) => void;
  onNovelUpdated?: (novel: Novel) => void;
  returnView?: 'editor' | 'workspace';
  initialStage?: GovernanceStage;
  onLaunchCapability?: (state: CapabilityLaunchState) => void;
  targetChapterId?: string;
}) {
  const returnLabel = selectedNovel
    ? returnView === 'editor'
      ? '回到刚才章节写作'
      : '回到当前作品工作台'
    : '去书库选择作品';
  const returnHint =
    selectedNovel && returnView === 'editor'
      ? targetChapterId
        ? '能力配置会带回刚才那一章，不需要重新找章节。'
        : '能力配置会带回编辑器，继续当前章节写作。'
      : selectedNovel
        ? '回到工作台继续设定、写作和管理作品。'
        : undefined;
  const stageLaunchHint =
    selectedNovel && targetChapterId && initialStage === 'style-polish'
      ? '从审稿问题进入：选择精修卡后点「生成精修预览」，会回到刚才章节生成只读预览。'
      : null;
  // Plan 195 切片 C：货架数据获取迁 useSkillsShelfData（加载+订阅收口，setter 镜像 useState 语义）。
  const { savedSkills, setSavedSkills } = useSkillsShelfData();
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [skillToDeleteId, setSkillToDeleteId] = useState<string | null>(null);
  const [userNovels, setUserNovels] = useState<Novel[]>([]);

  const [activeTab, setActiveTab] = useState<'mySkills' | 'plaza'>('mySkills');
  const [cloningAssetId, setCloningAssetId] = useState<string | null>(null);
  const [selectedFlowDetail, setSelectedFlowDetail] = useState<SkillSeriesFlow | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [guardrailPolicyOpen, setGuardrailPolicyOpen] = useState(false);
  // Plan 195 切片 B：增强包选择簇迁 skills-package-store（setter 镜像 useState 语义，调用点零改动）。
  const packageSelections = useSkillsPackageStore((state) => state.packageSelections);
  const setPackageSelections = useSkillsPackageStore((state) => state.setPackageSelections);
  const pendingPackageSteps = useSkillsPackageStore((state) => state.pendingPackageSteps);
  const setPendingPackageSteps = useSkillsPackageStore((state) => state.setPendingPackageSteps);
  const packageSelectionDrafts = useSkillsPackageStore((state) => state.packageSelectionDrafts);
  const setPackageSelectionDrafts = useSkillsPackageStore(
    (state) => state.setPackageSelectionDrafts
  );
  const packageComponentResults = useSkillsPackageStore((state) => state.packageComponentResults);
  const setPackageComponentResults = useSkillsPackageStore(
    (state) => state.setPackageComponentResults
  );
  const setPackageResultLaunchFeedbackAssetId = useSkillsPackageStore(
    (state) => state.setPackageResultLaunchFeedbackAssetId
  );
  // Plan 195 Phase 2：候选卡簇状态迁 skills-candidate-store（setter 镜像 useState 语义，调用点零改动）。
  const candidateCardIds = useSkillsCandidateStore((state) => state.candidateCardIds);
  const setCandidateCardIds = useSkillsCandidateStore((state) => state.setCandidateCardIds);
  const pendingCandidateId = useSkillsCandidateStore((state) => state.pendingCandidateId);
  const setPendingCandidateId = useSkillsCandidateStore((state) => state.setPendingCandidateId);
  const [migrationPreview, setMigrationPreview] = useState<CapabilityMigrationPreview | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  // Plan 195 切片 A：外部数据库代际快照随会话簇迁 skills-configuration-store。
  const databaseGeneration = useSkillsConfigurationStore((state) => state.databaseGeneration);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  // Plan 209：弹窗 aria 配对 id 改 useId 派生——多实例/测试残留 DOM 时固定 id 会串名。
  const flowDialogTitleId = useId();
  const leaveDialogTitleId = useId();
  const studioScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionContextRef = useRef<string | null>(null);
  // Set when a context change (baseline token / generation) was caused by our
  // own successful apply, so the session effect re-anchors instead of treating
  // it as external drift and resetting the open package dialog.
  const selfAppliedContextRef = useRef(0);
  const configurationSessionIdRef = useRef<string | null>(null);
  const capabilityViewStateRef = useRef<string | null>(null);
  const packageResultActionRef = useRef<HTMLButtonElement | null>(null);
  const packageApplyActionRef = useRef<HTMLButtonElement | null>(null);
  const previousNovelIdRef = useRef<string | null>(null);
  const applyingConfigurationRef = useRef(false);
  const flowDetailTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!selectedFlowDetail || typeof document === 'undefined') return;
    const dialog = document.querySelector(
      '[data-capability-flow-dialog="true"]'
    ) as HTMLElement | null;
    const focusable = dialog?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelectedFlowDetail(null);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const items = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (items.length < 2) return;
      const current = document.activeElement;
      const index = items.indexOf(current as HTMLElement);
      const nextIndex = event.shiftKey
        ? index <= 0
          ? items.length - 1
          : index - 1
        : index === items.length - 1
          ? 0
          : index + 1;
      if (index >= 0) {
        event.preventDefault();
        items[nextIndex].focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      flowDetailTriggerRef.current?.focus();
    };
  }, [selectedFlowDetail]);

  const recordCapabilityEvent = (input: Parameters<typeof recordProductEvent>[0]) => {
    if (!input.novelId) return recordProductEvent(input);
    const sessionPrefix = `capability:${input.novelId}:`;
    const restoredSessionId = loadLatestCapabilityConfigurationSession(input.novelId)?.sessionId;
    const sessionId = configurationSessionIdRef.current?.startsWith(sessionPrefix)
      ? configurationSessionIdRef.current
      : restoredSessionId?.startsWith(sessionPrefix)
        ? restoredSessionId
        : `${sessionPrefix}${createProductEventSessionId('configuration')}`;
    configurationSessionIdRef.current = sessionId;
    return recordProductEvent({
      ...input,
      sessionId,
      eventId:
        input.eventId ||
        createProductEventId(
          `${input.eventName}:${input.action || input.objectId || 'default'}`,
          sessionId
        ),
    });
  };

  const effectiveNovel = useMemo(
    () =>
      selectedNovel
        ? userNovels.find((novel) => novel.id === selectedNovel.id) || selectedNovel
        : null,
    [selectedNovel, userNovels]
  );

  const handleActivateFlow = async (flowId: string) => {
    if (!selectedNovel) {
      toast('请先选择或创建一个小说作品。', 'info');
      return;
    }
    if (staleConfigurationSession) {
      setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return;
    }

    const isLicensedFlow = getCatalogCapabilityManifest(flowId)?.sourceType === 'licensed';

    const activeFlowId = effectiveNovel?.projectPreferenceProfile?.capabilityProfile?.activeFlowId;
    if (activeFlowId && activeFlowId !== flowId && typeof window !== 'undefined') {
      // 003：排他确认带对比清单，说明替换的是哪个流程、会重置什么。
      const previousFlow = SKILL_SERIES_FLOWS.find((flow) => flow.id === activeFlowId);
      const nextFlow = SKILL_SERIES_FLOWS.find((flow) => flow.id === flowId);
      const confirmedReplace = await appConfirm(
        '替换当前创作流程？',
        `切换到「${nextFlow?.name || flowId}」将替换当前流程「${previousFlow?.name || activeFlowId}」；以下内容将被重置：流程步骤进度。`,
        { confirmLabel: '确认替换' }
      );
      if (!confirmedReplace) return;
    }

    if (isLicensedFlow && isFreeNovel) {
      dispatchCapabilityUnavailable({
        limitType: 'extractSkill',
        count: 5,
        max: 5,
        error: '当前商业化实验配置未开放该授权增强能力；基础写作和 BYOK 主链仍可继续。',
        novelId: selectedNovel.id,
      });
      return;
    }

    try {
      const updatedProfile = buildV3CapabilityProfile(effectiveNovel, { activeFlowId: flowId });

      stageConfiguration(updatedProfile.capabilityProfile);
    } catch (err) {
      logger.warn('Failed to activate flow:', err);
    }
  };

  useEffect(() => {
    // savedSkills 的加载与订阅已收口 useSkillsShelfData（切片 C Step 1）。
    listNovels().then(setUserNovels);
  }, []);

  useEffect(() => {
    if (selectedNovel?.id)
      void recordCapabilityEvent({
        eventName: 'capability_viewed',
        stage: 'advanced',
        result: 'success',
        novelId: selectedNovel.id,
        objectId: 'skills-studio',
      });
    capabilityViewStateRef.current = selectedNovel?.id || null;
  }, [selectedNovel?.id]);

  const selectedSkill = useMemo(
    () => savedSkills.find((skill) => skill.id === selectedSkillId) || null,
    [savedSkills, selectedSkillId]
  );

  const handleDeleteSkill = async (id: string) => {
    setSkillToDeleteId(id);
  };

  const executeDeleteSkill = async () => {
    if (skillToDeleteId) {
      await deleteSkill(skillToDeleteId);
      if (selectedSkillId === skillToDeleteId) {
        setSelectedSkillId(null);
      }
      setSkillToDeleteId(null);
    }
  };

  // Plan 195 切片 A：能力页签初始值纯函数迁 configuration store（getInitialCapabilityTab）。
  const [selectedCapability, setSelectedCapability] = useState<CapabilityStudioTab>('flow');
  // Plan 226 症候入口：当前选中的「这章要解决什么」，null = 未筛选。
  const [activeSymptomKey, setActiveSymptomKey] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<GovernanceStage | 'all'>(
    initialStage || 'all'
  );

  useEffect(() => {
    if (!selectedNovel?.id) return;
    const nextState = `${selectedNovel.id}:${activeTab}:${selectedCapability}:${selectedCategory}`;
    if (
      capabilityViewStateRef.current === null ||
      capabilityViewStateRef.current === selectedNovel.id
    ) {
      capabilityViewStateRef.current = nextState;
      return;
    }
    if (capabilityViewStateRef.current === nextState) return;
    capabilityViewStateRef.current = nextState;
    void recordCapabilityEvent({
      eventName: 'capability_viewed',
      stage: 'advanced',
      result: 'success',
      novelId: selectedNovel.id,
      objectId: 'skills-studio',
      action: 'view-change',
    });
  }, [activeTab, selectedCapability, selectedCategory, selectedNovel?.id]);

  const filteredCuratedSkills = useMemo(() => {
    if (selectedCapability === 'packages') return [];
    const stage = selectedCategory === 'all' ? undefined : selectedCategory;
    // 004：文风与正文分组——optional-style 治理资产投影上货架（实测 73 张；研究口径 74 含 1 张 test-fixture）
    if (selectedCapability === 'optional-style') {
      const styleAssets = getOptionalStyleAssets(stage);
      // Plan 226 症候入口：选中症候时只看「能解决这个问题的卡」。
      return activeSymptomKey ? filterBySymptom(styleAssets, activeSymptomKey) : styleAssets;
    }
    const isVisibleShelfAsset = (asset: CuratedProductSkill) => {
      const manifest = getCapabilityManifest(asset);
      return (
        manifest.runtimeStatus === 'active' ||
        (selectedCategory === 'commercial-sign' &&
          asset.curatedCategory === 'platform' &&
          manifest.runtimeStatus === 'unavailable')
      );
    };
    const polishPreviewCards = filterGovernedAssets(
      CURATED_PRODUCT_SKILLS,
      'technique',
      stage
    ).filter(
      (asset) =>
        getCapabilityManifest(asset).output === 'transform-preview' && isVisibleShelfAsset(asset)
    );
    if (selectedCapability === 'diagnostic-tools') {
      return [
        ...filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'diagnostic', stage),
        ...filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'utility', stage),
        ...polishPreviewCards,
      ].filter(isVisibleShelfAsset);
    }
    const assets = filterGovernedAssets(CURATED_PRODUCT_SKILLS, selectedCapability, stage).filter(
      isVisibleShelfAsset
    );
    if (selectedCapability === 'technique') {
      return assets.filter((asset) => getCapabilityManifest(asset).output !== 'transform-preview');
    }
    return assets;
  }, [selectedCapability, selectedCategory, activeSymptomKey]);
  // 001 目标 5：不可用卡不再与可用卡同屏混排，折叠进底部"需解锁"分组。
  // 004：待消毒候选卡也投影进该分组，提供"消毒并启用"入口。
  // Plan 220：投影收进 memo——弹窗按键重渲不再全量重筛货架与治理目录。
  const availableCuratedSkills = useMemo(
    () =>
      filteredCuratedSkills.filter(
        (asset) => getCapabilityManifest(asset).runtimeStatus === 'active'
      ),
    [filteredCuratedSkills]
  );
  // 已消毒（落库存在 sanitized- 副本）的候选不再出现在"需解锁"分组；
  // 消毒副本本身可在"我的能力"中查看与使用。
  const sanitizedCloneIds = useMemo(
    () =>
      new Set(
        savedSkills
          .filter((skill) => String(skill.id).startsWith('sanitized-'))
          .map((skill) => skill.parentSkillId || skill.id)
      ),
    [savedSkills]
  );
  const lockedCuratedSkills = useMemo(
    () => [
      ...filteredCuratedSkills.filter(
        (asset) => getCapabilityManifest(asset).runtimeStatus !== 'active'
      ),
      ...getSanitizeRequiredAssets().filter((asset) => !sanitizedCloneIds.has(asset.id)),
    ],
    [filteredCuratedSkills, sanitizedCloneIds]
  );
  // Plan 220：页签计数按 selectedCategory 预计算一次（原每渲染 6 次 × 每次多趟目录筛选）。
  const shelfTabCounts = useMemo(() => {
    const isVisibleShelfAsset = (asset: CuratedProductSkill) => {
      const manifest = getCapabilityManifest(asset);
      return (
        manifest.runtimeStatus === 'active' ||
        (selectedCategory === 'commercial-sign' &&
          asset.curatedCategory === 'platform' &&
          manifest.runtimeStatus === 'unavailable')
      );
    };
    const countFor = (id: GovernanceCapabilityType | 'diagnostic-tools'): number => {
      if (id === 'diagnostic-tools') {
        return (
          filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'diagnostic').filter(isVisibleShelfAsset)
            .length +
          filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'utility').filter(isVisibleShelfAsset)
            .length +
          filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'technique').filter(
            (asset) =>
              getCapabilityManifest(asset).output === 'transform-preview' &&
              isVisibleShelfAsset(asset)
          ).length
        );
      }
      const assets = filterGovernedAssets(CURATED_PRODUCT_SKILLS, id).filter(isVisibleShelfAsset);
      return id === 'technique'
        ? assets.filter((asset) => getCapabilityManifest(asset).output !== 'transform-preview')
            .length
        : assets.length;
    };
    const counts = {} as Record<CapabilityStudioTab, number>;
    (
      [
        'technique',
        'skill-card',
        'diagnostic',
        'utility',
        'guardrail',
        'role-skill',
        'overlay',
        'diagnostic-tools',
      ] as const
    ).forEach((id) => {
      counts[id] = countFor(id);
    });
    return counts;
  }, [selectedCategory]);

  const capabilityTabCount = (id: CapabilityStudioTab) => {
    if (id === 'flow') return visibleFlowCount;
    if (id === 'packages') return visiblePackageCount;
    if (id === 'optional-style') return OPTIONAL_STYLE_SHELF_COUNT;
    return shelfTabCounts[id] ?? 0;
  };
  // Plan 225 供给分区：官方规范（保修）与社区配方（自验）分两区渲染。
  const supplyPartitions = useMemo(
    () => partitionShelfBySupply(availableCuratedSkills),
    [availableCuratedSkills]
  );

  const selectedPackage = selectedPackageId
    ? ENHANCEMENT_PACKAGES.find((pkg) => pkg.id === selectedPackageId) || null
    : null;
  const visiblePackages = ENHANCEMENT_PACKAGES.filter((pkg) => pkg.id !== 'paid-author-flows');
  const groupedPackages = PACKAGE_GROUPS.map((group) => ({
    ...group,
    packages: visiblePackages.filter((pkg) => getPackageGroupId(pkg.id) === group.id),
  })).filter((group) => group.packages.length > 0);
  const packageComponents = (
    selectedPackage ? getEnhancementPackageSteps(selectedPackage) : []
  ).map((step) => {
    const assetId = step.assetId;
    const asset = CURATED_PRODUCT_SKILLS.find((entry) => entry.id === assetId) || null;
    const flow = SKILL_SERIES_FLOWS.find((entry) => entry.id === assetId) || null;
    const manifest = getCatalogCapabilityManifest(assetId);
    return { assetId, asset, flow, manifest, step };
  });
  const isPackageStepSelected = (component: (typeof packageComponents)[number]) =>
    packageSelections.includes(component.step.id) || packageSelections.includes(component.assetId);
  const isConfigurationPackageComponent = (component: (typeof packageComponents)[number]) => {
    if (component.flow) return true;
    if (!component.asset) return false;
    const type = getGovernanceCapabilityType(component.asset);
    return type !== 'diagnostic' && type !== 'utility';
  };
  const visibleFlowIds = [
    'xiaofeiji-novel-flow',
    'tomato-platform-flow',
    'generic-novel-flow',
    'book-deconstruction-flow',
    'fenghua-short-flow',
    'tianma-outline-flow',
  ];
  const visibleFlowCount = SKILL_SERIES_FLOWS.filter((flow) =>
    visibleFlowIds.includes(flow.id)
  ).length;
  const visiblePackageCount = visiblePackages.length;

  const isAssetPersisted = (asset: CuratedProductSkill) => {
    const manifestVersion = Number(getCatalogCapabilityManifest(asset.id)?.version) || 1;
    return savedSkills.some(
      (skill) =>
        (skill.parentSkillId || skill.id) === (asset.parentSkillId || asset.id) &&
        skill.sourceType === asset.sourceType &&
        skill.version === manifestVersion
    );
  };

  const isRuntimeReadySkillCard = (skill: Skill) => {
    const sourceId = skill.parentSkillId || skill.id;
    const manifest = getCatalogCapabilityManifest(sourceId);
    return Boolean(
      ((manifest?.kind === 'skill-card' && manifest.runtimeStatus === 'active') || !manifest) &&
      Boolean(skill.deconstructionCardType) &&
      skill.isRuntimeReady === true &&
      skill.sanitizationStatus === 'runtime-ready' &&
      skill.runtimeStatus === 'active'
    );
  };

  const resolveDeckCard = (id: string) => {
    const saved = savedSkills.find((skill) => skill.id === id);
    const sourceId = saved?.parentSkillId || id;
    const entry = CURATED_PRODUCT_SKILLS.find((asset) => asset.id === sourceId);
    const manifest = getCatalogCapabilityManifest(sourceId) || getCatalogCapabilityManifest(id);
    const dimensions = [
      ...new Set(
        [
          ...(saved?.dimensionTags || []),
          ...(saved?.primaryDimension ? [saved.primaryDimension] : []),
          ...(entry?.primaryCategory ? [entry.primaryCategory] : []),
          ...(manifest?.deconstructionCardType
            ? [manifest.deconstructionCardType.replace(/-card$/, '')]
            : []),
        ].filter(Boolean)
      ),
    ];
    const known = Boolean(
      saved
        ? isRuntimeReadySkillCard(saved)
        : manifest?.kind === 'skill-card' && manifest.runtimeStatus === 'active'
    );
    return {
      id,
      title: saved?.name || entry?.title || id,
      source: manifest ? getCapabilitySourceLabel(manifest.sourceType) : '来源未知',
      version: saved?.version || manifest?.version || '未知',
      cardType: saved?.deconstructionCardType || manifest?.deconstructionCardType || '未知卡型',
      dimensions,
      known,
    };
  };
  const isTechniqueFavorited = (asset: CuratedProductSkill) => {
    if (getGovernanceCapabilityType(asset) !== 'technique') return false;
    const profile = configurationDraft || capabilityProfile;
    const favorites = new Set(profile?.favoriteTechniqueIds || []);
    if (favorites.has(asset.id)) return true;

    const manifest = getCapabilityManifest(asset);
    const sourceId = asset.parentSkillId || asset.id;
    const sourceVersion = manifest.version || '1';
    return (profile?.capabilityMemberships || []).some(
      (membership) =>
        membership.sourceId === sourceId &&
        membership.sourceVersion === sourceVersion &&
        Boolean(membership.persistedSkillId && favorites.has(membership.persistedSkillId))
    );
  };

  const isFreeNovel =
    !selectedNovel ||
    !canUseEnhancedCapability({
      commercialMode: selectedNovel.projectPreferenceProfile?.commercialMode,
    });
  const monetizationEnabled = isMonetizationEnabled();
  // This pure normalization is cheap; avoiding manual memoization keeps the
  // React Compiler's generated memoization consistent with this component.
  const capabilityProfile = getProjectCapabilityProfile(effectiveNovel);
  // Plan 195 切片 A：配置会话三 state 迁 skills-configuration-store（setter 镜像 useState 语义，调用点零改动）。
  const configurationDraft = useSkillsConfigurationStore((state) => state.configurationDraft);
  const setConfigurationDraft = useSkillsConfigurationStore((state) => state.setConfigurationDraft);
  const configurationDirty = useSkillsConfigurationStore((state) => state.configurationDirty);
  const setConfigurationDirty = useSkillsConfigurationStore((state) => state.setConfigurationDirty);
  const staleConfigurationSession = useSkillsConfigurationStore(
    (state) => state.staleConfigurationSession
  );
  const setStaleConfigurationSession = useSkillsConfigurationStore(
    (state) => state.setStaleConfigurationSession
  );
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [configurationApplyFailed, setConfigurationApplyFailed] = useState(false);
  const [isApplyingConfiguration, setIsApplyingConfiguration] = useState(false);
  // Plan 230：零配置检测——收藏/流程/卡组全空且没有待应用草稿时，提供保底配置导购。
  const isStarterEligible =
    Boolean(selectedNovel) &&
    !configurationDirty &&
    !staleConfigurationSession &&
    (capabilityProfile?.favoriteTechniqueIds?.length ?? 0) === 0 &&
    !capabilityProfile?.activeFlowId &&
    !capabilityProfile?.projectSkillDeck?.mainCardId;
  const projectDeckIds = getProjectDeckIds(configurationDraft || capabilityProfile);
  const deckSummaryCards = [
    { slot: '主卡', id: (configurationDraft || capabilityProfile)?.projectSkillDeck.mainCardId },
    ...[0, 1].map((index) => ({
      slot: `辅卡 ${index + 1}`,
      id: (configurationDraft || capabilityProfile)?.projectSkillDeck.supportCardIds[index],
    })),
  ].map((item) => ({ ...item, card: item.id ? resolveDeckCard(item.id) : null }));
  const supportDeckCount = deckSummaryCards.filter(
    (item) => item.slot.startsWith('辅卡') && item.card
  ).length;
  const deckEmptyHint =
    projectDeckIds.length === 0
      ? '可添加 1 张主卡、2 张辅卡'
      : supportDeckCount < 2
        ? `还可添加 ${2 - supportDeckCount} 张辅卡`
        : '作品卡组已满';
  const activeFlow = SKILL_SERIES_FLOWS.find(
    (flow) => flow.id === configurationDraft?.activeFlowId
  );
  const currentGuardrailIds = (configurationDraft || capabilityProfile)?.guardrailIds || [];
  const isGuardrailCandidate = (asset: CuratedProductSkill) =>
    getGovernanceCapabilityType(asset) === 'guardrail' && currentGuardrailIds.includes(asset.id);
  const hasLegacyConfiguration = Boolean(
    effectiveNovel?.projectPreferenceProfile &&
    effectiveNovel.projectPreferenceProfile.capabilityModelVersion !== 3
  );
  const baselineToken = getCapabilityConfigurationBaselineToken(capabilityProfile);
  const packageApplyOutlineAssetId =
    packageComponents.find((component) => {
      const status =
        packageComponentResults[component.step.id] || packageComponentResults[component.assetId];
      return Boolean(
        status &&
        isOutlineCandidateOutput(component.manifest?.output) &&
        !isWorldCandidateArtifact(component.manifest?.outputArtifact)
      );
    })?.assetId || null;
  // Plan 195 切片 A：会话编排下沉 configuration store；视图层仅提供会话绑定控件的
  // 读写桥（setter 稳定，useMemo 缓存不改变 effect 触发时机）。
  const sessionViewBridge = useMemo<ConfigurationSessionViewBridge>(
    () => ({
      resetSessionBoundView: (stage) => {
        setActiveTab(stage ? 'plaza' : 'mySkills');
        setSelectedCapability(getInitialCapabilityTab(stage));
        setSelectedCategory(stage || 'all');
        setSelectedSkillId(null);
        setPackageSelections([]);
        setPendingPackageSteps([]);
        setPackageSelectionDrafts({});
        setSelectedPackageId(null);
        setSelectedFlowDetail(null);
        setConfigurationError(null);
        setConfigurationApplyFailed(false);
        setLeavePromptOpen(false);
      },
      resetForContextChange: (stage) => {
        setActiveTab(stage ? 'plaza' : 'mySkills');
        setSelectedCapability(getInitialCapabilityTab(stage));
        setSelectedCategory(stage || 'all');
        setSelectedSkillId(null);
        setPackageSelections([]);
        setPendingPackageSteps([]);
        setSelectedPackageId(null);
        setSelectedFlowDetail(null);
        setConfigurationError(null);
        setConfigurationApplyFailed(false);
        setLeavePromptOpen(false);
      },
      restoreViewForStage: (stage) => {
        setActiveTab('plaza');
        setSelectedCapability(getInitialCapabilityTab(stage));
        setSelectedCategory(stage);
        setSelectedSkillId(null);
      },
      restoreViewFromSession: (view) => {
        setActiveTab(view.activeTab);
        setSelectedCapability(view.selectedCapability);
        setSelectedCategory(view.selectedCategory);
        setSelectedSkillId(view.selectedAssetId);
      },
      setPendingPackageSteps,
    }),
    // 包/配置 store 的 setter 是模块级稳定引用，memo 实际永不失效（与 useState setter 同语义）。
    [setPackageSelectionDrafts, setPackageSelections, setPendingPackageSteps]
  );

  useEffect(() => {
    if (previousNovelIdRef.current === selectedNovel?.id) return;
    previousNovelIdRef.current = selectedNovel?.id || null;
    if (!selectedNovel?.id) return;
    // A work switch invalidates every session-bound configuration control.
    useSkillsConfigurationStore
      .getState()
      .onWorkSwitch(selectedNovel, { initialStage, viewBridge: sessionViewBridge });
  }, [initialStage, selectedNovel, sessionViewBridge]);

  useEffect(
    () =>
      useSkillsConfigurationStore.getState().onGenerationSnapshot(selectedNovel?.id ?? null, {
        sessionContextRef,
        configurationSessionIdRef,
      }),
    [selectedNovel?.id]
  );

  useEffect(() => {
    // 会话恢复编排（含自应用豁免窗口 flagAge<5000 语义）在 configuration store 的
    // hydrateSession 中逐行等价承载；capabilityProfile 由持久化偏好引用派生。
    useSkillsConfigurationStore.getState().hydrateSession({
      novelId: selectedNovel?.id ?? null,
      databaseGeneration,
      baselineToken,
      projectPreferenceProfile: effectiveNovel?.projectPreferenceProfile ?? null,
      initialStage,
      sessionContextRef,
      configurationSessionIdRef,
      selfAppliedContextRef,
      scrollRef: studioScrollRef,
      viewBridge: sessionViewBridge,
    });
  }, [
    selectedNovel?.id,
    databaseGeneration,
    baselineToken,
    effectiveNovel?.projectPreferenceProfile,
    initialStage,
    sessionViewBridge,
  ]);

  // 配置会话簇/增强包簇 store 的生命周期对齐原 useState 的按挂载初始化语义（见各 store resetForRemount 注释）。
  useEffect(
    () => () => {
      useSkillsConfigurationStore.getState().resetForRemount();
      useSkillsPackageStore.getState().resetForRemount();
    },
    []
  );

  useEffect(() => {
    useSkillsConfigurationStore.getState().persistSession({
      novelId: selectedNovel?.id ?? null,
      databaseGeneration,
      baselineToken,
      staleConfigurationSession,
      configurationDirty,
      configurationDraft,
      pendingPackageSteps,
      candidateCardIds,
      pendingCandidateId,
      activeTab,
      selectedCapability,
      selectedCategory,
      selectedAssetId: selectedSkillId,
      sessionContextRef,
      configurationSessionIdRef,
      scrollRef: studioScrollRef,
    });
  }, [
    staleConfigurationSession,
    selectedNovel?.id,
    databaseGeneration,
    baselineToken,
    configurationDirty,
    configurationDraft,
    pendingPackageSteps,
    candidateCardIds,
    pendingCandidateId,
    activeTab,
    selectedCapability,
    selectedCategory,
    selectedSkillId,
  ]);

  useEffect(() => {
    useSkillsConfigurationStore.getState().syncDraftWithProfile({
      novelId: effectiveNovel?.id ?? null,
      projectPreferenceProfile: effectiveNovel?.projectPreferenceProfile ?? null,
      configurationDirty,
    });
  }, [effectiveNovel?.id, effectiveNovel?.projectPreferenceProfile, configurationDirty]);

  type CapabilityProfileDraft = ReturnType<typeof buildV3CapabilityProfile>['capabilityProfile'];
  type CapabilityProfileUpdate =
    | CapabilityProfileDraft
    | ((current: CapabilityProfileDraft | null) => CapabilityProfileDraft | null);

  const stageConfiguration = (profileOrUpdate: CapabilityProfileUpdate) => {
    if (staleConfigurationSession) {
      setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return;
    }
    setConfigurationDraft((current) => {
      const next =
        typeof profileOrUpdate === 'function' ? profileOrUpdate(current) : profileOrUpdate;
      return next || null;
    });
    setConfigurationDirty(true);
    setConfigurationError(null);
    setConfigurationApplyFailed(false);
  };

  const stageAssetMembership = (asset: CuratedProductSkill, persistedSkillId: string) => {
    if (!selectedNovel) return;
    const manifest = getCapabilityManifest(asset);
    stageConfiguration((current) => {
      const withMembership = upsertCapabilityMembership(
        current || getProjectCapabilityProfile(effectiveNovel),
        {
          sourceId: asset.parentSkillId || asset.id,
          sourceVersion: manifest?.version || '1',
          sourceType: manifest?.sourceType || asset.sourceType,
          persistedSkillId,
        }
      );
      return buildV3CapabilityProfile(effectiveNovel, withMembership).capabilityProfile;
    });
  };

  const stageCandidateCard = (candidateId: string, slot: 'main' | 'support') => {
    const current = configurationDraft || getProjectCapabilityProfile(effectiveNovel);
    const result = addCardToProjectDeck(current, candidateId, slot);
    if (result.requiresReplacement) {
      setPendingCandidateId(candidateId);
      return;
    }
    stageConfiguration(buildV3CapabilityProfile(effectiveNovel, result.profile).capabilityProfile);
    setCandidateCardIds((items) => items.filter((item) => item !== candidateId));
  };

  const applyConfiguration = async (
    returnToWriting = false,
    destination: CapabilityApplyDestination = 'return',
    profileOverride?: CapabilityProfileDraft | null,
    projectLaunchAssetId?: string,
    worldCapabilityLaunch?: WorldCapabilityLaunchIntent,
    packageStepsOverride?: EnhancementPackageStep[]
  ) => {
    const draft = profileOverride || configurationDraft;
    if (!selectedNovel || !draft || applyingConfigurationRef.current) return;
    applyingConfigurationRef.current = true;
    setIsApplyingConfiguration(true);
    try {
      setConfigurationError(null);
      setConfigurationApplyFailed(false);
      const databaseGeneration = await getDatabaseGenerationSafe();
      let workingDraft = draft;
      let preview = await previewCapabilityConfiguration(
        selectedNovel.id,
        databaseGeneration,
        buildV3CapabilityProfile(effectiveNovel, workingDraft).capabilityProfile!
      );
      // 失效技法引用自动摘除：服务端预览对失效 id 降级为 warnings，
      // 这里从草稿摘除后重新预览（预览令牌与提交配置必须一致，不能复用旧 token）。
      const unresolvedIds = extractUnresolvedTechniqueIds(preview.warnings || []);
      if (unresolvedIds.length > 0) {
        workingDraft = stripUnresolvedTechniqueRefs(workingDraft, unresolvedIds);
        setConfigurationDraft(workingDraft);
        setConfigurationDirty(true);
        toast(`已移除失效技法引用：${unresolvedIds.join('、')}，正在按当前配置重新应用。`, 'info');
        preview = await previewCapabilityConfiguration(
          selectedNovel.id,
          databaseGeneration,
          buildV3CapabilityProfile(effectiveNovel, workingDraft).capabilityProfile!
        );
      }
      const nextProfile = buildV3CapabilityProfile(effectiveNovel, workingDraft);
      if (staleConfigurationSession) {
        setStaleConfigurationSession(false);
        setConfigurationError('草稿已按当前作品状态重新预览。请再次点击应用配置以写入作品。');
        setConfigurationApplyFailed(false);
        setConfigurationDirty(true);
        return;
      }
      const selectedPackageSteps = (packageStepsOverride ?? pendingPackageSteps).map((step) => ({
        stepId: step.id,
        assetId: step.assetId,
        mode: step.mode,
        trigger: step.trigger,
        scope: step.scope,
        order: step.order,
        required: step.required,
        ...(step.dependsOn ? { dependsOn: [...step.dependsOn] } : {}),
      }));
      const applied = await applyCapabilityConfiguration(
        selectedNovel.id,
        databaseGeneration,
        preview.previewToken,
        nextProfile.capabilityProfile!,
        selectedPackageSteps,
        targetChapterId
      );
      // Our own apply will move the baseline the session effect watches; let it
      // re-anchor instead of resetting the open dialog as external drift.
      // eslint-disable-next-line react-hooks/purity
      selfAppliedContextRef.current = Date.now();
      const appliedProfile = { ...nextProfile, capabilityProfile: applied.profile };
      const appliedNovel = { ...selectedNovel, projectPreferenceProfile: appliedProfile };
      setUserNovels((prev) =>
        prev.map((entry) =>
          entry.id === selectedNovel.id
            ? { ...entry, projectPreferenceProfile: appliedProfile }
            : entry
        )
      );
      onNovelUpdated?.(appliedNovel);
      setConfigurationDirty(false);
      setStaleConfigurationSession(false);
      setConfigurationDraft(applied.profile);
      setPackageSelections([]);
      setPendingPackageSteps([]);
      setPackageSelectionDrafts({});
      clearLatestCapabilityConfigurationSession(selectedNovel.id);
      setCandidateCardIds([]);
      setPendingCandidateId(null);
      if (selectedPackage) {
        setPackageComponentResults((current) => {
          const next = { ...current };
          if (applied.items?.length) {
            for (const item of applied.items) next[item.stepId || item.capabilityId] = item.status;
          } else {
            for (const component of packageComponents) {
              if (!isPackageStepSelected(component)) continue;
              next[component.step.id] =
                component.step.mode === 'configure' ? 'configured' : 'recommended';
            }
          }
          return next;
        });
      }
      // A valid configuration may contain only techniques/flow and no deck
      // cards. Keep telemetry valid by omitting the optional object id rather
      // than sending an empty string that the API rejects.
      void recordCapabilityEvent({
        eventName: 'skill_deck_applied',
        stage: 'advanced',
        result: 'success',
        novelId: selectedNovel.id,
        objectId: projectDeckIds.length > 0 ? projectDeckIds.join(',') : undefined,
      });
      if (returnToWriting) {
        void recordCapabilityEvent({
          eventName: 'capability_returned_to_editor',
          stage: 'advanced',
          result: 'success',
          novelId: selectedNovel.id,
          action: 'apply-and-return',
        });
        if (destination === 'world') {
          onNavigate?.('world', {
            capabilityApplied: true,
            targetFocus: 'workspace-world',
            worldCapabilityLaunch,
          });
        } else if (
          destination === 'outline' &&
          (projectLaunchAssetId || packageApplyOutlineAssetId)
        ) {
          // eslint-disable-next-line react-hooks/purity
          const launchToken = Date.now();
          onLaunchCapability?.({
            action: 'use-project-technique',
            assetId: projectLaunchAssetId || packageApplyOutlineAssetId!,
            launchToken,
            novelId: selectedNovel.id,
          });
        } else {
          onNavigate?.(returnView, { capabilityApplied: true });
        }
      } else {
        // Single-verb enable from the capability center: stay put, surface a
        // non-navigating success signal (undo toast is fired by the caller).
      }
    } catch (error) {
      setConfigurationError(error instanceof Error ? error.message : '配置保存失败，请重试。');
      setConfigurationApplyFailed(true);
    } finally {
      applyingConfigurationRef.current = false;
      setIsApplyingConfiguration(false);
    }
  };

  const handleReturnToWriting = () => {
    if (configurationDirty) {
      setLeavePromptOpen(true);
      return;
    }
    onNavigate?.(selectedNovel ? returnView : 'library');
  };

  const abandonConfiguration = () => {
    if (selectedNovel?.id) clearLatestCapabilityConfigurationSession(selectedNovel.id);
    setConfigurationDraft(capabilityProfile);
    setConfigurationDirty(false);
    setStaleConfigurationSession(false);
    setPackageSelections([]);
    setPendingPackageSteps([]);
    setPackageSelectionDrafts({});
    setCandidateCardIds([]);
    setPendingCandidateId(null);
    setLeavePromptOpen(false);
    if (selectedNovel?.id)
      void recordCapabilityEvent({
        eventName: 'capability_config_cancelled',
        stage: 'advanced',
        result: 'success',
        novelId: selectedNovel.id,
      });
    onNavigate?.(selectedNovel ? returnView : 'library');
  };

  // Plan 229：把配置草稿里的技法 id 解析回目录资产（供同工位互斥检测）。
  const craftAssetsForConfiguredIds = (): CuratedProductSkill[] => {
    const draft = configurationDraft || getProjectCapabilityProfile(effectiveNovel);
    const configuredIds = [
      ...(draft?.projectTechniqueIds || []),
      ...(draft?.favoriteTechniqueIds || []),
    ];
    return configuredIds
      .map((id) => {
        const saved = savedSkills.find((skill) => skill.id === id);
        const sourceId = saved?.parentSkillId || id;
        return CURATED_PRODUCT_SKILLS.find((asset) => asset.id === sourceId) || null;
      })
      .filter((asset): asset is CuratedProductSkill => Boolean(asset));
  };

  // Plan 229：同工位互斥文案（套牌卡专用——非套牌卡保留自由组合）。
  const blockIfStationConflicts = (asset: CuratedProductSkill, configured: CuratedProductSkill[]) => {
    const signature = getCraftSignature(asset);
    if (!signature.seriesId) return true;
    const conflicts = detectStationConflicts(configured, asset);
    if (conflicts.length === 0) return true;
    toast(
      `已选《${conflicts[0].title}》与《${asset.title}》同工位互斥；两套配方不能混用，如需更换请先移除已选卡。`,
      'error'
    );
    return false;
  };

  const handleApplyProjectTechnique = async (asset: CuratedProductSkill) => {
    if (!selectedNovel?.id || getGovernanceCapabilityType(asset) !== 'technique') return;
    if (!blockIfStationConflicts(asset, craftAssetsForConfiguredIds())) return;
    const manifest = getCapabilityManifest(asset);
    if (
      manifest.outputArtifact === 'worldBibleCandidate' ||
      manifest.outputArtifact === 'characterCardCandidate'
    ) {
      const persistedId =
        manifest.sourceType !== 'built-in' ? await handleImportAsset(asset) : asset.id;
      if (!persistedId) return;
      const current = upsertCapabilityMembership(
        configurationDraft || getProjectCapabilityProfile(effectiveNovel),
        {
          sourceId: asset.parentSkillId || asset.id,
          sourceVersion: manifest.version || '1',
          sourceType: manifest.sourceType || asset.sourceType,
          persistedSkillId: persistedId,
        }
      );
      const projectTechniques = current?.projectTechniqueIds || current?.favoriteTechniqueIds || [];
      const nextProfile = buildV3CapabilityProfile(effectiveNovel, {
        ...current,
        projectTechniqueIds: projectTechniques.includes(persistedId)
          ? projectTechniques
          : [...projectTechniques, persistedId],
        capabilityMemberships: current.capabilityMemberships,
      }).capabilityProfile;
      stageConfiguration(nextProfile);
      // eslint-disable-next-line react-hooks/purity
      const launchToken = Date.now();
      await applyConfiguration(true, 'world', nextProfile, undefined, {
        novelId: selectedNovel.id,
        launchToken,
        capabilityId: getCatalogCapabilityManifest(asset.id)?.id || asset.id,
        artifactKind: manifest.outputArtifact === 'characterCardCandidate' ? 'character' : 'world',
      });
      return;
    }
    const persistedId =
      manifest.sourceType !== 'built-in' ? await handleImportAsset(asset) : asset.id;
    if (!persistedId) return;
    const current = upsertCapabilityMembership(
      configurationDraft || getProjectCapabilityProfile(effectiveNovel),
      {
        sourceId: asset.parentSkillId || asset.id,
        sourceVersion: manifest.version || '1',
        sourceType: manifest.sourceType || asset.sourceType,
        persistedSkillId: persistedId,
      }
    );
    const projectTechniques = current?.projectTechniqueIds || current?.favoriteTechniqueIds || [];
    const nextProfile = buildV3CapabilityProfile(effectiveNovel, {
      ...current,
      projectTechniqueIds: projectTechniques.includes(persistedId)
        ? projectTechniques
        : [...projectTechniques, persistedId],
      capabilityMemberships: current.capabilityMemberships,
    }).capabilityProfile;
    stageConfiguration(nextProfile);
    await applyConfiguration(
      true,
      manifest.stages.includes('planner') ? 'outline' : 'return',
      nextProfile,
      asset.id
    );
  };

  // Plan 229：整剂启用/从第 N 张继续——按序批量入草稿后一次应用；批内同样跑同工位互斥。
  const handleApplyDeck = async (cards: CuratedProductSkill[]) => {
    if (!selectedNovel?.id || cards.length === 0) return;
    if (staleConfigurationSession) {
      setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return;
    }
    const configured = craftAssetsForConfiguredIds();
    for (const card of cards) {
      if (!blockIfStationConflicts(card, configured)) return;
      configured.push(card);
    }
    let working = configurationDraft || getProjectCapabilityProfile(effectiveNovel);
    for (const card of cards) {
      const manifest = getCapabilityManifest(card);
      const persistedId =
        manifest.sourceType !== 'built-in' ? await handleImportAsset(card) : card.id;
      if (!persistedId || !working) return;
      const withMembership = upsertCapabilityMembership(working, {
        sourceId: card.parentSkillId || card.id,
        sourceVersion: manifest.version || '1',
        sourceType: manifest.sourceType || card.sourceType,
        persistedSkillId: persistedId,
      });
      if (!withMembership) return;
      const projectTechniques =
        withMembership.projectTechniqueIds || withMembership.favoriteTechniqueIds || [];
      const built = buildV3CapabilityProfile(effectiveNovel, {
        ...withMembership,
        projectTechniqueIds: projectTechniques.includes(persistedId)
          ? projectTechniques
          : [...projectTechniques, persistedId],
        capabilityMemberships: withMembership.capabilityMemberships,
      }).capabilityProfile;
      if (!built) return;
      working = built;
    }
    if (!working) return;
    stageConfiguration(working);
    await applyConfiguration(false, 'return', working);
  };

  // Plan 229：「从第 N 张继续」的推算口径——卡的源 id 已在配置草稿技法里。
  const isDeckCardConfigured = (asset: CuratedProductSkill) =>
    craftAssetsForConfiguredIds().some(
      (entry) => (entry.parentSkillId || entry.id) === (asset.parentSkillId || asset.id)
    );

  const cancelPendingCandidate = () => {
    if (pendingCandidateId && selectedNovel?.id) {
      void recordCapabilityEvent({
        eventName: 'capability_config_cancelled',
        stage: 'advanced',
        result: 'success',
        novelId: selectedNovel.id,
        objectId: pendingCandidateId,
        action: 'conflict',
      });
    }
    setPendingCandidateId(null);
  };

  // 切片 C Step 3：候选托盘「确认替换」编排（原弹窗 onClick 内联逻辑原样收口）。
  const handleReplaceDeckCard = (targetId: string) => {
    if (!pendingCandidateId) return;
    const current = configurationDraft || getProjectCapabilityProfile(effectiveNovel);
    const result = addCardToProjectDeck(current, pendingCandidateId, undefined, targetId);
    if (!result.requiresReplacement) {
      stageConfiguration(
        buildV3CapabilityProfile(effectiveNovel, result.profile).capabilityProfile
      );
      setCandidateCardIds((items) => items.filter((item) => item !== pendingCandidateId));
      setPendingCandidateId(null);
    }
  };

  const addCandidateSkill = (skillId: string) => {
    if (!skillId || staleConfigurationSession) {
      if (staleConfigurationSession) setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return;
    }
    setCandidateCardIds((ids) => (ids.includes(skillId) ? ids : [...ids, skillId]));
    setConfigurationDirty(true);
    setConfigurationError(null);
    setConfigurationApplyFailed(false);
  };

  const handleImportAsset = async (asset: CuratedProductSkill): Promise<string | null> => {
    if (staleConfigurationSession) {
      setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return null;
    }
    if (isLicensedEnhancementGated(getCapabilityManifest(asset)?.sourceType, isFreeNovel)) {
      dispatchCapabilityUnavailable({
        limitType: 'extractSkill',
        count: 5,
        max: 5,
        error: '当前商业化实验配置未开放该授权增强能力；基础写作和 BYOK 主链仍可继续。',
        novelId: selectedNovel?.id || '',
      });
      return null;
    }

    const existing = savedSkills.find(
      (skill) =>
        (skill.parentSkillId || skill.id) === (asset.parentSkillId || asset.id) &&
        skill.sourceType === asset.sourceType &&
        skill.version === (Number(getCatalogCapabilityManifest(asset.id)?.version) || 1)
    );
    if (existing) {
      stageAssetMembership(asset, existing.id);
      return existing.id;
    }
    setCloningAssetId(asset.id);

    await new Promise((resolve) => setTimeout(resolve, 400));

    try {
      const newSkill = cloneAssetToSkill(asset);
      if (!newSkill) {
        toast('该能力尚未评测，暂不能导入。', 'info');
        return null;
      }
      await createSkill(newSkill);

      // Creation is the authoritative persistence boundary. A feedback-score
      // refresh is best effort and must not discard the newly created card or
      // prevent its project membership from being staged.
      let persistedSkillId = newSkill.id;
      try {
        const updated = await syncSkillFeedbackScores();
        const persisted = updated.find(
          (skill) =>
            (skill.parentSkillId || skill.id) === (newSkill.parentSkillId || newSkill.id) &&
            skill.sourceType === newSkill.sourceType &&
            skill.version === newSkill.version
        );
        persistedSkillId = persisted?.id || newSkill.id;
        setSavedSkills(persisted ? updated : [...updated, newSkill]);
      } catch (syncError) {
        logger.warn('Skill feedback refresh failed after creation:', syncError);
        setSavedSkills((current) =>
          current.some((skill) => skill.id === newSkill.id) ? current : [...current, newSkill]
        );
      }
      stageAssetMembership(asset, persistedSkillId);
      void recordCapabilityEvent({
        eventName: 'skill_card_added',
        stage: 'import',
        result: 'success',
        novelId: selectedNovel?.id,
        objectId: persistedSkillId,
        sourceType: asset.sourceType,
      });
      return persistedSkillId;
    } catch (err) {
      logger.warn('Failed to clone asset:', err);
      return null;
    } finally {
      setCloningAssetId(null);
    }
  };

  // Single-verb enable (plan 001): staging is an implementation detail — every
  // equip action applies immediately and offers a 5s undo via toast.
  const applyStagedProfileImmediately = async (
    capabilityProfile: CapabilityProfileDraft,
    assetTitle: string
  ) => {
    const preProfile = selectedNovel?.projectPreferenceProfile
      ? JSON.parse(JSON.stringify(selectedNovel.projectPreferenceProfile))
      : null;
    await applyConfiguration(false, 'return', capabilityProfile);
    toast(`已启用「${assetTitle}」`, 'success', 5000, {
      label: '撤销',
      onClick: () => {
        if (preProfile)
          void applyConfiguration(false, 'return', preProfile as CapabilityProfileDraft);
      },
    });
  };

  const handleEquipAsset = async (asset: CuratedProductSkill) => {
    if (!selectedNovel) {
      toast('请先选择一个作品再配置能力。', 'info');
      return;
    }
    if (staleConfigurationSession) {
      setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return;
    }
    const type = getGovernanceCapabilityType(asset);
    if (type === 'flow') {
      await handleActivateFlow(asset.id);
      return;
    }
    if (type === 'technique') {
      const persistedId =
        getCapabilityManifest(asset)?.sourceType !== 'built-in'
          ? await handleImportAsset(asset)
          : asset.id;
      if (!persistedId) return;
      await equipPersistedTechnique(asset, persistedId);
      return;
    }
    if (type === 'skill-card') {
      const manifest = getCapabilityManifest(asset);
      if (manifest.kind !== 'skill-card' || manifest.runtimeStatus !== 'active') return;
      const persistedId = await handleImportAsset(asset);
      if (!persistedId) return;
      stageAssetMembership(asset, persistedId);
      const base = configurationDraft || getProjectCapabilityProfile(effectiveNovel);
      const deckResult = addCardToProjectDeck(base, persistedId);
      if (deckResult.requiresReplacement) {
        // Deck full: keep the old candidate flow — replacement needs a choice.
        setCandidateCardIds((ids) => (ids.includes(persistedId) ? ids : [...ids, persistedId]));
        toast('作品卡组已满：已加入候选，替换主/辅卡后生效。', 'info', 6500);
        return;
      }
      const nextProfile = buildV3CapabilityProfile(
        effectiveNovel,
        deckResult.profile
      ).capabilityProfile;
      stageConfiguration(nextProfile);
      await applyStagedProfileImmediately(nextProfile, asset.title);
      return;
    }
    if (type === 'guardrail') {
      const current = configurationDraft || getProjectCapabilityProfile(effectiveNovel);
      const ids = current?.guardrailIds || [];
      const nextIds = ids.includes(asset.id)
        ? ids.filter((id) => id !== asset.id)
        : [...ids, asset.id];
      const nextProfile = buildV3CapabilityProfile(effectiveNovel, {
        ...(current || {
          version: 3 as const,
          projectSkillDeck: { supportCardIds: [], updatedAt: 0 },
          favoriteTechniqueIds: [],
          capabilityMemberships: [],
        }),
        guardrailIds: nextIds,
      });
      stageConfiguration(nextProfile.capabilityProfile);
      await applyStagedProfileImmediately(nextProfile.capabilityProfile, asset.title);
      void recordCapabilityEvent({
        eventName: 'capability_viewed',
        stage: 'advanced',
        result: 'success',
        novelId: selectedNovel.id,
        objectId: asset.id,
        sourceType: asset.sourceType,
        action: 'guardrail-staged',
      });
      return;
    }
    if (type === 'role-skill' || type === 'overlay') {
      // v2 records are shown for organization only. They must not silently
      // become a v3 role slot or navigate away from the capability center.
      toast('该历史能力待整理，暂不参与新配置。', 'info');
      return;
    }
    handleDirectExec(asset);
  };

  // 010/J6：把已落库的技法卡装配进作品（收藏 + 即时应用）。
  // 供目录克隆与消毒副本两条路径共用，避免消毒后启用被目录克隆门槛拦下。
  const equipPersistedTechnique = async (asset: CuratedProductSkill, persistedId: string) => {
    const manifest = getCapabilityManifest(asset);
    const current = upsertCapabilityMembership(
      configurationDraft || getProjectCapabilityProfile(effectiveNovel),
      {
        sourceId: asset.parentSkillId || asset.id,
        sourceVersion: manifest?.version || '1',
        sourceType: manifest?.sourceType || asset.sourceType,
        persistedSkillId: persistedId,
      }
    );
    const favorites = current?.favoriteTechniqueIds || [];
    const nextFavorites = favorites.includes(persistedId)
      ? favorites.filter((id) => id !== persistedId)
      : [...favorites, persistedId];
    const nextProfile = buildV3CapabilityProfile(effectiveNovel, {
      ...current,
      favoriteTechniqueIds: nextFavorites,
      capabilityMemberships: current.capabilityMemberships,
    });
    stageConfiguration(nextProfile.capabilityProfile);
    await applyStagedProfileImmediately(nextProfile.capabilityProfile, asset.title);
    void recordCapabilityEvent({
      eventName: 'technique_favorited',
      stage: 'advanced',
      result: 'success',
      novelId: selectedNovel?.id || '',
      objectId: asset.id,
      sourceType: asset.sourceType,
    });
  };

  // 004 消毒并启用：调服务端消毒端点落库脱敏副本，再走既有装配链路
  // （handleImportAsset 的去重会命中 sanitized- 副本，不会重复落库）。
  const handleSanitizeAndEnable = async (asset: CuratedProductSkill) => {
    if (!selectedNovel) {
      toast('请先选择一个作品再配置能力。', 'info');
      return;
    }
    try {
      const response = await fetch(`/api/skills/sanitize/${encodeURIComponent(asset.id)}`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast(body.error || '消毒失败，请重试。', 'error');
        return;
      }
      const cloneId = `sanitized-${asset.id}`;
      const alreadyFavorited = (
        (configurationDraft || getProjectCapabilityProfile(effectiveNovel))?.favoriteTechniqueIds ||
        []
      ).includes(cloneId);
      // eslint-disable-next-line react-hooks/purity
      const sanitizedSkill = buildSanitizedSkillStub(asset, Date.now());
      setSavedSkills((current) =>
        current.some((skill) => skill.id === cloneId) ? current : [...current, sanitizedSkill]
      );
      if (!alreadyFavorited) {
        // 直接装配已落库的消毒副本：目录克隆门槛（candidate 状态/证据分）不适用于显式消毒
        await equipPersistedTechnique(asset, cloneId);
      }
      toast('已消毒并启用该能力卡（原作者署名与私有引用已剥离）。', 'success', 5000);
    } catch {
      toast('消毒失败，请重试。', 'error');
    }
  };

  const handleDirectExec = (asset: CuratedProductSkill) => {
    if (!selectedNovel?.id) {
      toast('请先选择一个作品再使用该能力。', 'info');
      return;
    }
    const manifest = getCapabilityManifest(asset);
    const launchStage = selectedCategory === 'all' ? initialStage : selectedCategory;
    const plannerOnly =
      manifest.stages.includes('planner') &&
      !manifest.stages.includes('writer') &&
      !manifest.stages.includes('critic');
    if (
      plannerOnly &&
      (Boolean(targetChapterId) || (launchStage && launchStage !== 'creative-setup'))
    ) {
      toast('该能力仅支持设定与大纲阶段，请切换到「① 立设定与大纲」后再运行。', 'info');
      setSelectedCategory('creative-setup');
      return;
    }
    const canUseAsChapterSkillCard =
      manifest.kind === 'skill-card' &&
      manifest.runtimeStatus === 'active' &&
      manifest.allowedScopes.includes('chapter');
    if (getGovernanceCapabilityType(asset) === 'overlay' || canUseAsChapterSkillCard) {
      const savedSkill = savedSkills.find(
        (skill) => skill.id === asset.id || skill.parentSkillId === asset.id
      );
      const sessionCardIds = getTrustedSessionCardIds(
        [asset.id, savedSkill?.id || ''],
        savedSkills
      );
      if (!sessionCardIds.length) {
        toast('该卡暂不可作为本章使用卡运行。', 'info');
        return;
      }
      // eslint-disable-next-line react-hooks/purity
      const now = Date.now();
      onLaunchCapability?.({
        action: 'use-overlay',
        assetId: asset.id,
        launchToken: now,
        novelId: selectedNovel.id,
        targetChapterId,
        sessionCardIds,
      });
      void recordCapabilityEvent({
        eventName: 'deconstruction_card_trial',
        stage: 'drafting',
        result: 'success',
        novelId: selectedNovel?.id,
        objectId: sessionCardIds[0],
      });
      return;
    }
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const launchAction = getDirectExecLaunchAction(asset);
    if (!launchAction) return;
    onLaunchCapability?.({
      action: launchAction,
      assetId: asset.id,
      launchToken: now,
      novelId: selectedNovel.id,
      targetChapterId,
    });
  };

  const getDirectExecLaunchAction = (
    asset: CuratedProductSkill
  ): 'run-diagnostic' | 'run-utility' | null => {
    const manifest = getCapabilityManifest(asset);
    const isPreviewOnlyTransform =
      manifest.output === 'transform-preview' && manifest.sideEffect === 'preview-only';
    if (manifest.action === 'run-diagnostic') return 'run-diagnostic';
    if (isPreviewOnlyTransform || getGovernanceCapabilityType(asset) === 'utility')
      return 'run-utility';
    return null;
  };

  // 切片 C Step 4：包弹窗「重新预览」入口（视图守卫无作品时给出配置错误提示）。
  const handleDialogRepreview = () => {
    if (!selectedNovel) {
      setConfigurationError('请先选择作品后再预览本次配置。');
      return;
    }
    void applyConfiguration(false);
  };

  const handleLaunchPackageResult = (asset: CuratedProductSkill) => {
    const launchAction = getDirectExecLaunchAction(asset);
    if (!selectedNovel?.id || !launchAction || !onLaunchCapability) {
      handleDirectExec(asset);
      return;
    }
    setPackageResultLaunchFeedbackAssetId(asset.id);
    void recordCapabilityEvent({
      eventName: 'capability_package_result_launched',
      stage: 'advanced',
      result: 'success',
      novelId: selectedNovel.id,
      objectId: asset.id,
      action: launchAction,
    });
    handleDirectExec(asset);
  };

  useEffect(() => {
    if (!selectedPackageId || packageSelections.length > 0) return;
    const action = packageResultActionRef.current;
    const applyAction = packageApplyActionRef.current;
    const target =
      action || (configurationDirty && !staleConfigurationSession ? applyAction : null);
    if (!target) return;
    target.focus();
    target.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [
    configurationDirty,
    packageComponentResults,
    packageSelections.length,
    selectedPackageId,
    staleConfigurationSession,
  ]);

  const launchTechnique = (asset: CuratedProductSkill, scope: 'project' | 'chapter') => {
    if (!selectedNovel?.id) {
      toast('请先选择一个作品再使用该能力。', 'info');
      return;
    }
    if (getGovernanceCapabilityType(asset) !== 'technique') return;
    const manifest = getCapabilityManifest(asset);
    if (!manifest.allowedScopes.includes(scope)) return;
    if (scope === 'project') {
      void handleApplyProjectTechnique(asset);
      return;
    }
    // eslint-disable-next-line react-hooks/purity
    const launchToken = Date.now();
    onLaunchCapability?.({
      action: 'use-technique',
      assetId: asset.id,
      launchToken,
      novelId: selectedNovel.id,
      targetChapterId,
    });
  };

  const handleUseTechnique = (asset: CuratedProductSkill) => launchTechnique(asset, 'chapter');
  const handleUseProjectTechnique = (asset: CuratedProductSkill) =>
    launchTechnique(asset, 'project');

  // Single-verb enable: stage the selected steps AND apply them in one action.
  // Returns the built profile so the caller (dialog button) can hand it to
  // applyConfiguration; returns null when staging produced nothing usable.
  const handleApplyPackage = async (): Promise<
    | { capabilityProfile: CapabilityProfileDraft; steps: EnhancementPackageStep[] }
    | null
    | undefined
  > => {
    setPackageResultLaunchFeedbackAssetId(null);
    if (!selectedPackage || !selectedNovel) {
      setConfigurationError('请先选择作品，再启用能力包。');
      return null;
    }
    const selected = packageComponents.filter(isPackageStepSelected);
    if (selected.length === 0) {
      setConfigurationError('至少选择一项能力。');
      return null;
    }
    if (staleConfigurationSession && selected.some(isConfigurationPackageComponent)) {
      setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return null;
    }
    const selectedFlows = selected.filter((component) => component.flow);
    if (selectedFlows.length > 1) {
      setConfigurationError('每部作品只能选择一个创作流程，请在能力包中只保留一个流程。');
      return;
    }
    const baseProfile = configurationDraft ||
      getProjectCapabilityProfile(effectiveNovel) || {
        version: 3 as const,
        projectSkillDeck: { supportCardIds: [], updatedAt: 0 },
        favoriteTechniqueIds: [],
        capabilityMemberships: [],
      };
    let nextProfile = baseProfile;
    const nextCandidates: string[] = [];
    const nextPendingSteps: EnhancementPackageStep[] = [];
    let profileChanged = false;
    for (const component of selected) {
      if (component.flow) {
        const activeFlowId = nextProfile.activeFlowId;
        if (activeFlowId && activeFlowId !== component.flow.id && typeof window !== 'undefined') {
          // 003：包内流程切换同样给出替换清单。
          const previousFlow = SKILL_SERIES_FLOWS.find((flow) => flow.id === activeFlowId);
          const confirmedReplace = await appConfirm(
            '替换当前创作流程？',
            `切换到「${component.flow.name || component.flow.id}」将替换当前流程「${previousFlow?.name || activeFlowId}」；以下内容将被重置：流程步骤进度。`,
            { confirmLabel: '确认替换' }
          );
          if (!confirmedReplace) {
            setPackageComponentResults((current) => ({
              ...current,
              [component.step.id]: 'conflict',
            }));
            continue;
          }
        }
        nextProfile = { ...nextProfile, activeFlowId: component.flow.id };
        profileChanged = true;
        nextPendingSteps.push(component.step);
        setPackageComponentResults((current) => ({
          ...current,
          [component.step.id]: 'recommended',
        }));
      } else if (component.asset) {
        const type = getGovernanceCapabilityType(component.asset);
        if (type === 'diagnostic' || type === 'utility') {
          setPackageComponentResults((current) => ({
            ...current,
            [component.step.id]: 'recommended',
          }));
          nextPendingSteps.push(component.step);
          void recordCapabilityEvent({
            eventName: 'capability_package_component_selected',
            stage: 'advanced',
            result: 'success',
            novelId: selectedNovel.id,
            objectId: component.asset.id,
          });
          continue;
        }
        if (type !== 'technique' && type !== 'skill-card') continue;
        const manifest = getCapabilityManifest(component.asset);
        if (isLicensedEnhancementGated(manifest.sourceType, isFreeNovel)) {
          setPackageComponentResults((current) => ({
            ...current,
            [component.step.id]: 'unavailable',
          }));
          dispatchCapabilityUnavailable({
            limitType: 'extractSkill',
            count: 5,
            max: 5,
            error: '当前商业化实验配置未开放该授权增强能力；其他已选能力仍可继续配置。',
            novelId: selectedNovel.id,
          });
          continue;
        }
        const existing = savedSkills.find(
          (skill) =>
            (skill.parentSkillId || skill.id) ===
              (component.asset?.parentSkillId || component.asset?.id) &&
            skill.sourceType === component.asset?.sourceType &&
            skill.version === (Number(manifest.version) || 1)
        );
        const persistedId =
          manifest.sourceType === 'built-in' && type === 'technique'
            ? component.asset.id
            : existing?.id;
        if (!persistedId) {
          setPackageComponentResults((current) => ({ ...current, [component.step.id]: 'skipped' }));
          continue;
        }
        nextProfile = upsertCapabilityMembership(nextProfile, {
          sourceId: component.asset.parentSkillId || component.asset.id,
          sourceVersion: manifest.version || '1',
          sourceType: manifest.sourceType,
          persistedSkillId: persistedId,
        });
        // Membership is part of the staged project profile even when this
        // package component only becomes a deck candidate. Without marking
        // the draft dirty, a skill-card-only package appears to do nothing
        // and its source mapping is lost on the next refresh.
        profileChanged = true;
        nextPendingSteps.push(component.step);
        if (
          type === 'technique' &&
          component.step.scope === 'project' &&
          !(nextProfile.projectTechniqueIds || []).includes(persistedId)
        ) {
          nextProfile = {
            ...nextProfile,
            projectTechniqueIds: [...(nextProfile.projectTechniqueIds || []), persistedId],
          };
        } else if (type === 'skill-card') {
          const deckResult = addCardToProjectDeck(nextProfile, persistedId);
          if (deckResult.requiresReplacement) nextCandidates.push(persistedId);
          else nextProfile = deckResult.profile;
        }
        setPackageComponentResults((current) => ({
          ...current,
          [component.step.id]: 'recommended',
        }));
      } else {
        setPackageComponentResults((current) => ({
          ...current,
          [component.step.id]: 'unavailable',
        }));
      }
    }
    if (profileChanged)
      stageConfiguration(buildV3CapabilityProfile(effectiveNovel, nextProfile).capabilityProfile);
    if (nextPendingSteps.length > 0) {
      setPendingPackageSteps((current) => [
        ...current.filter((step) => !nextPendingSteps.some((next) => next.id === step.id)),
        ...nextPendingSteps,
      ]);
    }
    if (nextCandidates.length > 0) {
      setCandidateCardIds((current) => [...new Set([...current, ...nextCandidates])]);
    }
    setPackageSelections([]);
    setPackageSelectionDrafts((current) => {
      const rest = { ...current };
      delete rest[selectedPackage.id];
      return rest;
    });
    void recordCapabilityEvent({
      eventName: 'capability_package_expanded',
      stage: 'advanced',
      result: 'success',
      novelId: selectedNovel.id,
      objectId: selectedPackage.id,
    });
    if (!profileChanged) return null;
    return {
      capabilityProfile: buildV3CapabilityProfile(effectiveNovel, nextProfile).capabilityProfile,
      steps: nextPendingSteps,
    };
  };

  return (
    <div className="h-full flex bg-transparent relative overflow-hidden">
      <div ref={studioScrollRef} className="flex-1 overflow-y-auto p-8 relative z-10">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-serif font-bold text-theme-text flex items-center justify-center gap-3">
            <Wand2 size={28} className="text-theme-accent" />
            作品能力中心
          </h1>
          <p className="text-theme-muted mt-2">
            管理作品默认能力与本章写法；应用配置后，作品卡组影响后续正文，本章使用规则只影响当前章。
          </p>
        </div>

        <div className="max-w-6xl mx-auto mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
            <div className="text-xs font-bold text-theme-text">当前创作流程</div>
            <p className="mt-2 text-sm font-semibold text-theme-accent">
              {activeFlow?.name || '未选择流程'}
            </p>
            <p className="mt-1 text-[11px] text-theme-muted">
              {activeFlow ? '当前作品已选择' : '手写流程不受影响'}
            </p>
          </div>
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
            <div className="text-xs font-bold text-theme-text">常用技法</div>
            <p className="mt-2 text-sm font-semibold text-theme-accent">
              {(configurationDraft || capabilityProfile)?.favoriteTechniqueIds.length || 0} 张已收藏
            </p>
            <p className="mt-1 text-[11px] text-theme-muted">按阶段选择，不占作品卡组</p>
          </div>
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
            <div className="text-xs font-bold text-theme-text">作品卡组</div>
            <p className="mt-2 text-sm font-semibold text-theme-accent">
              {projectDeckIds.length} / 3
            </p>
            <p className="mt-1 text-[11px] text-theme-muted">
              仅拆书卡占用：一张主卡，最多两张辅卡
            </p>
            <div className="mt-2 space-y-1 text-[10px] leading-4">
              {deckSummaryCards.map(({ slot, card }) => (
                <p
                  key={slot}
                  className={cn('truncate', card ? 'text-theme-text' : 'text-theme-muted')}
                >
                  <span className="font-bold text-theme-text">{slot}：</span>
                  {card
                    ? `${card.title} · 用途：${getDeckDimensionSummary(card.dimensions)}`
                    : '未设置'}
                </p>
              ))}
              <p className="text-theme-muted">
                <span className="font-bold text-theme-text">空位：</span>
                {deckEmptyHint}
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-theme-text">护栏状态</div>
              <button
                type="button"
                onClick={() => setGuardrailPolicyOpen(true)}
                className="shrink-0 rounded-lg border border-theme-border px-2 py-1 text-[10px] font-bold text-theme-text hover:bg-theme-border/30"
              >
                管理
              </button>
            </div>
            <p className="mt-2 text-sm font-semibold text-emerald-600">
              默认 {CORE_DEFAULT_GUARDRAIL_COUNT} 条已自动生效
            </p>
            <p className="mt-1 text-[11px] text-theme-muted">
              增强护栏已开启 {currentGuardrailIds.length} 条，追加在默认检查之后。
            </p>
          </div>
        </div>

        {hasLegacyConfiguration && (
          <div className="max-w-6xl mx-auto mb-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-theme-text">
            <div className="font-bold">旧配置待整理</div>
            <p className="mt-1 text-xs text-theme-muted">
              检测到历史能力配置。这里仅提供迁移预览，不会静默改写；现有写作流程继续可用。
            </p>
            <button
              type="button"
              className="mt-3 rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-bold text-amber-700"
              onClick={async () => {
                if (!selectedNovel) return;
                setMigrationBusy(true);
                setMigrationError(null);
                try {
                  const generation = await getDatabaseGenerationSafe();
                  setMigrationPreview(
                    await previewCapabilityMigration(selectedNovel.id, generation)
                  );
                } catch (error) {
                  setMigrationError(error instanceof Error ? error.message : '迁移预览失败');
                } finally {
                  setMigrationBusy(false);
                }
              }}
            >
              查看整理入口
            </button>
          </div>
        )}

        {selectedNovel && (
          <LegacyArtifactStructuringPrompt key={selectedNovel.id} novelId={selectedNovel.id} />
        )}

        <div className="max-w-6xl mx-auto mb-8 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
          <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-theme-text">
              <Sparkles size={18} className="text-theme-accent" />
              能力卡如何影响写作
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                {
                  label: '分镜',
                  detail: '影响下一章的场景选择、冲突推进和节奏密度。',
                  icon: BrainCircuit,
                },
                { label: '正文', detail: '约束文风、句法、人物口吻和叙事颗粒度。', icon: PenLine },
                {
                  label: '审查',
                  detail: '帮助 AI 用同一套标准检查跑偏、重复和节奏问题。',
                  icon: CheckCircle2,
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-theme-border bg-theme-bg/50 p-4"
                  >
                    <div className="flex items-center gap-2 text-sm font-bold text-theme-text">
                      <Icon size={15} className="text-theme-accent" />
                      {item.label}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-theme-muted">{item.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
            <div className="text-sm font-bold text-theme-text">当前作品</div>
            <p className="mt-2 text-xs leading-5 text-theme-muted">
              {selectedNovel
                ? `《${selectedNovel.title}》能力配置`
                : '先在书库选择作品，再管理能力。'}
            </p>
            {stageLaunchHint && (
              <p className="mt-2 rounded-lg border border-theme-accent/30 bg-theme-accent/5 px-3 py-2 text-xs leading-5 text-theme-text">
                {stageLaunchHint}
              </p>
            )}
            {isStarterEligible && (
              <div
                className="mt-3 rounded-xl border border-theme-accent/30 bg-theme-accent/5 p-3"
                data-testid="starter-config-card"
              >
                <p className="text-xs leading-5 text-theme-text">
                  保底配置：官方去 AI 味规则卡（95 分）+ 长篇商业连载流程；护栏默认已生效。
                </p>
                <button
                  type="button"
                  data-testid="apply-starter-config"
                  onClick={() => {
                    const presetProfile =
                      buildV3CapabilityProfile(effectiveNovel, STARTER_PROFILE_PRESET)
                        .capabilityProfile;
                    if (presetProfile) void applyConfiguration(true, 'return', presetProfile);
                  }}
                  disabled={isApplyingConfiguration}
                  className="mt-2 w-full rounded-lg bg-theme-accent px-3 py-2 text-xs font-bold text-theme-accent-contrast disabled:opacity-60"
                >
                  {isApplyingConfiguration ? '正在套用…' : '套用保底配置并返回写作'}
                </button>
              </div>
            )}
            {returnHint && <p className="mt-2 text-xs leading-5 text-theme-muted">{returnHint}</p>}
            <button
              type="button"
              onClick={handleReturnToWriting}
              className="mt-4 w-full rounded-2xl border border-theme-border px-4 py-3 text-sm font-bold text-theme-text transition-colors hover:border-theme-accent"
            >
              {returnLabel}
            </button>
          </div>
        </div>

        {/* TAB Switcher */}
        <div className="max-w-6xl mx-auto mb-8 flex justify-center border-b border-theme-border/30 pb-px">
          <div className="flex gap-8">
            <button
              type="button"
              onClick={() => setActiveTab('mySkills')}
              className={cn(
                'pb-4 text-base font-bold transition-all relative',
                activeTab === 'mySkills'
                  ? 'text-theme-text font-black'
                  : 'text-theme-muted hover:text-theme-text'
              )}
            >
              我的能力卡
              {activeTab === 'mySkills' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-theme-accent rounded-full" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('plaza')}
              className={cn(
                'pb-4 text-base font-bold transition-all relative flex items-center gap-1.5',
                activeTab === 'plaza'
                  ? 'text-theme-text font-black'
                  : 'text-theme-muted hover:text-theme-text'
              )}
            >
              <Sparkles
                size={14}
                className={cn('text-amber-500', activeTab === 'plaza' && 'animate-pulse')}
              />
              能力商店
              {activeTab === 'plaza' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full" />
              )}
            </button>
          </div>
        </div>

        {(configurationDirty || configurationError) && (
          <div
            className="max-w-6xl mx-auto mb-6 rounded-xl border border-theme-accent/40 bg-theme-accent/5 p-4"
            role="status"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-theme-text">本次配置</div>
                <p className="mt-1 text-xs text-theme-muted">
                  {staleConfigurationSession
                    ? '这是旧版本草稿，仅供查看。请先重新预览，确认当前作品状态后再应用。'
                    : '本次配置仍待应用；应用成功后才更新作品状态。'}
                </p>
                {!staleConfigurationSession && (
                  <p className="mt-1 text-xs text-theme-muted">{CAPABILITY_RETURN_EFFECT_HINT}</p>
                )}
                {configurationError && (
                  <p role="alert" className="mt-1 text-xs text-red-600">
                    {configurationError}
                  </p>
                )}
              </div>
              {candidateCardIds.length > 0 && (
                <div className="w-full rounded-lg border border-theme-border bg-theme-bg/40 p-3">
                  <div className="text-xs font-bold text-theme-text">待提交的卡组位置</div>
                  <p className="mt-1 text-[11px] text-theme-muted">
                    选择主卡或辅卡后仍是待提交状态；点击应用配置才会写入作品卡组。
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {candidateCardIds.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded border border-theme-border px-2 py-1 text-[11px] text-theme-text"
                      >
                        {CURATED_PRODUCT_SKILLS.find((asset) => asset.id === id)?.title ||
                          savedSkills.find((skill) => skill.id === id)?.name ||
                          id}
                        <button
                          type="button"
                          disabled={staleConfigurationSession}
                          onClick={() => stageCandidateCard(id, 'main')}
                          className="rounded border border-theme-border px-1.5 py-0.5 text-[10px]"
                        >
                          设为主卡
                        </button>
                        <button
                          type="button"
                          disabled={staleConfigurationSession}
                          onClick={() => stageCandidateCard(id, 'support')}
                          className="rounded border border-theme-border px-1.5 py-0.5 text-[10px]"
                        >
                          设为辅卡
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => void applyConfiguration(true)}
                disabled={!selectedNovel || isApplyingConfiguration}
                className="rounded-lg bg-theme-text px-4 py-2 text-xs font-bold text-theme-accent-contrast disabled:opacity-50"
              >
                {staleConfigurationSession
                  ? '重新预览本次配置'
                  : configurationApplyFailed
                    ? '重试应用配置并返回写作'
                    : '应用配置并返回写作'}
              </button>
            </div>
          </div>
        )}

        {/* MySkills Tab Content */}
        {activeTab === 'mySkills' && (
          <>
            {savedSkills.length > 0 && (
              <>
                <div className="max-w-6xl mx-auto mb-8">
                  <SkillMapPanel skills={savedSkills} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6 max-w-6xl mx-auto">
                  {savedSkills.map((s) => (
                    <SkillCard
                      key={s.id}
                      skill={s}
                      selected={s.id === selectedSkillId}
                      onOpen={() => setSelectedSkillId(s.id)}
                      onDelete={() => handleDeleteSkill(s.id)}
                      userNovels={userNovels}
                      onEquip={
                        isRuntimeReadySkillCard(s)
                          ? (novelId) => {
                              if (novelId !== selectedNovel?.id) {
                                setConfigurationError('请先切换到目标作品，再启用所选能力。');
                                return;
                              }
                              addCandidateSkill(s.id);
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              </>
            )}

            {savedSkills.length === 0 && (
              <div className="mt-12 text-center text-theme-muted/60 p-16 border-2 border-dashed border-theme-border rounded-3xl bg-theme-sidebar/30 max-w-2xl mx-auto flex flex-col items-center">
                <div className="w-16 h-16 rounded-2xl bg-theme-accent/10 flex items-center justify-center text-theme-accent mb-6">
                  <Wand2 size={32} />
                </div>
                <h3 className="text-xl font-bold text-theme-text mb-2">你还没有保存能力卡</h3>
                <p className="text-sm max-w-md text-theme-muted mb-8 leading-relaxed">
                  这里还没有可配置到作品的专属 AI
                  写作能力。先生成或挑选能力卡，再选择卡组位置或应用配置；使用范围会在卡片上标明。
                </p>
                <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
                  <button
                    type="button"
                    onClick={() => onNavigate?.('factory')}
                    className="px-6 py-3 rounded-2xl bg-theme-text text-theme-bg font-bold text-sm hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  >
                    <Sparkles size={15} />
                    去拆书工厂生成拆书卡
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('plaza')}
                    className="px-6 py-3 rounded-2xl border border-theme-border hover:border-theme-accent text-theme-text hover:text-theme-accent hover:bg-theme-accent/5 font-bold text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  >
                    <BrainCircuit size={15} />
                    去能力商店挑选预设卡
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Plaza Tab Content */}
        {activeTab === 'plaza' && (
          <div className="max-w-6xl mx-auto space-y-8 pb-12 text-left">
            {/* Plan 226 症候入口：先说「要解决什么」，再看货架。 */}
            <div
              className="flex flex-wrap items-center gap-2"
              data-testid="symptom-nav"
              aria-label="按要解决的问题筛选能力卡"
            >
              <span className="text-[11px] font-bold text-theme-muted">这章要解决什么：</span>
              {CAPABILITY_SYMPTOMS.map((symptom) => {
                const active = activeSymptomKey === symptom.key;
                return (
                  <button
                    key={symptom.key}
                    type="button"
                    aria-pressed={active}
                    title={symptom.hint}
                    onClick={() => {
                      setActiveSymptomKey((prev) => (prev === symptom.key ? null : symptom.key));
                      if (selectedCapability !== 'optional-style')
                        setSelectedCapability('optional-style');
                    }}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-bold border transition-colors',
                      active
                        ? 'bg-theme-accent/15 border-theme-accent text-theme-accent'
                        : 'border-theme-border text-theme-muted hover:text-theme-text'
                    )}
                  >
                    {symptom.label}
                  </button>
                );
              })}
              {activeSymptomKey && (
                <button
                  type="button"
                  onClick={() => setActiveSymptomKey(null)}
                  className="px-2 py-1 rounded-full text-[11px] text-theme-muted hover:text-theme-text border border-dashed border-theme-border"
                >
                  清除筛选
                </button>
              )}
            </div>
            <div
              role="tablist"
              aria-label="能力治理类别"
              className="flex flex-wrap gap-2 border-b border-theme-border/25 pb-3"
            >
              {(
                [
                  ['flow', '创作流程'],
                  ['technique', '写作技法'],
                  ['skill-card', '拆书卡'],
                  ['diagnostic-tools', '审稿与精修'],
                  ['optional-style', '文风与正文'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={selectedCapability === id}
                  type="button"
                  onClick={() => setSelectedCapability(id)}
                  className={cn(
                    'px-3 py-2 rounded-lg text-xs font-bold border',
                    selectedCapability === id
                      ? 'bg-theme-sidebar border-theme-accent text-theme-text'
                      : 'border-transparent text-theme-muted hover:text-theme-text'
                  )}
                >
                  {label} <span className="ml-1 text-[10px]">{capabilityTabCount(id)}</span>
                </button>
              ))}
              <button
                role="tab"
                aria-selected={selectedCapability === 'packages'}
                type="button"
                onClick={() => setSelectedCapability('packages')}
                className={cn(
                  'px-3 py-2 rounded-lg text-xs font-bold border',
                  selectedCapability === 'packages'
                    ? 'bg-theme-sidebar border-theme-accent text-theme-text'
                    : 'border-transparent text-theme-muted hover:text-theme-text'
                )}
              >
                能力包 <span className="ml-1 text-[10px]">{capabilityTabCount('packages')}</span>
              </button>
            </div>
            {/* 次级阶段过滤 */}
            {selectedCapability !== 'packages' && (
              <div className="flex flex-wrap gap-2 border-b border-theme-border/25 pb-4">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={cn(
                    'px-3 py-2 rounded-lg text-xs font-bold border',
                    selectedCategory === 'all'
                      ? 'border-theme-accent text-theme-text'
                      : 'border-transparent text-theme-muted'
                  )}
                >
                  全部阶段
                </button>
                {(
                  [
                    {
                      id: 'creative-setup',
                      label: '① 立设定与大纲',
                      desc: '世界观、人设、黄金三章',
                    },
                    {
                      id: 'active-drafting',
                      label: '② 写正文与提速',
                      desc: '流程、口吻、场面推进',
                    },
                    { id: 'style-polish', label: '③ 审稿与精修', desc: '去AI腔、套话、逻辑检查' },
                    {
                      id: 'commercial-sign',
                      label: '④ 过签与平台检查',
                      desc: '番茄阅文、爽点、完读率',
                    },
                  ] as const
                ).map((cat) => {
                  const isSelected = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={cn(
                        'px-4 py-2.5 rounded-lg text-xs font-bold transition-all flex flex-col items-start gap-0.5 border text-left',
                        isSelected
                          ? 'bg-theme-sidebar border-theme-accent text-theme-text shadow-sm'
                          : 'bg-transparent border-transparent text-theme-muted hover:text-theme-text hover:bg-theme-sidebar/30'
                      )}
                    >
                      <span>{cat.label}</span>
                      <span className="text-[9px] font-normal opacity-80 scale-90 origin-left block truncate max-w-[120px]">
                        {cat.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedCapability === 'packages' && (
              <section aria-labelledby="capability-packages-title" className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h2
                      id="capability-packages-title"
                      className="text-sm font-bold text-theme-text"
                    >
                      能力包
                    </h2>
                    <p className="mt-1 text-[11px] text-theme-muted">
                      能力包会把流程、技法、拆书卡和辅助动作拆成可勾选步骤；勾选后点「启用所选」即生效，可撤销。
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] text-theme-muted">勾选待提交</span>
                </div>
                <div className="space-y-5">
                  {groupedPackages.map((group) => (
                    <section
                      key={group.id}
                      aria-labelledby={`capability-package-group-${group.id}`}
                      className="space-y-2"
                    >
                      <h3
                        id={`capability-package-group-${group.id}`}
                        className="text-[11px] font-bold text-theme-text"
                      >
                        {group.title}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {group.packages.map((pkg) => (
                          <div
                            key={pkg.id}
                            className="rounded-xl border border-theme-border/70 bg-theme-sidebar p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-theme-text">{pkg.name}</h4>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  <span className="rounded border border-theme-border/40 bg-theme-bg px-1.5 py-0.5 text-[9px] font-bold text-theme-text">
                                    {getPackageUseLabel(pkg.id)}
                                  </span>
                                  <span className="rounded border border-theme-border/40 bg-theme-bg px-1.5 py-0.5 text-[9px] text-theme-muted">
                                    {getPackageStageSummary(pkg)}
                                  </span>
                                </div>
                                <p className="mt-1 text-[10px] leading-4 text-theme-muted">
                                  {pkg.intendedOutcome || pkg.description}
                                </p>
                                {(packageSelectionDrafts[pkg.id]?.length || 0) > 0 && (
                                  <p className="mt-1 text-[10px] font-bold text-theme-accent">
                                    已勾选 {packageSelectionDrafts[pkg.id].length} 项，待提交
                                  </p>
                                )}
                              </div>
                              <span
                                className={cn(
                                  'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold',
                                  pkg.type === 'paid'
                                    ? isFreeNovel
                                      ? 'bg-amber-500/10 text-amber-600'
                                      : 'bg-emerald-500/10 text-emerald-600'
                                    : 'bg-emerald-500/10 text-emerald-600'
                                )}
                              >
                                {getPackageAvailabilityLabel(
                                  pkg,
                                  !isFreeNovel,
                                  monetizationEnabled
                                )}
                              </span>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <span className="text-[10px] text-theme-muted">
                                {getEnhancementPackageSteps(pkg).length} 项能力
                              </span>
                              <button
                                type="button"
                                className="rounded-lg border border-theme-border px-3 py-1.5 text-[10px] font-bold text-theme-text hover:border-theme-accent"
                                onClick={() => {
                                  setSelectedPackageId(pkg.id);
                                  setPackageResultLaunchFeedbackAssetId(null);
                                  setPackageSelections(packageSelectionDrafts[pkg.id] || []);
                                }}
                              >
                                {getPackageOpenButtonLabel(pkg, !isFreeNovel, monetizationEnabled)}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            )}

            {/* 货架卡主渲染区域 */}
            {selectedCapability !== 'packages' && (
              <div className="space-y-8">
                <div className="border-l-2 border-theme-accent pl-3.5 mb-6">
                  <h2 className="text-base font-bold text-theme-text">
                    {selectedCategory === 'all'
                      ? '全部阶段'
                      : selectedCategory === 'creative-setup'
                        ? '① 立设定与大纲'
                        : selectedCategory === 'active-drafting'
                          ? '② 写正文与提速'
                          : selectedCategory === 'style-polish'
                            ? '③ 审稿与精修'
                            : '④ 过签与平台检查'}
                  </h2>
                  <p className="text-[11px] text-theme-muted mt-1">
                    {selectedCategory === 'all'
                      ? '跨阶段浏览设定、大纲、正文、审稿与精修能力，按当前创作节点选择并应用。'
                      : selectedCategory === 'creative-setup'
                        ? '先选世界观、人设与黄金三章能力，搭好长篇骨架再开写。'
                        : selectedCategory === 'active-drafting'
                          ? '选择作者流程、口吻技法和场面推进卡，让章节写作更稳定。'
                          : selectedCategory === 'style-polish'
                            ? '写完后先跑审稿卡，再用精修卡处理套话、逻辑和局部润色。'
                            : '准备投平台前，用过签检查、爽点评分和完读率诊断做最后校准。'}
                  </p>
                </div>

                {/* 创作流程的唯一选择与详情入口 */}
                {selectedCapability === 'flow' &&
                  (selectedCategory === 'all' ||
                    selectedCategory === 'creative-setup' ||
                    selectedCategory === 'active-drafting') && (
                    <div className="space-y-6 pb-6 border-b border-theme-border/20 text-left">
                      <div className="flex items-center gap-2">
                        <Sparkles size={14} className="text-amber-500 animate-pulse" />
                        <div>
                          <h3 className="text-xs font-bold text-theme-text">创作流程目录</h3>
                          <p className="mt-1 text-[10px] text-theme-muted">
                            这里是唯一的创作流程选择与详情入口。
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {SKILL_SERIES_FLOWS.filter((flow) => visibleFlowIds.includes(flow.id)).map(
                          (flow) => {
                            const meta = goldenFlowMetadata[flow.id] || {
                              target: '通用作者',
                              output: '全生命周期大纲正文',
                              color:
                                'from-theme-border/20 to-theme-border/10 border-theme-border/30',
                            };
                            const isActive = configurationDraft?.activeFlowId === flow.id;
                            const isLocked = isLicensedEnhancementGated(
                              getCatalogCapabilityManifest(flow.id)?.sourceType,
                              isFreeNovel
                            );

                            return (
                              <div
                                key={flow.id}
                                className={cn(
                                  'relative rounded-xl p-5 border bg-gradient-to-br flex flex-col justify-between transition-all duration-200 group text-left',
                                  meta.color,
                                  isActive
                                    ? 'ring-1 ring-emerald-500/50 border-emerald-500/40 bg-emerald-500/[0.02]'
                                    : 'hover:border-theme-border/80 hover:shadow-sm'
                                )}
                              >
                                <div>
                                  <div className="flex justify-between items-start gap-2 mb-2">
                                    <h3 className="font-bold text-theme-text text-sm group-hover:text-theme-accent transition-colors flex items-center gap-1.5 min-w-0">
                                      <span className="truncate">{flow.name}</span>
                                    </h3>
                                    <div className="flex gap-1 shrink-0">
                                      {isActive && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                          已选流程
                                        </span>
                                      )}
                                      {isLocked && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                          授权增强
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <p className="text-[11px] text-theme-muted mb-3 line-clamp-2 min-h-[2rem]">
                                    {flow.description}
                                  </p>

                                  <div className="space-y-1.5 mb-4 text-[10px]">
                                    <div className="flex justify-between border-b border-theme-border/10 pb-1">
                                      <span className="text-theme-muted">适用人群:</span>
                                      <span className="text-theme-text font-medium">
                                        {meta.target}
                                      </span>
                                    </div>
                                    <div className="flex justify-between pt-0.5">
                                      <span className="text-theme-muted">预期产物:</span>
                                      <span className="text-theme-text font-medium">
                                        {meta.output}
                                      </span>
                                    </div>
                                  </div>

                                  {/* 进度节点迷你时间轴预览 */}
                                  <FlowTimelinePreview flow={flow} />
                                </div>

                                <div className="mt-5">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      flowDetailTriggerRef.current = event.currentTarget;
                                      setSelectedFlowDetail(flow);
                                    }}
                                    className={cn(
                                      'w-full py-2.5 rounded-lg text-xs font-bold transition-all text-center flex items-center justify-center gap-1',
                                      isActive
                                        ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 border border-emerald-500/20'
                                        : isLocked
                                          ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm'
                                          : 'bg-theme-text text-theme-bg hover:opacity-90'
                                    )}
                                  >
                                    免密预览流程详情
                                    {isActive && (
                                      <CheckCircle2 size={12} className="text-emerald-500" />
                                    )}
                                  </button>
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>
                  )}

                {/* 推荐的辅助写作精品卡 */}
                <div className="space-y-4">
                  {selectedCategory === 'active-drafting' && (
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} className="text-theme-accent animate-pulse" />
                      <h3 className="text-xs font-bold text-theme-text">辅助写作推荐能力卡</h3>
                    </div>
                  )}

                  {selectedCapability === 'optional-style' &&
                    filteredCuratedSkills.length > 0 && (
                      /* Plan 195 切片 C Step 2：货架分组渲染迁 skills/StyleShelf。 */
                      /* Plan 225：供给分区——官方规范（保修）与社区配方（自验）先分区再列卡。 */
                      <div className="space-y-8">
                        {[
                          { key: 'official', label: '官方规范', note: '随版本升级 · 效果由 InkFlow 保修', assets: supplyPartitions.official },
                          { key: 'community', label: '社区配方', note: '社区供给 · 已消毒 · 效果请自验', assets: supplyPartitions.community },
                        ]
                          .filter((region) => region.assets.length > 0)
                          .map((region) => (
                            <section key={region.key}>
                              <div className="flex items-center justify-between gap-2 mb-3">
                                <h3 className="text-xs font-bold text-theme-text">
                                  {region.label}
                                  <span className="ml-2 text-[10px] font-normal text-theme-muted">
                                    {region.assets.length} 张
                                  </span>
                                </h3>
                                <span
                                  className="rounded-full border border-theme-border px-2 py-0.5 text-[10px] text-theme-muted"
                                  title={region.note}
                                >
                                  {region.note}
                                </span>
                              </div>
                              <StyleShelf
                                selectedNovel={selectedNovel}
                                assets={region.assets}
                                isFavorited={(asset) =>
                                  isTechniqueFavorited(asset) || isGuardrailCandidate(asset)
                                }
                                isImported={isAssetPersisted}
                                cloningAssetId={cloningAssetId}
                                isFreeNovel={isFreeNovel}
                                onApplyDeck={handleApplyDeck}
                                isCardConfigured={isDeckCardConfigured}
                                handlers={{
                                  onImport: handleImportAsset,
                                  onEquip: handleEquipAsset,
                                  onUseTechnique: handleUseTechnique,
                                  onUseProjectTechnique: handleUseProjectTechnique,
                                  onDirectExec: handleDirectExec,
                                  onSanitize: handleSanitizeAndEnable,
                                }}
                              />
                            </section>
                          ))}
                      </div>
                    )}
                  {selectedCapability !== 'optional-style' && filteredCuratedSkills.length > 0 ? (
                    <>
                      {availableCuratedSkills.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                          {availableCuratedSkills.map((asset) => (
                            <PlazaAssetCard
                              key={asset.id}
                              asset={asset}
                              isImported={isAssetPersisted(asset)}
                              isFavorited={
                                isTechniqueFavorited(asset) || isGuardrailCandidate(asset)
                              }
                              isCloning={cloningAssetId === asset.id}
                              selectedNovel={selectedNovel || null}
                              isFreeNovel={isFreeNovel}
                              onImport={() => handleImportAsset(asset)}
                              onEquip={() => handleEquipAsset(asset)}
                              onUseTechnique={() => handleUseTechnique(asset)}
                              onUseProjectTechnique={() => handleUseProjectTechnique(asset)}
                              onDirectExec={() => handleDirectExec(asset)}
                            />
                          ))}
                        </div>
                      )}
                      {lockedCuratedSkills.length > 0 && (
                        <details className="rounded-xl border border-theme-border/60 bg-theme-bg/40">
                          <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold text-theme-muted">
                            需解锁（{lockedCuratedSkills.length}）· 消毒或授权后可用
                          </summary>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 px-4 pb-4">
                            {lockedCuratedSkills.map((asset) => (
                              <PlazaAssetCard
                                key={asset.id}
                                asset={asset}
                                isImported={isAssetPersisted(asset)}
                                isFavorited={
                                  isTechniqueFavorited(asset) || isGuardrailCandidate(asset)
                                }
                                isCloning={cloningAssetId === asset.id}
                                selectedNovel={selectedNovel || null}
                                isFreeNovel={isFreeNovel}
                                onImport={() => handleImportAsset(asset)}
                                onEquip={() => handleEquipAsset(asset)}
                                onUseTechnique={() => handleUseTechnique(asset)}
                                onUseProjectTechnique={() => handleUseProjectTechnique(asset)}
                                onDirectExec={() => handleDirectExec(asset)}
                                onSanitize={() => void handleSanitizeAndEnable(asset)}
                              />
                            ))}
                          </div>
                        </details>
                      )}
                    </>
                  ) : (
                    <div className="py-12 text-center text-theme-muted text-xs border border-dashed border-theme-border rounded-lg">
                      该航道暂无精品卡，敬请期待
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Plan 195 切片 C Step 4：能力包配置弹窗迁 skills/PackageConfigDialog
          （选择簇/会话态/货架数据自订阅，编排动作由视图注入）。 */}
      <PackageConfigDialog
        selectedNovel={selectedNovel}
        selectedPackage={selectedPackage}
        selectedPackageId={selectedPackageId}
        projectDeckIds={projectDeckIds}
        cloningAssetId={cloningAssetId}
        isApplyingConfiguration={isApplyingConfiguration}
        actionRefs={{ result: packageResultActionRef, apply: packageApplyActionRef }}
        onApply={applyConfiguration}
        onApplyPackage={handleApplyPackage}
        onLaunchResult={handleLaunchPackageResult}
        onStageCandidate={stageCandidateCard}
        onImportAsset={handleImportAsset}
        onRepreview={handleDialogRepreview}
        onClose={() => setSelectedPackageId(null)}
        onNavigateLibrary={() => onNavigate?.('library')}
      />

      {guardrailPolicyOpen && selectedNovel && (
        <GuardrailPolicyPanel
          enhancedGuardrails={CONFIGURABLE_GUARDRAIL_ASSETS}
          enabledIds={currentGuardrailIds}
          onToggle={(asset) => {
            void handleEquipAsset(asset);
          }}
          onClose={() => setGuardrailPolicyOpen(false)}
        />
      )}

      {selectedFlowDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={flowDialogTitleId}
          data-capability-flow-dialog="true"
        >
          {/* Backdrop with backdrop-blur */}
          <div
            className="absolute inset-0 bg-theme-bg/60 backdrop-blur-md transition-opacity"
            onClick={() => setSelectedFlowDetail(null)}
          />

          {/* Glassmorphism Container */}
          <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-theme-sidebar/95 border border-theme-border/60 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-6 border-b border-theme-border/30 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-theme-accent/10 text-theme-accent">
                    <BrainCircuit size={18} />
                  </span>
                  <h2
                    id={flowDialogTitleId}
                    className="text-xl font-serif font-bold text-theme-text"
                  >
                    {selectedFlowDetail.name}
                  </h2>
                </div>
                <p className="text-xs text-theme-muted mt-1.5 leading-relaxed">
                  {selectedFlowDetail.description}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭流程详情"
                onClick={() => setSelectedFlowDetail(null)}
                className="p-1.5 rounded-lg hover:bg-theme-border/20 text-theme-muted hover:text-theme-text transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content with Custom Scrollbar */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="relative pl-6 border-l-2 border-theme-border/50 space-y-8">
                {selectedFlowDetail.steps.map((step, idx) => {
                  return (
                    <div key={step.id} className="relative group text-left">
                      {/* Timeline Dot */}
                      <span className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full border-2 border-theme-accent bg-theme-bg flex items-center justify-center text-[9px] font-black text-theme-accent font-mono shadow-sm group-hover:scale-110 transition-transform">
                        {step.stepNumber}
                      </span>

                      {/* Step Header */}
                      <div className="flex flex-wrap items-baseline gap-2 mb-1.5">
                        <h4 className="font-bold text-sm text-theme-text">{step.name}</h4>
                        <span className="text-[9px] font-mono text-theme-muted uppercase tracking-wider bg-theme-bg px-1.5 py-0.5 rounded border border-theme-border/45">
                          {step.input} ➔ {step.output}
                        </span>
                      </div>

                      {/* Step Description */}
                      <p className="text-xs text-theme-muted leading-relaxed mb-3 pr-2">
                        {step.description}
                      </p>

                      {/* Quality Gate with amber-themed badge */}
                      {step.qualityGate && (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/5 text-amber-500 border border-amber-500/10 text-[10px]">
                          <ShieldAlert
                            size={11}
                            className="shrink-0 text-amber-500/80 animate-pulse"
                          />
                          <span className="font-bold shrink-0">质量门栏:</span>
                          <span className="font-sans line-clamp-1 text-amber-500/90">
                            {step.qualityGate}
                          </span>
                        </div>
                      )}

                      {/* Visual Arrow Connector (except last one) */}
                      {idx < selectedFlowDetail.steps.length - 1 && (
                        <div className="absolute -left-[27px] bottom-[-22px] text-theme-border/40">
                          <ArrowDown size={10} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action Bar */}
            <div className="p-6 border-t border-theme-border/30 bg-theme-bg/30 flex gap-3">
              <button
                type="button"
                onClick={() => setSelectedFlowDetail(null)}
                className="flex-1 py-2.5 text-xs font-bold border border-theme-border hover:border-theme-text rounded-xl text-theme-text transition-all bg-transparent"
              >
                返回
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedFlowDetail(null);
                  handleActivateFlow(selectedFlowDetail.id);
                }}
                className={cn(
                  'flex-1 py-2.5 text-xs font-bold rounded-xl text-white transition-all flex items-center justify-center gap-1.5',
                  isLicensedEnhancementGated(
                    getCatalogCapabilityManifest(selectedFlowDetail.id)?.sourceType,
                    isFreeNovel
                  )
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : 'bg-theme-accent hover:opacity-90'
                )}
              >
                {isLicensedEnhancementGated(
                  getCatalogCapabilityManifest(selectedFlowDetail.id)?.sourceType,
                  isFreeNovel
                ) && <Lock size={12} />}
                激活该创作主流程
              </button>
            </div>
          </div>
        </div>
      )}

      {leavePromptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={leaveDialogTitleId}
        >
          <div className="w-full max-w-md rounded-xl border border-theme-border bg-theme-sidebar p-5 shadow-xl">
            <h2 id={leaveDialogTitleId} className="text-base font-bold text-theme-text">
              能力配置尚未应用
            </h2>
            <p className="mt-2 text-xs leading-5 text-theme-muted">
              离开前请选择如何处理当前作品未应用的能力配置。
            </p>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                className="rounded-lg bg-theme-text px-3 py-2 text-xs font-bold text-theme-bg"
                onClick={() => setLeavePromptOpen(false)}
              >
                继续配置
              </button>
              <button
                type="button"
                className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-bold text-red-600"
                onClick={abandonConfiguration}
              >
                放弃变更
              </button>
              <button
                type="button"
                className="rounded-lg border border-theme-border px-3 py-2 text-xs font-bold text-theme-text disabled:opacity-50"
                disabled={!selectedNovel || isApplyingConfiguration}
                onClick={() => {
                  setLeavePromptOpen(false);
                  void applyConfiguration(true);
                }}
              >
                应用并返回
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Plan 195 切片 C Step 3：候选托盘迁 skills/CandidateTray（替换编排留在视图）。 */}
      <CandidateTray
        projectDeckIds={projectDeckIds}
        resolveDeckCard={resolveDeckCard}
        onReplaceDeckCard={handleReplaceDeckCard}
        onCancel={cancelPendingCandidate}
      />

      <SkillDetailDrawer
        skill={selectedSkill}
        allSkills={savedSkills}
        open={Boolean(selectedSkill)}
        onClose={() => setSelectedSkillId(null)}
        onSelectSkill={(id) => setSelectedSkillId(id)}
        novelId={selectedNovel?.id || ''}
        chapterId={targetChapterId}
        databaseGeneration={databaseGeneration ?? undefined}
        styleConfirmationFingerprint={
          selectedNovel?.projectPreferenceProfile?.writingStyleConfirmation?.fingerprint
        }
      />
      {migrationPreview && selectedNovel && (
        <CapabilityMigrationPreviewPanel
          preview={migrationPreview}
          error={migrationError}
          busy={migrationBusy}
          onClose={() => {
            setMigrationPreview(null);
            setMigrationError(null);
          }}
          onConfirm={async () => {
            setMigrationBusy(true);
            setMigrationError(null);
            try {
              const result = await applyCapabilityMigration(
                selectedNovel.id,
                migrationPreview.databaseGeneration,
                migrationPreview.previewToken
              );
              const migratedPreference = buildV3CapabilityProfile(
                effectiveNovel,
                result.profile as Partial<ProjectCapabilityProfile>
              );
              const profile = migratedPreference.capabilityProfile;
              if (!profile) throw new Error('迁移结果缺少有效能力配置');
              setUserNovels((prev) =>
                prev.map((entry) =>
                  entry.id === selectedNovel.id
                    ? { ...entry, projectPreferenceProfile: migratedPreference }
                    : entry
                )
              );
              onNovelUpdated?.({ ...selectedNovel, projectPreferenceProfile: migratedPreference });
              setConfigurationDraft(profile);
              setConfigurationDirty(false);
              setMigrationPreview(null);
              void recordCapabilityEvent({
                eventName: 'skill_deck_applied',
                stage: 'advanced',
                result: 'success',
                novelId: selectedNovel.id,
                objectId: 'migration',
              });
            } catch (error) {
              const message =
                error instanceof CapabilityMigrationError && error.status === 409
                  ? '预览已过期，请重新预览。'
                  : error instanceof Error
                    ? error.message
                    : '迁移应用失败';
              setMigrationError(message);
            } finally {
              setMigrationBusy(false);
            }
          }}
        />
      )}
      <AlertDialog
        open={Boolean(skillToDeleteId)}
        onOpenChange={(open) => !open && setSkillToDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这张能力卡？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将删除这张写作能力卡，并从所有使用它的作品中移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDeleteSkill}
              className="bg-red-600 hover:bg-red-700 text-white font-bold"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
