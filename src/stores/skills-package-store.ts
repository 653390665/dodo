import { create } from 'zustand';
import type { CapabilityApplicationStatus } from '../../shared/types/capability-execution';
import type { EnhancementPackageStep } from '../../shared/types/prompt-assets-governed';

/**
 * 增强包选择簇状态（Plan 195 切片 B：自 SkillsStudioView 迁出）。
 *
 * setter 镜像 useState 语义（值或函数式更新），迁移不改变调用点行为；
 * 会话恢复/保存的 package 字段经 ConfigurationSessionViewBridge 直写本 store
 * （hydrateSession 的 setPendingPackageSteps 桥实现即 store setter）。
 *
 * 清空时机与原视图逐点一致：工作切换（resetSessionBoundView）清
 * selections/pendingSteps/drafts，但 componentResults 与 launchFeedback
 * 不随工作切换清空；二者仅在视图卸载时由 resetForRemount 归零，
 * 对齐原 useState 的按挂载初始化语义。
 */
interface SkillsPackageState {
  packageSelections: string[];
  pendingPackageSteps: EnhancementPackageStep[];
  packageSelectionDrafts: Record<string, string[]>;
  packageComponentResults: Record<string, CapabilityApplicationStatus>;
  packageResultLaunchFeedbackAssetId: string | null;
  setPackageSelections: (value: string[] | ((current: string[]) => string[])) => void;
  setPendingPackageSteps: (
    value:
      | EnhancementPackageStep[]
      | ((current: EnhancementPackageStep[]) => EnhancementPackageStep[])
  ) => void;
  setPackageSelectionDrafts: (
    value:
      | Record<string, string[]>
      | ((current: Record<string, string[]>) => Record<string, string[]>)
  ) => void;
  setPackageComponentResults: (
    value:
      | Record<string, CapabilityApplicationStatus>
      | ((
          current: Record<string, CapabilityApplicationStatus>
        ) => Record<string, CapabilityApplicationStatus>)
  ) => void;
  setPackageResultLaunchFeedbackAssetId: (value: string | null) => void;
  resetForRemount: () => void;
}

export const useSkillsPackageStore = create<SkillsPackageState>((set) => ({
  packageSelections: [],
  pendingPackageSteps: [],
  packageSelectionDrafts: {},
  packageComponentResults: {},
  packageResultLaunchFeedbackAssetId: null,
  setPackageSelections: (value) =>
    set((state) => ({
      packageSelections: typeof value === 'function' ? value(state.packageSelections) : value,
    })),
  setPendingPackageSteps: (value) =>
    set((state) => ({
      pendingPackageSteps: typeof value === 'function' ? value(state.pendingPackageSteps) : value,
    })),
  setPackageSelectionDrafts: (value) =>
    set((state) => ({
      packageSelectionDrafts:
        typeof value === 'function' ? value(state.packageSelectionDrafts) : value,
    })),
  setPackageComponentResults: (value) =>
    set((state) => ({
      packageComponentResults:
        typeof value === 'function' ? value(state.packageComponentResults) : value,
    })),
  setPackageResultLaunchFeedbackAssetId: (value) => set({ packageResultLaunchFeedbackAssetId: value }),
  resetForRemount: () => {
    set({
      packageSelections: [],
      pendingPackageSteps: [],
      packageSelectionDrafts: {},
      packageComponentResults: {},
      packageResultLaunchFeedbackAssetId: null,
    });
  },
}));

/** 提交禁用口径的输入（全部由视图派生：作品、包受限态、组件清单与勾选结果）。 */
export interface PackageSubmitDisabledInput {
  hasNovel: boolean;
  restrictedPackage: boolean;
  selectionCount: number;
  packageHasResults: boolean;
  missingRequiredLabels: string[];
  staleConfigurationSession: boolean;
  packageHasStaleSelection: boolean;
}

/**
 * 提交按钮禁用原因（原视图派生块整体迁入，纯函数）。
 * 返回 null 表示可提交；否则返回面向用户的禁用文案。
 */
export function computePackageSubmitDisabledReason(
  input: PackageSubmitDisabledInput
): string | null {
  const {
    hasNovel,
    restrictedPackage,
    selectionCount,
    packageHasResults,
    missingRequiredLabels,
    staleConfigurationSession,
    packageHasStaleSelection,
  } = input;
  if (!hasNovel) {
    return selectionCount > 0
      ? '请先在书库选择作品后再启用所选能力'
      : '请先在书库选择作品';
  }
  if (restrictedPackage && selectionCount > 0) {
    return '当前作品未开通授权增强；可查看步骤，需授权后再启用所选能力。';
  }
  if (selectionCount === 0) {
    return packageHasResults ? '如需继续提交，请先勾选新能力' : '至少选择一项能力';
  }
  if (missingRequiredLabels.length > 0) {
    return `请先选择必需能力：${missingRequiredLabels.join('、')}`;
  }
  if (staleConfigurationSession && packageHasStaleSelection) {
    return '本次配置已变化，请先重新预览';
  }
  return null;
}
