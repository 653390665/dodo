import { CheckCircle2, ShieldAlert, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PROMPT_GOVERNANCE_CATALOG } from '../../../shared/lib/prompt-governance-catalog';
import type { CuratedProductSkill } from '../../../shared/types';

interface GuardrailPolicyPanelProps {
  /** 增强护栏候选（非 core-default），可开关。 */
  enhancedGuardrails: CuratedProductSkill[];
  /** 当前已开启的增强护栏 id。 */
  enabledIds: string[];
  /** 开关某条增强护栏（复用能力中心的即时应用 + 撤销链路）。 */
  onToggle: (asset: CuratedProductSkill, next: boolean) => void;
  onClose: () => void;
}

/** core-default 护栏由运行时无条件注入全部三阶段，这里只读展示。 */
function getCoreDefaultGuardrails() {
  return PROMPT_GOVERNANCE_CATALOG.filter((asset) => (
    asset.placementTier === 'core-default' && asset.primaryCategory === 'quality-guardrail'
  ));
}

/**
 * 003 质量标准面板：护栏不是可勾选的商品。
 * core-default 全部"已自动生效"（只读）；增强护栏开关追加在默认检查之后。
 */
export function GuardrailPolicyPanel({ enhancedGuardrails, enabledIds, onToggle, onClose }: GuardrailPolicyPanelProps) {
  const coreGuardrails = getCoreDefaultGuardrails();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="guardrail-policy-title">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-xl border border-theme-border bg-theme-sidebar p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="guardrail-policy-title" className="text-base font-bold text-theme-text">质量标准</h2>
            <p className="mt-1 text-xs leading-5 text-theme-muted">
              默认护栏已无条件作用于分镜、正文与审查，无需配置；增强护栏会追加到默认检查之后。
            </p>
          </div>
          <button type="button" aria-label="关闭质量标准" className="rounded-lg p-1 text-theme-muted hover:bg-theme-bg" onClick={onClose}><X size={16} /></button>
        </div>

        <section className="mt-4" aria-label="默认护栏">
          <h3 className="text-xs font-bold text-theme-text">默认护栏（{coreGuardrails.length}）</h3>
          <div className="mt-2 space-y-1.5">
            {coreGuardrails.map((asset) => (
              <div key={asset.id} className="flex items-start justify-between gap-3 rounded-lg border border-theme-border/60 bg-theme-bg/50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-theme-text truncate">{asset.title}</p>
                  {asset.goal && <p className="mt-0.5 text-[10px] leading-4 text-theme-muted line-clamp-1">{asset.goal}</p>}
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  <CheckCircle2 size={10} />已自动生效
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-4" aria-label="增强护栏">
          <h3 className="text-xs font-bold text-theme-text">增强护栏</h3>
          {enhancedGuardrails.length === 0 ? (
            <p className="mt-2 text-[11px] text-theme-muted">暂无可追加的增强护栏。</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {enhancedGuardrails.map((asset) => {
                const enabled = enabledIds.includes(asset.id);
                return (
                  <div key={asset.id} className={cn('flex items-start justify-between gap-3 rounded-lg border px-3 py-2', enabled ? 'border-theme-accent/40 bg-theme-accent/5' : 'border-theme-border/60 bg-theme-bg/50')}>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-theme-text truncate">{asset.title}</p>
                      {asset.goal && <p className="mt-0.5 text-[10px] leading-4 text-theme-muted line-clamp-1">{asset.goal}</p>}
                    </div>
                    <button
                      type="button"
                      aria-pressed={enabled}
                      aria-label={`${enabled ? '关闭' : '开启'}增强护栏：${asset.title}`}
                      onClick={() => onToggle(asset, !enabled)}
                      className={cn(
                        'shrink-0 inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold border transition-colors',
                        enabled
                          ? 'bg-theme-accent/10 border-theme-accent/40 text-theme-accent'
                          : 'bg-theme-bg border-theme-border text-theme-muted hover:text-theme-text',
                      )}
                    >
                      <ShieldAlert size={11} />
                      {enabled ? '已开启' : '开启'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
