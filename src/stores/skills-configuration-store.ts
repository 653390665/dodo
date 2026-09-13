import { create } from 'zustand';
import type { Novel, ProjectCapabilityProfile } from '../../shared/types';
import type { EnhancementPackageStep } from '../../shared/types/prompt-assets-governed';
import type { GovernanceCapabilityType, GovernanceStage } from '../lib/capability-governance';
import * as dbTransport from '../lib/db-transport';
import {
  getCapabilityConfigurationBaselineToken,
  isCapabilityConfigurationSessionStale,
  loadCapabilityConfigurationSession,
  loadLatestCapabilityConfigurationSession,
  saveCapabilityConfigurationSession,
  type CapabilityConfigurationSession,
  type CapabilitySessionCategory,
  type CapabilitySessionStoreTab,
  type CapabilitySessionTab,
} from '../lib/capability-configuration-session';
import { createProductEventSessionId } from '../lib/product-events-client';
import { getProjectCapabilityProfile } from '../lib/skills-studio-governance';
import { useSkillsCandidateStore } from './skills-candidate-store';

/**
 * 能力配置会话簇状态（Plan 195 切片 A：自 SkillsStudioView 迁出）。
 *
 * configurationDraft / configurationDirty / staleConfigurationSession / databaseGeneration
 * 是与数据库代际、工作切换、会话恢复耦合最深的行为敏感状态（plan158 安全网覆盖：
 * 持久化失败 / 代际过期 / 脏配置失败路径）。setter 镜像 useState 语义
 * （值或函数式更新），迁移不改变调用点行为。
 *
 * 三段同步 effect 与伴随 effect 的编排下沉为 onWorkSwitch / onGenerationSnapshot /
 * hydrateSession / persistSession / syncDraftWithProfile action（原视图层的
 * set-state-in-effect / purity / exhaustive-deps 抑制随迁移消化）。
 * 视图层仍持有的会话绑定控件（页签、过滤、弹层）经 ConfigurationSessionViewBridge 读写；
 * 自应用豁免窗口（selfAppliedContextRef + flagAge < 5000）保持 ref 语义由视图传入，
 * 保证每次挂载窗口重置，与迁移前逐行等价。
 */
interface SkillsConfigurationState {
  configurationDraft: ProjectCapabilityProfile | null;
  configurationDirty: boolean;
  staleConfigurationSession: boolean;
  databaseGeneration: number | null;
  setConfigurationDraft: (
    value:
      | ProjectCapabilityProfile
      | null
      | ((current: ProjectCapabilityProfile | null) => ProjectCapabilityProfile | null)
  ) => void;
  setConfigurationDirty: (value: boolean) => void;
  setStaleConfigurationSession: (value: boolean) => void;
  setDatabaseGeneration: (value: number | null) => void;
  onWorkSwitch: (
    novel: Pick<Novel, 'id' | 'projectPreferenceProfile'>,
    options: { initialStage?: GovernanceStage; viewBridge: ConfigurationSessionViewBridge }
  ) => void;
  onGenerationSnapshot: (
    novelId: string | null,
    refs: { sessionContextRef: SessionStringRef; configurationSessionIdRef: SessionStringRef }
  ) => () => void;
  hydrateSession: (options: {
    novelId: string | null;
    databaseGeneration: number | null;
    baselineToken: string;
    projectPreferenceProfile: Novel['projectPreferenceProfile'] | null;
    initialStage?: GovernanceStage;
    sessionContextRef: SessionStringRef;
    configurationSessionIdRef: SessionStringRef;
    selfAppliedContextRef: { current: number };
    scrollRef: { current: { scrollTop: number } | null };
    viewBridge: ConfigurationSessionViewBridge;
  }) => void;
  /** Plan 203 Step 3：会话持久化（原视图持久化 effect，含上下文键守卫）。 */
  persistSession: (options: {
    novelId: string | null;
    databaseGeneration: number | null;
    baselineToken: string;
    staleConfigurationSession: boolean;
    configurationDirty: boolean;
    configurationDraft: ProjectCapabilityProfile | null;
    pendingPackageSteps: EnhancementPackageStep[];
    candidateCardIds: string[];
    pendingCandidateId: string | null;
    activeTab: CapabilitySessionTab;
    selectedCapability: CapabilitySessionStoreTab;
    selectedCategory: CapabilitySessionCategory;
    selectedAssetId: string | null;
    sessionContextRef: SessionStringRef;
    configurationSessionIdRef: SessionStringRef;
    scrollRef: { current: { scrollTop: number } | null };
  }) => void;
  /** Plan 203 Step 3：未暂存编辑时把本地草稿与服务端作品偏好对齐（原视图 draft 同步 effect）。 */
  syncDraftWithProfile: (options: {
    /** 仅用于保持原 effect 依赖口径（effectiveNovel?.id）；派生只依赖 projectPreferenceProfile。 */
    novelId: string | null;
    projectPreferenceProfile: Novel['projectPreferenceProfile'] | null;
    configurationDirty: boolean;
  }) => void;
  /**
   * 卸载时重置会话簇状态。原 useState 按挂载初始化（代际快照每次挂载从 null 重读），
   * 模块级 store 若跨挂载残留会改变 effect 的首轮编排时序（如 hydrate 抢跑、
   * 被 draft 同步的旧闭包覆盖），因此视图卸载时由视图调用本 action 归零。
   */
  resetForRemount: () => void;
}

/** 视图层会话绑定控件类型（原 SkillsStudioView 的 StoreTab，与持久化会话类型同域）。 */
export type CapabilityStudioTab =
  GovernanceCapabilityType | 'diagnostic-tools' | 'packages' | 'optional-style';

/** 195 切片 A：编辑器阶段入口的能力页签初始值（原视图 useCallback，纯函数）。 */
export function getInitialCapabilityTab(stage?: GovernanceStage): CapabilityStudioTab {
  return stage === 'style-polish' ? 'diagnostic-tools' : 'flow';
}

type DatabaseGenerationReader = () => Promise<number>;

export function getDatabaseGenerationReader(): DatabaseGenerationReader | null {
  try {
    const reader = (
      dbTransport as unknown as { getDatabaseGenerationSnapshot?: DatabaseGenerationReader }
    ).getDatabaseGenerationSnapshot;
    return typeof reader === 'function' ? reader : null;
  } catch {
    return null;
  }
}

export async function getDatabaseGenerationSafe(): Promise<number> {
  return (await getDatabaseGenerationReader()?.()) ?? 0;
}

interface SessionStringRef {
  current: string | null;
}

/**
 * 会话绑定视图控件桥：会话编排 action 中视图层仍持有的控件
 * （页签/过滤/弹层/增强包选择簇）由视图以稳定 setter 实现本接口，
 * store 不持有 React state。切片 B 落地后 setPendingPackageSteps 将收口为包 store 直写。
 */
export interface ConfigurationSessionViewBridge {
  /** 工作切换 / 上下文失效：重置所有会话绑定的视图控件。 */
  resetSessionBoundView(initialStage: GovernanceStage | undefined): void;
  /**
   * 会话上下文失效且无会话可恢复时的视图重置。
   * 与工作切换的唯一差异：不清 packageSelectionDrafts（未打开包的勾选草稿保留）。
   */
  resetForContextChange(initialStage: GovernanceStage | undefined): void;
  /** 会话恢复：initialStage 优先（编辑器阶段入口进入）。 */
  restoreViewForStage(initialStage: GovernanceStage): void;
  /** 会话恢复：按持久化快照恢复视图控件。 */
  restoreViewFromSession(view: {
    activeTab: CapabilitySessionTab;
    selectedCapability: CapabilitySessionStoreTab;
    selectedCategory: CapabilitySessionCategory;
    selectedAssetId: string | null;
  }): void;
  /** 会话恢复 / 重置：写回待提交增强包步骤（切片 B 收口为包 store）。 */
  setPendingPackageSteps(steps: EnhancementPackageStep[]): void;
}

export const useSkillsConfigurationStore = create<SkillsConfigurationState>((set) => ({
  configurationDraft: null,
  configurationDirty: false,
  staleConfigurationSession: false,
  databaseGeneration: null,
  setConfigurationDraft: (value) =>
    set((state) => ({
      configurationDraft: typeof value === 'function' ? value(state.configurationDraft) : value,
    })),
  setConfigurationDirty: (value) => set({ configurationDirty: value }),
  setStaleConfigurationSession: (value) => set({ staleConfigurationSession: value }),
  setDatabaseGeneration: (value) => set({ databaseGeneration: value }),
  onWorkSwitch: (novel, options) => {
    const { initialStage, viewBridge } = options;
    set({
      configurationDraft: getProjectCapabilityProfile(novel),
      configurationDirty: false,
    });
    const candidate = useSkillsCandidateStore.getState();
    candidate.setCandidateCardIds([]);
    candidate.setPendingCandidateId(null);
    viewBridge.resetSessionBoundView(initialStage);
  },
  onGenerationSnapshot: (novelId, refs) => {
    let cancelled = false;
    if (!novelId) {
      // This effect owns the external database-generation snapshot and must clear it when the work changes.
      set({ databaseGeneration: null });
      refs.sessionContextRef.current = null;
      refs.configurationSessionIdRef.current = null;
      set({ staleConfigurationSession: false });
      return () => {
        cancelled = true;
      };
    }
    const readGeneration = getDatabaseGenerationReader();
    if (!readGeneration) {
      set({ databaseGeneration: 0 });
      return () => {
        cancelled = true;
      };
    }
    void readGeneration()
      .then((generation) => {
        if (!cancelled) set({ databaseGeneration: generation });
      })
      .catch(() => {
        if (!cancelled) set({ databaseGeneration: null });
      });
    return () => {
      cancelled = true;
    };
  },
  hydrateSession: (options) => {
    const {
      novelId,
      databaseGeneration,
      baselineToken,
      projectPreferenceProfile,
      initialStage,
      sessionContextRef,
      configurationSessionIdRef,
      selfAppliedContextRef,
      scrollRef,
      viewBridge,
    } = options;
    if (!novelId || databaseGeneration === null) return;
    const capabilityProfile = getProjectCapabilityProfile({
      projectPreferenceProfile: projectPreferenceProfile ?? undefined,
    });
    const contextKey = `${novelId}:${databaseGeneration}:${baselineToken}`;
    const hadSessionContext = sessionContextRef.current !== null;
    const contextChanged = sessionContextRef.current !== contextKey;
    // 自家 apply 造成的上下文变化只在短暂窗口内被豁免一次；超过窗口的
    // flag 视为残留（如幂等应用未改变 baseline），避免吞掉真正的外部漂移。
    const flagAge = selfAppliedContextRef.current
      ? Date.now() - selfAppliedContextRef.current
      : Number.POSITIVE_INFINITY;
    if (contextChanged && flagAge < 5000) {
      selfAppliedContextRef.current = 0;
      sessionContextRef.current = contextKey;
      return;
    }
    const latest = loadLatestCapabilityConfigurationSession(novelId);
    const restored = loadCapabilityConfigurationSession(novelId, databaseGeneration, baselineToken);
    const stale = Boolean(
      latest && isCapabilityConfigurationSessionStale(latest, databaseGeneration, baselineToken)
    );
    sessionContextRef.current = contextKey;
    set({ staleConfigurationSession: stale });
    const sessionToRestore = restored || latest;
    const sessionPrefix = `capability:${novelId}:`;
    configurationSessionIdRef.current =
      sessionToRestore?.sessionId ||
      (configurationSessionIdRef.current?.startsWith(sessionPrefix)
        ? configurationSessionIdRef.current
        : null) ||
      `${sessionPrefix}${createProductEventSessionId('configuration')}`;
    if (!sessionToRestore) {
      // The novel-switch effect already clears project-bound state. Avoid
      // overwriting a user's first click while the initial generation read
      // finishes; only a later database-generation change needs another reset.
      if (contextChanged && hadSessionContext) {
        set({ configurationDraft: capabilityProfile, configurationDirty: false });
        const candidate = useSkillsCandidateStore.getState();
        candidate.setCandidateCardIds([]);
        candidate.setPendingCandidateId(null);
        viewBridge.resetForContextChange(initialStage);
      }
      return;
    }
    // Hydrate the draft from the persisted session after the external snapshot is available.
    set({ configurationDraft: sessionToRestore.configurationDraft || capabilityProfile });
    useSkillsCandidateStore.getState().setCandidateCardIds(sessionToRestore.candidateCardIds);
    viewBridge.setPendingPackageSteps(sessionToRestore.pendingPackageSteps || []);
    useSkillsCandidateStore.getState().setPendingCandidateId(sessionToRestore.pendingCandidateId);
    if (initialStage) {
      viewBridge.restoreViewForStage(initialStage);
    } else {
      viewBridge.restoreViewFromSession({
        activeTab: sessionToRestore.activeTab,
        selectedCapability: sessionToRestore.selectedCapability,
        selectedCategory: sessionToRestore.selectedCategory,
        selectedAssetId: sessionToRestore.selectedAssetId,
      });
    }
    const restoreScroll = () => {
      if (scrollRef.current) scrollRef.current.scrollTop = sessionToRestore.scrollTop;
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
      window.requestAnimationFrame(restoreScroll);
    else restoreScroll();
    const restoredDraftToken = getCapabilityConfigurationBaselineToken(
      sessionToRestore.configurationDraft
    );
    const hasPendingSessionWork =
      sessionToRestore.candidateCardIds.length > 0 ||
      (sessionToRestore.pendingPackageSteps?.length || 0) > 0 ||
      Boolean(sessionToRestore.pendingCandidateId);
    set({
      configurationDirty: Boolean(restoredDraftToken !== baselineToken || hasPendingSessionWork),
    });
  },
  persistSession: (options) => {
    const {
      novelId,
      databaseGeneration,
      baselineToken,
      staleConfigurationSession,
      configurationDraft,
      pendingPackageSteps,
      candidateCardIds,
      pendingCandidateId,
      activeTab,
      selectedCapability,
      selectedCategory,
      selectedAssetId,
      sessionContextRef,
      configurationSessionIdRef,
      scrollRef,
    } = options;
    // configurationDirty 不参与守卫，仅由视图依赖数组承载“脏状态翻转需重存”的原口径。
    if (staleConfigurationSession || !novelId || databaseGeneration === null) return;
    if (sessionContextRef.current !== `${novelId}:${databaseGeneration}:${baselineToken}`) return;
    const session: CapabilityConfigurationSession = {
      version: 1,
      novelId,
      databaseGeneration,
      baselineToken,
      configurationDraft,
      pendingPackageSteps,
      sessionId: configurationSessionIdRef.current || undefined,
      candidateCardIds,
      pendingCandidateId,
      activeTab,
      selectedCapability,
      selectedCategory,
      selectedAssetId,
      scrollTop: scrollRef.current?.scrollTop || 0,
      // Session ordering is not used for restoration; keep this value deterministic.
      updatedAt: 0,
    };
    saveCapabilityConfigurationSession(session);
  },
  syncDraftWithProfile: (options) => {
    const { projectPreferenceProfile, configurationDirty } = options;
    if (configurationDirty) return;
    // Keep the local draft aligned with the server profile when no edits are staged.
    set({
      configurationDraft: getProjectCapabilityProfile({
        projectPreferenceProfile: projectPreferenceProfile ?? undefined,
      }),
    });
  },
  resetForRemount: () => {
    set({
      configurationDraft: null,
      configurationDirty: false,
      staleConfigurationSession: false,
      databaseGeneration: null,
    });
  },
}));
