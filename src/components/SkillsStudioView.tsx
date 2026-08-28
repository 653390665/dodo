import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BrainCircuit, CheckCircle2, PenLine, Sparkles, Wand2, X, ShieldAlert, ArrowDown, Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import { logger } from '../lib/client-logger';
import { subscribeToChanges } from '../lib/db-transport';
import * as dbTransport from '../lib/db-transport';
import { listNovels } from '../lib/novel-client';
import { deleteSkill, syncSkillFeedbackScores, createSkill } from '../lib/skill-client';
import { Skill, Novel, ViewType, ProjectCapabilityProfile } from '../../shared/types';
import { SkillCard } from './skills/SkillCard';
import { SkillDetailDrawer } from './skills/SkillDetailDrawer';
import { SkillMapPanel } from './skills/SkillMapPanel';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from './ui/alert-dialog';
import { CURATED_PRODUCT_SKILLS, sanitizeWhiteLabelText, SKILL_SERIES_FLOWS } from '../../shared/lib/public-skill-catalog';
import type { CuratedProductSkill, EnhancementPackage, EnhancementPackageStep, SkillSeriesFlow } from '../../shared/types/prompt-assets-governed';
import { createProductEventId, createProductEventSessionId, recordProductEvent } from '../lib/product-events-client';
import { canUseEnhancedCapability, dispatchCapabilityUnavailable, isMonetizationEnabled } from '../lib/entitlements';
import { filterGovernedAssets, getGovernanceCapabilityType, getTrustedSessionCardIds, getCapabilityManifest, getCapabilitySourceLabel, getCapabilityRuntimeLabel, type GovernanceCapabilityType, type GovernanceStage } from '../lib/capability-governance';
import {
  getAuthorFacingCapabilityActionHint,
  getAuthorFacingCapabilityActionLabel,
  getAuthorFacingCapabilityCardCategory,
  getAuthorFacingCapabilityDeckHint,
  getAuthorFacingCapabilityEntryHint,
  getAuthorFacingCapabilityScopeLabel,
  getAuthorFacingCapabilityUseHint,
} from '../lib/capability-stage-cards';
import type { CapabilityLaunchState, WorldCapabilityLaunchIntent } from '../../shared/types/capability-manifest';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import { ENHANCEMENT_PACKAGES, getEnhancementPackageSteps } from '../../shared/lib/enhancement-packages';
import type { CapabilityApplicationStatus } from '../../shared/types/capability-execution';
import {
  getCapabilityDisplayText,
  addCardToProjectDeck,
  buildV3CapabilityProfile,
  getProjectCapabilityProfile,
  getProjectDeckIds,
  upsertCapabilityMembership,
} from '../lib/skills-studio-governance';
import { applyCapabilityConfiguration, previewCapabilityConfiguration } from '../lib/capability-configuration-client';
import { applyCapabilityMigration, previewCapabilityMigration, type CapabilityMigrationPreview, CapabilityMigrationError } from '../lib/capability-migration-client';
import { CapabilityMigrationPreviewPanel } from './skills/CapabilityMigrationPreviewPanel';
import { LegacyArtifactStructuringPrompt } from './LegacyArtifactStructuringPrompt';
import {
  clearLatestCapabilityConfigurationSession,
  getCapabilityConfigurationBaselineToken,
  isCapabilityConfigurationSessionStale,
  loadLatestCapabilityConfigurationSession,
  loadCapabilityConfigurationSession,
  saveCapabilityConfigurationSession,
  type CapabilityConfigurationSession,
} from '../lib/capability-configuration-session';

type DatabaseGenerationReader = () => Promise<number>;
type SkillsStudioNavigateContext = { capabilityApplied?: boolean; targetFocus?: 'workspace-world'; worldCapabilityLaunch?: WorldCapabilityLaunchIntent };
type CapabilityApplyDestination = 'return' | 'world' | 'outline';

const CAPABILITY_RETURN_EFFECT_HINT = '应用配置后，主卡与辅卡影响作品后续正文；常用技法作为作品偏好；本章使用规则只影响当前章；系统护栏参与生成与审稿检查。';

function getCapabilityApplyButtonLabel(destination: CapabilityApplyDestination): string {
  if (destination === 'world') return '应用配置并前往世界观';
  if (destination === 'outline') return '应用配置并前往大纲';
  return '应用所选配置并返回写作';
}

function isOutlineCandidateOutput(output: string | undefined): boolean {
  return output === 'outline-candidate' || output === 'artifact-candidate';
}

function isWorldCandidateArtifact(outputArtifact: string | undefined): boolean {
  return outputArtifact === 'worldBibleCandidate' || outputArtifact === 'characterCardCandidate';
}

function getPackageSubmitButtonLabel(hasResults: boolean, selectionCount: number): string {
  if (hasResults && selectionCount === 0) return '勾选新能力后可提交';
  return '加入本次配置候选';
}

function getPackageEmptySelectionHint(hasResults: boolean, selectionCount: number, hasPendingConfiguration: boolean): string | null {
  if (!hasResults || selectionCount > 0) return null;
  if (hasPendingConfiguration) return '已提交的配置仍待应用；点击应用配置后才写入作品。也可继续勾选其他能力。';
  return '已提交的运行项可立即执行；请点击结果里的运行按钮。也可继续勾选其他能力。';
}

function getDatabaseGenerationReader(): DatabaseGenerationReader | null {
  try {
    const reader = (dbTransport as unknown as { getDatabaseGenerationSnapshot?: DatabaseGenerationReader }).getDatabaseGenerationSnapshot;
    return typeof reader === 'function' ? reader : null;
  } catch {
    return null;
  }
}

async function getDatabaseGenerationSafe(): Promise<number> {
  return (await getDatabaseGenerationReader()?.()) ?? 0;
}

function getPackageModeLabel(mode: EnhancementPackageStep['mode'], manifest?: ReturnType<typeof getCatalogCapabilityManifest>): string {
  if (mode === 'configure') return '应用配置后设为作品默认';
  if (mode === 'schedule' && manifest?.output === 'transform-preview') return '应用配置后写入本章规则';
  if (mode === 'schedule') return '写到这里时提醒';
  if (mode === 'run-now' && manifest) return getAuthorFacingCapabilityActionLabel(manifest, 'single-run') || '运行一次，不保存配置';
  if (mode === 'run-now') return '运行一次，不保存配置';
  return '稍后选择';
}

function getPackageResultLabel(
  status: CapabilityApplicationStatus,
  step: EnhancementPackageStep,
  manifest: ReturnType<typeof getCatalogCapabilityManifest> | undefined,
  capabilityType: GovernanceCapabilityType | string | undefined,
  resultCandidateInDeck = false,
): string {
  const isPolishPreview = manifest?.output === 'transform-preview';
  const isRunTool = manifest?.action === 'run-diagnostic' || manifest?.kind === 'utility';
  const isProjectTechnique = capabilityType === 'technique' && step.scope === 'project';
  const projectTechniqueResult = isWorldCandidateArtifact(manifest?.outputArtifact)
    ? '下一步：应用配置后前往世界观设定'
    : isOutlineCandidateOutput(manifest?.output)
      ? '下一步：应用配置后前往大纲面板'
      : '下一步：应用配置后写入作品';
  if (status === 'configured') return '下一步：应用配置后写入作品';
  if (status === 'scheduled') return isPolishPreview ? '下一步：应用配置后写入本章规则' : '下一步：应用配置后写入写前提醒';
  if (status === 'run') {
    if (isPolishPreview) return '下一步：精修预览待生成';
    if (manifest?.action === 'run-diagnostic') return '下一步：审稿诊断待运行';
    if (isRunTool) return '下一步：辅助动作待运行';
    return '下一步：待运行';
  }
  if (status === 'recommended') {
    if (step.mode === 'schedule' && isPolishPreview) return '下一步：应用配置后写入本章规则';
    if (step.mode === 'run-now' && isPolishPreview) return '下一步：精修预览待生成';
    if (step.mode === 'run-now' && manifest?.action === 'run-diagnostic') return '下一步：审稿诊断待运行';
    if (step.mode === 'run-now' && isRunTool) return '下一步：辅助动作待运行';
    if (isProjectTechnique) return projectTechniqueResult;
    if (capabilityType === 'flow') return '下一步：应用配置后写入创作流程';
    if (capabilityType === 'skill-card') return resultCandidateInDeck ? '下一步：应用配置后写入作品卡组' : '下一步：选择卡组位置后应用';
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
  manifest: ReturnType<typeof getCatalogCapabilityManifest> | undefined,
): string | null {
  if (flow) return '配置到作品：应用配置后写入创作流程。';
  if (!manifest) return null;
  return getAuthorFacingCapabilityActionHint(manifest);
}

function getPackageUseLabel(packageId: string): string {
  if (packageId.includes('audit') || packageId.includes('diagnostic')) return '审稿包';
  if (packageId.includes('humanization') || packageId.includes('patch')) return '精修包';
  if (packageId.includes('onboarding')) return '设定包';
  if (packageId.includes('continuity') || packageId.includes('deconstruction')) return '拆书包';
  if (packageId.includes('chapter')) return '正文包';
  return '流程包';
}

function getPackageNextStepHint(packageId: string): string {
  if (packageId.includes('audit') || packageId.includes('diagnostic')) return '加入本次配置候选后点运行诊断';
  if (packageId.includes('humanization') || packageId.includes('patch')) return '加入本次配置候选后点生成预览';
  if (packageId.includes('onboarding')) return '加入本次配置候选后点应用配置';
  if (packageId.includes('continuity') || packageId.includes('deconstruction')) return '加入本次配置候选后先选卡组位置';
  if (packageId.includes('chapter')) return '加入本次配置候选后点应用配置';
  return '加入本次配置候选后确认下一步';
}

function getPackageRecommendedPath(packageId: string): string {
  if (packageId.includes('audit') || packageId.includes('diagnostic')) return '先勾必选审稿项，加入本次配置候选后点运行诊断。';
  if (packageId.includes('humanization') || packageId.includes('patch')) return '先勾写前规则，再按需勾写后预览项。';
  if (packageId.includes('onboarding')) return '建议两个设定项一起勾选，先生成世界观，再接人物弧线。';
  if (packageId.includes('first-chapter')) return '先勾开篇结构，再按需选择正文表达技法。';
  if (packageId.includes('continuity')) return '按当前作品短板选择一张节奏卡或悬念卡，加入本次配置候选后先选主卡或辅卡位置。';
  if (packageId.includes('deconstruction')) return '先选主笔文风卡，再补一张节奏或钩子卡。';
  if (packageId.includes('platform')) return '先运行开篇钩子诊断，再按目标平台补充检查项。';
  return '先勾当前阶段最需要的一项，加入本次配置候选后再确认下一步。';
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

function getPackageAvailabilityLabel(pkg: EnhancementPackage, canUsePaidCapabilities: boolean, monetizationEnabled: boolean): string {
  if (pkg.type !== 'paid') return '基础开放';
  if (!monetizationEnabled) return 'Beta 开放';
  return canUsePaidCapabilities ? '授权可用' : '需授权';
}

function getPackageOpenButtonLabel(pkg: EnhancementPackage, canUsePaidCapabilities: boolean, monetizationEnabled: boolean): string {
  if (pkg.type === 'paid' && monetizationEnabled && !canUsePaidCapabilities) return '查看受限步骤';
  return '展开并选择';
}

function getDeckDimensionLabel(dimension: string): string {
  const labels: Record<string, string> = {
    style: '文风',
    hook: '钩子',
    pacing: '节奏',
    world: '世界观',
    worldview: '世界观',
    character: '人物',
    plot: '剧情',
    conflict: '冲突',
    platform: '平台',
    'style-reference': '文风',
    'utility-tool': '工具',
    'author-workflow': '结构',
    'platform-criteria': '平台',
    'quality-guardrail': '护栏',
    'constellation-pack': '题材',
    'skill-card': '拆书',
  };
  return labels[dimension] || dimension;
}

function getDeckDimensionSummary(dimensions: string[]): string {
  const labels = [...new Set(dimensions.map(getDeckDimensionLabel).filter(Boolean))];
  return labels.length ? labels.join('、') : '未标注';
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
  if (packageId.includes('audit') || packageId.includes('diagnostic') || packageId.includes('humanization') || packageId.includes('patch')) return 'review';
  return 'other';
}

function PlazaAssetCard({
  asset,
  isImported,
  isFavorited,
  isCloning,
  selectedNovel: _selectedNovel,
  isFreeNovel: _isFreeNovel,
  onImport,
  onEquip,
  onUseTechnique,
  onUseProjectTechnique,
  onDirectExec,
}: {
  asset: CuratedProductSkill;
  isImported: boolean;
  isFavorited: boolean;
  isCloning: boolean;
  selectedNovel: Novel | null;
  isFreeNovel: boolean;
  onImport: () => void;
  onEquip: () => void;
  onUseTechnique: () => void;
  onUseProjectTechnique: () => void;
  onDirectExec: () => void;
}) {
  const isLicensed = getCapabilityManifest(asset)?.sourceType === 'licensed';
  const cleanTitle = sanitizeWhiteLabelText(asset.title);
  const governanceType = getGovernanceCapabilityType(asset);
  const manifest = getCapabilityManifest(asset);
  const isTechniqueManifest = (manifest?.kind as string) === 'technique';
  const supportsProjectTechnique = isTechniqueManifest && manifest?.allowedScopes.includes('project');
  const supportsChapterTechnique = isTechniqueManifest && manifest?.allowedScopes.includes('chapter');
  const isPreviewOnlyTransform = manifest.output === 'transform-preview' && manifest.sideEffect === 'preview-only';
  const canRunOneShot = manifest.action === 'run-diagnostic' || manifest.kind === 'utility' || isPreviewOnlyTransform;
  const cleanGoal = getCapabilityDisplayText(sanitizeWhiteLabelText(asset.goal || '暂无描述'), manifest.sourceType);
  const cleanSignal = getCapabilityDisplayText(sanitizeWhiteLabelText(asset.successSignal || ''), manifest.sourceType);
  const unavailable = manifest?.runtimeStatus !== 'active';
  const isBuiltIn = manifest?.sourceType === 'built-in';
  const cardCategory = manifest ? getAuthorFacingCapabilityCardCategory(manifest) : null;
  const useHint = cardCategory ? getAuthorFacingCapabilityUseHint(cardCategory) : null;
  const entryHint = manifest ? getAuthorFacingCapabilityDeckHint(manifest) || (cardCategory ? getAuthorFacingCapabilityEntryHint(cardCategory) : null) : null;
  const visibleScopes = manifest.allowedScopes.filter((scope) => scope !== 'single-run' || canRunOneShot);
  const scopeLabel = visibleScopes.length
    ? visibleScopes.map(getAuthorFacingCapabilityScopeLabel).join(' / ')
    : null;
  const directActionLabel = canRunOneShot ? getAuthorFacingCapabilityActionLabel(manifest, 'single-run') : undefined;
  const projectActionLabel = manifest ? getAuthorFacingCapabilityActionLabel(manifest, 'project') : undefined;
  const chapterActionLabel = manifest ? getAuthorFacingCapabilityActionLabel(manifest, 'chapter') : undefined;
  const defaultActionLabel = manifest ? getAuthorFacingCapabilityActionLabel(manifest) : undefined;
  const favoriteActionLabel = cardCategory === '精修卡' ? '收藏为常用精修卡' : '收藏为常用技法';
  const actionHint = manifest ? getAuthorFacingCapabilityActionHint(manifest) : null;

  return (
    <div className="bg-theme-sidebar rounded-lg p-5 border border-theme-border/40 hover:border-theme-border/85 hover:shadow-md transition-all duration-200 flex flex-col text-left relative overflow-hidden">
      {isLicensed && (
        <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-amber-500/5 to-transparent rounded-full -mr-8 -mt-8 blur-lg pointer-events-none" />
      )}

      <div className="flex justify-between items-start mb-3 gap-3 relative z-10">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-theme-text text-sm leading-snug flex items-center gap-2">
            <span className="truncate">{cleanTitle}</span>
            {isLicensed && (
              <span aria-hidden="true" className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest bg-amber-500/10 text-amber-500 border border-amber-500/20">
                授权增强
              </span>
            )}
          </h3>
          <div className="text-[10px] text-theme-muted tracking-wide mt-1 flex flex-wrap items-center gap-1.5">
            <span>{Number.isFinite(asset.score) ? `冷启动证据 ${asset.score}` : '证据待积累'}</span>
            <span className="text-theme-border/60">·</span>
            <span className="text-[9px] px-1 py-0.2 bg-theme-bg rounded text-theme-muted">{manifest ? getCapabilitySourceLabel(manifest.sourceType) : '来源未知'}</span>
          </div>
        </div>
      </div>

      <div className="text-xs text-theme-muted/90 flex-1 mb-4 leading-relaxed min-h-[3em]">
        <span className="font-bold text-theme-text text-[11px] block mb-0.5">功能定位:</span>
        <p className="line-clamp-3">{cleanGoal}</p>
      </div>

      <div className="space-y-2 mb-4 border-t border-theme-border/20 pt-3 relative z-10">
        {cleanSignal && (
          <div className="text-[11px] text-theme-muted leading-relaxed">
            <span className="font-bold text-theme-text text-[11px] block mb-0.5">预期成效:</span>
            <p className="line-clamp-2">✨ {cleanSignal}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mt-2">
          {cardCategory && (
            <span className="px-1.5 py-0.5 bg-theme-bg rounded text-[9px] font-medium text-theme-muted border border-theme-border/30 font-sans">
              {cardCategory}
            </span>
          )}
          {manifest && <>
            <span className="px-1.5 py-0.5 bg-theme-bg rounded text-[9px] text-theme-muted border border-theme-border/30">{getCapabilityRuntimeLabel(manifest.runtimeStatus)}</span>
            {scopeLabel && (
              <span className="px-1.5 py-0.5 bg-theme-bg rounded text-[9px] text-theme-muted border border-theme-border/30">
                {scopeLabel}
              </span>
            )}
          </>}
          {asset.inputs && asset.inputs.map(input => (
            <span key={input} className="px-1.5 py-0.5 bg-theme-bg rounded text-[9px] font-medium text-theme-muted border border-theme-border/30 font-sans">
              接收: {input === 'content' ? '正文' : input === 'outline' ? '大纲' : '设定'}
            </span>
          ))}
        </div>
        {(useHint || entryHint) && (
          <div className="space-y-0.5 text-[10px] leading-4 text-theme-muted">
            {useHint && <p>{useHint}</p>}
            {entryHint && <p>{entryHint}</p>}
          </div>
        )}
      </div>

      <div className="mt-auto pt-2 relative z-10">
        {actionHint && (
          <p className="mb-2 text-[10px] leading-4 text-theme-muted">
            {actionHint}
          </p>
        )}
        {governanceType === 'guardrail' ? (
          <button
            type="button"
            disabled={isCloning || unavailable}
            aria-pressed={isFavorited}
            onClick={(e) => { e.stopPropagation(); onEquip(); }}
            className={cn(
              "w-full py-2 rounded text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1",
              isCloning || unavailable
                ? "bg-theme-border/30 text-theme-muted cursor-not-allowed"
                : isFavorited
                  ? "bg-amber-500/10 border border-amber-500/35 text-amber-700 hover:bg-amber-500/15"
                  : "border border-amber-500/35 text-amber-700 hover:bg-amber-500/10",
            )}
          >
            <ShieldAlert size={13} />
            {isFavorited ? '移出系统检查候选' : defaultActionLabel || '保存为系统检查候选'}
          </button>
        ) : unavailable ? (
          <div className="w-full py-2 text-center text-xs font-bold text-theme-muted border border-theme-border/40 rounded">
            暂不可运行
          </div>
        ) : isPreviewOnlyTransform && isTechniqueManifest ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isCloning}
                aria-pressed={isFavorited}
                onClick={(e) => { e.stopPropagation(); onEquip(); }}
                className={cn(
                  "flex-1 py-2 rounded text-xs font-bold transition-all duration-150",
                  isCloning
                    ? "bg-theme-border/30 text-theme-muted cursor-wait"
                    : isFavorited
                      ? "bg-theme-accent/10 border border-theme-accent/40 text-theme-accent hover:bg-theme-accent/15"
                      : "border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5",
                )}
              >
                {isCloning ? '处理中...' : isFavorited ? '取消收藏' : favoriteActionLabel}
              </button>
              <button
                type="button"
                disabled={isCloning}
                onClick={(e) => { e.stopPropagation(); onUseTechnique(); }}
                className="flex-1 py-2 rounded bg-theme-text text-theme-bg text-xs font-bold hover:opacity-90 disabled:opacity-60"
              >
                {chapterActionLabel || '用于本章'}
              </button>
            </div>
            <button
              type="button"
              disabled={isCloning}
              onClick={(e) => { e.stopPropagation(); onDirectExec(); }}
              className="w-full py-2 rounded border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text text-xs font-bold transition-all duration-150 disabled:opacity-60"
            >
              {directActionLabel || '运行一次，不保存配置'}
            </button>
          </div>
        ) : manifest?.action === 'run-diagnostic' || manifest?.action === 'preview-transform' || manifest?.kind === 'utility' ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDirectExec(); }}
            className="w-full py-2 rounded bg-theme-text hover:opacity-90 text-theme-bg text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1"
          >
            {directActionLabel || '运行一次，不保存配置'}
          </button>
        ) : manifest?.action === 'activate-flow' || manifest?.action === 'use-technique' || manifest?.action === 'add-to-stack' ? isTechniqueManifest ? (
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={isCloning}
              aria-pressed={isFavorited}
              onClick={(e) => { e.stopPropagation(); onEquip(); }}
              className={cn(
                "flex-1 py-2 rounded text-xs font-bold transition-all duration-150",
                isCloning
                  ? "bg-theme-border/30 text-theme-muted cursor-wait"
                  : isFavorited
                    ? "bg-theme-accent/10 border border-theme-accent/40 text-theme-accent hover:bg-theme-accent/15"
                    : "border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5",
              )}
            >
              {isCloning ? '处理中...' : isFavorited ? '取消收藏' : favoriteActionLabel}
            </button>
            {supportsProjectTechnique && (
              <button
                type="button"
                disabled={isCloning}
                onClick={(e) => { e.stopPropagation(); onUseProjectTechnique(); }}
                className="flex-1 min-w-[8rem] py-2 rounded bg-theme-text text-theme-bg text-xs font-bold hover:opacity-90 disabled:opacity-60"
              >
                {projectActionLabel || '设为作品默认'}
              </button>
            )}
            {supportsChapterTechnique && (
              <button
                type="button"
                disabled={isCloning}
                onClick={(e) => { e.stopPropagation(); onUseTechnique(); }}
                className="flex-1 min-w-[8rem] py-2 rounded border border-theme-border text-theme-text text-xs font-bold hover:border-theme-accent hover:text-theme-accent disabled:opacity-60"
              >
                {chapterActionLabel || '用于本章'}
              </button>
            )}
          </div>
          ) : manifest.kind === 'skill-card' && manifest.allowedScopes.includes('project') && manifest.allowedScopes.includes('chapter') ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isCloning}
                onClick={(e) => { e.stopPropagation(); onEquip(); }}
                className={cn(
                  "flex-1 py-2 rounded text-xs font-bold transition-all duration-150",
                  isCloning
                    ? "bg-theme-border/30 text-theme-muted cursor-wait"
                    : isLicensed
                      ? "bg-amber-500 hover:bg-amber-600 text-white"
                      : "border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5",
                )}
              >
                {isCloning ? '处理中...' : projectActionLabel || '应用配置后设为作品默认'}
              </button>
              <button
                type="button"
                disabled={isCloning}
                onClick={(e) => { e.stopPropagation(); onDirectExec(); }}
                className="flex-1 py-2 rounded bg-theme-text text-theme-bg text-xs font-bold hover:opacity-90 disabled:opacity-60"
              >
                {chapterActionLabel || '用于本章'}
              </button>
            </div>
          ) : (
          <button
            type="button"
            disabled={isCloning}
            aria-pressed={isTechniqueManifest ? isFavorited : undefined}
            onClick={(e) => { e.stopPropagation(); onEquip(); }}
            className={cn(
              "w-full py-2 rounded text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1",
              isCloning
                ? "bg-theme-border/30 text-theme-muted cursor-wait"
                : isTechniqueManifest && isFavorited
                  ? "bg-theme-accent/10 border border-theme-accent/40 text-theme-accent hover:bg-theme-accent/15"
                : isLicensed
                  ? "bg-amber-500 hover:bg-amber-600 text-white"
                  : "border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5"
            )}
          >
            {isCloning ? "处理中..." : governanceType === 'flow' ? (projectActionLabel || "应用配置后设为作品默认") : isTechniqueManifest ? (isFavorited ? "取消收藏" : favoriteActionLabel) : (defaultActionLabel || "用于本章")}
          </button>
        ) : isImported || isBuiltIn ? (
          <button
            type="button"
            disabled
            className="w-full py-2 rounded bg-green-500/10 border border-green-500/20 text-green-600 text-xs font-bold flex items-center justify-center gap-1 cursor-default"
          >
            ✓ 已保存到我的能力
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onImport(); }}
            disabled={isCloning}
            className={cn(
              "w-full py-2 rounded text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1",
              isCloning
                ? "bg-theme-border/30 text-theme-muted cursor-wait"
                : isLicensed
                  ? "bg-amber-500 hover:bg-amber-600 text-white"
                  : "border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5"
            )}
          >
            {isCloning ? "处理中..." : "保存到我的能力"}
          </button>
        )}
      </div>
    </div>
  );
}

function cloneAssetToSkill(asset: CuratedProductSkill): Skill | null {
  const manifest = getCatalogCapabilityManifest(asset.id);
  if (!Number.isFinite(asset.score) || !manifest || manifest.runtimeStatus !== 'active' || !['technique', 'skill-card'].includes(manifest.kind)) {
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
    accessTier: (manifest.sourceType === 'built-in' || manifest.sourceType === 'plaza') ? 'free' : 'paid',
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
    color: 'from-orange-500/10 to-amber-500/10 border-amber-500/30'
  },
  'tomato-platform-flow': {
    target: '番茄平台写手 / 爆款爽文追随者',
    output: '黄金三章快速过签大纲 & 高频金手指爽点正文',
    color: 'from-red-500/10 to-orange-500/10 border-red-500/30'
  },
  'generic-novel-flow': {
    target: '传统网文作者 / 新手通俗写手',
    output: '标准三要素设定 & 结构扎实的百万字通俗大纲',
    color: 'from-blue-500/10 to-teal-500/10 border-blue-500/30'
  },
  'book-deconstruction-flow': {
    target: '大神文风研习者 / 精准流派复刻者',
    output: '神作精髓拆解报告 & 强因果节奏伏笔线索图谱',
    color: 'from-purple-500/10 to-pink-500/10 border-purple-500/30'
  },
  'fenghua-short-flow': {
    target: '短篇网文作者 / 快速完稿创作者',
    output: '短篇高密度大纲 & 紧凑节奏正文',
    color: 'from-cyan-500/10 to-sky-500/10 border-cyan-500/30'
  },
  'tianma-outline-flow': {
    target: '长篇策划作者 / 结构型创作者',
    output: '天马行空创意拆解 & 可执行长篇大纲',
    color: 'from-violet-500/10 to-indigo-500/10 border-violet-500/30'
  }
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
          <div key={step.id} className="relative z-10 flex flex-col items-center group/dot cursor-pointer">
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
  const returnHint = selectedNovel && returnView === 'editor'
    ? targetChapterId
      ? '能力配置会带回刚才那一章，不需要重新找章节。'
      : '能力配置会带回编辑器，继续当前章节写作。'
    : selectedNovel
      ? '回到工作台继续设定、写作和管理作品。'
      : undefined;
  const stageLaunchHint = selectedNovel && targetChapterId && initialStage === 'style-polish'
    ? '从审稿问题进入：选择精修卡后点「生成精修预览」，会回到刚才章节生成只读预览。'
    : null;
  const [savedSkills, setSavedSkills] = useState<Skill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [skillToDeleteId, setSkillToDeleteId] = useState<string | null>(null);
  const [userNovels, setUserNovels] = useState<Novel[]>([]);

  const [activeTab, setActiveTab] = useState<'mySkills' | 'plaza'>('mySkills');
  const [cloningAssetId, setCloningAssetId] = useState<string | null>(null);
  const [selectedFlowDetail, setSelectedFlowDetail] = useState<SkillSeriesFlow | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [packageSelections, setPackageSelections] = useState<string[]>([]);
  const [pendingPackageSteps, setPendingPackageSteps] = useState<EnhancementPackageStep[]>([]);
  const [packageSelectionDrafts, setPackageSelectionDrafts] = useState<Record<string, string[]>>({});
  const [packageComponentResults, setPackageComponentResults] = useState<Record<string, CapabilityApplicationStatus>>({});
  const [packageResultLaunchFeedbackAssetId, setPackageResultLaunchFeedbackAssetId] = useState<string | null>(null);
  const [candidateCardIds, setCandidateCardIds] = useState<string[]>([]);
  const [pendingCandidateId, setPendingCandidateId] = useState<string | null>(null);
  const [migrationPreview, setMigrationPreview] = useState<CapabilityMigrationPreview | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [databaseGeneration, setDatabaseGeneration] = useState<number | null>(null);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const studioScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionContextRef = useRef<string | null>(null);
  const configurationSessionIdRef = useRef<string | null>(null);
  const capabilityViewStateRef = useRef<string | null>(null);
  const packageResultActionRef = useRef<HTMLButtonElement | null>(null);
  const packageApplyActionRef = useRef<HTMLButtonElement | null>(null);
  const previousNovelIdRef = useRef<string | null>(null);
  const applyingConfigurationRef = useRef(false);
  const flowDetailTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!selectedFlowDetail || typeof document === 'undefined') return;
    const dialog = document.querySelector('[data-capability-flow-dialog="true"]') as HTMLElement | null;
    const focusable = dialog?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelectedFlowDetail(null);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (items.length < 2) return;
      const current = document.activeElement;
      const index = items.indexOf(current as HTMLElement);
      const nextIndex = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index === items.length - 1 ? 0 : index + 1);
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
      eventId: input.eventId || createProductEventId(`${input.eventName}:${input.action || input.objectId || 'default'}`, sessionId),
    });
  };

  const effectiveNovel = useMemo(
    () => (selectedNovel ? userNovels.find((novel) => novel.id === selectedNovel.id) || selectedNovel : null),
    [selectedNovel, userNovels],
  );

  const handleActivateFlow = async (flowId: string) => {
    if (!selectedNovel) {
      alert('请先选择或创建一个小说作品。');
      return;
    }
    if (staleConfigurationSession) {
      setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return;
    }

    const isLicensedFlow = getCatalogCapabilityManifest(flowId)?.sourceType === 'licensed';

    const activeFlowId = effectiveNovel?.projectPreferenceProfile?.capabilityProfile?.activeFlowId;
    if (activeFlowId && activeFlowId !== flowId && typeof window !== 'undefined' && !window.confirm('当前作品已有创作流程。确认替换为该流程吗？')) {
      return;
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
    const refreshSkills = () => {
      syncSkillFeedbackScores()
        .then(setSavedSkills)
        .catch((err) => logger.warn('Failed to load skills:', err));
    };
    refreshSkills();
    listNovels().then(setUserNovels);
    return subscribeToChanges(refreshSkills);
  }, []);

  useEffect(() => {
    if (selectedNovel?.id) void recordCapabilityEvent({ eventName: 'capability_viewed', stage: 'advanced', result: 'success', novelId: selectedNovel.id, objectId: 'skills-studio' });
    capabilityViewStateRef.current = selectedNovel?.id || null;
  }, [selectedNovel?.id]);

  const selectedSkill = useMemo(
    () => savedSkills.find((skill) => skill.id === selectedSkillId) || null,
    [savedSkills, selectedSkillId],
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

  type StoreTab = GovernanceCapabilityType | 'diagnostic-tools' | 'packages';
  const getInitialCapabilityTab = React.useCallback((stage?: GovernanceStage): StoreTab => (
    stage === 'style-polish' ? 'diagnostic-tools' : 'flow'
  ), []);
  const [selectedCapability, setSelectedCapability] = useState<StoreTab>('flow');
  const [selectedCategory, setSelectedCategory] = useState<GovernanceStage | 'all'>(initialStage || 'all');

  useEffect(() => {
    if (!selectedNovel?.id) return;
    const nextState = `${selectedNovel.id}:${activeTab}:${selectedCapability}:${selectedCategory}`;
    if (capabilityViewStateRef.current === null || capabilityViewStateRef.current === selectedNovel.id) {
      capabilityViewStateRef.current = nextState;
      return;
    }
    if (capabilityViewStateRef.current === nextState) return;
    capabilityViewStateRef.current = nextState;
    void recordCapabilityEvent({
      eventName: 'capability_viewed', stage: 'advanced', result: 'success',
      novelId: selectedNovel.id, objectId: 'skills-studio', action: 'view-change',
    });
  }, [activeTab, selectedCapability, selectedCategory, selectedNovel?.id]);

  const filteredCuratedSkills = useMemo(() => {
    if (selectedCapability === 'packages') return [];
    const stage = selectedCategory === 'all' ? undefined : selectedCategory;
    const isVisibleShelfAsset = (asset: CuratedProductSkill) => {
      const manifest = getCapabilityManifest(asset);
      return manifest.runtimeStatus === 'active'
        || (selectedCategory === 'commercial-sign'
          && asset.curatedCategory === 'platform'
          && manifest.runtimeStatus === 'unavailable');
    };
    const polishPreviewCards = filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'technique', stage)
      .filter((asset) => getCapabilityManifest(asset).output === 'transform-preview' && isVisibleShelfAsset(asset));
    if (selectedCapability === 'diagnostic-tools') {
      return [
        ...filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'diagnostic', stage),
        ...filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'utility', stage),
        ...polishPreviewCards,
      ].filter(isVisibleShelfAsset);
    }
    const assets = filterGovernedAssets(CURATED_PRODUCT_SKILLS, selectedCapability, stage).filter(isVisibleShelfAsset);
    if (selectedCapability === 'technique') {
      return assets.filter((asset) => getCapabilityManifest(asset).output !== 'transform-preview');
    }
    return assets;
  }, [selectedCapability, selectedCategory]);
  const capabilityTabCount = (id: StoreTab) => {
    if (id === 'flow') return visibleFlowCount;
    if (id === 'packages') return visiblePackageCount;
    const isVisibleShelfAsset = (asset: CuratedProductSkill) => {
      const manifest = getCapabilityManifest(asset);
      return manifest.runtimeStatus === 'active'
        || (selectedCategory === 'commercial-sign'
          && asset.curatedCategory === 'platform'
          && manifest.runtimeStatus === 'unavailable');
    };
    if (id === 'diagnostic-tools') {
      return filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'diagnostic').filter(isVisibleShelfAsset).length
        + filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'utility').filter(isVisibleShelfAsset).length
        + filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'technique')
          .filter((asset) => getCapabilityManifest(asset).output === 'transform-preview' && isVisibleShelfAsset(asset)).length;
    }
    const assets = filterGovernedAssets(CURATED_PRODUCT_SKILLS, id).filter(isVisibleShelfAsset);
    return id === 'technique'
      ? assets.filter((asset) => getCapabilityManifest(asset).output !== 'transform-preview').length
      : assets.length;
  };

  const selectedPackage = selectedPackageId
    ? ENHANCEMENT_PACKAGES.find((pkg) => pkg.id === selectedPackageId) || null
    : null;
  const visiblePackages = ENHANCEMENT_PACKAGES.filter((pkg) => pkg.id !== 'paid-author-flows');
  const groupedPackages = PACKAGE_GROUPS
    .map((group) => ({
      ...group,
      packages: visiblePackages.filter((pkg) => getPackageGroupId(pkg.id) === group.id),
    }))
    .filter((group) => group.packages.length > 0);
  const packageComponents = (selectedPackage ? getEnhancementPackageSteps(selectedPackage) : []).map((step) => {
    const assetId = step.assetId;
    const asset = CURATED_PRODUCT_SKILLS.find((entry) => entry.id === assetId) || null;
    const flow = SKILL_SERIES_FLOWS.find((entry) => entry.id === assetId) || null;
    const manifest = getCatalogCapabilityManifest(assetId);
    return { assetId, asset, flow, manifest, step };
  });
  const getPackageComponentLabel = (component: typeof packageComponents[number]) => component.flow?.name || component.asset?.title || component.assetId;
  const isPackageStepSelected = (component: typeof packageComponents[number]) =>
    packageSelections.includes(component.step.id) || packageSelections.includes(component.assetId);
  const isConfigurationPackageComponent = (component: typeof packageComponents[number]) => {
    if (component.flow) return true;
    if (!component.asset) return false;
    const type = getGovernanceCapabilityType(component.asset);
    return type !== 'diagnostic' && type !== 'utility';
  };
  const visibleFlowIds = ['xiaofeiji-novel-flow', 'tomato-platform-flow', 'generic-novel-flow', 'book-deconstruction-flow', 'fenghua-short-flow', 'tianma-outline-flow'];
  const visibleFlowCount = SKILL_SERIES_FLOWS.filter((flow) => visibleFlowIds.includes(flow.id)).length;
  const visiblePackageCount = visiblePackages.length;

  const isAssetPersisted = (asset: CuratedProductSkill) => {
    const manifestVersion = Number(getCatalogCapabilityManifest(asset.id)?.version) || 1;
    return savedSkills.some((skill) => (skill.parentSkillId || skill.id) === (asset.parentSkillId || asset.id)
      && skill.sourceType === asset.sourceType && skill.version === manifestVersion);
  };

  const isRuntimeReadySkillCard = (skill: Skill) => {
    const sourceId = skill.parentSkillId || skill.id;
    const manifest = getCatalogCapabilityManifest(sourceId);
    return Boolean(
      (manifest?.kind === 'skill-card' && manifest.runtimeStatus === 'active' || !manifest)
      && Boolean(skill.deconstructionCardType)
      && skill.isRuntimeReady === true
      && skill.sanitizationStatus === 'runtime-ready'
      && skill.runtimeStatus === 'active',
    );
  };

  const resolveDeckCard = (id: string) => {
    const saved = savedSkills.find((skill) => skill.id === id);
    const sourceId = saved?.parentSkillId || id;
    const entry = CURATED_PRODUCT_SKILLS.find((asset) => asset.id === sourceId);
    const manifest = getCatalogCapabilityManifest(sourceId) || getCatalogCapabilityManifest(id);
    const dimensions = [...new Set([
      ...(saved?.dimensionTags || []),
      ...(saved?.primaryDimension ? [saved.primaryDimension] : []),
      ...(entry?.primaryCategory ? [entry.primaryCategory] : []),
      ...(manifest?.deconstructionCardType ? [manifest.deconstructionCardType.replace(/-card$/, '')] : []),
    ].filter(Boolean))];
    const known = Boolean(saved ? isRuntimeReadySkillCard(saved) : manifest?.kind === 'skill-card' && manifest.runtimeStatus === 'active');
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
    return (profile?.capabilityMemberships || []).some((membership) =>
      membership.sourceId === sourceId
      && membership.sourceVersion === sourceVersion
      && Boolean(membership.persistedSkillId && favorites.has(membership.persistedSkillId)),
    );
  };

  const isFreeNovel = !selectedNovel || !canUseEnhancedCapability({
    commercialMode: selectedNovel.projectPreferenceProfile?.commercialMode,
  });
  const monetizationEnabled = isMonetizationEnabled();
  // This pure normalization is cheap; avoiding manual memoization keeps the
  // React Compiler's generated memoization consistent with this component.
  const capabilityProfile = getProjectCapabilityProfile(effectiveNovel);
  const [configurationDraft, setConfigurationDraft] = useState(capabilityProfile);
  const [configurationDirty, setConfigurationDirty] = useState(false);
  const [staleConfigurationSession, setStaleConfigurationSession] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [configurationApplyFailed, setConfigurationApplyFailed] = useState(false);
  const [isApplyingConfiguration, setIsApplyingConfiguration] = useState(false);
  const projectDeckIds = getProjectDeckIds(configurationDraft || capabilityProfile);
  const deckSummaryCards = [
    { slot: '主卡', id: (configurationDraft || capabilityProfile)?.projectSkillDeck.mainCardId },
    ...[0, 1].map((index) => ({
      slot: `辅卡 ${index + 1}`,
      id: (configurationDraft || capabilityProfile)?.projectSkillDeck.supportCardIds[index],
    })),
  ].map((item) => ({ ...item, card: item.id ? resolveDeckCard(item.id) : null }));
  const supportDeckCount = deckSummaryCards.filter((item) => item.slot.startsWith('辅卡') && item.card).length;
  const deckEmptyHint = projectDeckIds.length === 0
    ? '可添加 1 张主卡、2 张辅卡'
    : supportDeckCount < 2
      ? `还可添加 ${2 - supportDeckCount} 张辅卡`
      : '作品卡组已满';
  const activeFlow = SKILL_SERIES_FLOWS.find((flow) => flow.id === configurationDraft?.activeFlowId);
  const currentGuardrailIds = (configurationDraft || capabilityProfile)?.guardrailIds || [];
  const isGuardrailCandidate = (asset: CuratedProductSkill) => (
    getGovernanceCapabilityType(asset) === 'guardrail' && currentGuardrailIds.includes(asset.id)
  );
  const hasLegacyConfiguration = Boolean(effectiveNovel?.projectPreferenceProfile && effectiveNovel.projectPreferenceProfile.capabilityModelVersion !== 3);
  const baselineToken = getCapabilityConfigurationBaselineToken(capabilityProfile);
  const selectedPackageRestricted = Boolean(selectedPackage && selectedPackage.type === 'paid' && monetizationEnabled && isFreeNovel);
  const packageHasStaleSelection = packageComponents.some((component) => isPackageStepSelected(component) && isConfigurationPackageComponent(component));
  const packageHasResults = packageComponents.some((component) => packageComponentResults[component.step.id] || packageComponentResults[component.assetId]);
  const packageApplyDestination: CapabilityApplyDestination = packageComponents.some((component) => {
    const status = packageComponentResults[component.step.id] || packageComponentResults[component.assetId];
    return Boolean(status && isWorldCandidateArtifact(component.manifest?.outputArtifact));
  })
    ? 'world'
    : packageComponents.some((component) => {
      const status = packageComponentResults[component.step.id] || packageComponentResults[component.assetId];
      return Boolean(status && isOutlineCandidateOutput(component.manifest?.output)
        && !isWorldCandidateArtifact(component.manifest?.outputArtifact));
    })
      ? 'outline'
      : 'return';
  const packageApplyOutlineAssetId = packageComponents.find((component) => {
    const status = packageComponentResults[component.step.id] || packageComponentResults[component.assetId];
    return Boolean(status && isOutlineCandidateOutput(component.manifest?.output)
      && !isWorldCandidateArtifact(component.manifest?.outputArtifact));
  })?.assetId || null;
  const packageApplyButtonLabel = getCapabilityApplyButtonLabel(packageApplyDestination);
  const packageSubmitButtonLabel = getPackageSubmitButtonLabel(packageHasResults, packageSelections.length);
  const packageEmptySelectionHint = getPackageEmptySelectionHint(packageHasResults, packageSelections.length, configurationDirty && !staleConfigurationSession);
  const missingRequiredPackageLabels = packageComponents
    .filter((component) => component.step.required && !isPackageStepSelected(component))
    .map(getPackageComponentLabel);
  const packageMissingRequiredSelection = missingRequiredPackageLabels.length > 0;
  const packageSubmitDisabledReason = !selectedNovel
    ? packageSelections.length > 0 ? '请先在书库选择作品后再加入本次配置候选' : '请先在书库选择作品'
    : selectedPackageRestricted && packageSelections.length > 0
      ? '当前作品未开通授权增强；可查看步骤，需授权后再加入本次配置候选。'
      : packageSelections.length === 0
      ? packageHasResults ? '如需继续提交，请先勾选新能力' : '至少选择一项能力'
      : packageMissingRequiredSelection
        ? `请先选择必需能力：${missingRequiredPackageLabels.join('、')}`
      : staleConfigurationSession && packageHasStaleSelection
        ? '本次配置已变化，请先重新预览'
        : null;

  useEffect(() => {
    if (previousNovelIdRef.current === selectedNovel?.id) return;
    previousNovelIdRef.current = selectedNovel?.id || null;
    if (!selectedNovel?.id) return;
    // A work switch invalidates every session-bound configuration control.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfigurationDraft(getProjectCapabilityProfile(selectedNovel));
    setCandidateCardIds([]);
    setPendingCandidateId(null);
    setActiveTab(initialStage ? 'plaza' : 'mySkills');
    setSelectedCapability(getInitialCapabilityTab(initialStage));
    setSelectedCategory(initialStage || 'all');
    setSelectedSkillId(null);
    setPackageSelections([]);
    setPendingPackageSteps([]);
    setPackageSelectionDrafts({});
    setSelectedPackageId(null);
    setSelectedFlowDetail(null);
    setConfigurationDirty(false);
    setConfigurationError(null);
    setConfigurationApplyFailed(false);
    setLeavePromptOpen(false);
  }, [getInitialCapabilityTab, initialStage, selectedNovel]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedNovel?.id) {
      // This effect owns the external database-generation snapshot and must clear it when the work changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDatabaseGeneration(null);
      sessionContextRef.current = null;
      configurationSessionIdRef.current = null;
      setStaleConfigurationSession(false);
      return () => { cancelled = true; };
    }
    const readGeneration = getDatabaseGenerationReader();
    if (!readGeneration) {
      setDatabaseGeneration(0);
      return () => { cancelled = true; };
    }
    void readGeneration().then((generation) => {
      if (!cancelled) setDatabaseGeneration(generation);
    }).catch(() => {
      if (!cancelled) setDatabaseGeneration(null);
    });
    return () => { cancelled = true; };
  }, [selectedNovel?.id]);

  useEffect(() => {
    if (!selectedNovel?.id || databaseGeneration === null) return;
    const contextKey = `${selectedNovel.id}:${databaseGeneration}:${baselineToken}`;
    const hadSessionContext = sessionContextRef.current !== null;
    const contextChanged = sessionContextRef.current !== contextKey;
    const latest = loadLatestCapabilityConfigurationSession(selectedNovel.id);
    const restored = loadCapabilityConfigurationSession(selectedNovel.id, databaseGeneration, baselineToken);
    const stale = Boolean(latest && isCapabilityConfigurationSessionStale(latest, databaseGeneration, baselineToken));
    sessionContextRef.current = contextKey;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStaleConfigurationSession(stale);
    const sessionToRestore = restored || latest;
    const sessionPrefix = `capability:${selectedNovel.id}:`;
    configurationSessionIdRef.current = sessionToRestore?.sessionId
      || (configurationSessionIdRef.current?.startsWith(sessionPrefix) ? configurationSessionIdRef.current : null)
      || `${sessionPrefix}${createProductEventSessionId('configuration')}`;
    if (!sessionToRestore) {
      // The novel-switch effect already clears project-bound state. Avoid
      // overwriting a user's first click while the initial generation read
      // finishes; only a later database-generation change needs another reset.
      if (contextChanged && hadSessionContext) {
        setConfigurationDraft(capabilityProfile);
        setCandidateCardIds([]);
        setPendingCandidateId(null);
        setActiveTab(initialStage ? 'plaza' : 'mySkills');
        setSelectedCapability(getInitialCapabilityTab(initialStage));
        setSelectedCategory(initialStage || 'all');
        setSelectedSkillId(null);
        setPackageSelections([]);
        setPendingPackageSteps([]);
        setSelectedPackageId(null);
        setSelectedFlowDetail(null);
        setConfigurationDirty(false);
        setConfigurationError(null);
        setConfigurationApplyFailed(false);
        setLeavePromptOpen(false);
      }
      return;
    }
    // Hydrate the draft from the persisted session after the external snapshot is available.
    setConfigurationDraft(sessionToRestore.configurationDraft || capabilityProfile);
    setCandidateCardIds(sessionToRestore.candidateCardIds);
    setPendingPackageSteps(sessionToRestore.pendingPackageSteps || []);
    setPendingCandidateId(sessionToRestore.pendingCandidateId);
    if (initialStage) {
      setActiveTab('plaza');
      setSelectedCapability(getInitialCapabilityTab(initialStage));
      setSelectedCategory(initialStage);
      setSelectedSkillId(null);
    } else {
      setActiveTab(sessionToRestore.activeTab);
      setSelectedCapability(sessionToRestore.selectedCapability);
      setSelectedCategory(sessionToRestore.selectedCategory);
      setSelectedSkillId(sessionToRestore.selectedAssetId);
    }
    const restoreScroll = () => {
      if (studioScrollRef.current) studioScrollRef.current.scrollTop = sessionToRestore.scrollTop;
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(restoreScroll);
    else restoreScroll();
    const restoredDraftToken = getCapabilityConfigurationBaselineToken(sessionToRestore.configurationDraft);
    const hasPendingSessionWork = sessionToRestore.candidateCardIds.length > 0
      || (sessionToRestore.pendingPackageSteps?.length || 0) > 0
      || Boolean(sessionToRestore.pendingCandidateId);
    setConfigurationDirty(Boolean(restoredDraftToken !== baselineToken || hasPendingSessionWork));
  // capabilityProfile is derived on render; the persisted preference reference is the stable trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getInitialCapabilityTab, initialStage, selectedNovel?.id, databaseGeneration, baselineToken, effectiveNovel?.projectPreferenceProfile]);

  useEffect(() => {
    if (staleConfigurationSession || !selectedNovel?.id || databaseGeneration === null || sessionContextRef.current !== `${selectedNovel.id}:${databaseGeneration}:${baselineToken}`) return;
    const session: CapabilityConfigurationSession = {
      version: 1,
      novelId: selectedNovel.id,
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
      selectedAssetId: selectedSkillId,
      scrollTop: studioScrollRef.current?.scrollTop || 0,
      // Session ordering is not used for restoration; keep this value deterministic.
      updatedAt: 0,
    };
    saveCapabilityConfigurationSession(session);
  }, [staleConfigurationSession, selectedNovel?.id, databaseGeneration, baselineToken, configurationDraft, pendingPackageSteps, candidateCardIds, pendingCandidateId, activeTab, selectedCapability, selectedCategory, selectedSkillId, configurationDirty]);

  useEffect(() => {
    if (!configurationDirty) {
      // Keep the local draft aligned with the server profile when no edits are staged.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfigurationDraft(capabilityProfile);
    }
  // capabilityProfile is derived on render; the persisted preference reference is the stable trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveNovel?.id, effectiveNovel?.projectPreferenceProfile, configurationDirty]);

  type CapabilityProfileDraft = ReturnType<typeof buildV3CapabilityProfile>['capabilityProfile'];
  type CapabilityProfileUpdate = CapabilityProfileDraft | ((current: CapabilityProfileDraft | null) => CapabilityProfileDraft | null);

  const stageConfiguration = (profileOrUpdate: CapabilityProfileUpdate) => {
    if (staleConfigurationSession) {
      setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return;
    }
    setConfigurationDraft((current) => {
      const next = typeof profileOrUpdate === 'function'
        ? profileOrUpdate(current)
        : profileOrUpdate;
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
      const withMembership = upsertCapabilityMembership(current || getProjectCapabilityProfile(effectiveNovel), {
        sourceId: asset.parentSkillId || asset.id,
        sourceVersion: manifest?.version || '1',
        sourceType: manifest?.sourceType || asset.sourceType,
        persistedSkillId,
      });
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
  ) => {
    const draft = profileOverride || configurationDraft;
    if (!selectedNovel || !draft || applyingConfigurationRef.current) return;
    applyingConfigurationRef.current = true;
    setIsApplyingConfiguration(true);
    try {
      setConfigurationError(null);
      setConfigurationApplyFailed(false);
      const nextProfile = buildV3CapabilityProfile(effectiveNovel, draft);
      const databaseGeneration = await getDatabaseGenerationSafe();
      const preview = await previewCapabilityConfiguration(selectedNovel.id, databaseGeneration, nextProfile.capabilityProfile!);
      if (staleConfigurationSession) {
        setStaleConfigurationSession(false);
        setConfigurationError('草稿已按当前作品状态重新预览。请再次点击应用配置以写入作品。');
        setConfigurationApplyFailed(false);
        setConfigurationDirty(true);
        return;
      }
      const selectedPackageSteps = pendingPackageSteps.map((step) => ({
        stepId: step.id,
        assetId: step.assetId,
        mode: step.mode,
        trigger: step.trigger,
        scope: step.scope,
        order: step.order,
        required: step.required,
        ...(step.dependsOn ? { dependsOn: [...step.dependsOn] } : {}),
      }));
      const applied = await applyCapabilityConfiguration(selectedNovel.id, databaseGeneration, preview.previewToken, nextProfile.capabilityProfile!, selectedPackageSteps, targetChapterId);
      const appliedProfile = { ...nextProfile, capabilityProfile: applied.profile };
      const appliedNovel = { ...selectedNovel, projectPreferenceProfile: appliedProfile };
      setUserNovels((prev) => prev.map((entry) => entry.id === selectedNovel.id ? { ...entry, projectPreferenceProfile: appliedProfile } : entry));
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
              next[component.step.id] = component.step.mode === 'configure'
                ? 'configured'
                : 'recommended';
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
        void recordCapabilityEvent({ eventName: 'capability_returned_to_editor', stage: 'advanced', result: 'success', novelId: selectedNovel.id, action: 'apply-and-return' });
        if (destination === 'world') {
          onNavigate?.('world', { capabilityApplied: true, targetFocus: 'workspace-world', worldCapabilityLaunch });
        } else if (destination === 'outline' && (projectLaunchAssetId || packageApplyOutlineAssetId)) {
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
    if (selectedNovel?.id) void recordCapabilityEvent({ eventName: 'capability_config_cancelled', stage: 'advanced', result: 'success', novelId: selectedNovel.id });
    onNavigate?.(selectedNovel ? returnView : 'library');
  };

  const handleApplyProjectTechnique = async (asset: CuratedProductSkill) => {
    if (!selectedNovel?.id || getGovernanceCapabilityType(asset) !== 'technique') return;
    const manifest = getCapabilityManifest(asset);
    if (manifest.outputArtifact === 'worldBibleCandidate' || manifest.outputArtifact === 'characterCardCandidate') {
      const persistedId = manifest.sourceType !== 'built-in' ? await handleImportAsset(asset) : asset.id;
      if (!persistedId) return;
      const current = upsertCapabilityMembership(configurationDraft || getProjectCapabilityProfile(effectiveNovel), {
        sourceId: asset.parentSkillId || asset.id,
        sourceVersion: manifest.version || '1',
        sourceType: manifest.sourceType || asset.sourceType,
        persistedSkillId: persistedId,
      });
      const projectTechniques = current?.projectTechniqueIds || current?.favoriteTechniqueIds || [];
      const nextProfile = buildV3CapabilityProfile(effectiveNovel, {
        ...current,
        projectTechniqueIds: projectTechniques.includes(persistedId) ? projectTechniques : [...projectTechniques, persistedId],
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
    const persistedId = manifest.sourceType !== 'built-in' ? await handleImportAsset(asset) : asset.id;
    if (!persistedId) return;
    const current = upsertCapabilityMembership(configurationDraft || getProjectCapabilityProfile(effectiveNovel), {
      sourceId: asset.parentSkillId || asset.id,
      sourceVersion: manifest.version || '1',
      sourceType: manifest.sourceType || asset.sourceType,
      persistedSkillId: persistedId,
    });
    const projectTechniques = current?.projectTechniqueIds || current?.favoriteTechniqueIds || [];
    const nextProfile = buildV3CapabilityProfile(effectiveNovel, {
      ...current,
      projectTechniqueIds: projectTechniques.includes(persistedId) ? projectTechniques : [...projectTechniques, persistedId],
      capabilityMemberships: current.capabilityMemberships,
    }).capabilityProfile;
    stageConfiguration(nextProfile);
    await applyConfiguration(
      true,
      manifest.stages.includes('planner') ? 'outline' : 'return',
      nextProfile,
      asset.id,
    );
  };

  const cancelPendingCandidate = () => {
    if (pendingCandidateId && selectedNovel?.id) {
      void recordCapabilityEvent({
        eventName: 'capability_config_cancelled', stage: 'advanced', result: 'success',
        novelId: selectedNovel.id, objectId: pendingCandidateId, action: 'conflict',
      });
    }
    setPendingCandidateId(null);
  };

  const addCandidateSkill = (skillId: string) => {
    if (!skillId || staleConfigurationSession) {
      if (staleConfigurationSession) setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return;
    }
    setCandidateCardIds((ids) => ids.includes(skillId) ? ids : [...ids, skillId]);
    setConfigurationDirty(true);
    setConfigurationError(null);
    setConfigurationApplyFailed(false);
  };

  const handleImportAsset = async (asset: CuratedProductSkill): Promise<string | null> => {
    if (staleConfigurationSession) {
      setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return null;
    }
    const isLicensed = getCapabilityManifest(asset)?.sourceType === 'licensed';

    if (isLicensed && isFreeNovel) {
      dispatchCapabilityUnavailable({
          limitType: 'extractSkill',
          count: 5,
          max: 5,
          error: '当前商业化实验配置未开放该授权增强能力；基础写作和 BYOK 主链仍可继续。',
          novelId: selectedNovel?.id || '',
      });
      return null;
    }

    const existing = savedSkills.find((skill) => (skill.parentSkillId || skill.id) === (asset.parentSkillId || asset.id) && skill.sourceType === asset.sourceType && skill.version === (Number(getCatalogCapabilityManifest(asset.id)?.version) || 1));
    if (existing) {
      stageAssetMembership(asset, existing.id);
      return existing.id;
    }
    setCloningAssetId(asset.id);

    await new Promise((resolve) => setTimeout(resolve, 400));

    try {
      const newSkill = cloneAssetToSkill(asset);
      if (!newSkill) {
        alert('该能力尚未评测，暂不能导入。');
        return null;
      }
      await createSkill(newSkill);

      // Creation is the authoritative persistence boundary. A feedback-score
      // refresh is best effort and must not discard the newly created card or
      // prevent its project membership from being staged.
      let persistedSkillId = newSkill.id;
      try {
        const updated = await syncSkillFeedbackScores();
        const persisted = updated.find((skill) => (skill.parentSkillId || skill.id) === (newSkill.parentSkillId || newSkill.id) && skill.sourceType === newSkill.sourceType && skill.version === newSkill.version);
        persistedSkillId = persisted?.id || newSkill.id;
        setSavedSkills(persisted ? updated : [...updated, newSkill]);
      } catch (syncError) {
        logger.warn('Skill feedback refresh failed after creation:', syncError);
        setSavedSkills((current) => current.some((skill) => skill.id === newSkill.id) ? current : [...current, newSkill]);
      }
      stageAssetMembership(asset, persistedSkillId);
      void recordCapabilityEvent({ eventName: 'skill_card_added', stage: 'import', result: 'success', novelId: selectedNovel?.id, objectId: persistedSkillId, sourceType: asset.sourceType });
      return persistedSkillId;
    } catch (err) {
      logger.warn('Failed to clone asset:', err);
      return null;
    } finally {
      setCloningAssetId(null);
    }
  };

  const handleEquipAsset = async (asset: CuratedProductSkill) => {
    if (!selectedNovel) {
      alert('请先选择一个作品再配置能力。');
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
      const persistedId = getCapabilityManifest(asset)?.sourceType !== 'built-in' ? await handleImportAsset(asset) : asset.id;
      if (!persistedId) return;
      const current = upsertCapabilityMembership(configurationDraft || getProjectCapabilityProfile(effectiveNovel), {
        sourceId: asset.parentSkillId || asset.id,
        sourceVersion: getCapabilityManifest(asset)?.version || '1',
        sourceType: getCapabilityManifest(asset)?.sourceType || asset.sourceType,
        persistedSkillId: persistedId,
      });
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
      void recordCapabilityEvent({ eventName: 'technique_favorited', stage: 'advanced', result: 'success', novelId: selectedNovel.id, objectId: asset.id, sourceType: asset.sourceType });
      return;
    }
    if (type === 'skill-card') {
      const manifest = getCapabilityManifest(asset);
      if (manifest.kind !== 'skill-card' || manifest.runtimeStatus !== 'active') return;
      const persistedId = await handleImportAsset(asset);
      if (!persistedId) return;
      stageAssetMembership(asset, persistedId);
      if (!projectDeckIds.includes(persistedId)) setCandidateCardIds((ids) => ids.includes(persistedId) ? ids : [...ids, persistedId]);
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
      alert('该历史能力待整理，暂不参与新配置。');
      return;
    }
    handleDirectExec(asset);
  };

  const handleDirectExec = (asset: CuratedProductSkill) => {
    if (!selectedNovel?.id) {
      alert('请先选择一个作品再使用该能力。');
      return;
    }
    const manifest = getCapabilityManifest(asset);
    const launchStage = selectedCategory === 'all' ? initialStage : selectedCategory;
    const plannerOnly = manifest.stages.includes('planner')
      && !manifest.stages.includes('writer')
      && !manifest.stages.includes('critic');
    if (plannerOnly && (Boolean(targetChapterId) || (launchStage && launchStage !== 'creative-setup'))) {
      alert('该能力仅支持设定与大纲阶段，请切换到“① 立设定与大纲”后再运行。');
      setSelectedCategory('creative-setup');
      return;
    }
    const canUseAsChapterSkillCard =
      manifest.kind === 'skill-card' &&
      manifest.runtimeStatus === 'active' &&
      manifest.allowedScopes.includes('chapter');
    if (getGovernanceCapabilityType(asset) === 'overlay' || canUseAsChapterSkillCard) {
      const savedSkill = savedSkills.find((skill) => skill.id === asset.id || skill.parentSkillId === asset.id);
      const sessionCardIds = getTrustedSessionCardIds([asset.id, savedSkill?.id || ''], savedSkills);
      if (!sessionCardIds.length) { alert('该卡暂不可作为本章使用卡运行。'); return; }
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
      void recordCapabilityEvent({ eventName: 'deconstruction_card_trial', stage: 'drafting', result: 'success', novelId: selectedNovel?.id, objectId: sessionCardIds[0] });
      return;
    }
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const launchAction = getDirectExecLaunchAction(asset);
    if (!launchAction) return;
    onLaunchCapability?.({ action: launchAction, assetId: asset.id, launchToken: now, novelId: selectedNovel.id, targetChapterId });
  };

  const getDirectExecLaunchAction = (asset: CuratedProductSkill): 'run-diagnostic' | 'run-utility' | null => {
    const manifest = getCapabilityManifest(asset);
    const isPreviewOnlyTransform = manifest.output === 'transform-preview' && manifest.sideEffect === 'preview-only';
    if (manifest.action === 'run-diagnostic') return 'run-diagnostic';
    if (isPreviewOnlyTransform || getGovernanceCapabilityType(asset) === 'utility') return 'run-utility';
    return null;
  };

  const getPackageResultLaunchLabel = (
    applyResult: CapabilityApplicationStatus,
    step: EnhancementPackageStep,
    manifest: ReturnType<typeof getCatalogCapabilityManifest> | undefined,
    asset: CuratedProductSkill | null,
  ): string | null => {
    if (applyResult !== 'recommended' && applyResult !== 'run') return null;
    if (!asset || !manifest || step.mode !== 'run-now') return null;
    const isPreviewOnlyTransform = manifest.output === 'transform-preview' && manifest.sideEffect === 'preview-only';
    if (manifest.action === 'run-diagnostic') return '运行审稿诊断';
    if (isPreviewOnlyTransform) return '生成精修预览';
    if (getGovernanceCapabilityType(asset) === 'utility') return '运行辅助动作';
    return null;
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
    const target = action || (configurationDirty && !staleConfigurationSession ? applyAction : null);
    if (!target) return;
    target.focus();
    target.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [configurationDirty, packageComponentResults, packageSelections.length, selectedPackageId, staleConfigurationSession]);

  const launchTechnique = (asset: CuratedProductSkill, scope: 'project' | 'chapter') => {
    if (!selectedNovel?.id) {
      alert('请先选择一个作品再使用该能力。');
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
  const handleUseProjectTechnique = (asset: CuratedProductSkill) => launchTechnique(asset, 'project');

  const handleApplyPackage = async () => {
    setPackageResultLaunchFeedbackAssetId(null);
    if (!selectedPackage || !selectedNovel) {
      setConfigurationError('请先选择作品，再加入本次配置候选。');
      return;
    }
    const selected = packageComponents.filter(isPackageStepSelected);
    if (selected.length === 0) {
      setConfigurationError('至少选择一项能力。');
      return;
    }
    if (staleConfigurationSession && selected.some(isConfigurationPackageComponent)) {
      setConfigurationError('旧草稿只读，请先重新预览本次配置。');
      return;
    }
    const selectedFlows = selected.filter((component) => component.flow);
    if (selectedFlows.length > 1) {
      setConfigurationError('每部作品只能选择一个创作流程，请在能力包中只保留一个流程。');
      return;
    }
    const baseProfile = configurationDraft || getProjectCapabilityProfile(effectiveNovel) || {
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
        if (activeFlowId && activeFlowId !== component.flow.id && typeof window !== 'undefined' && !window.confirm('当前作品已有创作流程。确认替换为能力包中的流程吗？')) {
          setPackageComponentResults((current) => ({ ...current, [component.step.id]: 'conflict' }));
          continue;
        }
        nextProfile = { ...nextProfile, activeFlowId: component.flow.id };
        profileChanged = true;
        nextPendingSteps.push(component.step);
        setPackageComponentResults((current) => ({ ...current, [component.step.id]: 'recommended' }));
      } else if (component.asset) {
        const type = getGovernanceCapabilityType(component.asset);
        if (type === 'diagnostic' || type === 'utility') {
          setPackageComponentResults((current) => ({ ...current, [component.step.id]: 'recommended' }));
          nextPendingSteps.push(component.step);
          void recordCapabilityEvent({ eventName: 'capability_package_component_selected', stage: 'advanced', result: 'success', novelId: selectedNovel.id, objectId: component.asset.id });
          continue;
        }
        if (type !== 'technique' && type !== 'skill-card') continue;
        const manifest = getCapabilityManifest(component.asset);
        if (manifest.sourceType === 'licensed' && isFreeNovel) {
          setPackageComponentResults((current) => ({ ...current, [component.step.id]: 'unavailable' }));
          dispatchCapabilityUnavailable({
            limitType: 'extractSkill', count: 5, max: 5,
            error: '当前商业化实验配置未开放该授权增强能力；其他已选能力仍可继续配置。',
            novelId: selectedNovel.id,
          });
          continue;
        }
        const existing = savedSkills.find((skill) => (skill.parentSkillId || skill.id) === (component.asset?.parentSkillId || component.asset?.id)
          && skill.sourceType === component.asset?.sourceType
          && skill.version === (Number(manifest.version) || 1));
        const persistedId = manifest.sourceType === 'built-in' && type === 'technique' ? component.asset.id : existing?.id;
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
        if (type === 'technique' && component.step.scope === 'project' && !(nextProfile.projectTechniqueIds || []).includes(persistedId)) {
          nextProfile = { ...nextProfile, projectTechniqueIds: [...(nextProfile.projectTechniqueIds || []), persistedId] };
        } else if (type === 'skill-card') {
          const deckResult = addCardToProjectDeck(nextProfile, persistedId);
          if (deckResult.requiresReplacement) nextCandidates.push(persistedId);
          else nextProfile = deckResult.profile;
        }
        setPackageComponentResults((current) => ({ ...current, [component.step.id]: 'recommended' }));
      } else {
        setPackageComponentResults((current) => ({ ...current, [component.step.id]: 'unavailable' }));
      }
    }
    if (profileChanged) stageConfiguration(buildV3CapabilityProfile(effectiveNovel, nextProfile).capabilityProfile);
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
    void recordCapabilityEvent({ eventName: 'capability_package_expanded', stage: 'advanced', result: 'success', novelId: selectedNovel.id, objectId: selectedPackage.id });
  };

  return (
    <div className="h-full flex bg-transparent relative overflow-hidden">
      <div ref={studioScrollRef} className="flex-1 overflow-y-auto p-8 relative z-10">

        <div className="mb-10 text-center">
          <h1 className="text-3xl font-serif font-bold text-theme-text flex items-center justify-center gap-3">
            <Wand2 size={28} className="text-theme-accent" />
            作品能力中心
          </h1>
          <p className="text-theme-muted mt-2">管理作品默认能力与本章写法；应用配置后，作品卡组影响后续正文，本章使用规则只影响当前章。</p>
        </div>

        <div className="max-w-6xl mx-auto mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
            <div className="text-xs font-bold text-theme-text">当前创作流程</div>
            <p className="mt-2 text-sm font-semibold text-theme-accent">{activeFlow?.name || '未选择流程'}</p>
            <p className="mt-1 text-[11px] text-theme-muted">{activeFlow ? '当前作品已选择' : '手写流程不受影响'}</p>
          </div>
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
            <div className="text-xs font-bold text-theme-text">常用技法</div>
            <p className="mt-2 text-sm font-semibold text-theme-accent">{(configurationDraft || capabilityProfile)?.favoriteTechniqueIds.length || 0} 张已收藏</p>
            <p className="mt-1 text-[11px] text-theme-muted">按阶段选择，不占作品卡组</p>
          </div>
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
            <div className="text-xs font-bold text-theme-text">作品卡组</div>
            <p className="mt-2 text-sm font-semibold text-theme-accent">{projectDeckIds.length} / 3</p>
            <p className="mt-1 text-[11px] text-theme-muted">仅拆书卡占用：一张主卡，最多两张辅卡</p>
            <div className="mt-2 space-y-1 text-[10px] leading-4">
              {deckSummaryCards.map(({ slot, card }) => (
                <p key={slot} className={cn('truncate', card ? 'text-theme-text' : 'text-theme-muted')}>
                  <span className="font-bold text-theme-text">{slot}：</span>{card ? `${card.title} · 用途：${getDeckDimensionSummary(card.dimensions)}` : '未设置'}
                </p>
              ))}
              <p className="text-theme-muted"><span className="font-bold text-theme-text">空位：</span>{deckEmptyHint}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
            <div className="text-xs font-bold text-theme-text">护栏状态</div>
            <p className="mt-2 text-sm font-semibold text-amber-600">系统检查候选</p>
            <p className="mt-1 text-[11px] text-theme-muted">默认护栏自动启用；已选增强 {currentGuardrailIds.length} 条。</p>
          </div>
        </div>

        {hasLegacyConfiguration && (
          <div className="max-w-6xl mx-auto mb-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-theme-text">
            <div className="font-bold">旧配置待整理</div>
            <p className="mt-1 text-xs text-theme-muted">检测到历史能力配置。这里仅提供迁移预览，不会静默改写；现有写作流程继续可用。</p>
            <button type="button" className="mt-3 rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-bold text-amber-700" onClick={async () => {
              if (!selectedNovel) return;
              setMigrationBusy(true); setMigrationError(null);
              try { const generation = await getDatabaseGenerationSafe(); setMigrationPreview(await previewCapabilityMigration(selectedNovel.id, generation)); }
              catch (error) { setMigrationError(error instanceof Error ? error.message : '迁移预览失败'); }
              finally { setMigrationBusy(false); }
            }}>查看整理入口</button>
          </div>
        )}

        {selectedNovel && <LegacyArtifactStructuringPrompt key={selectedNovel.id} novelId={selectedNovel.id} />}

        <div className="max-w-6xl mx-auto mb-8 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
          <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-theme-text">
              <Sparkles size={18} className="text-theme-accent" />
              能力卡如何影响写作
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                { label: '分镜', detail: '影响下一章的场景选择、冲突推进和节奏密度。', icon: BrainCircuit },
                { label: '正文', detail: '约束文风、句法、人物口吻和叙事颗粒度。', icon: PenLine },
                { label: '审查', detail: '帮助 AI 用同一套标准检查跑偏、重复和节奏问题。', icon: CheckCircle2 },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-2xl border border-theme-border bg-theme-bg/50 p-4">
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
            <p className="mt-2 text-xs leading-5 text-theme-muted">{selectedNovel ? `《${selectedNovel.title}》能力配置` : '先在书库选择作品，再管理能力。'}</p>
            {stageLaunchHint && <p className="mt-2 rounded-lg border border-theme-accent/30 bg-theme-accent/5 px-3 py-2 text-xs leading-5 text-theme-text">{stageLaunchHint}</p>}
            {returnHint && <p className="mt-2 text-xs leading-5 text-theme-muted">{returnHint}</p>}
            <button type="button" onClick={handleReturnToWriting} className="mt-4 w-full rounded-2xl border border-theme-border px-4 py-3 text-sm font-bold text-theme-text transition-colors hover:border-theme-accent">{returnLabel}</button>
          </div>
        </div>

        {/* TAB Switcher */}
        <div className="max-w-6xl mx-auto mb-8 flex justify-center border-b border-theme-border/30 pb-px">
          <div className="flex gap-8">
            <button
              type="button"
              onClick={() => setActiveTab('mySkills')}
              className={cn(
                "pb-4 text-base font-bold transition-all relative",
                activeTab === 'mySkills'
                  ? "text-theme-text font-black"
                  : "text-theme-muted hover:text-theme-text"
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
                "pb-4 text-base font-bold transition-all relative flex items-center gap-1.5",
                activeTab === 'plaza'
                  ? "text-theme-text font-black"
                  : "text-theme-muted hover:text-theme-text"
              )}
            >
              <Sparkles size={14} className={cn("text-amber-500", activeTab === 'plaza' && "animate-pulse")} />
              能力商店
              {activeTab === 'plaza' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full" />
              )}
            </button>
          </div>
        </div>

        {(configurationDirty || configurationError) && (
          <div className="max-w-6xl mx-auto mb-6 rounded-xl border border-theme-accent/40 bg-theme-accent/5 p-4" role="status">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-theme-text">本次配置</div>
                <p className="mt-1 text-xs text-theme-muted">
                  {staleConfigurationSession
                    ? '这是旧版本草稿，仅供查看。请先重新预览，确认当前作品状态后再应用。'
                    : '本次配置仍待应用；应用成功后才更新作品状态。'}
                </p>
                {!staleConfigurationSession && <p className="mt-1 text-xs text-theme-muted">{CAPABILITY_RETURN_EFFECT_HINT}</p>}
                {configurationError && <p role="alert" className="mt-1 text-xs text-red-600">{configurationError}</p>}
              </div>
              {candidateCardIds.length > 0 && (
                <div className="w-full rounded-lg border border-theme-border bg-theme-bg/40 p-3">
                  <div className="text-xs font-bold text-theme-text">待提交的卡组位置</div>
                  <p className="mt-1 text-[11px] text-theme-muted">选择主卡或辅卡后仍是待提交状态；点击应用配置才会写入作品卡组。</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {candidateCardIds.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded border border-theme-border px-2 py-1 text-[11px] text-theme-text">
                        {CURATED_PRODUCT_SKILLS.find((asset) => asset.id === id)?.title || savedSkills.find((skill) => skill.id === id)?.name || id}
                        <button type="button" disabled={staleConfigurationSession} onClick={() => stageCandidateCard(id, 'main')} className="rounded border border-theme-border px-1.5 py-0.5 text-[10px]">设为主卡</button>
                        <button type="button" disabled={staleConfigurationSession} onClick={() => stageCandidateCard(id, 'support')} className="rounded border border-theme-border px-1.5 py-0.5 text-[10px]">设为辅卡</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" onClick={() => void applyConfiguration(true)} disabled={!selectedNovel || isApplyingConfiguration} className="rounded-lg bg-theme-text px-4 py-2 text-xs font-bold text-theme-bg disabled:opacity-50">
                {staleConfigurationSession ? '重新预览本次配置' : configurationApplyFailed ? '重试应用配置并返回写作' : '应用配置并返回写作'}
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
                  {savedSkills.map(s => (
                    <SkillCard
                      key={s.id}
                      skill={s}
                      selected={s.id === selectedSkillId}
                      onOpen={() => setSelectedSkillId(s.id)}
                      onDelete={() => handleDeleteSkill(s.id)}
                      userNovels={userNovels}
                      onEquip={isRuntimeReadySkillCard(s) ? (novelId) => {
                        if (novelId !== selectedNovel?.id) {
                          setConfigurationError('请先切换到目标作品，再加入本次配置候选。');
                          return;
                        }
                        addCandidateSkill(s.id);
                      } : undefined}
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
                  这里还没有可配置到作品的专属 AI 写作能力。先生成或挑选能力卡，再选择卡组位置或应用配置；使用范围会在卡片上标明。
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
            <div role="tablist" aria-label="能力治理类别" className="flex flex-wrap gap-2 border-b border-theme-border/25 pb-3">
              {([
                ['flow', '创作流程'], ['technique', '写作技法'], ['skill-card', '拆书卡'], ['diagnostic-tools', '审稿与精修'], ['guardrail', '系统护栏'],
              ] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={selectedCapability === id} type="button" onClick={() => setSelectedCapability(id)} className={cn('px-3 py-2 rounded-lg text-xs font-bold border', selectedCapability === id ? 'bg-theme-sidebar border-theme-accent text-theme-text' : 'border-transparent text-theme-muted hover:text-theme-text')}>
                  {label} <span className="ml-1 text-[10px]">{capabilityTabCount(id)}</span>
                </button>
              ))}
              <button role="tab" aria-selected={selectedCapability === 'packages'} type="button" onClick={() => setSelectedCapability('packages')} className={cn('px-3 py-2 rounded-lg text-xs font-bold border', selectedCapability === 'packages' ? 'bg-theme-sidebar border-theme-accent text-theme-text' : 'border-transparent text-theme-muted hover:text-theme-text')}>
                能力包 <span className="ml-1 text-[10px]">{capabilityTabCount('packages')}</span>
              </button>
            </div>
            {/* 次级阶段过滤 */}
            {selectedCapability !== 'packages' && <div className="flex flex-wrap gap-2 border-b border-theme-border/25 pb-4">
              <button type="button" onClick={() => setSelectedCategory('all')} className={cn('px-3 py-2 rounded-lg text-xs font-bold border', selectedCategory === 'all' ? 'border-theme-accent text-theme-text' : 'border-transparent text-theme-muted')}>全部阶段</button>
              {([
                { id: 'creative-setup', label: '① 立设定与大纲', desc: '世界观、人设、黄金三章' },
                { id: 'active-drafting', label: '② 写正文与提速', desc: '流程、口吻、场面推进' },
                { id: 'style-polish', label: '③ 审稿与精修', desc: '去AI腔、套话、逻辑检查' },
                { id: 'commercial-sign', label: '④ 过签与平台检查', desc: '番茄阅文、爽点、完读率' },
              ] as const).map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={cn(
                      "px-4 py-2.5 rounded-lg text-xs font-bold transition-all flex flex-col items-start gap-0.5 border text-left",
                      isSelected
                        ? "bg-theme-sidebar border-theme-accent text-theme-text shadow-sm"
                        : "bg-transparent border-transparent text-theme-muted hover:text-theme-text hover:bg-theme-sidebar/30"
                    )}
                  >
                    <span>{cat.label}</span>
                    <span className="text-[9px] font-normal opacity-80 scale-90 origin-left block truncate max-w-[120px]">
                      {cat.desc}
                    </span>
                  </button>
                );
              })}
            </div>}

            {selectedCapability === 'packages' && <section aria-labelledby="capability-packages-title" className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 id="capability-packages-title" className="text-sm font-bold text-theme-text">能力包</h2>
                  <p className="mt-1 text-[11px] text-theme-muted">能力包会把流程、技法、拆书卡和辅助动作拆成可勾选步骤；先勾选待提交，再加入本次配置候选并按每步结果确认下一步。</p>
                </div>
                <span className="shrink-0 text-[10px] text-theme-muted">勾选待提交</span>
              </div>
              <div className="space-y-5">
                {groupedPackages.map((group) => (
                  <section key={group.id} aria-labelledby={`capability-package-group-${group.id}`} className="space-y-2">
                    <h3 id={`capability-package-group-${group.id}`} className="text-[11px] font-bold text-theme-text">{group.title}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {group.packages.map((pkg) => (
                        <div key={pkg.id} className="rounded-xl border border-theme-border/70 bg-theme-sidebar p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-theme-text">{pkg.name}</h4>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                <span className="rounded border border-theme-border/40 bg-theme-bg px-1.5 py-0.5 text-[9px] font-bold text-theme-text">{getPackageUseLabel(pkg.id)}</span>
                                <span className="rounded border border-theme-border/40 bg-theme-bg px-1.5 py-0.5 text-[9px] text-theme-muted">{getPackageStageSummary(pkg)}</span>
                                <span className="rounded border border-theme-border/40 bg-theme-bg px-1.5 py-0.5 text-[9px] text-theme-muted">{getPackageNextStepHint(pkg.id)}</span>
                              </div>
                              <p className="mt-1 text-[10px] leading-4 text-theme-muted">{pkg.intendedOutcome || pkg.description}</p>
                              {(packageSelectionDrafts[pkg.id]?.length || 0) > 0 && <p className="mt-1 text-[10px] font-bold text-theme-accent">已勾选 {packageSelectionDrafts[pkg.id].length} 项，待提交</p>}
                            </div>
                            <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold', pkg.type === 'paid' ? isFreeNovel ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600' : 'bg-emerald-500/10 text-emerald-600')}>
                              {getPackageAvailabilityLabel(pkg, !isFreeNovel, monetizationEnabled)}
                            </span>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-theme-muted">{getEnhancementPackageSteps(pkg).length} 项能力</span>
                            <button type="button" className="rounded-lg border border-theme-border px-3 py-1.5 text-[10px] font-bold text-theme-text hover:border-theme-accent" onClick={() => {
                              setSelectedPackageId(pkg.id);
                              setPackageResultLaunchFeedbackAssetId(null);
                              setPackageSelections(packageSelectionDrafts[pkg.id] || []);
                            }}>
                              {getPackageOpenButtonLabel(pkg, !isFreeNovel, monetizationEnabled)}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>}

            {/* 货架卡主渲染区域 */}
            {selectedCapability !== 'packages' && <div className="space-y-8">
              <div className="border-l-2 border-theme-accent pl-3.5 mb-6">
                <h2 className="text-base font-bold text-theme-text">
                  {selectedCategory === 'all' ? '全部阶段' : selectedCategory === 'creative-setup' ? '① 立设定与大纲' :
                   selectedCategory === 'active-drafting' ? '② 写正文与提速' :
                   selectedCategory === 'style-polish' ? '③ 审稿与精修' : '④ 过签与平台检查'}
                </h2>
                <p className="text-[11px] text-theme-muted mt-1">
                  {selectedCategory === 'all' ? '跨阶段浏览设定、大纲、正文、审稿与精修能力，按当前创作节点选择并应用。' : selectedCategory === 'creative-setup' ? '先选世界观、人设与黄金三章能力，搭好长篇骨架再开写。' :
                   selectedCategory === 'active-drafting' ? '选择作者流程、口吻技法和场面推进卡，让章节写作更稳定。' :
                   selectedCategory === 'style-polish' ? '写完后先跑审稿卡，再用精修卡处理套话、逻辑和局部润色。' :
                   '准备投平台前，用过签检查、爽点评分和完读率诊断做最后校准。'}
                </p>
              </div>

              {/* 创作流程的唯一选择与详情入口 */}
              {selectedCapability === 'flow' && (selectedCategory === 'all' || selectedCategory === 'creative-setup' || selectedCategory === 'active-drafting') && (
                <div className="space-y-6 pb-6 border-b border-theme-border/20 text-left">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-amber-500 animate-pulse" />
                    <div>
                      <h3 className="text-xs font-bold text-theme-text">创作流程目录</h3>
                      <p className="mt-1 text-[10px] text-theme-muted">这里是唯一的创作流程选择与详情入口。</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {SKILL_SERIES_FLOWS.filter((flow) => visibleFlowIds.includes(flow.id)).map((flow) => {
                      const meta = goldenFlowMetadata[flow.id] || { target: '通用作者', output: '全生命周期大纲正文', color: 'from-theme-border/20 to-theme-border/10 border-theme-border/30' };
                      const isActive = configurationDraft?.activeFlowId === flow.id;
                      const isLicensed = getCatalogCapabilityManifest(flow.id)?.sourceType === 'licensed';
                      const isLocked = isLicensed && isFreeNovel;

                      return (
                        <div
                          key={flow.id}
                          className={cn(
                            "relative rounded-xl p-5 border bg-gradient-to-br flex flex-col justify-between transition-all duration-200 group text-left",
                            meta.color,
                            isActive
                              ? "ring-1 ring-emerald-500/50 border-emerald-500/40 bg-emerald-500/[0.02]"
                              : "hover:border-theme-border/80 hover:shadow-sm"
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
                                <span className="text-theme-text font-medium">{meta.target}</span>
                              </div>
                              <div className="flex justify-between pt-0.5">
                                <span className="text-theme-muted">预期产物:</span>
                                <span className="text-theme-text font-medium">{meta.output}</span>
                              </div>
                            </div>

                            {/* 进度节点迷你时间轴预览 */}
                            <FlowTimelinePreview flow={flow} />
                          </div>

                          <div className="mt-5">
                            <button
                              type="button"
                              onClick={(event) => { flowDetailTriggerRef.current = event.currentTarget; setSelectedFlowDetail(flow); }}
                              className={cn(
                                "w-full py-2.5 rounded-lg text-xs font-bold transition-all text-center flex items-center justify-center gap-1",
                                isActive
                                  ? "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 border border-emerald-500/20"
                                  : isLocked
                                    ? "bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                                    : "bg-theme-text text-theme-bg hover:opacity-90"
                              )}
                            >
                              免密预览流程详情
                              {isActive && <CheckCircle2 size={12} className="text-emerald-500" />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
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

                {filteredCuratedSkills.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredCuratedSkills.map((asset) => (
                      <PlazaAssetCard
                        key={asset.id}
                        asset={asset}
                        isImported={isAssetPersisted(asset)}
                        isFavorited={isTechniqueFavorited(asset) || isGuardrailCandidate(asset)}
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
                ) : (
                  <div className="py-12 text-center text-theme-muted text-xs border border-dashed border-theme-border rounded-lg">
                    该航道暂无精品卡，敬请期待
                  </div>
                )}
              </div>
            </div>}
          </div>
        )}
      </div>

      {selectedPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="capability-package-title">
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-theme-border bg-theme-sidebar p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="capability-package-title" className="text-base font-bold text-theme-text">{selectedPackage.name}</h2>
                <p className="mt-1 text-xs leading-5 text-theme-muted">只把已勾选步骤提交到本次配置候选；配置类提交后仍待应用，点击应用配置后才写入作品；运行类提交后再点运行按钮。</p>
                <div className="mt-2 rounded-lg border border-theme-border/60 bg-theme-bg/60 p-2 text-[10px] leading-4 text-theme-muted">
                  {selectedPackage.intendedOutcome && <p><span className="font-bold text-theme-text">目标：</span>{selectedPackage.intendedOutcome}</p>}
                  <p><span className="font-bold text-theme-text">优先：</span>{getPackageRecommendedPath(selectedPackage.id)}</p>
                  <p><span className="font-bold text-theme-text">提交后：</span>{getPackageNextStepHint(selectedPackage.id)}</p>
                </div>
                {selectedPackageRestricted && (
                  <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] leading-4 text-amber-700" role="status">
                    当前作品未开通授权增强；你可以先查看步骤，授权后再加入本次配置候选。
                  </div>
                )}
                {packageSelections.length > 0 && <p className="mt-1 text-[10px] font-bold text-theme-accent" role="status">已勾选 {packageSelections.length} 项，待提交</p>}
              </div>
              <button type="button" aria-label="关闭能力包" className="rounded-lg p-1 text-theme-muted hover:bg-theme-bg" onClick={() => setSelectedPackageId(null)}><X size={16} /></button>
            </div>
            <div className="mt-4 space-y-2">
              {packageComponents.map(({ assetId, asset, flow, manifest, step }) => {
                const component = { assetId, asset, flow, manifest, step };
                const label = getPackageComponentLabel(component);
                const persisted = asset ? savedSkills.some((skill) => (skill.parentSkillId || skill.id) === (asset.parentSkillId || asset.id)
                  && skill.sourceType === asset.sourceType
                  && skill.version === (Number(manifest?.version) || 1)) : false;
                const needsImport = Boolean(asset && manifest && ['technique', 'skill-card'].includes(manifest.kind) && manifest.sourceType !== 'built-in' && !persisted);
                const selectable = Boolean((flow || asset) && manifest?.runtimeStatus === 'active' && !needsImport);
                const modeLabel = getPackageModeLabel(step.mode, manifest);
                const triggerLabel = step.trigger === 'project-setup' ? '立项时' : step.trigger === 'outline' ? '大纲期' : step.trigger === 'before-draft' ? '写前' : step.trigger === 'after-draft' ? '写后' : '阶段节点';
                const scopeLabel = getPackageScopeLabel(step.scope);
                const capabilityType = asset ? getGovernanceCapabilityType(asset) : manifest?.kind;
                const toolLabel = capabilityType === 'diagnostic' || capabilityType === 'utility' ? '不改正文 · ' : '';
                const action = needsImport ? '先保存到我的能力，再勾选待提交' : `${step.required ? '必选 · ' : ''}${toolLabel}${modeLabel} · ${triggerLabel} · ${scopeLabel}`;
                const effectHint = getPackageComponentActionHint(flow, manifest);
                const staleBlocked = staleConfigurationSession && isConfigurationPackageComponent(component);
                const missingDependencyLabels = (step.dependsOn || []).map((dependencyId) => {
                  const dependency = packageComponents.find((candidate) => candidate.step.id === dependencyId);
                  if (dependency && !isPackageStepSelected(dependency)) return getPackageComponentLabel(dependency);
                  if (!dependency && !packageSelections.includes(dependencyId)) return dependencyId;
                  return null;
                }).filter(Boolean);
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
                const applyResult = packageComponentResults[step.id] || packageComponentResults[assetId];
                const selectedPendingSubmit = isPackageStepSelected({ assetId, asset, flow, manifest, step }) && !applyResult;
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
                const stepPriorityTone = needsImport || !dependenciesSatisfied || manifest?.runtimeStatus !== 'active' || staleBlocked
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                  : step.required
                    ? 'border-theme-accent/40 bg-theme-accent/10 text-theme-accent'
                    : 'border-theme-border/50 bg-theme-bg text-theme-muted';
                const resultLaunchLabel = applyResult ? getPackageResultLaunchLabel(applyResult, step, manifest, asset) : null;
                const resultCandidateId = applyResult === 'recommended' && asset && capabilityType === 'skill-card'
                  ? (configurationDraft?.capabilityMemberships || []).find((membership) => membership.sourceId === (asset.parentSkillId || asset.id))?.persistedSkillId || null
                  : null;
                const resultCandidateInDeck = Boolean(resultCandidateId && projectDeckIds.includes(resultCandidateId));
                return (
                  <div key={step.id} className={cn('flex items-start gap-3 rounded-lg border border-theme-border p-3', selectable ? 'hover:border-theme-accent' : 'opacity-70')}>
                    <input type="checkbox" aria-label={`选择 ${label}`} disabled={!selectable || staleBlocked || (!isPackageStepSelected({ assetId, asset, flow, manifest, step }) && !dependenciesSatisfied)} checked={isPackageStepSelected({ assetId, asset, flow, manifest, step })} onChange={(event) => {
                      if (event.target.checked && !dependenciesSatisfied) return;
                      const next = event.target.checked ? [...packageSelections.filter((id) => id !== assetId), step.id] : packageSelections.filter((id) => id !== step.id && id !== assetId);
                      setPackageSelections(next);
                      if (selectedPackageId) setPackageSelectionDrafts((current) => ({ ...current, [selectedPackageId]: next }));
                    }} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-theme-text">{label}</span>
                        <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-bold', stepPriorityTone)}>{stepPriorityLabel}</span>
                      </span>
                      <span className="mt-1 block text-[10px] text-theme-muted">{action}{manifest?.sourceType ? ` · ${getCapabilitySourceLabel(manifest.sourceType)}` : ''}{disabledReason ? ` · ${disabledReason}` : ''}</span>
                      {effectHint && <span className="mt-0.5 block text-[10px] leading-4 text-theme-muted">{effectHint}</span>}
                      {applyResult && (
                        <span className="mt-1 block space-y-1">
                          <span role="status" className={cn('block text-[10px] font-bold', applyResult === 'configured' ? 'text-emerald-600' : applyResult === 'unavailable' || applyResult === 'conflict' ? 'text-amber-600' : 'text-theme-muted')}>
                            {getPackageResultLabel(applyResult, step, manifest, capabilityType, resultCandidateInDeck)}
                          </span>
                          {(resultLaunchLabel || (resultCandidateId && !resultCandidateInDeck)) && (
                            <span className="flex flex-wrap items-center gap-2">
                              {resultLaunchLabel && asset && (
                                <button
                                  type="button"
                                  ref={packageResultActionRef}
                                  data-autofocus-package-result="true"
                                  className="w-full rounded-lg bg-theme-text px-3 py-2 text-xs font-bold text-theme-bg hover:opacity-90"
                                  onClick={() => handleLaunchPackageResult(asset)}
                                >
                                  {resultLaunchLabel}
                                </button>
                              )}
                              {packageResultLaunchFeedbackAssetId === asset?.id && resultLaunchLabel && (
                                <span role="status" className="w-full text-[10px] font-bold text-emerald-600">
                                  已发送到编辑器执行
                                </span>
                              )}
                              {resultCandidateId && !resultCandidateInDeck && (
                                <>
                                  <button
                                    type="button"
                                    disabled={staleConfigurationSession}
                                    className="rounded-md border border-theme-accent px-2 py-0.5 text-[10px] font-bold text-theme-accent hover:bg-theme-accent/10 disabled:opacity-50"
                                    onClick={() => stageCandidateCard(resultCandidateId, 'main')}
                                  >
                                    设为主卡
                                  </button>
                                  <button
                                    type="button"
                                    disabled={staleConfigurationSession}
                                    className="rounded-md border border-theme-accent px-2 py-0.5 text-[10px] font-bold text-theme-accent hover:bg-theme-accent/10 disabled:opacity-50"
                                    onClick={() => stageCandidateCard(resultCandidateId, 'support')}
                                  >
                                    设为辅卡
                                  </button>
                                </>
                              )}
                            </span>
                          )}
                        </span>
                      )}
                      {selectedPendingSubmit && <span role="status" className="mt-1 block text-[10px] font-bold text-amber-600">已勾选，待提交到本次配置</span>}
                    </span>
                    {needsImport && asset && (
                      <button
                        type="button"
                        disabled={cloningAssetId === assetId}
                        className="shrink-0 rounded-lg border border-theme-border px-2 py-1 text-[10px] font-bold text-theme-text hover:border-theme-accent disabled:cursor-wait disabled:opacity-60"
                        onClick={async () => {
                          const persistedId = await handleImportAsset(asset);
                          if (persistedId) {
                            const next = isPackageStepSelected({ assetId, asset, flow, manifest, step }) ? packageSelections : [...packageSelections.filter((id) => id !== assetId), step.id];
                            setPackageSelections(next);
                            if (selectedPackageId) setPackageSelectionDrafts((current) => ({ ...current, [selectedPackageId]: next }));
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
                <p className="w-full basis-full text-[10px] leading-4 text-theme-muted">{CAPABILITY_RETURN_EFFECT_HINT}</p>
              )}
              <button type="button" className="flex-1 rounded-lg border border-theme-border px-3 py-2 text-xs font-bold text-theme-text" onClick={() => setSelectedPackageId(null)}>取消</button>
              {packageSubmitDisabledReason && packageSelections.length > 0 && (
                <div className="w-full basis-full rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700" role="status">
                  <span id="capability-package-submit-help">{packageSubmitDisabledReason}</span>
                  {!selectedNovel && (
                    <button
                      type="button"
                      className="ml-2 font-bold underline underline-offset-2"
                      onClick={() => {
                        setSelectedPackageId(null);
                        onNavigate?.('library');
                      }}
                    >
                      去书库选择作品
                    </button>
                  )}
                </div>
              )}
              {packageEmptySelectionHint && (
                <p className="w-full basis-full text-[10px] leading-4 text-theme-muted" role="status">
                  {packageEmptySelectionHint}
                </p>
              )}
              {staleConfigurationSession && (
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-theme-accent px-3 py-2 text-xs font-bold text-theme-accent"
                  onClick={() => {
                    if (!selectedNovel) {
                      setConfigurationError('请先选择作品后再预览本次配置。');
                      return;
                    }
                    void applyConfiguration(false);
                  }}
                  disabled={isApplyingConfiguration}
                >
                  重新预览本次配置
                </button>
              )}
              {configurationDirty && !staleConfigurationSession && (
                <button
                  type="button"
                  ref={packageApplyActionRef}
                  data-autofocus-package-apply="true"
                  disabled={!selectedNovel || isApplyingConfiguration}
                  className="flex-1 rounded-lg bg-theme-accent px-3 py-2 text-xs font-bold text-theme-bg shadow-sm hover:opacity-90 disabled:opacity-50"
                  onClick={() => void applyConfiguration(true, packageApplyDestination)}
                >
                  {packageApplyButtonLabel}
                </button>
              )}
              <button type="button" className="flex-1 rounded-lg bg-theme-text px-3 py-2 text-xs font-bold text-theme-bg disabled:opacity-50" aria-describedby={packageSubmitDisabledReason && packageSelections.length > 0 ? 'capability-package-submit-help' : undefined} title={packageSubmitDisabledReason || undefined} disabled={Boolean(packageSubmitDisabledReason) || isApplyingConfiguration} onClick={() => void handleApplyPackage()}>{packageSubmitButtonLabel}</button>
            </div>
          </div>
        </div>
      )}

      {selectedFlowDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="capability-flow-title" data-capability-flow-dialog="true">
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
                  <h2 id="capability-flow-title" className="text-xl font-serif font-bold text-theme-text">{selectedFlowDetail.name}</h2>
                </div>
                <p className="text-xs text-theme-muted mt-1.5 leading-relaxed">{selectedFlowDetail.description}</p>
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
                          <ShieldAlert size={11} className="shrink-0 text-amber-500/80 animate-pulse" />
                          <span className="font-bold shrink-0">质量门栏:</span>
                          <span className="font-sans line-clamp-1 text-amber-500/90">{step.qualityGate}</span>
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
                  "flex-1 py-2.5 text-xs font-bold rounded-xl text-white transition-all flex items-center justify-center gap-1.5",
                  (getCatalogCapabilityManifest(selectedFlowDetail.id)?.sourceType === 'licensed' && isFreeNovel)
                    ? "bg-amber-500 hover:bg-amber-600"
                    : "bg-theme-accent hover:opacity-90"
                )}
              >
                {(getCatalogCapabilityManifest(selectedFlowDetail.id)?.sourceType === 'licensed' && isFreeNovel) && <Lock size={12} />}
                激活该创作主流程
              </button>
            </div>
          </div>
        </div>
      )}

      {leavePromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="capability-leave-title">
          <div className="w-full max-w-md rounded-xl border border-theme-border bg-theme-sidebar p-5 shadow-xl">
            <h2 id="capability-leave-title" className="text-base font-bold text-theme-text">能力配置尚未应用</h2>
            <p className="mt-2 text-xs leading-5 text-theme-muted">离开前请选择如何处理当前作品未应用的能力配置。</p>
            <div className="mt-5 grid gap-2">
              <button type="button" className="rounded-lg bg-theme-text px-3 py-2 text-xs font-bold text-theme-bg" onClick={() => setLeavePromptOpen(false)}>继续配置</button>
              <button type="button" className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-bold text-red-600" onClick={abandonConfiguration}>放弃变更</button>
              <button type="button" className="rounded-lg border border-theme-border px-3 py-2 text-xs font-bold text-theme-text disabled:opacity-50" disabled={!selectedNovel || isApplyingConfiguration} onClick={() => { setLeavePromptOpen(false); void applyConfiguration(true); }}>应用并返回</button>
            </div>
          </div>
        </div>
      )}
      {pendingCandidateId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-theme-border bg-theme-sidebar p-5 shadow-xl">
            <h2 className="text-base font-bold text-theme-text">作品卡组已满</h2>
            <p className="mt-2 text-xs text-theme-muted">请选择要替换的卡片，或取消本次候选配置。</p>
            {(() => {
              const candidate = resolveDeckCard(pendingCandidateId);
              return (
                <div className="mt-4 rounded-lg border border-theme-accent/30 bg-theme-accent/5 p-3 text-xs">
                  <div className="font-bold text-theme-text">待放入：{candidate.title}</div>
                  <div className="mt-1 text-[10px] text-theme-muted">
                    来源：{candidate.source} · 版本：{candidate.version} · 卡型：{candidate.cardType}
                  </div>
                  <div className="mt-1 text-[10px] text-theme-muted">负责维度：{getDeckDimensionSummary(candidate.dimensions)}</div>
                </div>
              );
            })()}
            <div className="mt-4 space-y-2">{projectDeckIds.map((id, index) => {
              const target = resolveDeckCard(id);
              const candidate = resolveDeckCard(pendingCandidateId);
              const conflictDimensions = candidate.dimensions.filter((dimension) => target.dimensions.includes(dimension));
              const lostDimensions = target.dimensions.filter((dimension) => !candidate.dimensions.includes(dimension));
              const newDimensions = candidate.dimensions.filter((dimension) => !target.dimensions.includes(dimension));
              const impactRows = [
                { label: '重叠', value: conflictDimensions.length ? getDeckDimensionSummary(conflictDimensions) : '无' },
                { label: '会失去', value: lostDimensions.length ? getDeckDimensionSummary(lostDimensions) : '无' },
                { label: '会新增', value: newDimensions.length ? getDeckDimensionSummary(newDimensions) : '无' },
              ];
              return <button key={id} type="button" disabled={staleConfigurationSession || !target.known || !candidate.known} className="w-full rounded-lg border border-theme-border px-3 py-2 text-left text-xs enabled:hover:border-theme-accent disabled:cursor-not-allowed disabled:opacity-60" onClick={() => { const current = configurationDraft || getProjectCapabilityProfile(effectiveNovel); const result = addCardToProjectDeck(current, pendingCandidateId, undefined, id); if (!result.requiresReplacement) { stageConfiguration(buildV3CapabilityProfile(effectiveNovel, result.profile).capabilityProfile); setCandidateCardIds((items) => items.filter((item) => item !== pendingCandidateId)); setPendingCandidateId(null); } }}>
                <span className="block font-bold">{target.title} · {index === 0 ? '主卡' : `辅卡 ${index}`}</span>
                <span className="mt-1 block text-[10px] text-theme-muted">来源：{target.source} · 版本：{target.version} · 卡型：{target.cardType}</span>
                <span className="mt-1 block text-[10px] text-theme-muted">负责维度：{getDeckDimensionSummary(target.dimensions)}</span>
                {target.known && candidate.known ? (
                  <span className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-theme-muted">
                    {impactRows.map((row) => (
                      <span key={row.label} className="rounded border border-theme-border/40 bg-theme-bg/40 px-1.5 py-1">
                        <span className="block font-bold text-theme-text">{row.label}</span>
                        <span className="mt-0.5 block">{row.value}</span>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="mt-1 block text-[10px] text-theme-muted">来源、版本或运行时状态未知，暂不能确认替换。</span>
                )}
              </button>;
            })}</div>
            <button type="button" className="mt-4 w-full rounded-lg border border-theme-border px-3 py-2 text-xs text-theme-muted" onClick={cancelPendingCandidate}>取消</button>
          </div>
        </div>
      )}

      <SkillDetailDrawer
        skill={selectedSkill}
        allSkills={savedSkills}
        open={Boolean(selectedSkill)}
        onClose={() => setSelectedSkillId(null)}
        onSelectSkill={(id) => setSelectedSkillId(id)}
        novelId={selectedNovel?.id || ''}
        chapterId={targetChapterId}
        databaseGeneration={databaseGeneration ?? undefined}
        styleConfirmationFingerprint={selectedNovel?.projectPreferenceProfile?.writingStyleConfirmation?.fingerprint}
      />
      {migrationPreview && selectedNovel && (
        <CapabilityMigrationPreviewPanel
          preview={migrationPreview}
          error={migrationError}
          busy={migrationBusy}
          onClose={() => { setMigrationPreview(null); setMigrationError(null); }}
          onConfirm={async () => {
            setMigrationBusy(true); setMigrationError(null);
            try {
              const result = await applyCapabilityMigration(selectedNovel.id, migrationPreview.databaseGeneration, migrationPreview.previewToken);
              const migratedPreference = buildV3CapabilityProfile(effectiveNovel, result.profile as Partial<ProjectCapabilityProfile>);
              const profile = migratedPreference.capabilityProfile;
              if (!profile) throw new Error('迁移结果缺少有效能力配置');
              setUserNovels((prev) => prev.map((entry) => entry.id === selectedNovel.id ? { ...entry, projectPreferenceProfile: migratedPreference } : entry));
              onNovelUpdated?.({ ...selectedNovel, projectPreferenceProfile: migratedPreference });
              setConfigurationDraft(profile); setConfigurationDirty(false); setMigrationPreview(null);
              void recordCapabilityEvent({ eventName: 'skill_deck_applied', stage: 'advanced', result: 'success', novelId: selectedNovel.id, objectId: 'migration' });
            } catch (error) {
              const message = error instanceof CapabilityMigrationError && error.status === 409 ? '预览已过期，请重新预览。' : (error instanceof Error ? error.message : '迁移应用失败');
              setMigrationError(message);
            } finally { setMigrationBusy(false); }
          }}
        />
      )}
      <AlertDialog open={Boolean(skillToDeleteId)} onOpenChange={(open) => !open && setSkillToDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这张能力卡？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将删除这张写作能力卡，并从所有使用它的作品中移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={executeDeleteSkill} className="bg-red-600 hover:bg-red-700 text-white font-bold">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
