import { ShieldAlert } from 'lucide-react';
import { cn } from '../../lib/utils';
import { sanitizeWhiteLabelText } from '../../../shared/lib/public-skill-catalog';
import type { Novel } from '../../../shared/types';
import type { CuratedProductSkill } from '../../../shared/types/prompt-assets-governed';
import {
  getCapabilityDisplayText,
} from '../../lib/skills-studio-governance';
import {
  getCapabilityManifest,
  getCapabilitySourceLabel,
  getGovernanceCapabilityType,
  isSanitizeRequiredAsset,
} from '../../lib/capability-governance';
import {
  getAuthorFacingCapabilityActionHint,
  getAuthorFacingCapabilityActionLabel,
  getAuthorFacingCapabilityCardCategory,
  getAuthorFacingCapabilityDeckHint,
  getAuthorFacingCapabilityEntryHint,
  getAuthorFacingCapabilityScopeLabel,
  getAuthorFacingCapabilityUseHint,
} from '../../lib/capability-stage-cards';

export function PlazaAssetCard({
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
  onSanitize,
  fitnessChip,
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
  onSanitize?: () => void;
  fitnessChip?: { score: number; reasons: string[] };
}) {
  const isLicensed = getCapabilityManifest(asset)?.sourceType === 'licensed';
  const cleanTitle = sanitizeWhiteLabelText(asset.title);
  const governanceType = getGovernanceCapabilityType(asset);
  const manifest = getCapabilityManifest(asset);
  const isTechniqueManifest = (manifest?.kind as string) === 'technique';
  const supportsProjectTechnique =
    isTechniqueManifest && manifest?.allowedScopes.includes('project');
  const supportsChapterTechnique =
    isTechniqueManifest && manifest?.allowedScopes.includes('chapter');
  const isPreviewOnlyTransform =
    manifest.output === 'transform-preview' && manifest.sideEffect === 'preview-only';
  const canRunOneShot =
    manifest.action === 'run-diagnostic' || manifest.kind === 'utility' || isPreviewOnlyTransform;
  const cleanGoal = getCapabilityDisplayText(
    sanitizeWhiteLabelText(asset.goal || '暂无描述'),
    manifest.sourceType
  );
  const cleanSignal = getCapabilityDisplayText(
    sanitizeWhiteLabelText(asset.successSignal || ''),
    manifest.sourceType
  );
  const unavailable = manifest?.runtimeStatus !== 'active';
  const isBuiltIn = manifest?.sourceType === 'built-in';
  // Plan 225 签字语义：官方保修 vs 社区自验；消毒副本单独标注。
  const isSanitizedCopy = asset.id.startsWith('sanitized-');
  const cardCategory = manifest ? getAuthorFacingCapabilityCardCategory(manifest) : null;
  const useHint = cardCategory ? getAuthorFacingCapabilityUseHint(cardCategory) : null;
  const entryHint = manifest
    ? getAuthorFacingCapabilityDeckHint(manifest) ||
      (cardCategory ? getAuthorFacingCapabilityEntryHint(cardCategory) : null)
    : null;
  const visibleScopes = manifest.allowedScopes.filter(
    (scope) => scope !== 'single-run' || canRunOneShot
  );
  const scopeLabel = visibleScopes.length
    ? visibleScopes.map(getAuthorFacingCapabilityScopeLabel).join(' / ')
    : null;
  const directActionLabel = canRunOneShot
    ? getAuthorFacingCapabilityActionLabel(manifest, 'single-run')
    : undefined;
  const projectActionLabel = manifest
    ? getAuthorFacingCapabilityActionLabel(manifest, 'project')
    : undefined;
  const chapterActionLabel = manifest
    ? getAuthorFacingCapabilityActionLabel(manifest, 'chapter')
    : undefined;
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
            {isBuiltIn && (
              <span
                title="随版本升级 · 效果由 InkFlow 保修"
                className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest bg-emerald-500/10 text-emerald-600 border border-emerald-500/25"
              
                aria-hidden="true"
              >
                官方保修
              </span>
            )}
            {!isBuiltIn &&
              (isSanitizedCopy ? (
                <span
                  title="社区供给 · 已完成白标消毒 · 效果请自验"
                  aria-hidden="true"
                  className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest bg-sky-500/10 text-sky-600 border border-sky-500/25"
                >
                  已消毒
                </span>
              ) : (
                <span
                  title="社区供给 · 效果请自验"
                  aria-hidden="true"
                  className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest bg-theme-bg text-theme-muted border border-theme-border"
                >
                  社区配方
                </span>
              ))}
            {isLicensed && (
              <span
                aria-hidden="true"
                className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black tracking-widest bg-amber-500/10 text-amber-500 border border-amber-500/20"
              >
                授权增强
              </span>
            )}
          </h3>
          <div className="text-[10px] text-theme-muted tracking-wide mt-1 flex flex-wrap items-center gap-1.5">
            <span title="官方基准评测对卡面提示词的冷启动质量评分（45-98 分），仅代表提示词本身的质量，不代表你的生成效果。">
              {Number.isFinite(asset.score) ? `冷启动证据 ${asset.score}` : '证据待积累'}
            </span>
            <span className="text-theme-border/60">·</span>
            <span className="text-[9px] px-1 py-0.2 bg-theme-bg rounded text-theme-muted">
              {manifest ? getCapabilitySourceLabel(manifest.sourceType) : '来源未知'}
            </span>
            {fitnessChip && (
              <span
                className="text-[9px] px-1 py-0.2 bg-theme-accent/10 rounded text-theme-accent font-bold"
                title={fitnessChip.reasons.join('；') || undefined}
              >
                适合度 {fitnessChip.score}
              </span>
            )}
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

        {/* 徽章瘦身（001 目标 4）：只保留 作用范围 + 改正文/只读 两枚，
            其余元数据（类别、运行态、输入）由 useHint/actionHint 文案承载。 */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {scopeLabel && (
            <span className="px-1.5 py-0.5 bg-theme-bg rounded text-[9px] text-theme-muted border border-theme-border/30">
              {scopeLabel}
            </span>
          )}
          <span className="px-1.5 py-0.5 bg-theme-bg rounded text-[9px] text-theme-muted border border-theme-border/30">
            {canRunOneShot || governanceType === 'guardrail' ? '只读' : '改正文'}
          </span>
        </div>
        {(useHint || entryHint) && (
          <div className="space-y-0.5 text-[10px] leading-4 text-theme-muted">
            {useHint && <p>{useHint}</p>}
            {entryHint && <p>{entryHint}</p>}
          </div>
        )}
      </div>

      <div className="mt-auto pt-2 relative z-10">
        {actionHint && <p className="mb-2 text-[10px] leading-4 text-theme-muted">{actionHint}</p>}
        {governanceType === 'guardrail' ? (
          <button
            type="button"
            disabled={isCloning || unavailable}
            aria-pressed={isFavorited}
            onClick={(e) => {
              e.stopPropagation();
              onEquip();
            }}
            className={cn(
              'w-full py-2 rounded text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1',
              isCloning || unavailable
                ? 'bg-theme-border/30 text-theme-muted cursor-not-allowed'
                : isFavorited
                  ? 'bg-amber-500/10 border border-amber-500/35 text-amber-700 hover:bg-amber-500/15'
                  : 'border border-amber-500/35 text-amber-700 hover:bg-amber-500/10'
            )}
          >
            <ShieldAlert size={13} />
            {isFavorited ? '移出系统检查候选' : defaultActionLabel || '保存为系统检查候选'}
          </button>
        ) : unavailable ? (
          <div className="space-y-1.5">
            <div className="w-full py-2 text-center text-xs font-bold text-theme-muted border border-theme-border/40 rounded">
              暂不可运行
            </div>
            {onSanitize && isSanitizeRequiredAsset(asset.id) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSanitize();
                }}
                className="w-full py-2 rounded text-xs font-bold bg-theme-accent/10 border border-theme-accent/30 text-theme-accent hover:bg-theme-accent/20 transition-all"
              >
                消毒并启用
              </button>
            )}
          </div>
        ) : isPreviewOnlyTransform && isTechniqueManifest ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isCloning}
                aria-pressed={isFavorited}
                onClick={(e) => {
                  e.stopPropagation();
                  onEquip();
                }}
                className={cn(
                  'flex-1 py-2 rounded text-xs font-bold transition-all duration-150',
                  isCloning
                    ? 'bg-theme-border/30 text-theme-muted cursor-wait'
                    : isFavorited
                      ? 'bg-theme-accent/10 border border-theme-accent/40 text-theme-accent hover:bg-theme-accent/15'
                      : 'border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5'
                )}
              >
                {isCloning ? '处理中...' : isFavorited ? '取消收藏' : favoriteActionLabel}
              </button>
              <button
                type="button"
                disabled={isCloning}
                onClick={(e) => {
                  e.stopPropagation();
                  onUseTechnique();
                }}
                className="flex-1 py-2 rounded bg-theme-text text-theme-bg text-xs font-bold hover:opacity-90 disabled:opacity-60"
              >
                {chapterActionLabel || '用于本章'}
              </button>
            </div>
            <button
              type="button"
              disabled={isCloning}
              onClick={(e) => {
                e.stopPropagation();
                onDirectExec();
              }}
              className="w-full py-2 rounded border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text text-xs font-bold transition-all duration-150 disabled:opacity-60"
            >
              {directActionLabel || '运行一次，不保存配置'}
            </button>
          </div>
        ) : manifest?.action === 'run-diagnostic' ||
          manifest?.action === 'preview-transform' ||
          manifest?.kind === 'utility' ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDirectExec();
            }}
            className="w-full py-2 rounded bg-theme-text hover:opacity-90 text-theme-bg text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1"
          >
            {directActionLabel || '运行一次，不保存配置'}
          </button>
        ) : manifest?.action === 'activate-flow' ||
          manifest?.action === 'use-technique' ||
          manifest?.action === 'add-to-stack' ? (
          isTechniqueManifest ? (
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                disabled={isCloning}
                aria-pressed={isFavorited}
                onClick={(e) => {
                  e.stopPropagation();
                  onEquip();
                }}
                className={cn(
                  'flex-1 py-2 rounded text-xs font-bold transition-all duration-150',
                  isCloning
                    ? 'bg-theme-border/30 text-theme-muted cursor-wait'
                    : isFavorited
                      ? 'bg-theme-accent/10 border border-theme-accent/40 text-theme-accent hover:bg-theme-accent/15'
                      : 'border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5'
                )}
              >
                {isCloning ? '处理中...' : isFavorited ? '取消收藏' : favoriteActionLabel}
              </button>
              {supportsProjectTechnique && (
                <button
                  type="button"
                  disabled={isCloning}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUseProjectTechnique();
                  }}
                  className="flex-1 min-w-[8rem] py-2 rounded bg-theme-text text-theme-bg text-xs font-bold hover:opacity-90 disabled:opacity-60"
                >
                  {projectActionLabel || '设为作品默认'}
                </button>
              )}
              {supportsChapterTechnique && (
                <button
                  type="button"
                  disabled={isCloning}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUseTechnique();
                  }}
                  className="flex-1 min-w-[8rem] py-2 rounded border border-theme-border text-theme-text text-xs font-bold hover:border-theme-accent hover:text-theme-accent disabled:opacity-60"
                >
                  {chapterActionLabel || '用于本章'}
                </button>
              )}
            </div>
          ) : manifest.kind === 'skill-card' &&
            manifest.allowedScopes.includes('project') &&
            manifest.allowedScopes.includes('chapter') ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isCloning}
                onClick={(e) => {
                  e.stopPropagation();
                  onEquip();
                }}
                className={cn(
                  'flex-1 py-2 rounded text-xs font-bold transition-all duration-150',
                  isCloning
                    ? 'bg-theme-border/30 text-theme-muted cursor-wait'
                    : isLicensed
                      ? 'bg-amber-500 hover:bg-amber-600 text-white'
                      : 'border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5'
                )}
              >
                {isCloning ? '处理中...' : projectActionLabel || '应用配置后设为作品默认'}
              </button>
              <button
                type="button"
                disabled={isCloning}
                onClick={(e) => {
                  e.stopPropagation();
                  onDirectExec();
                }}
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
              onClick={(e) => {
                e.stopPropagation();
                onEquip();
              }}
              className={cn(
                'w-full py-2 rounded text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1',
                isCloning
                  ? 'bg-theme-border/30 text-theme-muted cursor-wait'
                  : isTechniqueManifest && isFavorited
                    ? 'bg-theme-accent/10 border border-theme-accent/40 text-theme-accent hover:bg-theme-accent/15'
                    : isLicensed
                      ? 'bg-amber-500 hover:bg-amber-600 text-white'
                      : 'border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5'
              )}
            >
              {isCloning
                ? '处理中...'
                : governanceType === 'flow'
                  ? projectActionLabel || '应用配置后设为作品默认'
                  : isTechniqueManifest
                    ? isFavorited
                      ? '取消收藏'
                      : favoriteActionLabel
                    : defaultActionLabel || '用于本章'}
            </button>
          )
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
            onClick={(e) => {
              e.stopPropagation();
              onImport();
            }}
            disabled={isCloning}
            className={cn(
              'w-full py-2 rounded text-xs font-bold transition-all duration-150 flex items-center justify-center gap-1',
              isCloning
                ? 'bg-theme-border/30 text-theme-muted cursor-wait'
                : isLicensed
                  ? 'bg-amber-500 hover:bg-amber-600 text-white'
                  : 'border border-theme-border hover:border-theme-accent hover:text-theme-accent text-theme-text hover:bg-theme-accent/5'
            )}
          >
            {isCloning ? '处理中...' : '保存到我的能力'}
          </button>
        )}
      </div>
    </div>
  );
}

