import type { RefObject } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from '../../lib/toast';
import { canUseEnhancedCapability, isMonetizationEnabled } from '../../lib/entitlements';
import {
  CURATED_PRODUCT_SKILLS,
  getEnhancementPackageSteps,
  SKILL_SERIES_FLOWS,
} from '../../../shared/lib/public-skill-catalog';
import { getCatalogCapabilityManifest } from '../../../shared/lib/capability-manifest-catalog';
import type {
  CuratedProductSkill,
  EnhancementPackage,
  EnhancementPackageStep,
  SkillSeriesFlow,
} from '../../../shared/types/prompt-assets-governed';
import type { Novel } from '../../../shared/types';
import type { CapabilityApplicationStatus } from '../../../shared/types/capability-execution';
import type { WorldCapabilityLaunchIntent } from '../../../shared/types/capability-manifest';
import {
  getGovernanceCapabilityType,
  getCapabilitySourceLabel,
  type GovernanceCapabilityType,
} from '../../lib/capability-governance';
import {
  getAuthorFacingCapabilityActionHint,
  getAuthorFacingCapabilityActionLabel,
  getAuthorFacingCapabilityScopeLabel,
} from '../../lib/capability-stage-cards';
import type { buildV3CapabilityProfile } from '../../lib/skills-studio-governance';
import {
  isOutlineCandidateOutput,
  isWorldCandidateArtifact,
} from '../../lib/skills-studio-governance';
import {
  computePackageSubmitDisabledReason,
  useSkillsPackageStore,
} from '../../stores/skills-package-store';
import { useSkillsConfigurationStore } from '../../stores/skills-configuration-store';
import { useSkillsShelfStore } from '../../stores/skills-shelf-store';

export const CAPABILITY_RETURN_EFFECT_HINT =
  '应用配置后，主卡与辅卡影响作品后续正文；常用技法作为作品偏好；本章使用规则只影响当前章；系统护栏参与生成与审稿检查。';

type CapabilityProfileDraft = ReturnType<typeof buildV3CapabilityProfile>['capabilityProfile'];
type CapabilityApplyDestination = 'return' | 'world' | 'outline';

function getCapabilityApplyButtonLabel(destination: CapabilityApplyDestination): string {
  if (destination === 'world') return '应用配置并前往世界观';
  if (destination === 'outline') return '应用配置并前往大纲';
  return '应用并返回写作';
}

function getPackageSubmitButtonLabel(hasResults: boolean, selectionCount: number): string {
  if (hasResults && selectionCount === 0) return '先勾选要启用的能力';
  return '启用所选';
}

function getPackageEmptySelectionHint(
  hasResults: boolean,
  selectionCount: number,
  hasPendingConfiguration: boolean
): string | null {
  if (!hasResults || selectionCount > 0) return null;
  if (hasPendingConfiguration) return null;
  return '勾选后点击「启用所选」即生效，可撤销。';
}

function getPackageModeLabel(
  mode: EnhancementPackageStep['mode'],
  manifest?: ReturnType<typeof getCatalogCapabilityManifest>
): string {
  if (mode === 'configure') return '启用（作品默认）';
  if (mode === 'schedule' && manifest?.output === 'transform-preview')
    return '启用（写入本章规则）';
  if (mode === 'schedule') return '写到这里时提醒';
  if (mode === 'run-now' && manifest)
    return getAuthorFacingCapabilityActionLabel(manifest, 'single-run') || '运行（一次性）';
  if (mode === 'run-now') return '运行（一次性）';
  return '稍后选择';
}

function getPackageResultLabel(
  status: CapabilityApplicationStatus,
  step: EnhancementPackageStep,
  manifest: ReturnType<typeof getCatalogCapabilityManifest> | undefined,
  capabilityType: GovernanceCapabilityType | string | undefined,
  resultCandidateInDeck = false
): string {
  const isPolishPreview = manifest?.output === 'transform-preview';
  const isRunTool = manifest?.action === 'run-diagnostic' || manifest?.kind === 'utility';
  const isProjectTechnique = capabilityType === 'technique' && step.scope === 'project';
  // Destination-aware result copy mirrors packageApplyDestination's manifest
  // logic so applied rows point at the same panel the apply path launches.
  const destinationResult = isWorldCandidateArtifact(manifest?.outputArtifact)
    ? '下一步：应用配置后前往世界观设定'
    : isOutlineCandidateOutput(manifest?.output) &&
        !isWorldCandidateArtifact(manifest?.outputArtifact)
      ? '下一步：应用配置后前往大纲面板'
      : '下一步：应用配置后写入作品';
  if (status === 'configured') return destinationResult;
  if (status === 'scheduled')
    return isPolishPreview ? '下一步：应用配置后写入本章规则' : '下一步：应用配置后写入写前提醒';
  if (status === 'run') {
    if (isPolishPreview) return '下一步：精修预览待生成';
    if (manifest?.action === 'run-diagnostic') return '下一步：审稿诊断待运行';
    if (isRunTool) return '下一步：辅助动作待运行';
    return '下一步：待运行';
  }
  if (status === 'recommended') {
    if (step.mode === 'schedule' && isPolishPreview) return '下一步：应用配置后写入本章规则';
    if (step.mode === 'run-now' && isPolishPreview) return '下一步：精修预览待生成';
    if (step.mode === 'run-now' && manifest?.action === 'run-diagnostic')
      return '下一步：审稿诊断待运行';
    if (step.mode === 'run-now' && isRunTool) return '下一步：辅助动作待运行';
    if (isProjectTechnique) return destinationResult;
    if (capabilityType === 'flow') return '下一步：应用配置后写入创作流程';
    if (capabilityType === 'skill-card')
      return resultCandidateInDeck
        ? '下一步：应用配置后写入作品卡组'
        : '下一步：选择卡组位置后应用';
    return '下一步：应用配置后写入作品';
  }
  if (status === 'unavailable') return '结果：不可用，已跳过';
  if (status === 'conflict') return '结果：存在冲突，未更改';
  return '结果：已跳过';
}

function getPackageScopeLabel(scope: EnhancementPackageStep['scope']): string {
  if (scope === 'project' || scope === 'chapter' || scope === 'single-run') {
    return getAuthorFacingCapabilityScopeLabel(scope);
  }
  if (scope === 'volume') return '本卷使用';
  return '选区使用';
}

function getPackageComponentActionHint(
  flow: SkillSeriesFlow | null,
  manifest: ReturnType<typeof getCatalogCapabilityManifest> | undefined
): string | null {
  if (flow) return '配置到作品：应用配置后写入创作流程。';
  if (!manifest) return null;
  return getAuthorFacingCapabilityActionHint(manifest);
}

function getPackageNextStepHint(packageId: string): string {
  if (packageId.includes('audit') || packageId.includes('diagnostic'))
    return '勾选后点「启用所选」，诊断立即运行';
  if (packageId.includes('humanization') || packageId.includes('patch'))
    return '勾选后点「启用所选」，预览生成后确认应用';
  if (packageId.includes('continuity') || packageId.includes('deconstruction'))
    return '勾选拆书卡，启用后自动放入卡组空位';
  return '勾选后点「启用所选」即生效，可撤销';
}

function getPackageRecommendedPath(packageId: string): string {
  if (packageId.includes('audit') || packageId.includes('diagnostic'))
    return '先勾必选审稿项，启用后诊断立即运行。';
  if (packageId.includes('humanization') || packageId.includes('patch'))
    return '先勾写前规则，再按需勾写后预览项。';
  if (packageId.includes('onboarding'))
    return '建议两个设定项一起勾选，先生成世界观，再接人物弧线。';
  if (packageId.includes('first-chapter')) return '先勾开篇结构，再按需选择正文表达技法。';
  if (packageId.includes('continuity'))
    return '按当前作品短板选择一张节奏卡或悬念卡，启用后自动放入卡组空位。';
  if (packageId.includes('deconstruction')) return '先选主笔文风卡，再补一张节奏或钩子卡。';
  if (packageId.includes('platform')) return '先运行开篇钩子诊断，再按目标平台补充检查项。';
  return '先勾当前阶段最需要的一项，启用后即生效。';
}

interface PackageConfigDialogProps {
  selectedNovel: Novel | null | undefined;
  selectedPackage: EnhancementPackage | null;
  selectedPackageId: string | null;
  /** 重新预览（视图侧守卫无作品时给出配置错误提示）。 */
  onRepreview: () => void;
  projectDeckIds: string[];
  cloningAssetId: string | null;
  isApplyingConfiguration: boolean;
  actionRefs: {
    result: RefObject<HTMLButtonElement | null>;
    apply: RefObject<HTMLButtonElement | null>;
  };
  onApply: (
    returnToWriting?: boolean,
    destination?: CapabilityApplyDestination,
    profileOverride?: CapabilityProfileDraft | null,
    projectLaunchAssetId?: string,
    worldCapabilityLaunch?: WorldCapabilityLaunchIntent,
    packageStepsOverride?: EnhancementPackageStep[]
  ) => Promise<void>;
  onApplyPackage: () => Promise<
    { capabilityProfile: CapabilityProfileDraft; steps: EnhancementPackageStep[] } | null | undefined
  >;
  onLaunchResult: (asset: CuratedProductSkill) => void;
  onStageCandidate: (candidateId: string, slot: 'main' | 'support') => void;
  onImportAsset: (asset: CuratedProductSkill) => Promise<string | null | undefined>;
  onClose: () => void;
  onNavigateLibrary: () => void;
}

/**
 * 能力包配置弹窗（Plan 195 切片 C Step 4 自 SkillsStudioView 内联迁出）。
 *
 * 增强包选择簇（skills-package-store）、会话态（skills-configuration-store）与
 * 货架数据（skills-shelf-store）自订阅；编排类动作（应用配置/单动词启用/
 * 候选入组/导入）由视图经 props 注入。组件内派生（提交禁用口径、应用去向、
 * 各按钮文案）与原视图逐分支等价，仅消费面收窄到本弹窗。
 */
export function PackageConfigDialog({
  selectedNovel,
  selectedPackage,
  selectedPackageId,
  onRepreview,
  projectDeckIds,
  cloningAssetId,
  isApplyingConfiguration,
  actionRefs,
  onApply,
  onApplyPackage,
  onLaunchResult,
  onStageCandidate,
  onImportAsset,
  onClose,
  onNavigateLibrary,
}: PackageConfigDialogProps) {
  const packageSelections = useSkillsPackageStore((state) => state.packageSelections);
  const setPackageSelections = useSkillsPackageStore((state) => state.setPackageSelections);
  const setPackageSelectionDrafts = useSkillsPackageStore(
    (state) => state.setPackageSelectionDrafts
  );
  const packageComponentResults = useSkillsPackageStore(
    (state) => state.packageComponentResults
  );
  const packageResultLaunchFeedbackAssetId = useSkillsPackageStore(
    (state) => state.packageResultLaunchFeedbackAssetId
  );
  const configurationDraft = useSkillsConfigurationStore((state) => state.configurationDraft);
  const configurationDirty = useSkillsConfigurationStore((state) => state.configurationDirty);
  const staleConfigurationSession = useSkillsConfigurationStore(
    (state) => state.staleConfigurationSession
  );
  const savedSkills = useSkillsShelfStore((state) => state.savedSkills);
  // 组件顶部解构 ref 对象，渲染期仅附加 ref 本体（不读 current）。
  const { result: resultActionRef, apply: applyActionRef } = actionRefs;
  if (!selectedPackage) return null;
  const restricted = Boolean(
    selectedPackage.type === 'paid' && isMonetizationEnabled() &&
    (!selectedNovel ||
      !canUseEnhancedCapability({
        commercialMode: selectedNovel.projectPreferenceProfile?.commercialMode,
      }))
  );

  const packageComponents = (
    selectedPackage ? getEnhancementPackageSteps(selectedPackage) : []
  ).map((step) => {
    const assetId = step.assetId;
    const asset = CURATED_PRODUCT_SKILLS.find((entry) => entry.id === assetId) || null;
    const flow = SKILL_SERIES_FLOWS.find((entry) => entry.id === assetId) || null;
    const manifest = getCatalogCapabilityManifest(assetId);
    return { assetId, asset, flow, manifest, step };
  });
  const getPackageComponentLabel = (component: (typeof packageComponents)[number]) =>
    component.flow?.name || component.asset?.title || component.assetId;
  const isPackageStepSelected = (component: (typeof packageComponents)[number]) =>
    packageSelections.includes(component.step.id) || packageSelections.includes(component.assetId);
  const isConfigurationPackageComponent = (component: (typeof packageComponents)[number]) => {
    if (component.flow) return true;
    if (!component.asset) return false;
    const type = getGovernanceCapabilityType(component.asset);
    return type !== 'diagnostic' && type !== 'utility';
  };
  const getPackageResultLaunchLabel = (
    applyResult: CapabilityApplicationStatus,
    step: EnhancementPackageStep,
    manifest: ReturnType<typeof getCatalogCapabilityManifest> | undefined,
    asset: CuratedProductSkill | null
  ): string | null => {
    if (applyResult !== 'recommended' && applyResult !== 'run') return null;
    if (!asset || !manifest || step.mode !== 'run-now') return null;
    const isPreviewOnlyTransform =
      manifest.output === 'transform-preview' && manifest.sideEffect === 'preview-only';
    if (manifest.action === 'run-diagnostic') return '运行审稿诊断';
    if (isPreviewOnlyTransform) return '生成精修预览';
    if (getGovernanceCapabilityType(asset) === 'utility') return '运行辅助动作';
    return null;
  };
  const packageHasStaleSelection = packageComponents.some(
    (component) => isPackageStepSelected(component) && isConfigurationPackageComponent(component)
  );
  const packageHasResults = packageComponents.some(
    (component) =>
      packageComponentResults[component.step.id] || packageComponentResults[component.assetId]
  );
  const packageApplyDestination: CapabilityApplyDestination = packageComponents.some(
    (component) => {
      const status =
        packageComponentResults[component.step.id] || packageComponentResults[component.assetId];
      return Boolean(status && isWorldCandidateArtifact(component.manifest?.outputArtifact));
    }
  )
    ? 'world'
    : packageComponents.some((component) => {
          const status =
            packageComponentResults[component.step.id] ||
            packageComponentResults[component.assetId];
          return Boolean(
            status &&
            isOutlineCandidateOutput(component.manifest?.output) &&
            !isWorldCandidateArtifact(component.manifest?.outputArtifact)
          );
        })
      ? 'outline'
      : 'return';
  const packageApplyButtonLabel = getCapabilityApplyButtonLabel(packageApplyDestination);
  const packageSubmitButtonLabel = getPackageSubmitButtonLabel(
    packageHasResults,
    packageSelections.length
  );
  const packageEmptySelectionHint = getPackageEmptySelectionHint(
    packageHasResults,
    packageSelections.length,
    configurationDirty && !staleConfigurationSession
  );
  const missingRequiredPackageLabels = packageComponents
    .filter((component) => component.step.required && !isPackageStepSelected(component))
    .map(getPackageComponentLabel);
  // Plan 195 切片 B：提交禁用口径收口为包 store 模块的纯函数（原派生块逐分支等价迁入）。
  const packageSubmitDisabledReason = computePackageSubmitDisabledReason({
    hasNovel: Boolean(selectedNovel),
    restrictedPackage: restricted,
    selectionCount: packageSelections.length,
    packageHasResults,
    missingRequiredLabels: missingRequiredPackageLabels,
    staleConfigurationSession,
    packageHasStaleSelection,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="capability-package-title"
    >
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-theme-border bg-theme-sidebar p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="capability-package-title" className="text-base font-bold text-theme-text">
              {selectedPackage.name}
            </h2>
            <p className="mt-1 text-xs leading-5 text-theme-muted">
              勾选要启用的能力，点「启用所选」即生效；运行类启用后可点击对应运行按钮。
            </p>
            <div className="mt-2 rounded-lg border border-theme-border/60 bg-theme-bg/60 p-2 text-[10px] leading-4 text-theme-muted">
              {selectedPackage.intendedOutcome && (
                <p>
                  <span className="font-bold text-theme-text">目标：</span>
                  {selectedPackage.intendedOutcome}
                </p>
              )}
              <p>
                <span className="font-bold text-theme-text">优先：</span>
                {getPackageRecommendedPath(selectedPackage.id)}
              </p>
              <p>
                <span className="font-bold text-theme-text">提交后：</span>
                {getPackageNextStepHint(selectedPackage.id)}
              </p>
            </div>
            {restricted && (
              <div
                className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] leading-4 text-amber-700"
                role="status"
              >
                当前作品未开通授权增强；你可以先查看步骤，授权后再启用所选能力。
              </div>
            )}
            {packageSelections.length > 0 && (
              <p className="mt-1 text-[10px] font-bold text-theme-accent" role="status">
                已勾选 {packageSelections.length} 项，待提交
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="关闭能力包"
            className="rounded-lg p-1 text-theme-muted hover:bg-theme-bg"
            onClick={() => onClose()}
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {packageComponents.map(({ assetId, asset, flow, manifest, step }) => {
            const component = { assetId, asset, flow, manifest, step };
            const label = getPackageComponentLabel(component);
            const persisted = asset
              ? savedSkills.some(
                  (skill) =>
                    (skill.parentSkillId || skill.id) === (asset.parentSkillId || asset.id) &&
                    skill.sourceType === asset.sourceType &&
                    skill.version === (Number(manifest?.version) || 1)
                )
              : false;
            const needsImport = Boolean(
              asset &&
              manifest &&
              ['technique', 'skill-card'].includes(manifest.kind) &&
              manifest.sourceType !== 'built-in' &&
              !persisted
            );
            const selectable = Boolean(
              (flow || asset) && manifest?.runtimeStatus === 'active' && !needsImport
            );
            const modeLabel = getPackageModeLabel(step.mode, manifest);
            const triggerLabel =
              step.trigger === 'project-setup'
                ? '立项时'
                : step.trigger === 'outline'
                  ? '大纲期'
                  : step.trigger === 'before-draft'
                    ? '写前'
                    : step.trigger === 'after-draft'
                      ? '写后'
                      : '阶段节点';
            const scopeLabel = getPackageScopeLabel(step.scope);
            const capabilityType = asset ? getGovernanceCapabilityType(asset) : manifest?.kind;
            const toolLabel =
              capabilityType === 'diagnostic' || capabilityType === 'utility'
                ? '不改正文 · '
                : '';
            const action = needsImport
              ? '先保存到我的能力，再勾选待提交'
              : `${step.required ? '必选 · ' : ''}${toolLabel}${modeLabel} · ${triggerLabel} · ${scopeLabel}`;
            const effectHint = getPackageComponentActionHint(flow, manifest);
            const staleBlocked =
              staleConfigurationSession && isConfigurationPackageComponent(component);
            const missingDependencyLabels = (step.dependsOn || [])
              .map((dependencyId) => {
                const dependency = packageComponents.find(
                  (candidate) => candidate.step.id === dependencyId
                );
                if (dependency && !isPackageStepSelected(dependency))
                  return getPackageComponentLabel(dependency);
                if (!dependency && !packageSelections.includes(dependencyId))
                  return dependencyId;
                return null;
              })
              .filter(Boolean);
            const dependenciesSatisfied = missingDependencyLabels.length === 0;
            const disabledReason = staleBlocked
              ? '本次配置已变化，请先重新预览'
              : needsImport
                ? '先保存到我的能力，再勾选待提交'
                : manifest?.runtimeStatus !== 'active'
                  ? '当前能力暂不可运行'
                  : !dependenciesSatisfied
                    ? `请先选择前置能力：${missingDependencyLabels.join('、')}`
                    : null;
            const applyResult =
              packageComponentResults[step.id] || packageComponentResults[assetId];
            const selectedPendingSubmit =
              isPackageStepSelected({ assetId, asset, flow, manifest, step }) && !applyResult;
            const stepPriorityLabel = needsImport
              ? '需先保存'
              : !dependenciesSatisfied
                ? '依赖未满足'
                : manifest?.runtimeStatus !== 'active' || staleBlocked
                  ? '不可用'
                  : step.required
                    ? '必选'
                    : step.dependsOn?.length
                      ? '可选'
                      : '推荐';
            const stepPriorityTone =
              needsImport ||
              !dependenciesSatisfied ||
              manifest?.runtimeStatus !== 'active' ||
              staleBlocked
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                : step.required
                  ? 'border-theme-accent/40 bg-theme-accent/10 text-theme-accent'
                  : 'border-theme-border/50 bg-theme-bg text-theme-muted';
            const resultLaunchLabel = applyResult
              ? getPackageResultLaunchLabel(applyResult, step, manifest, asset)
              : null;
            const resultCandidateId =
              applyResult === 'recommended' && asset && capabilityType === 'skill-card'
                ? (configurationDraft?.capabilityMemberships || []).find(
                    (membership) => membership.sourceId === (asset.parentSkillId || asset.id)
                  )?.persistedSkillId || null
                : null;
            const resultCandidateInDeck = Boolean(
              resultCandidateId && projectDeckIds.includes(resultCandidateId)
            );
            return (
              <div
                key={step.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border border-theme-border p-3',
                  selectable ? 'hover:border-theme-accent' : 'opacity-70'
                )}
              >
                <input
                  type="checkbox"
                  aria-label={`选择 ${label}`}
                  disabled={
                    !selectable ||
                    staleBlocked ||
                    (!isPackageStepSelected({ assetId, asset, flow, manifest, step }) &&
                      !dependenciesSatisfied)
                  }
                  checked={isPackageStepSelected({ assetId, asset, flow, manifest, step })}
                  onChange={(event) => {
                    if (event.target.checked && !dependenciesSatisfied) return;
                    const next = event.target.checked
                      ? [...packageSelections.filter((id) => id !== assetId), step.id]
                      : packageSelections.filter((id) => id !== step.id && id !== assetId);
                    setPackageSelections(next);
                    if (selectedPackageId)
                      setPackageSelectionDrafts((current) => ({
                        ...current,
                        [selectedPackageId]: next,
                      }));
                  }}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-theme-text">{label}</span>
                    <span
                      className={cn(
                        'rounded border px-1.5 py-0.5 text-[9px] font-bold',
                        stepPriorityTone
                      )}
                    >
                      {stepPriorityLabel}
                    </span>
                  </span>
                  <span className="mt-1 block text-[10px] text-theme-muted">
                    {action}
                    {manifest?.sourceType
                      ? ` · ${getCapabilitySourceLabel(manifest.sourceType)}`
                      : ''}
                    {disabledReason ? ` · ${disabledReason}` : ''}
                  </span>
                  {effectHint && (
                    <span className="mt-0.5 block text-[10px] leading-4 text-theme-muted">
                      {effectHint}
                    </span>
                  )}
                  {applyResult && (
                    <span className="mt-1 block space-y-1">
                      <span
                        role="status"
                        className={cn(
                          'block text-[10px] font-bold',
                          applyResult === 'configured'
                            ? 'text-emerald-600'
                            : applyResult === 'unavailable' || applyResult === 'conflict'
                              ? 'text-amber-600'
                              : 'text-theme-muted'
                        )}
                      >
                        {getPackageResultLabel(
                          applyResult,
                          step,
                          manifest,
                          capabilityType,
                          resultCandidateInDeck
                        )}
                      </span>
                      {(resultLaunchLabel || (resultCandidateId && !resultCandidateInDeck)) && (
                        <span className="flex flex-wrap items-center gap-2">
                          {resultLaunchLabel && asset && (
                            <button
                              type="button"
                              ref={resultActionRef}
                              data-autofocus-package-result="true"
                              className="w-full rounded-lg bg-theme-text px-3 py-2 text-xs font-bold text-theme-bg hover:opacity-90"
                              onClick={() => onLaunchResult(asset)}
                            >
                              {resultLaunchLabel}
                            </button>
                          )}
                          {packageResultLaunchFeedbackAssetId === asset?.id &&
                            resultLaunchLabel && (
                              <span
                                role="status"
                                className="w-full text-[10px] font-bold text-emerald-600"
                              >
                                已发送到编辑器执行
                              </span>
                            )}
                          {resultCandidateId && !resultCandidateInDeck && (
                            <>
                              <button
                                type="button"
                                disabled={staleConfigurationSession}
                                className="rounded-md border border-theme-accent px-2 py-0.5 text-[10px] font-bold text-theme-accent hover:bg-theme-accent/10 disabled:opacity-50"
                                onClick={() => onStageCandidate(resultCandidateId, 'main')}
                              >
                                设为主卡
                              </button>
                              <button
                                type="button"
                                disabled={staleConfigurationSession}
                                className="rounded-md border border-theme-accent px-2 py-0.5 text-[10px] font-bold text-theme-accent hover:bg-theme-accent/10 disabled:opacity-50"
                                onClick={() => onStageCandidate(resultCandidateId, 'support')}
                              >
                                设为辅卡
                              </button>
                            </>
                          )}
                        </span>
                      )}
                    </span>
                  )}
                  {selectedPendingSubmit && (
                    <span
                      role="status"
                      className="mt-1 block text-[10px] font-bold text-amber-600"
                    >
                      已勾选，待提交到本次配置
                    </span>
                  )}
                </span>
                {needsImport && asset && (
                  <button
                    type="button"
                    disabled={cloningAssetId === assetId}
                    className="shrink-0 rounded-lg border border-theme-border px-2 py-1 text-[10px] font-bold text-theme-text hover:border-theme-accent disabled:cursor-wait disabled:opacity-60"
                    onClick={async () => {
                      const persistedId = await onImportAsset(asset);
                      if (persistedId) {
                        const next = isPackageStepSelected({
                          assetId,
                          asset,
                          flow,
                          manifest,
                          step,
                        })
                          ? packageSelections
                          : [...packageSelections.filter((id) => id !== assetId), step.id];
                        setPackageSelections(next);
                        if (selectedPackageId)
                          setPackageSelectionDrafts((current) => ({
                            ...current,
                            [selectedPackageId]: next,
                          }));
                      }
                    }}
                  >
                    {cloningAssetId === assetId ? '保存中...' : '保存到我的能力，并勾选待提交'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {configurationDirty && !staleConfigurationSession && (
            <p className="w-full basis-full text-[10px] leading-4 text-theme-muted">
              {CAPABILITY_RETURN_EFFECT_HINT}
            </p>
          )}
          <button
            type="button"
            className="flex-1 rounded-lg border border-theme-border px-3 py-2 text-xs font-bold text-theme-text"
            onClick={() => onClose()}
          >
            取消
          </button>
          {packageSubmitDisabledReason && packageSelections.length > 0 && (
            <div
              className="w-full basis-full rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700"
              role="status"
            >
              <span id="capability-package-submit-help">{packageSubmitDisabledReason}</span>
              {!selectedNovel && (
                <button
                  type="button"
                  className="ml-2 font-bold underline underline-offset-2"
                  onClick={() => {
                    onClose();
                    onNavigateLibrary();
                  }}
                >
                  去书库选择作品
                </button>
              )}
            </div>
          )}
          {packageEmptySelectionHint && (
            <p
              className="w-full basis-full text-[10px] leading-4 text-theme-muted"
              role="status"
            >
              {packageEmptySelectionHint}
            </p>
          )}
          {staleConfigurationSession && (
            <button
              type="button"
              className="flex-1 rounded-lg border border-theme-accent px-3 py-2 text-xs font-bold text-theme-accent"
              onClick={onRepreview}
              disabled={isApplyingConfiguration}
            >
              重新预览本次配置
            </button>
          )}
          {configurationDirty && !staleConfigurationSession && (
            <button
              type="button"
              ref={applyActionRef}
              data-autofocus-package-apply="true"
              disabled={!selectedNovel || isApplyingConfiguration}
              className="flex-1 rounded-lg bg-theme-accent px-3 py-2 text-xs font-bold text-theme-accent-contrast shadow-sm hover:opacity-90 disabled:opacity-50"
              onClick={() => void onApply(true, packageApplyDestination)}
            >
              {packageApplyButtonLabel}
            </button>
          )}
          <button
            type="button"
            className="flex-1 rounded-lg bg-theme-accent px-3 py-2 text-xs font-bold text-theme-accent-contrast disabled:opacity-50"
            aria-describedby={
              packageSubmitDisabledReason && packageSelections.length > 0
                ? 'capability-package-submit-help'
                : undefined
            }
            title={packageSubmitDisabledReason || undefined}
            disabled={Boolean(packageSubmitDisabledReason) || isApplyingConfiguration}
            onClick={async () => {
              const preProfile = selectedNovel?.projectPreferenceProfile
                ? JSON.parse(JSON.stringify(selectedNovel.projectPreferenceProfile))
                : null;
              const built = await onApplyPackage();
              if (!built || !selectedNovel) return;
              try {
                // Derive the outline launch from the just-staged steps, not
                // from packageApplyDestination: result statuses (and thus the
                // destination) only exist AFTER onApply resolves.
                const outlineLaunchAssetId = built.steps?.find((step) => {
                  const manifest = getCatalogCapabilityManifest(step.assetId);
                  return (
                    isOutlineCandidateOutput(manifest?.output) &&
                    !isWorldCandidateArtifact(manifest?.outputArtifact)
                  );
                })?.assetId;
                const launchOutline = Boolean(outlineLaunchAssetId);
                await onApply(
                  launchOutline,
                  launchOutline ? 'outline' : packageApplyDestination,
                  built.capabilityProfile,
                  outlineLaunchAssetId,
                  undefined,
                  built.steps
                );
              } catch {
                // onApply already toasts the failure; the draft
                // stays staged so the user can retry from the dialog.
              }
              const title = selectedPackage?.name || '所选能力';
              toast(`已启用「${title}」`, 'success', 5000, {
                label: '撤销',
                onClick: () => {
                  if (!preProfile) return;
                  void onApply(false, 'return', preProfile);
                },
              });
            }}
          >
            {packageSubmitButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
