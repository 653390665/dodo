import React from 'react';
import { Archive, Check, X } from 'lucide-react';
import type { CanonPatch, OutlineArtifact } from '../../../shared/types/outline-governance';
import {
  activateOutline,
  archiveOutline,
  acceptCanonPatch,
  getDatabaseGenerationSnapshot,
  listCanonPatches,
  listOutlines,
  rejectCanonPatch,
  subscribeToOutlineGovernanceChanges,
} from '../../lib/outline-client';

interface Props {
  novelId?: string;
  currentGlobalOutline?: string;
  onCanonicalOutlineChange?: (outline: string) => void;
  onAdoptOutline?: (outline: string) => Promise<boolean>;
}

export function OutlineGovernancePanel({
  novelId,
  currentGlobalOutline = '',
  onCanonicalOutlineChange,
  onAdoptOutline,
}: Props) {
  const [artifacts, setArtifacts] = React.useState<OutlineArtifact[]>([]);
  const [patches, setPatches] = React.useState<CanonPatch[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [selectedMasterId, setSelectedMasterId] = React.useState('');
  const [showReportCandidates, setShowReportCandidates] = React.useState(false);
  const activeMasterRef = React.useRef<string | undefined>(undefined);
  const requestRef = React.useRef(0);
  const currentNovelRef = React.useRef(novelId);
  const opSeq = React.useRef(0);
  const refresh = React.useCallback(async () => {
    if (!novelId) return;
    const request = ++requestRef.current;
    const capturedNovel = novelId;
    try {
      const [nextArtifacts, nextPatches] = await Promise.all([
        listOutlines(novelId),
        listCanonPatches(novelId),
      ]);
      if (request === requestRef.current && currentNovelRef.current === capturedNovel) {
        setArtifacts(nextArtifacts);
        setPatches(nextPatches);
        setError(null);
      }
      const active = nextArtifacts.find((a) => a.level === 'master' && a.status === 'active');
      if (
        request === requestRef.current &&
        currentNovelRef.current === capturedNovel &&
        active?.id !== activeMasterRef.current
      ) {
        activeMasterRef.current = active?.id;
        if (active && active.content !== currentGlobalOutline) {
          if (onCanonicalOutlineChange) onCanonicalOutlineChange(active.content);
          else if (onAdoptOutline) await onAdoptOutline(active.content);
        }
      }
    } catch (cause) {
      if (request === requestRef.current && currentNovelRef.current === capturedNovel)
        setError(cause instanceof Error ? cause.message : '治理数据加载失败');
    }
  }, [novelId, currentGlobalOutline, onCanonicalOutlineChange, onAdoptOutline]);
  React.useEffect(() => {
    currentNovelRef.current = novelId;
    opSeq.current += 1;
    // Reset transient controls when the user changes作品; this is an intentional external-sync boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(null);
    setError(null);
    activeMasterRef.current = undefined;
    setSelectedMasterId('');
    void refresh();
    if (!novelId) return;
    const unsubscribe = subscribeToOutlineGovernanceChanges((event) => {
      if (!event || event.novelId === novelId) void refresh();
    });
    return () => {
      requestRef.current += 1;
      opSeq.current += 1;
      unsubscribe();
    };
  }, [novelId, refresh]);
  const mutate = async (key: string, action: (generation: number) => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    const capturedNovel = novelId;
    const operation = ++opSeq.current;
    try {
      const generation = await getDatabaseGenerationSnapshot();
      if (currentNovelRef.current !== capturedNovel || opSeq.current !== operation) return;
      await action(generation);
      if (currentNovelRef.current !== capturedNovel || opSeq.current !== operation) return;
      await refresh();
    } catch (cause) {
      if (currentNovelRef.current === capturedNovel && opSeq.current === operation) {
        const errorCode = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
        const errorStatus = typeof cause === 'object' && cause !== null && 'status' in cause ? cause.status : undefined;
        if (errorCode === 'CANON_PATCH_STALE' || errorStatus === 409) {
          await refresh();
          setError('Canon 基线已变化，补丁已标记为失效，请拒绝或重新生成。');
        } else {
          setError(cause instanceof Error ? cause.message : '治理操作失败');
        }
      }
    } finally {
      if (currentNovelRef.current === capturedNovel && opSeq.current === operation) setBusy(null);
    }
  };
  const isReportArtifact = React.useCallback((artifact: OutlineArtifact) => /报告|审稿|审计|评分|问题清单|report|audit|review|score/i.test(`${artifact.id} ${artifact.content}`), []);
  const visibleArtifacts = artifacts.filter((artifact) => showReportCandidates || !isReportArtifact(artifact));
  const reportCandidates = artifacts.filter(isReportArtifact);
  const masters = visibleArtifacts.filter((a) => a.level === 'master' && a.status !== 'archived');
  const scoped = visibleArtifacts.filter((a) => a.level !== 'master' && a.status !== 'archived');
  const pending = patches.filter((p) => p.status === 'pending' || p.status === 'stale');
  const activeMaster = masters.find((a) => a.status === 'active');
  React.useEffect(() => {
    if (selectedMasterId && !masters.some((a) => a.id === selectedMasterId))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedMasterId(activeMaster?.id || '');
  }, [selectedMasterId, activeMaster?.id, masters]);
  if (!novelId) return null;
  return (
    <section
      aria-labelledby="outline-governance-title"
      className="space-y-3 rounded-xl border border-theme-border bg-theme-sidebar p-4"
    >
      <h3 id="outline-governance-title" className="text-xs font-bold text-theme-text">
        大纲治理
      </h3>
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <label className="flex items-center gap-2 text-theme-muted">
          <input type="checkbox" checked={showReportCandidates} onChange={(event) => setShowReportCandidates(event.target.checked)} />
          显示报告类候选（不可作为主纲）{reportCandidates.length ? ` · ${reportCandidates.length}` : ''}
        </label>
        <button type="button" className="text-theme-accent" disabled={Boolean(busy)} onClick={() => void refresh()}>刷新治理状态</button>
      </div>
      {error && (
        <div role="alert" className="break-words text-[10px] text-red-600">
          {error}
        </div>
      )}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold text-theme-muted">主大纲（唯一 active）</p>
        {masters.map((a) => (
          <div key={a.id} className="flex min-w-0 items-start gap-2 text-[10px]">
            {isReportArtifact(a) ? (
              <div className="min-w-0 flex-1 break-words text-theme-muted">报告候选 · {a.content.slice(0, 160)}</div>
            ) : (
              <label className="flex min-w-0 flex-1 items-start gap-2">
                <input
                  type="radio"
                  name="governance-master"
                  checked={
                    selectedMasterId || a.status === 'active'
                      ? (selectedMasterId || a.id) === a.id
                      : false
                  }
                  onChange={() => setSelectedMasterId(a.id)}
                  aria-label={`主大纲 ${a.id}`}
                />
                <span className="min-w-0 break-words">{a.content.slice(0, 160)}</span>
              </label>
            )}
            {a.status === 'active' && <span className="shrink-0 text-green-600">active</span>}
            {a.status === 'candidate' && !isReportArtifact(a) && (
              <button
                type="button"
                className="shrink-0 text-theme-accent"
                disabled={Boolean(busy) || !selectedMasterId || selectedMasterId !== a.id}
                onClick={() =>
                  void mutate(a.id, (generation) => activateOutline(novelId, a.id, generation))
                }
              >
                设为主纲
              </button>
            )}
          </div>
        ))}
        {!masters.some((a) => a.status === 'active') && (
          <p className="text-[10px] text-amber-600">尚无 active 主大纲，请从候选中选择。</p>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-[10px] font-semibold text-theme-muted">卷 / 章细纲</p>
        {scoped.length === 0 && <p className="text-[10px] text-theme-muted">暂无范围细纲</p>}
        {scoped.map((a) => (
          <div key={a.id} className="flex min-w-0 items-center gap-2 text-[10px]">
            <span className="shrink-0 text-theme-muted">
              {a.level === 'volume' ? '卷' : '章'}{' '}
              {a.scope.volumeName || `${a.scope.chapterStart ?? ''}-${a.scope.chapterEnd ?? ''}`}
            </span>
            <span className="min-w-0 flex-1 break-words">
              {a.status} · {a.content.slice(0, 100)}
            </span>
            {a.status === 'candidate' && !isReportArtifact(a) && (
              <button
                type="button"
                className="shrink-0 text-theme-accent"
                disabled={Boolean(busy) || !activeMaster}
                onClick={() =>
                  void mutate(a.id, (generation) => activateOutline(novelId, a.id, generation))
                }
              >
                激活
              </button>
            )}
            {a.status !== 'archived' && (
              <button
                type="button"
                aria-label="归档细纲"
                className="shrink-0 text-theme-muted"
                disabled={Boolean(busy)}
                onClick={() =>
                  void mutate(`${a.id}:archive`, (generation) =>
                    archiveOutline(novelId, a.id, generation)
                  )
                }
              >
                <Archive size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-[10px] font-semibold text-theme-muted">待确认 Canon 补丁</p>
        {patches.some((patch) => patch.status === 'stale') && <p role="status" className="text-[10px] text-amber-600">Canon 基线已变化，失效补丁需重新生成或拒绝。</p>}
        {pending.length === 0 && <p className="text-[10px] text-theme-muted">暂无待确认补丁</p>}
        {pending.map((p) => (
          <div key={p.id} className="flex min-w-0 items-center gap-2 text-[10px]">
            <span className="min-w-0 flex-1 break-words">
              {p.id} · {p.status === 'stale' ? '已失效，基线已变化' : '待确认'}
            </span>
            {p.status === 'pending' && (
              <>
                <button
                  type="button"
                  aria-label="接受补丁"
                  className="text-green-600"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void mutate(p.id, (generation) => acceptCanonPatch(novelId, p.id, generation))
                  }
                >
                  <Check size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="拒绝补丁"
                  className="text-red-600"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void mutate(`${p.id}:reject`, (generation) =>
                      rejectCanonPatch(novelId, p.id, generation)
                    )
                  }
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </>
            )}
            {p.status === 'stale' && (
              <button
                type="button"
                aria-label="拒绝失效补丁"
                className="text-red-600"
                disabled={Boolean(busy)}
                onClick={() => void mutate(`${p.id}:reject`, (generation) => rejectCanonPatch(novelId, p.id, generation))}
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
