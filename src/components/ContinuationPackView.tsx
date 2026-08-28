import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, FileText, ListChecks, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';

import type { Novel, ContinuationPack, ContinuationGap, Character, Location, Item, Faction } from '../../shared/types';
import type { ExtractionSnapshot, OutputDiagnostic } from '../lib/continuation-client';
import { deleteContinuationPack, extractPackEntities, listContinuationPacks, syncPackToWorld, updateContinuationPack, approveContinuationImport, resumePackEntityExtraction, requeryPackEntityExtraction, resolveContinuationPackConflicts } from '../lib/continuation-client';
import { listCharacters, listLocations, listItems, listFactions } from '../lib/world-client';
import { parseContinuationPack } from '../lib/prompt-client';
import { SyncPreviewPanel } from './world-bible/SyncPreviewPanel';
import { isContinuationContradictionResolved } from '../../shared/lib/continuation-import-flow';

type ViewError = { code?: string; message: string; detailMessage?: string; batch?: number; totalBatches?: number; traceId?: string; jobId?: string; databaseGeneration?: number; attempt?: number; issues?: Array<{ path: string; code: string; message: string }>; outputDiagnostic?: OutputDiagnostic };

interface ContinuationPackViewProps {
  novel: Novel;
  initialActivePackId?: string | null;
  initialAutoSyncPackId?: string | null;
  onAutoSyncConsumed?: (packId: string) => void;
  onSyncComplete?: (packId: string) => void;
  onOpenGapAssistant?: (gap: ContinuationGap, packTitle: string, continuationPackId?: string) => void;
  onOpenGapAssistantBatch?: (gaps: ContinuationGap[], packTitle: string, continuationPackId?: string) => void;
}

function getClientErrorCode(error: unknown): string | undefined {
  return error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string'
    ? (error as Error & { code: string }).code
    : undefined;
}

function clearExtractionRecoveryParams() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('extractionJobId');
  url.searchParams.delete('extractionPackId');
  url.searchParams.delete('databaseGeneration');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function ContinuationPackView({ novel, initialActivePackId = null, initialAutoSyncPackId = null, onAutoSyncConsumed, onSyncComplete, onOpenGapAssistant, onOpenGapAssistantBatch }: ContinuationPackViewProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [activePack, setActivePack] = useState<ContinuationPack | null>(null);
  const [packs, setPacks] = useState<ContinuationPack[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseStageText, setParseStageText] = useState('');
  const [error, setError] = useState<ViewError | null>(null);
  const [editingTask, setEditingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');
  const [syncExtraction, setSyncExtraction] = useState<ExtractionSnapshot | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const [existingLoadError, setExistingLoadError] = useState<ViewError | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);
  const [existingEntities, setExistingEntities] = useState<{
    characters: Character[];
    locations: Location[];
    items: Item[];
    factions: Faction[];
  }>({ characters: [], locations: [], items: [], factions: [] });
  const [conflictDrafts, setConflictDrafts] = useState<Record<string, string>>({});
  const [acceptedConflictIds, setAcceptedConflictIds] = useState<Set<string>>(new Set());
  const [savingConflictId, setSavingConflictId] = useState<string | null>(null);

  const selectActivePack = useCallback((pack: ContinuationPack | null) => {
    setActivePack(pack);
    setAcceptedConflictIds(new Set());
    setConflictDrafts({});
  }, []);

  const extractSeqRef = useRef(0);
  const extractAbortRef = useRef<AbortController | null>(null);
  const syncSeqRef = useRef(0);
  const syncPackSnapshotRef = useRef<string | null>(null);
  const syncInFlightRef = useRef(false);
  const extractionRecoveryRef = useRef<string | null>(null);
  const autoSyncStartedRef = useRef<string | null>(null);
  const autoSyncConsumedRef = useRef<string | null>(null);

  const invalidateSync = useCallback(() => {
    syncSeqRef.current++;
    syncPackSnapshotRef.current = null;
    syncInFlightRef.current = false;
  }, []);

  const cancelPendingExtraction = useCallback(() => {
    extractSeqRef.current++;
    extractAbortRef.current?.abort();
    extractAbortRef.current = null;
    setIsExtracting(false);
    setIsLoadingExisting(false);
    setSyncExtraction(null);
    setExistingLoadError(null);
    setError(null);
  }, []);

  useEffect(() => {
    listContinuationPacks(novel.id).then(setPacks);
  }, [novel.id]);

  useEffect(() => {
    return () => {
      cancelPendingExtraction();
      invalidateSync();
    };
  }, [cancelPendingExtraction, invalidateSync]);

  useEffect(() => {
    if (!initialActivePackId) return;
    const matchedPack = packs.find((pack) => pack.id === initialActivePackId);
    if (matchedPack) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing derived state from props
      selectActivePack(matchedPack);
    }
  }, [initialActivePackId, packs, selectActivePack]);

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.substring(result.indexOf(',') + 1);
        resolve(base64);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  const handleParsePack = async () => {
    if (files.length === 0) return;
    setIsParsing(true);
    setError(null);
    setParseProgress(10);
    setParseStageText('正在提取资料并解包文本...');
    try {
      const documents = await Promise.all(files.map(async (file) => ({
        filename: file.name,
        filedata: await fileToBase64(file),
      })));
      const pack = await parseContinuationPack(
        { novelId: novel.id, title: `${novel.title} 续写资料包`, documents },
        (progress, stageText) => {
          setParseProgress(progress);
          setParseStageText(stageText);
        }
      );
      selectActivePack(pack);
      setPacks(prev => [pack, ...prev]);
      setFiles([]);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsParsing(false);
    }
  };

  const handleApprovePack = async (pack: ContinuationPack) => {
    const conflictResolutions = pack.contradictions.flatMap((contradiction) => {
      if (!acceptedConflictIds.has(contradiction.id)) return [];
      const resolution = conflictDrafts[contradiction.id]?.trim();
      return resolution ? [{ contradictionId: contradiction.id, resolution }] : [];
    });
    try {
      const { pack: approved } = await approveContinuationImport({
        packId: pack.id,
        mode: 'existing',
        existingNovelId: novel.id,
        conflictResolutions,
      });
      selectActivePack(approved);
      setPacks(prev => prev.map(p => p.id === pack.id ? approved : p));
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : '批准失败' });
    }
  };

  const handleDeletePack = async (packId: string) => {
    if (!await deleteContinuationPack(packId)) {
      setError({ message: '资料包已不存在，删除未生效。' });
      return;
    }
    setActivePack(prev => prev?.id === packId ? null : prev);
    setPacks(prev => prev.filter(p => p.id !== packId));
  };

  const handleStartEditTask = () => {
    if (!activePack) return;
    setTaskDraft(activePack.continuationTask || '');
    setEditingTask(true);
  };

  const handleSaveTask = async () => {
    if (!activePack) return;
    if (!await updateContinuationPack(activePack.id, { continuationTask: taskDraft })) {
      setError({ message: '资料包已不存在，任务修改未保存。' });
      return;
    }
    const updated = { ...activePack, continuationTask: taskDraft, updatedAt: Date.now() };
    setActivePack(updated);
    setPacks(prev => prev.map(p => p.id === activePack.id ? updated : p));
    setEditingTask(false);
  };

  const handleSaveConflict = async (contradictionId: string) => {
    if (!activePack || activePack.status !== 'approved' || savingConflictId) return;
    const contradiction = activePack.contradictions.find((item) => item.id === contradictionId);
    const resolution = (conflictDrafts[contradictionId] ?? contradiction?.acceptedResolution ?? contradiction?.suggestedResolution ?? '').trim();
    if (!contradiction || !resolution || resolution === contradiction.acceptedResolution?.trim()) return;
    setSavingConflictId(contradictionId);
    setError(null);
    try {
      const updated = await resolveContinuationPackConflicts({
        packId: activePack.id,
        novelId: novel.id,
        conflictResolutions: [{ contradictionId, resolution }],
      });
      setActivePack(updated);
      setPacks((previous) => previous.map((pack) => pack.id === updated.id ? updated : pack));
      setConflictDrafts((previous) => ({ ...previous, [contradictionId]: resolution }));
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : '保存冲突裁决失败，未改变本地状态。' });
    } finally {
      setSavingConflictId(null);
    }
  };

  const canApprove = activePack && !activePack.contradictions.some((item) => (
    item.severity === 'high'
    && !isContinuationContradictionResolved(item)
    && !(acceptedConflictIds.has(item.id) && (conflictDrafts[item.id] || '').trim())
  ));

  const loadExistingEntities = useCallback(async (seq: number): Promise<boolean> => {
    setIsLoadingExisting(true);
    setExistingLoadError(null);
    const results = await Promise.allSettled([
      listCharacters(novel.id),
      listLocations(novel.id),
      listItems(novel.id),
      listFactions(novel.id),
    ]);
    if (seq !== extractSeqRef.current) {
      setIsLoadingExisting(false);
      return false;
    }
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) {
      const reason = failed.reason;
      const nextError = getClientErrorCode(reason)
        ? { code: getClientErrorCode(reason), message: reason instanceof Error ? reason.message : '本地设定读取失败，请重试。' }
        : { code: 'LOCAL_ENTITIES_LOAD_FAILED', message: reason instanceof Error ? reason.message : '本地设定读取失败，请重试。' };
      setExistingLoadError(nextError);
    }
    setExistingEntities({
      characters: results[0].status === 'fulfilled' ? results[0].value : [],
      locations: results[1].status === 'fulfilled' ? results[1].value : [],
      items: results[2].status === 'fulfilled' ? results[2].value : [],
      factions: results[3].status === 'fulfilled' ? results[3].value : [],
    });
    setIsLoadingExisting(false);
    return !failed;
  }, [novel.id]);

  const consumeAutoSyncIntent = useCallback((packId: string) => {
    if (initialAutoSyncPackId !== packId || autoSyncConsumedRef.current === packId) return;
    autoSyncConsumedRef.current = packId;
    onAutoSyncConsumed?.(packId);
  }, [initialAutoSyncPackId, onAutoSyncConsumed]);

  const handleSyncEntities = useCallback(async (pack: ContinuationPack, resumeJob?: { jobId: string; databaseGeneration: number }, requeryJob?: { jobId: string; databaseGeneration: number }) => {
    if (syncInFlightRef.current) return;
    invalidateSync();
    cancelPendingExtraction();
    const seq = ++extractSeqRef.current;
    const controller = new AbortController();
    extractAbortRef.current = controller;
    setIsExtracting(true);
    setParseProgress(0);
    setParseStageText(requeryJob ? '正在重新查询提取进度...' : resumeJob ? '正在从失败批次继续...' : '正在从头重新提取...');
    setError(null);
    setSyncSuccess(null);
    setExistingLoadError(null);
    setSyncExtraction(null);
    try {
      const onProgress = ({ progress, stageText }: { progress: number; stageText: string }) => {
        setParseProgress(progress);
        setParseStageText(stageText);
      };
      const snapshot = requeryJob
        ? await requeryPackEntityExtraction(requeryJob.jobId, requeryJob.databaseGeneration, controller.signal, onProgress)
        : resumeJob
        ? await resumePackEntityExtraction(resumeJob.jobId, resumeJob.databaseGeneration, controller.signal, onProgress)
        : await extractPackEntities(pack.id, novel.id, controller.signal, onProgress);
      if (seq !== extractSeqRef.current || snapshot.packId !== pack.id) return;
      setSyncExtraction(snapshot);
      setParseProgress(100);
      setParseStageText('AI 提取完成，正在读取本地已有设定...');
      void loadExistingEntities(seq).then((loaded) => {
        if (loaded) consumeAutoSyncIntent(snapshot.packId);
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (seq !== extractSeqRef.current) return;
      const clientError = e as Error & { code?: string; batch?: number; totalBatches?: number; traceId?: string; jobId?: string; databaseGeneration?: number; attempt?: number; issues?: Array<{ path: string; code: string; message: string }>; outputDiagnostic?: OutputDiagnostic; detailMessage?: string };
      const nextError = getClientErrorCode(e)
        ? {
          code: clientError.code,
          batch: clientError.batch,
          totalBatches: clientError.totalBatches,
          traceId: clientError.traceId,
          jobId: clientError.jobId,
          databaseGeneration: clientError.databaseGeneration,
          attempt: clientError.attempt,
          issues: clientError.issues,
          outputDiagnostic: clientError.outputDiagnostic,
          detailMessage: clientError.detailMessage || (e instanceof Error ? e.message : undefined),
          message: clientError.code === 'EXTRACTION_INVALID_JSON'
            ? `第 ${clientError.batch || '?'} / ${clientError.totalBatches || '?'} 批模型输出不是有效 JSON，系统已停止，资料未丢失。`
            : clientError.code === 'EXTRACTION_OUTPUT_TRUNCATED'
              ? `第 ${clientError.batch || '?'} / ${clientError.totalBatches || '?'} 批模型输出被截断，系统已停止，资料未丢失。`
              : clientError.code === 'EXTRACTION_SCHEMA_MISMATCH'
                ? `第 ${clientError.batch || '?'} / ${clientError.totalBatches || '?'} 批字段格式不符合要求，系统已停止，资料未丢失。`
            : clientError.code === 'EXTRACTION_EMPTY_SEMANTIC_RESULT' ? '模型未提取到可用设定，请检查资料内容。'
            : clientError.code === 'EXTRACTION_CONFIG' ? '模型配置不可用，请检查设置后重试。'
              : clientError.code === 'GENERATION_MISMATCH' ? '数据已变更，请刷新后重试。'
              : clientError.code === 'EXTRACTION_QUOTA' ? '额度不足，请查看额度说明后重试。'
                : clientError.code === 'EXTRACTION_RATE_LIMIT' ? '模型服务暂时限流，可稍后续跑。'
                  : clientError.code === 'EXTRACTION_NETWORK' || clientError.code === 'EXTRACTION_SERVICE_UNAVAILABLE' ? '模型服务暂时不可用，可稍后续跑。'
                    : clientError.code === 'EXTRACTION_EMPTY_RESPONSE' ? '模型返回空结果，可稍后续跑。'
                      : clientError.code === 'EXTRACTION_POLLING_UNAVAILABLE' ? '暂时无法读取进度，任务仍保留，可稍后续跑。'
                        : `提取失败：${e instanceof Error ? e.message : '未知错误'}`,
        }
        : { code: 'EXTRACTION_FAILED', message: `提取失败：${e instanceof Error ? e.message : '未知错误'}` };
      setError(nextError);
    } finally {
      if (seq === extractSeqRef.current) setIsExtracting(false);
    }
  }, [novel.id, cancelPendingExtraction, invalidateSync, loadExistingEntities, consumeAutoSyncIntent]);

  useEffect(() => {
    if (!initialAutoSyncPackId || autoSyncStartedRef.current === initialAutoSyncPackId) return;
    const matchedPack = packs.find((pack) => pack.id === initialAutoSyncPackId && pack.novelId === novel.id && pack.status === 'approved');
    if (!matchedPack) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || autoSyncStartedRef.current === initialAutoSyncPackId) return;
      autoSyncStartedRef.current = initialAutoSyncPackId;
      selectActivePack(matchedPack);
      void handleSyncEntities(matchedPack);
    });
    return () => { cancelled = true; };
  }, [handleSyncEntities, initialAutoSyncPackId, novel.id, packs, selectActivePack]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('extractionJobId')?.trim() || '';
    const packId = params.get('extractionPackId')?.trim() || '';
    const rawDatabaseGeneration = params.get('databaseGeneration');
    if (!jobId || !packId || !rawDatabaseGeneration?.trim()) return;
    const databaseGeneration = Number(rawDatabaseGeneration);
    if (!Number.isFinite(databaseGeneration) || !Number.isInteger(databaseGeneration) || databaseGeneration < 0) return;
    const recoveryKey = `${jobId}:${packId}:${databaseGeneration}`;
    if (extractionRecoveryRef.current === recoveryKey) return;
    const matchedPack = packs.find((pack) => pack.id === packId && pack.novelId === novel.id);
    if (!matchedPack) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || extractionRecoveryRef.current === recoveryKey) return;
      extractionRecoveryRef.current = recoveryKey;
      selectActivePack(matchedPack);
      void handleSyncEntities(matchedPack, undefined, { jobId, databaseGeneration });
    });
    return () => { cancelled = true; };
  }, [handleSyncEntities, novel.id, packs, selectActivePack]);

  const handleRetryExistingEntities = useCallback(() => {
    if (!syncExtraction || isLoadingExisting) return;
    void loadExistingEntities(extractSeqRef.current).then((loaded) => {
      if (loaded) consumeAutoSyncIntent(syncExtraction.packId);
    });
  }, [syncExtraction, isLoadingExisting, loadExistingEntities, consumeAutoSyncIntent]);

  const handleSyncConfirm = async (selections: {
    characters: ExtractionSnapshot['extraction']['characters'];
    locations: ExtractionSnapshot['extraction']['locations'];
    items: ExtractionSnapshot['extraction']['items'];
    factions: ExtractionSnapshot['extraction']['factions'];
    powerLevels: ExtractionSnapshot['extraction']['powerLevels'];
    timelineEvents: ExtractionSnapshot['extraction']['timelineEvents'];
    relationships: ExtractionSnapshot['extraction']['relationships'];
    globalOutline?: string;
    worldRules?: string;
  }, options?: { keepOpen?: boolean }): Promise<boolean> => {
    if (!syncExtraction || syncInFlightRef.current) return false;
    const syncSnapshot = { ...syncExtraction };
    const seq = ++syncSeqRef.current;
    syncPackSnapshotRef.current = syncSnapshot.packId;
    syncInFlightRef.current = true;
    setIsSyncing(true);
    setError(null);
    setSyncSuccess(null);
    try {
      const result = await syncPackToWorld({
        packId: syncSnapshot.packId,
        novelId: syncSnapshot.novelId,
        databaseGeneration: syncSnapshot.databaseGeneration,
        ...selections,
      });
      if (seq !== syncSeqRef.current || syncPackSnapshotRef.current !== syncSnapshot.packId) return false;
      const skippedRels = result.skipped.relationships;
      if (result.syncState) {
        setActivePack((current) => current && current.id === syncSnapshot.packId
          ? { ...current, syncState: result.syncState, updatedAt: Date.now() }
          : current);
        setPacks((packs) => packs.map((item) => item.id === syncSnapshot.packId
          ? { ...item, syncState: result.syncState, updatedAt: Date.now() }
          : item));
      }
      if (skippedRels > 0) {
        setError({ message: `同步完成，但有 ${skippedRels} 条关系因引用不存在的实体被跳过` });
      }
      const createdEntries = Object.entries(result.created).filter(([, count]) => count > 0);
      const labels: Record<string, string> = {
        characters: '人物', locations: '地点', items: '道具', factions: '势力',
        powerLevels: '境界', timelineEvents: '时间线', relationships: '关系',
      };
      setSyncSuccess(createdEntries.length > 0
        ? `本次同步新增：${createdEntries.map(([key, count]) => `${labels[key] || key} ${count}`).join('、')}`
        : '本次同步未新增实体');
      if (!options?.keepOpen) setSyncExtraction(null);
      if (!options?.keepOpen) clearExtractionRecoveryParams();
      else await loadExistingEntities(extractSeqRef.current);
      onSyncComplete?.(syncSnapshot.packId);
      return true;
    } catch (e) {
      if (seq !== syncSeqRef.current || syncPackSnapshotRef.current !== syncSnapshot.packId) return false;
      setError({ code: getClientErrorCode(e) || 'SYNC_FAILED', message: '同步失败：' + (e instanceof Error ? e.message : '未知错误') });
      return false;
    } finally {
      if (seq === syncSeqRef.current && syncPackSnapshotRef.current === syncSnapshot.packId) {
        syncInFlightRef.current = false;
        syncPackSnapshotRef.current = null;
        setIsSyncing(false);
      }
    }
  };

  const errorAlert = error ? (
    <div role="alert" className="min-w-0 text-xs text-red-500 font-medium bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 rounded-xl animate-fade-in flex flex-col items-stretch gap-2">
      <span>⚠️</span>
      <span className="min-w-0 whitespace-normal break-words">{error.message}</span>
      {(error.code || error.batch || error.traceId || error.detailMessage || error.outputDiagnostic) && (
        <details className="min-w-0 text-[10px] text-red-700">
          <summary className="cursor-pointer">错误详情</summary>
          <div className="block max-w-[22rem] whitespace-normal break-words space-y-1">
            <div>类别：{error.code || '未知'}{error.batch ? `；第 ${error.batch}/${error.totalBatches || '?'} 批` : ''}{error.attempt ? `；第 ${error.attempt} 次尝试` : ''}{error.traceId ? `；traceId：${error.traceId}` : ''}</div>
            {error.detailMessage && <div>安全详情：{error.detailMessage}</div>}
            {error.issues?.slice(0, 3).map((issue, index) => <div key={`${issue.path}-${index}`}>字段 {issue.path || '(根)'}：{issue.code}；{issue.message}</div>)}
            {error.outputDiagnostic && <div>输出：{error.outputDiagnostic.provider || '未知 Provider'}；格式 {error.outputDiagnostic.responseFormatMode || '未知'}；兼容模式 {error.outputDiagnostic.compatibilityMode || 'none'}；结束原因 {error.outputDiagnostic.finishReason || '未提供'}；解析阶段 {error.outputDiagnostic.parserStage || '未提供'}；上游请求 {error.outputDiagnostic.providerRequestCount ?? '未提供'} 次{error.outputDiagnostic.providerHttpStatus ? `；HTTP ${error.outputDiagnostic.providerHttpStatus}` : ''}{error.outputDiagnostic.rejectedParameter ? `；拒绝参数 ${error.outputDiagnostic.rejectedParameter}` : ''}{error.outputDiagnostic.providerErrorCode ? `；Provider code ${error.outputDiagnostic.providerErrorCode}` : ''}</div>}
          </div>
        </details>
      )}
      {activePack?.status === 'approved' && !isExtracting && error.code && (
        <div className="flex flex-wrap gap-2 min-w-0">
          {error.code === 'EXTRACTION_POLLING_UNAVAILABLE' && error.jobId && (
            <button type="button" onClick={() => handleSyncEntities(activePack, undefined, { jobId: error.jobId!, databaseGeneration: error.databaseGeneration || 0 })} className="rounded-lg border border-red-500/30 px-2.5 py-1 font-bold">
              <RefreshCw size={12} className="inline mr-1" />重新查询进度
            </button>
          )}
          {['EXTRACTION_SCHEMA_MISMATCH', 'EXTRACTION_INVALID_JSON', 'EXTRACTION_OUTPUT_TRUNCATED', 'EXTRACTION_NETWORK', 'EXTRACTION_SERVICE_UNAVAILABLE', 'EXTRACTION_RATE_LIMIT', 'EXTRACTION_TIMEOUT', 'EXTRACTION_EMPTY_RESPONSE'].includes(error.code) && error.jobId && error.batch && (
            <button type="button" onClick={() => handleSyncEntities(activePack, { jobId: error.jobId!, databaseGeneration: error.databaseGeneration || 0 })} className="rounded-lg border border-red-500/30 px-2.5 py-1 font-bold">
              <RefreshCw size={12} className="inline mr-1" />{error.code === 'EXTRACTION_SCHEMA_MISMATCH' ? '修复并重试本批' : '从失败批次续跑'}
            </button>
          )}
          {['EXTRACTION_SCHEMA_MISMATCH', 'EXTRACTION_INVALID_JSON', 'EXTRACTION_OUTPUT_TRUNCATED', 'EXTRACTION_NETWORK', 'EXTRACTION_SERVICE_UNAVAILABLE', 'EXTRACTION_RATE_LIMIT', 'EXTRACTION_TIMEOUT', 'EXTRACTION_EMPTY_RESPONSE'].includes(error.code) && <button type="button" onClick={() => handleSyncEntities(activePack)} className="rounded-lg border border-red-500/30 px-2.5 py-1 font-bold">
            <RefreshCw size={12} className="inline mr-1" />从头重新提取
          </button>}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="h-full overflow-y-auto p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-serif font-bold text-theme-text">资料包管理</h1>
        <p className="text-sm text-theme-muted mt-1">
          上传世界观、大纲、人物设定、已有正文等资料，整理、审核并切换用于续写的资料包。
        </p>
      </div>

      {/* Upload */}
      <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-6 space-y-4">
        <div className="flex items-center gap-2"><Upload size={18} /><span className="font-bold text-theme-text">上传资料文件</span></div>
        <p className="text-xs text-theme-muted">支持 .txt / .md / .json / .docx，可一次选多个文件。</p>
        <input
          type="file"
          multiple
          accept=".txt,.md,.json,.docx"
          onChange={e => setFiles(Array.from(e.target.files || []))}
          className="block w-full text-sm text-theme-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-bold file:bg-theme-sidebar file:text-theme-text hover:file:bg-theme-border/50"
        />
        {files.length > 0 && (
          <div className="text-xs text-theme-muted space-y-1">
            {files.map((f) => <div key={`${f.name}-${f.lastModified}`} className="flex items-center gap-2"><FileText size={12} />{f.name}</div>)}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={handleParsePack}
            disabled={files.length === 0 || isParsing}
            className="px-5 py-2.5 rounded-xl bg-theme-text text-theme-sidebar text-sm font-semibold disabled:opacity-50 flex items-center gap-2 transition-all hover:opacity-90 active:scale-95"
          >
            {isParsing ? <Loader2 size={14} className="animate-spin" /> : null}
            {isParsing ? '解析中...' : '解析资料包'}
          </button>
          {isParsing && (
            <div className="flex-1 space-y-1.5 bg-theme-sidebar/40 border border-theme-border/60 p-3.5 rounded-xl backdrop-blur-md">
              <div className="flex items-center justify-between text-[11px] leading-none">
                <span className="text-theme-muted font-medium animate-pulse">{parseStageText || '正在解析...'}</span>
                <span className="font-mono text-theme-text font-bold">{parseProgress}%</span>
              </div>
              <div className="h-1.5 w-full bg-theme-border/30 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-theme-text rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${parseProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
        {(!error?.code || Boolean(syncExtraction)) && errorAlert}
      </div>

      {/* Active pack review */}
      {activePack && !syncExtraction && (
        <div aria-label={`当前资料包：${activePack.title}`} className="rounded-2xl border border-theme-border bg-theme-sidebar p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-theme-text">{activePack.title}</div>
              <div className="text-xs text-theme-muted">
                状态：{activePack.status === 'approved' ? <span className="text-emerald-600">资料包已确认</span> : <span className="text-amber-600">待审核</span>}
                {activePack.status === 'approved' && <div className="mt-2 text-xs text-theme-muted">
                  同步：{({ not_started: '未同步', partial: '部分同步', synced: '已同步', stale: '内容已变化，需重新同步' } as const)[activePack.syncState?.status || 'not_started']}
                  {(activePack.syncState?.pendingRelationshipCount || 0) > 0 && ` · 待处理关系 ${activePack.syncState?.pendingRelationshipCount} 条`}
                  {activePack.syncState?.summary && <div className="mt-1">摘要：人物 {activePack.syncState.summary.characters} · 地点 {activePack.syncState.summary.locations} · 物品 {activePack.syncState.summary.items} · 势力 {activePack.syncState.summary.factions} · 战力 {activePack.syncState.summary.powerLevels} · 时间线 {activePack.syncState.summary.timelineEvents} · 关系 {activePack.syncState.summary.relationships}</div>}
                </div>}
                {activePack.status === 'approved' && <div className="mt-1 text-[11px] text-theme-muted">资料包确认不代表已写入设定集；提取后还需在同步预览确认。</div>}
              </div>
            </div>
            {activePack.status === 'draft' && (
              <button
                onClick={() => handleApprovePack(activePack)}
                disabled={!canApprove}
                className="px-4 py-2 rounded-xl bg-theme-accent text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2"
              >
                <CheckCircle2 size={14} /> 确认资料包
              </button>
            )}
            {activePack.status === 'approved' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSyncEntities(activePack)}
                  disabled={isExtracting}
                  className="px-4 py-2 rounded-xl bg-theme-accent text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2"
                >
                  {isExtracting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {isExtracting ? '正在提取...' : '提取并预览'}
                </button>
                {isExtracting && (
                  <button type="button" onClick={cancelPendingExtraction} className="px-3 py-2 rounded-xl border border-theme-border text-theme-muted text-xs font-bold">
                    取消
                  </button>
                )}
              </div>
            )}
          </div>

          {isExtracting && (
            <div className="space-y-1.5 rounded-xl border border-theme-border bg-theme-sidebar/40 p-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-theme-muted">{parseStageText || '正在提取设定...'}</span>
                <span className="font-mono font-bold text-theme-text">{Math.round(parseProgress)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-theme-border/30">
                <div className="h-full rounded-full bg-theme-accent transition-all" style={{ width: `${parseProgress}%` }} />
              </div>
            </div>
          )}
          {error?.code && errorAlert}

          {activePack.contradictions.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              <div className="font-bold flex items-center gap-1"><AlertTriangle size={12} />发现资料冲突</div>
              {activePack.contradictions.map((c) => {
                const resolutionDraft = activePack.status === 'approved'
                  ? conflictDrafts[c.id] ?? c.acceptedResolution ?? c.suggestedResolution ?? ''
                  : conflictDrafts[c.id] ?? c.suggestedResolution ?? '';
                const isSuggestedDraft = !c.acceptedResolution && !conflictDrafts[c.id] && Boolean(c.suggestedResolution?.trim());
                return (
                <div key={`${c.severity}-${c.id}`} className="mt-3 rounded-lg border border-amber-200/80 bg-theme-sidebar/70 p-3 text-theme-text">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold">[{c.severity}] {c.summary}</div>
                    {isContinuationContradictionResolved(c) ? <span className="text-emerald-700">已处理</span> : null}
                  </div>
                  <div className="mt-2 text-[11px] text-theme-muted">证据：{c.conflictingEvidence.join('；') || '未提供'}</div>
                  {activePack.status === 'approved' || activePack.status === 'draft' ? (
                    <>
                      <div className="mt-2 text-[11px] text-theme-muted">Agent 初始建议：{c.suggestedResolution || '暂无建议'}</div>
                      <textarea
                        value={resolutionDraft}
                        onChange={(event) => {
                          setConflictDrafts((previous) => ({ ...previous, [c.id]: event.target.value }));
                          setAcceptedConflictIds((previous) => {
                            if (!previous.has(c.id)) return previous;
                            const next = new Set(previous);
                            next.delete(c.id);
                            return next;
                          });
                        }}
                        rows={2}
                        className="mt-2 w-full rounded-lg border border-theme-border bg-theme-sidebar px-2.5 py-2 text-xs text-theme-text outline-none focus:border-theme-accent"
                        aria-label={`冲突裁决：${c.summary}`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!resolutionDraft.trim()) return;
                          if (activePack.status === 'approved') {
                            void handleSaveConflict(c.id);
                          } else {
                            setAcceptedConflictIds((previous) => new Set(previous).add(c.id));
                          }
                        }}
                        disabled={activePack.status === 'approved'
                          ? savingConflictId !== null || !resolutionDraft.trim() || resolutionDraft.trim() === (c.acceptedResolution || '').trim()
                          : !resolutionDraft.trim() || acceptedConflictIds.has(c.id)}
                        className="mt-2 rounded-lg border border-theme-border bg-theme-sidebar px-3 py-1.5 text-[11px] font-bold text-theme-text disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingConflictId === c.id ? '保存中...' : acceptedConflictIds.has(c.id) ? '已确认此方案' : isSuggestedDraft ? '采用 Agent 建议' : activePack.status === 'draft' ? '采用此方案' : '保存裁决'}
                      </button>
                    </>
                  ) : null}
                </div>
                );
              })}
              <div className="mt-2 text-amber-600">{activePack.status === 'approved' ? '可按 Agent 建议确认或编辑裁决。' : '请填写并采用高风险冲突裁决后再确认资料包。'}</div>
            </div>
          )}

          {activePack.canonFacts.length === 0 && activePack.status === 'draft' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              未识别到硬设定事实，但仍可确认资料包。建议先检查上传资料是否包含世界观或设定信息。
            </div>
          )}

          {activePack.sourceMap && (
            <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 p-4 space-y-2">
              <div className="text-xs font-bold text-theme-text">资料结构地图</div>
              {activePack.sourceMap.sections.slice(0, 6).map((s) => (
                <div key={s.title} className="text-xs text-theme-muted">
                  <span className="font-bold text-theme-text">{s.title}</span>：{s.summary}
                </div>
              ))}
              {activePack.sourceMap.keyConflicts.length > 0 && (
                <div className="mt-2 pt-2 border-t border-theme-border">
                  <div className="text-[10px] font-bold text-amber-600 mb-1">资料间冲突</div>
                  {activePack.sourceMap.keyConflicts.map((c) => (
                    <div key={c} className="text-[10px] text-amber-700">- {c}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activePack.readingQuestions && activePack.readingQuestions.length > 0 && (
            <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 p-4 space-y-2">
              <div className="text-xs font-bold text-theme-text">资料审读问题</div>
              {activePack.readingQuestions.slice(0, 6).map((q, i) => (
                <div key={q.id || i} className="text-xs">
                  <span className="text-theme-accent font-bold">Q{i + 1}.</span>
                  <span className="text-theme-text ml-1">{q.question}</span>
                  <div className="text-[10px] text-theme-muted mt-0.5 ml-4">上下文：{q.context}</div>
                  <div className="text-[10px] text-theme-muted mt-0.5 ml-4">创作决策，不阻塞续写。</div>
                </div>
              ))}
            </div>
          )}

          {activePack.continuationGaps && activePack.continuationGaps.length > 0 && (
            <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-theme-text">续写缺口</div>
                {onOpenGapAssistantBatch && (
                  <button
                    type="button"
                    aria-label="批量交给智能管家处理续写缺口"
                    onClick={() => onOpenGapAssistantBatch(activePack.continuationGaps || [], activePack.title, activePack.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-theme-accent/40 px-2.5 py-1.5 text-[10px] font-bold text-theme-accent hover:bg-theme-accent/10"
                  >
                    <ListChecks size={12} />
                    批量交给智能管家处理
                  </button>
                )}
              </div>
              {activePack.continuationGaps.slice(0, 5).map((g, i) => (
                <div key={g.id || i} className="rounded-lg border border-theme-border bg-theme-sidebar p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      g.severity === 'high' ? 'bg-red-100 text-red-700' :
                      g.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{g.severity}</span>
                    <span className="text-theme-text font-bold">{g.description}</span>
                  </div>
                  <div className="text-[10px] text-theme-muted mt-1.5">建议方向：{g.suggestedDirection}</div>
                  {onOpenGapAssistant && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-theme-border/60 pt-2">
                      <span className="text-[10px] text-theme-muted">生成补充草稿，确认后再写入设定。</span>
                      <button
                        type="button"
                        aria-label={`交给智能管家处理：${g.description}`}
                        onClick={() => onOpenGapAssistant(g, activePack.title, activePack.id)}
                        className="rounded-lg border border-theme-accent/40 px-2.5 py-1.5 text-[10px] font-bold text-theme-accent hover:bg-theme-accent/10"
                      >
                        交给智能管家处理
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Continuation Task - always visible and editable */}
          <div className="rounded-xl border border-theme-border bg-theme-sidebar p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-theme-text">续写主任务</div>
              {!editingTask && (
                <button
                  onClick={handleStartEditTask}
                  className="text-[10px] text-theme-accent hover:underline"
                >
                  编辑
                </button>
              )}
            </div>
            <p className="text-[10px] text-theme-muted">
              这批资料导入后，你希望系统续写的主任务方向。将用于分镜预填和生成预览摘要。
            </p>
            {editingTask ? (
              <div className="space-y-2">
                <textarea
                  value={taskDraft}
                  onChange={(e) => setTaskDraft(e.target.value)}
                  placeholder="例如：从第三卷高潮处续写，主角团进入秘境后遭遇反派伏击..."
                  className="w-full h-20 bg-theme-sidebar border border-theme-border rounded-xl p-3 text-xs text-theme-text placeholder:text-theme-muted/50 resize-none shadow-sm focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
                />
                <div className="flex gap-2">
                  <button onClick={handleSaveTask} className="px-3 py-1.5 rounded-lg bg-theme-accent text-white text-[10px] font-bold">
                    保存
                  </button>
                  <button onClick={() => setEditingTask(false)} className="px-3 py-1.5 rounded-lg bg-theme-sidebar text-theme-text text-[10px] font-bold border border-theme-border">
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-theme-text">
                {activePack?.continuationTask || <span className="text-theme-muted italic">未指定 — 点击编辑添加续写方向</span>}
              </div>
            )}
          </div>

          <details className="text-xs text-theme-muted">
            <summary className="cursor-pointer font-bold">展开结构化上下文</summary>
            <div className="mt-2 space-y-3 ml-4">
              <div><span className="font-bold">硬设定：</span>{activePack.canonFacts.map(f => f.text).join('；') || '无'}</div>
              <div><span className="font-bold">人物状态：</span>{activePack.characterStates.map(c => `${c.name}(${c.currentGoal})`).join('；') || '无'}</div>
              <div><span className="font-bold">剧情位置：</span>{activePack.plotState.currentTimeline} | {activePack.plotState.latestScene}</div>
            </div>
          </details>
        </div>
      )}

      {/* Sync preview panel */}
      {syncExtraction && (
        <div className="space-y-3">
          {isLoadingExisting && (
            <div className="rounded-xl border border-theme-border bg-theme-sidebar p-3 text-xs text-theme-muted flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> 正在读取本地已有设定...
            </div>
          )}
          {existingLoadError && (
            <div role="alert" className="min-w-0 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-500 flex flex-col items-stretch gap-2">
              <span className="min-w-0 whitespace-normal break-words">[{existingLoadError.code}] {existingLoadError.message}</span>
              <span className="flex flex-wrap gap-2">
                <button type="button" onClick={handleRetryExistingEntities} disabled={isLoadingExisting} className="rounded-lg border border-red-500/30 px-2.5 py-1 font-bold disabled:opacity-50">
                  <RefreshCw size={12} className="inline mr-1" />只重试列表
                </button>
                <button type="button" onClick={() => setSyncExtraction(null)} disabled={isLoadingExisting} className="rounded-lg border border-theme-border px-2.5 py-1 font-bold disabled:opacity-50">
                  暂不同步设定
                </button>
              </span>
            </div>
          )}
          <SyncPreviewPanel
            extraction={syncExtraction.extraction}
            packId={syncExtraction.packId}
            novelId={syncExtraction.novelId}
            databaseGeneration={syncExtraction.databaseGeneration}
            existingCharacters={existingEntities.characters}
            existingLocations={existingEntities.locations}
            existingItems={existingEntities.items}
            existingFactions={existingEntities.factions}
            onConfirm={handleSyncConfirm}
            onCancel={() => {
              if (isSyncing || syncInFlightRef.current) return;
              clearExtractionRecoveryParams();
              setSyncExtraction(null);
            }}
            isSyncing={isSyncing || isLoadingExisting}
          />
        </div>
      )}

      {syncSuccess && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 size={14} className="mr-1 inline" />{syncSuccess}
        </div>
      )}

      {/* Pack history */}
      {packs.length > 0 && (
        <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-6 space-y-3">
          <div className="font-bold text-theme-text text-sm">已上传资料包</div>
          {packs.map(pack => (
            <div
              key={pack.id}
              className={`rounded-xl border px-4 py-3 text-xs ${
                activePack?.id === pack.id ? 'border-theme-accent bg-theme-accent/5' : 'border-theme-border hover:bg-theme-sidebar/20'
              }`}
            >
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => {
                  if (isSyncing || syncInFlightRef.current) return;
                  clearExtractionRecoveryParams();
                  invalidateSync();
                  cancelPendingExtraction();
                  setSyncSuccess(null);
                  selectActivePack(pack);
                }}
                className="block w-full min-w-0 text-left"
              >
                <span className="block truncate font-bold">{pack.title}</span>
                <span className="block text-theme-muted mt-1">
                  {pack.canonFacts.length} 条设定 · {pack.characterStates.length} 个人物 · {new Date(pack.createdAt).toLocaleDateString('zh-CN')}
                </span>
              </button>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-theme-border/60 pt-2">
                <span className={pack.status === 'approved' ? 'text-emerald-600' : 'text-amber-600'}>
                  {pack.status === 'approved' ? '资料包已确认' : '待审核'}
                </span>
                {pack.status === 'approved' && (
                  <span className="text-xs text-theme-muted">
                    同步：{({ not_started: '未同步', partial: '部分同步', synced: '已同步', stale: '内容已变化' } as const)[pack.syncState?.status || 'not_started']}
                    {(pack.syncState?.pendingRelationshipCount || 0) > 0 && ` · 待处理关系 ${pack.syncState?.pendingRelationshipCount} 条`}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  {pack.status === 'approved' && (
                    <button
                      type="button"
                      disabled={isExtracting || isSyncing}
                      onClick={() => {
                        if (isExtracting || isSyncing || syncInFlightRef.current) return;
                        clearExtractionRecoveryParams();
                        selectActivePack(pack);
                        void handleSyncEntities(pack);
                      }}
                      className="rounded-lg border border-theme-accent/40 px-2.5 py-1 font-bold text-theme-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isExtracting && activePack?.id === pack.id ? '正在提取...' : '提取并预览'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={() => handleDeletePack(pack.id)}
                    className="p-1 rounded hover:bg-red-50 text-theme-muted hover:text-red-500 transition-colors disabled:opacity-50"
                    title="删除资料包"
                    aria-label="删除资料包"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {packs.length === 0 && <div className="text-xs text-theme-muted">暂无资料包，先上传文件并解析，再回来审核或确认。</div>}
        </div>
      )}
    </div>
  );
}
