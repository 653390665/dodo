import React from 'react';
import { Sparkles } from 'lucide-react';
import type { WritingStyleCandidate, WritingStyleMode, WritingStyleResolution } from '../lib/writing-style-client';

interface WritingStyleControlProps {
  resolution?: WritingStyleResolution | null;
  candidates?: WritingStyleCandidate[];
  onConfirm?: (mode: WritingStyleMode) => Promise<string | void> | string | void;
  onGenerate?: (fingerprint?: string) => Promise<void> | void;
  onOpenWritingStyle?: () => void;
  onManageSkills?: () => void;
  disabled?: boolean;
  confirmed?: boolean;
}

function getSourceScopeLabel(kind: WritingStyleResolution['sources'][number]['kind']) {
  switch (kind) {
    case 'skill-deck':
    case 'writer-skill':
    case 'project-tone':
      return '作品默认';
    case 'writer-session':
      return '本章使用';
    case 'continuation-pack':
      return '资料包';
    case 'technique':
      return '阶段技法';
    case 'default':
    default:
      return '系统默认';
  }
}

export function WritingStyleControl({ resolution, candidates = [], onConfirm, onGenerate, onOpenWritingStyle, onManageSkills, disabled = false, confirmed = false }: WritingStyleControlProps) {
  const [selection, setSelection] = React.useState<{ fingerprint?: string; mode: WritingStyleMode }>({
    fingerprint: resolution?.fingerprint,
    mode: resolution?.mode || candidates[0]?.mode || 'default',
  });
  const [confirming, setConfirming] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const mode = candidates.some((candidate) => candidate.mode === selection.mode)
    ? selection.mode
    : resolution?.mode && candidates.some((candidate) => candidate.mode === resolution.mode)
      ? resolution.mode
      : candidates[0]?.mode || 'default';
  const selectionIsStale = Boolean(resolution?.fingerprint && (selection.mode !== resolution.mode || selection.fingerprint !== resolution.fingerprint));
  React.useEffect(() => {
    if (!confirmOpen) return;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirming) {
        setConfirmOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmOpen, confirming]);
  const confirmAndGenerate = async () => {
    if (confirming || disabled) return;
    setConfirming(true);
    setError(null);
    try {
      const fingerprint = (!confirmed || selectionIsStale) ? await onConfirm?.(mode) : resolution?.fingerprint;
      setConfirmOpen(false);
      await onGenerate?.(typeof fingerprint === 'string' ? fingerprint : undefined);
      triggerRef.current?.focus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '写法确认失败，请重试。');
    } finally {
      setConfirming(false);
    }
  };
  const sourceLabels = resolution?.sources.map((source) => source.label).filter((label): label is string => Boolean(label)) || [];
  const summary = resolution?.summary || sourceLabels.join(' · ') || '未解析';
  const sourceDetails = sourceLabels.join(' · ');
  const effectiveSources = (resolution?.sources || []).filter((source) => Boolean(source.label));
  return (
    <section aria-label="本次写法" className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-theme-border bg-theme-sidebar px-2.5 py-2 text-xs text-theme-muted">
      <span className="font-semibold text-theme-text">本次写法</span>
      {onOpenWritingStyle ? <button type="button" onClick={onOpenWritingStyle} className="text-[11px] text-theme-accent underline underline-offset-2">查看本章写法</button> : null}
      {onManageSkills ? <button type="button" onClick={onManageSkills} className="text-[11px] text-theme-accent underline underline-offset-2">管理能力卡</button> : null}
      <span className="min-w-0 flex-1 whitespace-normal break-words" title={sourceDetails || summary}>{summary}</span>
      {effectiveSources.length > 0 ? (
        <div aria-label="本次写法来源列表" className="basis-full">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {effectiveSources.slice(0, 5).map((source, index) => (
              <span key={`${source.kind}-${source.id || source.label || index}`} className="inline-flex max-w-full items-center gap-1 rounded border border-theme-border bg-theme-bg px-1.5 py-0.5 text-[11px] text-theme-text">
                <span className="shrink-0 text-theme-muted">{getSourceScopeLabel(source.kind)}</span>
                <span className="min-w-0 truncate">{source.label}</span>
              </span>
            ))}
            {effectiveSources.length > 5 ? <span className="rounded border border-theme-border bg-theme-bg px-1.5 py-0.5 text-[11px] text-theme-muted">+{effectiveSources.length - 5}</span> : null}
          </div>
        </div>
      ) : null}
      {candidates.length > 0 ? <div role="group" aria-label="写法模式" className="flex flex-wrap gap-1">
        {candidates.map((candidate) => <button key={candidate.mode} type="button" aria-pressed={mode === candidate.mode} disabled={disabled || confirming} onClick={() => setSelection({ fingerprint: candidate.fingerprint, mode: candidate.mode })} className="rounded border border-theme-border px-2 py-1 text-[11px] text-theme-text hover:bg-theme-border/30">{candidate.summary || candidate.mode}</button>)}
      </div> : null}
      <button ref={triggerRef} type="button" disabled={disabled || confirming} onClick={() => (confirmed && !selectionIsStale) ? void confirmAndGenerate() : setConfirmOpen(true)} className="inline-flex items-center gap-1 rounded border border-theme-accent bg-theme-accent px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"><Sparkles size={12} aria-hidden="true" />{confirmed && !selectionIsStale ? `按「${resolution?.summary || '当前写法'}」扩写正文` : '确认并生成'}</button>
      {error ? <div role="alert" className="basis-full text-rose-700">{error}</div> : null}
      {confirmOpen ? <div role="dialog" aria-modal="true" aria-labelledby="writing-style-confirm-title" tabIndex={-1} ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
        <div className="w-full max-w-md rounded-lg border border-theme-border bg-theme-bg p-4 shadow-xl">
          <h2 id="writing-style-confirm-title" className="mb-2 text-sm font-semibold text-theme-text">确认本次写法</h2>
          <p className="mb-3 whitespace-normal break-words text-xs text-theme-muted">{summary}</p>
          <div className="flex justify-end gap-2">
            <button type="button" disabled={confirming} onClick={() => { setConfirmOpen(false); triggerRef.current?.focus(); }} className="rounded border border-theme-border px-3 py-1.5 text-xs">取消</button>
            <button type="button" disabled={confirming} onClick={() => void confirmAndGenerate()} className="rounded bg-theme-accent px-3 py-1.5 text-xs font-semibold text-white">{confirming ? '确认中…' : '确认并生成'}</button>
          </div>
        </div>
      </div> : null}
    </section>
  );
}

export type { WritingStyleCandidate, WritingStyleMode, WritingStyleResolution };
