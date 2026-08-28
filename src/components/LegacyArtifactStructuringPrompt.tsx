import { useMemo, useState } from 'react';
import { Braces, Check, EyeOff, Search, X } from 'lucide-react';
import type { LegacyArtifactPreview, LegacyArtifactSource } from '../../shared/types/legacy-artifact-structuring';
import {
  confirmLegacyArtifact,
  discoverLegacyArtifacts,
  previewLegacyArtifact,
} from '../lib/legacy-artifact-client';

function dismissalKey(novelId: string): string {
  return `inkflow-legacy-structuring-dismissals:${novelId}`;
}

function readDismissals(novelId: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(dismissalKey(novelId)) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function sourceKey(source: LegacyArtifactSource): string {
  return `${source.artifactKind}:${source.artifactId}:${source.sourceFingerprint}`;
}

export function LegacyArtifactStructuringPrompt({ novelId }: { novelId: string }) {
  const [sources, setSources] = useState<LegacyArtifactSource[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissals(novelId));
  const [selectedKey, setSelectedKey] = useState('');
  const [databaseGeneration, setDatabaseGeneration] = useState<number | null>(null);
  const [preview, setPreview] = useState<LegacyArtifactPreview | null>(null);
  const [busy, setBusy] = useState<'discover' | 'preview' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);

  const visibleSources = useMemo(
    () => sources.filter((source) => !dismissed.includes(source.sourceFingerprint)),
    [dismissed, sources],
  );
  const selectedSource = visibleSources.find((source) => sourceKey(source) === selectedKey) || visibleSources[0];

  const discover = async () => {
    setBusy('discover'); setError(null); setMessage(null); setPreview(null);
    try {
      const result = await discoverLegacyArtifacts(novelId);
      const storedDismissals = readDismissals(novelId);
      const visible = result.sources.filter((source) => !storedDismissals.includes(source.sourceFingerprint));
      setDismissed(storedDismissals);
      setSources(result.sources);
      setDatabaseGeneration(result.databaseGeneration);
      setSelectedKey(visible[0] ? sourceKey(visible[0]) : '');
      setHasScanned(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '检查旧产物失败');
    } finally {
      setBusy(null);
    }
  };

  const generatePreview = async () => {
    if (!selectedSource || databaseGeneration === null) return;
    setBusy('preview'); setError(null); setMessage(null); setPreview(null);
    try {
      const result = await previewLegacyArtifact({
        novelId,
        artifactKind: selectedSource.artifactKind,
        artifactId: selectedSource.artifactId,
        databaseGeneration,
      });
      setPreview(result.preview);
      setDatabaseGeneration(result.databaseGeneration);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '预览失败');
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (!preview || databaseGeneration === null) return;
    setBusy('confirm'); setError(null); setMessage(null);
    try {
      await confirmLegacyArtifact({ novelId, previewId: preview.previewId, databaseGeneration });
      setSources((current) => current.filter((source) => sourceKey(source) !== sourceKey(preview.source)));
      setPreview(null);
      setSelectedKey('');
      setMessage('结构化版本已确认');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '确认失败');
    } finally {
      setBusy(null);
    }
  };

  const dismiss = () => {
    if (!selectedSource) return;
    const next = [...new Set([...dismissed, selectedSource.sourceFingerprint])];
    localStorage.setItem(dismissalKey(novelId), JSON.stringify(next));
    setDismissed(next);
    setPreview(null);
    const nextSource = visibleSources.find((source) => sourceKey(source) !== sourceKey(selectedSource));
    setSelectedKey(nextSource ? sourceKey(nextSource) : '');
  };

  return (
    <section className="mx-auto mb-8 max-w-6xl border-y border-theme-border/60 py-4" aria-labelledby="legacy-artifact-maintenance-title">
      <details>
        <summary id="legacy-artifact-maintenance-title" className="cursor-pointer text-sm font-bold text-theme-text">
          高级维护
        </summary>
        <div className="mt-4 space-y-4">
          <button type="button" onClick={() => void discover()} disabled={busy !== null} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-theme-border px-3 py-2 text-xs font-bold text-theme-text hover:border-theme-accent disabled:cursor-wait disabled:opacity-60">
            <Search size={14} aria-hidden="true" />
            {busy === 'discover' ? '检查中' : '检查旧产物'}
          </button>

          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          {message && <p role="status" className="text-xs font-bold text-emerald-600">{message}</p>}
          {hasScanned && visibleSources.length === 0 && <p className="text-xs text-theme-muted">未发现需要整理的旧产物</p>}

          {selectedSource && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                <label className="grid gap-1 text-xs font-bold text-theme-text">
                  旧产物
                  <select aria-label="旧产物" value={sourceKey(selectedSource)} onChange={(event) => { setSelectedKey(event.target.value); setPreview(null); setError(null); }} className="min-h-9 rounded-md border border-theme-border bg-theme-bg px-3 text-sm text-theme-text">
                    {visibleSources.map((source) => <option key={sourceKey(source)} value={sourceKey(source)}>{source.label}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => void generatePreview()} disabled={busy !== null} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-theme-text px-3 py-2 text-xs font-bold text-theme-bg disabled:cursor-wait disabled:opacity-60">
                  <Braces size={14} aria-hidden="true" />
                  {busy === 'preview' ? '生成中' : '生成结构化预览'}
                </button>
                <button type="button" onClick={dismiss} disabled={busy !== null} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-theme-border px-3 py-2 text-xs font-bold text-theme-muted hover:text-theme-text disabled:opacity-60">
                  <EyeOff size={14} aria-hidden="true" />暂不处理
                </button>
              </div>

              {preview && (
                <div className="space-y-3">
                  <div className="grid gap-0 border border-theme-border md:grid-cols-2">
                    <div className="min-w-0 border-b border-theme-border p-3 md:border-b-0 md:border-r">
                      <h3 className="text-xs font-bold text-theme-text">原文</h3>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-theme-muted">{preview.source.originalContent}</pre>
                    </div>
                    <div className="min-w-0 p-3">
                      <h3 className="text-xs font-bold text-theme-text">结构化结果</h3>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-theme-muted">{JSON.stringify(preview.proposedCore, null, 2)}</pre>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void confirm()} disabled={busy !== null} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-theme-accent px-3 py-2 text-xs font-bold text-white disabled:cursor-wait disabled:opacity-60">
                      <Check size={14} aria-hidden="true" />{busy === 'confirm' ? '确认中' : '确认结构化版本'}
                    </button>
                    <button type="button" onClick={() => { setPreview(null); setError(null); }} disabled={busy !== null} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-theme-border px-3 py-2 text-xs font-bold text-theme-text disabled:opacity-60">
                      <X size={14} aria-hidden="true" />取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
