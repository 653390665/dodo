import React from 'react';
import {
  FileText,
  Loader2,
  Sparkles,
  Package,
  CheckCircle2,
  Check,
  AlertCircle,
  Save,
} from 'lucide-react';
import type {
  Chapter,
  ChapterMetadata,
  ContinuationPack,
  ContinuationSourceKind,
} from '../../../shared/types';
import { cn } from '../../lib/utils';
import {
  createOutline,
  activateOutline,
  getDatabaseGenerationSnapshot,
  listOutlines,
} from '../../lib/outline-client';
import { OutlineGovernancePanel } from './OutlineGovernancePanel';
import { CURATED_PRODUCT_SKILLS } from '../../../shared/lib/public-skill-catalog';

const SOURCE_KIND_LABELS: Record<ContinuationSourceKind, string> = {
  world: '世界设定',
  outline: '大纲资料',
  characters: '人物资料',
  manuscript: '正文资料',
  style_sample: '风格样本',
  other: '其他资料',
};

function isOutlineReportDocument(document: {
  filename: string;
  text: string;
  excerpt?: string;
}): boolean {
  const signal =
    `${document.filename} ${document.excerpt || ''} ${document.text.slice(0, 240)}`.toLowerCase();
  return /(审稿|审查|审计|评审|批评|评分|报告|问题清单|review|critique|audit|score|issue\s*list)/i.test(
    signal
  );
}

const OUTLINE_REFERENCE_KINDS = new Set<ContinuationSourceKind>(['outline', 'world', 'characters']);

interface OutlineTabProps {
  novelId?: string;
  expectedWordCount: number | '';
  setExpectedWordCount: (count: number | '') => void;
  projectTechniqueId?: string;
  onGenerateOutline: (outline?: string, options?: {
    techniqueId?: string;
    outlineSourceSelection?: {
      continuationPackId: string;
      primaryDocumentId: string;
      referenceDocumentIds: string[];
    };
  }) => Promise<{ candidateId: string; content: string; databaseGeneration: number } | void>;
  onAdoptOutline?: (outline: string) => Promise<boolean>;
  onCanonicalOutlineChange?: (outline: string) => void;
  outlineError?: string | null;
  isGeneratingOutline: boolean;
  globalOutline: string;
  onGlobalOutlineChange: (outline: string) => void;
  chapters: ChapterMetadata[];
  currentChapter: Chapter | null;
  onSelectChapter: (chapter: ChapterMetadata) => void | Promise<void>;
  selectedContinuationPack: ContinuationPack | null;
}

export function OutlineTab({
  novelId,
  projectTechniqueId,
  expectedWordCount,
  setExpectedWordCount,
  onGenerateOutline,
  onAdoptOutline,
  onCanonicalOutlineChange,
  outlineError,
  isGeneratingOutline,
  globalOutline,
  onGlobalOutlineChange,
  chapters,
  currentChapter,
  onSelectChapter,
  selectedContinuationPack,
}: OutlineTabProps) {
  const hasOutline = globalOutline.trim().length > 0;
  const hasApprovedPack = selectedContinuationPack?.status === 'approved';
  const outlineDocuments = React.useMemo(
    () =>
      selectedContinuationPack?.sourceDocuments.filter(
        (doc) => doc.kind === 'outline' && !isOutlineReportDocument(doc)
      ) || [],
    [selectedContinuationPack]
  );
  const referenceDocuments = React.useMemo(
    () => selectedContinuationPack?.sourceDocuments.filter(
      (doc) => OUTLINE_REFERENCE_KINDS.has(doc.kind) &&
        !isOutlineReportDocument(doc) &&
        !outlineDocuments.some((outline) => outline.id === doc.id)
    ) || [],
    [selectedContinuationPack, outlineDocuments]
  );
  const projectTechniqueTitle = React.useMemo(
    () => projectTechniqueId
      ? CURATED_PRODUCT_SKILLS.find((skill) => skill.id === projectTechniqueId)?.title || '当前大纲技法'
      : '',
    [projectTechniqueId]
  );
  const [selectedOutlineId, setSelectedOutlineId] = React.useState('');
  const [selectedReferenceIds, setSelectedReferenceIds] = React.useState<string[]>([]);
  const [pendingCandidate, setPendingCandidate] = React.useState<{
    candidateId: string;
    content: string;
    databaseGeneration: number;
  } | null>(null);
  const [adoptError, setAdoptError] = React.useState<string | null>(null);
  const [adoptNotice, setAdoptNotice] = React.useState<string | null>(null);
  const [draftOutline, setDraftOutline] = React.useState(globalOutline);
  const [draftDirty, setDraftDirty] = React.useState(false);
  const currentNovelRef = React.useRef(novelId);
  const operationSeq = React.useRef(0);
  React.useEffect(() => {
    currentNovelRef.current = novelId;
    operationSeq.current += 1;
    // Reset draft controls at the novel boundary; these states intentionally mirror external selection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedOutlineId('');
    setSelectedReferenceIds([]);
    setPendingCandidate(null);
    setAdoptError(null);
    setAdoptNotice(null);
    setDraftOutline(globalOutline);
    setDraftDirty(false);
  }, [novelId, globalOutline]);
  React.useEffect(() => {
    if (!draftDirty) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftOutline(globalOutline);
    }
  }, [globalOutline, draftDirty]);

  const activeSelectedOutlineId = outlineDocuments.some(
    (document) => document.id === selectedOutlineId
  )
    ? selectedOutlineId
    : outlineDocuments.length === 1
      ? outlineDocuments[0].id
      : '';
  const selectedOutline =
    outlineDocuments.find((document) => document.id === activeSelectedOutlineId) || null;

  const sourceDocumentCounts = React.useMemo(() => {
    if (!selectedContinuationPack) return null;
    const counts: Partial<Record<ContinuationSourceKind, number>> = {};
    for (const doc of selectedContinuationPack.sourceDocuments) {
      counts[doc.kind] = (counts[doc.kind] || 0) + 1;
    }
    return counts;
  }, [selectedContinuationPack]);

  const hasManuscriptDocs = React.useMemo(() => {
    if (!sourceDocumentCounts) return false;
    return (sourceDocumentCounts.manuscript || 0) > 0;
  }, [sourceDocumentCounts]);

  const isButtonDisabled =
    !expectedWordCount || isGeneratingOutline || (outlineDocuments.length > 1 && !selectedOutline);
  const reconcileActivation = async (
    capturedNovel: string,
    operation: number,
    generation: number,
    candidateId: string,
    desiredContent: string
  ) => {
    if (currentNovelRef.current !== capturedNovel || operationSeq.current !== operation) return;
    try {
      const artifacts = await listOutlines(capturedNovel, {}, generation);
      if (novelId && (currentNovelRef.current !== capturedNovel || operationSeq.current !== operation)) return;
      const active = artifacts.find((a) => a.level === 'master' && a.status === 'active');
      if (active?.id === candidateId) {
        onCanonicalOutlineChange?.(desiredContent);
        setDraftOutline(desiredContent);
        setDraftDirty(false);
        setAdoptNotice('主纲已保存，但确认响应中断，已从当前数据库核实');
      } else if (active) setAdoptError('设为主纲失败，当前主纲未变，可重试');
      else setAdoptError('保存状态未知，请刷新大纲治理后确认，勿重复提交');
    } catch {
      if (currentNovelRef.current === capturedNovel && operationSeq.current === operation)
        setAdoptError('保存状态未知，请刷新大纲治理后确认，勿重复提交');
    }
  };

  const handleSaveDraft = async () => {
    if (!novelId || !draftDirty) return;
    const capturedNovel = novelId || '';
    const operation = ++operationSeq.current;
    setAdoptError(null);
    setAdoptNotice(null);
    try {
      const generation = await getDatabaseGenerationSnapshot();
      if (currentNovelRef.current !== capturedNovel || operationSeq.current !== operation) return;
      const candidate = await createOutline(novelId, {
        level: 'master',
        scope: {},
        content: draftOutline,
        source: 'user',
        databaseGeneration: generation,
      });
      if (currentNovelRef.current !== capturedNovel || operationSeq.current !== operation) return;
      try {
        await activateOutline(novelId, candidate.id, generation);
      } catch {
        await reconcileActivation(capturedNovel, operation, generation, candidate.id, draftOutline);
        return;
      }
      if (currentNovelRef.current !== capturedNovel || operationSeq.current !== operation) return;
      onCanonicalOutlineChange?.(draftOutline);
      setDraftDirty(false);
    } catch (error) {
      if (novelId && (currentNovelRef.current !== capturedNovel || operationSeq.current !== operation)) return;
      setAdoptError(
        `大纲保存失败：${error instanceof Error ? error.message : '未知错误'}。原大纲未被修改，可重试。`
      );
    }
  };

  const handleAdoptOutline = async () => {
    if (!selectedOutline) return;
    if (hasOutline && !window.confirm('已有大纲，确认采用此候选会覆盖当前大纲。确定继续吗？'))
      return;
    setAdoptError(null);
    setAdoptNotice(null);
    const capturedNovel = novelId || '';
    const operation = ++operationSeq.current;
    try {
      if (novelId) {
        const generation = await getDatabaseGenerationSnapshot();
        if (currentNovelRef.current !== capturedNovel || operationSeq.current !== operation) return;
        const candidate = await createOutline(novelId, {
          level: 'master',
          scope: {},
          content: selectedOutline.text,
          source: 'continuation-pack',
          databaseGeneration: generation,
        });
        if (currentNovelRef.current !== capturedNovel || operationSeq.current !== operation) return;
        try {
          await activateOutline(novelId, candidate.id, generation);
        } catch {
          await reconcileActivation(
            capturedNovel,
            operation,
            generation,
            candidate.id,
            selectedOutline.text
          );
          return;
        }
        if (currentNovelRef.current !== capturedNovel || operationSeq.current !== operation) return;
        onCanonicalOutlineChange?.(selectedOutline.text);
      }
      if (!novelId && onAdoptOutline) {
        const result = await onAdoptOutline(selectedOutline.text);
        if (result === false) throw new Error('保存未生效');
      } else if (!novelId) onGlobalOutlineChange(selectedOutline.text);
      setDraftOutline(selectedOutline.text);
      setDraftDirty(false);
    } catch (error) {
      if (novelId && (currentNovelRef.current !== capturedNovel || operationSeq.current !== operation)) return;
      setAdoptError(
        `大纲保存失败：${error instanceof Error ? error.message : '未知错误'}。原大纲未被修改，可重试。`
      );
    }
  };

  const handleGenerateCandidate = async () => {
    const primary = draftDirty ? draftOutline : (selectedOutline?.text ?? draftOutline);
    const sourceSelection = selectedContinuationPack && activeSelectedOutlineId
      ? {
          continuationPackId: selectedContinuationPack.id,
          primaryDocumentId: activeSelectedOutlineId,
          referenceDocumentIds: selectedReferenceIds,
        }
      : undefined;
    // When an imported pack is selected, the server resolves its documents by ID.
    // Only an explicit local draft remains a seed; never concatenate imported text in the client.
    const seedOutline = sourceSelection && !draftDirty ? undefined : primary;
    const options = projectTechniqueId || sourceSelection
      ? {
          ...(projectTechniqueId ? { techniqueId: projectTechniqueId } : {}),
          ...(sourceSelection ? { outlineSourceSelection: sourceSelection } : {}),
        }
      : undefined;
    const candidate = options
      ? await onGenerateOutline(seedOutline, options)
      : await onGenerateOutline(seedOutline);
    if (!candidate) return;
    setPendingCandidate(candidate);
    setDraftOutline(candidate.content);
    setDraftDirty(false);
  };

  const handleConfirmCandidate = async () => {
    if (!pendingCandidate) return;
    try {
      if (novelId) {
        await activateOutline(novelId, pendingCandidate.candidateId, pendingCandidate.databaseGeneration);
        onCanonicalOutlineChange?.(pendingCandidate.content);
      } else if (onAdoptOutline) {
        const saved = await onAdoptOutline(pendingCandidate.content);
        if (saved === false) return;
      } else {
        onGlobalOutlineChange(pendingCandidate.content);
      }
      setPendingCandidate(null);
      setAdoptNotice('候选大纲已确认并保存');
    } catch {
      setAdoptError('候选大纲保存失败，原大纲未被修改，可重试。');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-xs font-bold text-theme-text flex items-center gap-2">
            <FileText size={14} className="text-theme-accent" aria-hidden="true" />
            全局大纲
          </h3>
        </div>

        {projectTechniqueId && (
          <div className="mb-3 rounded-lg border border-theme-accent/30 bg-theme-accent/5 px-3 py-2 text-[10px] text-theme-text" role="status">
            <div className="font-bold text-theme-accent">本次大纲技法</div>
            <div className="mt-1 text-theme-muted">
              已选择能力「{projectTechniqueTitle}」。将基于当前主纲或选中的导入大纲生成候选，不直接覆盖。
            </div>
          </div>
        )}

        {outlineDocuments.length > 0 && (
          <div className="mb-3 space-y-2">
            <div className="flex items-center gap-2 text-[10px] font-bold text-theme-text">
              <FileText size={12} className="text-theme-accent" aria-hidden="true" />
              选择本次整理输入
              {outlineDocuments.length > 1 && (
                <span className="text-theme-muted">请选择本次输入</span>
              )}
            </div>
            {outlineDocuments.map((document) => {
              const isSelected = document.id === activeSelectedOutlineId;
              return (
                <div
                  key={document.id}
                  className={cn(
                    'rounded-lg border p-3',
                    isSelected
                      ? 'border-theme-accent bg-theme-accent/5'
                      : 'border-theme-border/60 bg-theme-sidebar'
                  )}
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    {outlineDocuments.length > 1 && (
                      <input
                        type="radio"
                        name="primary-outline"
                        value={document.id}
                        checked={isSelected}
                        onChange={() => setSelectedOutlineId(document.id)}
                        className="mt-0.5 accent-theme-accent"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold text-theme-text">
                        {isSelected && (
                          <Check size={11} className="text-theme-accent" aria-hidden="true" />
                        )}
                        {document.filename}
                        {isSelected && outlineDocuments.length > 1 && (
                          <span className="text-theme-accent">本次输入</span>
                        )}
                      </span>
                      <span className="mt-1 block text-[9px] leading-relaxed text-theme-muted">
                        摘要：{document.excerpt || '暂无摘要'}
                      </span>
                      <span className="mt-1 block line-clamp-3 whitespace-pre-wrap text-[9px] leading-relaxed text-theme-muted/80">
                        预览：{document.text.slice(0, 240) || '暂无内容'}
                      </span>
                    </span>
                  </label>
                  {isSelected && (
                    <button
                      type="button"
                      onClick={() => void handleAdoptOutline()}
                      disabled={isGeneratingOutline}
                      className="mt-2 inline-flex items-center gap-1 rounded-md border border-theme-accent/40 px-2 py-1 text-[9px] font-bold text-theme-accent hover:bg-theme-accent/10 disabled:opacity-50"
                    >
                      <CheckCircle2 size={11} aria-hidden="true" />
                      确认采用此大纲
                    </button>
                  )}
                </div>
              );
            })}
            {referenceDocuments.length > 0 && (
              <div className="rounded-lg border border-theme-border/50 p-3">
                <div className="text-[10px] font-bold text-theme-text">参考资料（最多选择 5 份）</div>
                <div className="mt-2 space-y-1.5">
                  {referenceDocuments.map((document, index) => {
                    const checked = selectedReferenceIds.includes(document.id);
                    return (
                      <label key={document.id} className="flex items-center gap-2 text-[9px] text-theme-muted">
                        <input
                          type="checkbox"
                          aria-label={`参考资料：${document.filename}`}
                          checked={checked}
                          disabled={!checked && (selectedReferenceIds.length >= 5 || index >= 5)}
                          onChange={() => setSelectedReferenceIds((current) => {
                            if (!checked && (current.length >= 5 || index >= 5)) return current;
                            return checked ? current.filter((id) => id !== document.id) : [...current, document.id];
                          })}
                        />
                        <span>{document.filename}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {hasApprovedPack &&
          !hasOutline &&
          outlineDocuments.length === 0 &&
          sourceDocumentCounts && (
            <div className="mb-3 p-3 bg-theme-accent/5 border border-theme-accent/20 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Package size={12} className="text-theme-accent" aria-hidden="true" />
                <span className="text-[10px] font-bold text-theme-accent">
                  资料已读取，尚未生成作品大纲
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(sourceDocumentCounts).map(([kind, count]) => (
                  <span
                    key={kind}
                    className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 bg-theme-sidebar border border-theme-border rounded-full"
                  >
                    <CheckCircle2 size={8} className="text-green-500" aria-hidden="true" />
                    {SOURCE_KIND_LABELS[kind as ContinuationSourceKind]}: {count} 份
                  </span>
                ))}
              </div>
              {hasManuscriptDocs && (
                <p className="text-[9px] text-theme-muted mt-2">
                  导入正文仅作为续写参考，尚未拆分成章节。点击下方按钮可基于资料生成大纲。
                </p>
              )}
            </div>
          )}

        <div className="flex flex-col gap-2 mb-3 sm:flex-row">
          <div className="flex-1 relative">
            <input
              type="number"
              placeholder="预计总字数 (如: 1000000)"
              value={expectedWordCount}
              onChange={(e) =>
                setExpectedWordCount(
                  e.currentTarget.value === '' ? '' : Number(e.currentTarget.value)
                )
              }
              disabled={isGeneratingOutline}
              className="w-full text-[10px] p-2 bg-theme-sidebar border border-theme-border rounded-lg pl-2 pr-6 transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20 disabled:opacity-50"
            />
            <span className="absolute right-2 top-[7px] text-[10px] text-theme-muted">字</span>
          </div>
          <button
            onClick={() => void handleGenerateCandidate()}
            disabled={isButtonDisabled}
            title={
              !expectedWordCount
                ? '请先填写预计总字数'
                : outlineDocuments.length > 1 && !selectedOutline
                  ? '请先选择主大纲'
                  : undefined
            }
            className="px-3 py-1.5 bg-theme-accent text-white text-[10px] font-bold rounded-lg hover:bg-theme-accent/90 disabled:opacity-50 transition-[background-color,opacity,box-shadow] duration-200 flex items-center gap-1.5"
          >
            {isGeneratingOutline ? (
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles size={12} aria-hidden="true" />
            )}{' '}
            {projectTechniqueId
              ? `用「${projectTechniqueTitle}」生成候选细纲`
              : outlineDocuments.length > 0
                ? 'AI 整理所选大纲'
                : 'AI 生成作品大纲'}
          </button>
        </div>

        {outlineDocuments.length > 0 && selectedOutline && (
          <p className="mb-3 flex items-center gap-1 text-[9px] text-theme-muted" role="status">
            <AlertCircle size={10} aria-hidden="true" /> AI 整理将使用「{selectedOutline.filename}
            」作为本次大纲输入。
          </p>
        )}

        {adoptNotice && <div role="status" className="mb-3 text-[10px] text-amber-600">{adoptNotice}</div>}
        {pendingCandidate && (
          <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[10px] text-amber-700">
            <span>生成结果已作为候选，请确认后才会写入主纲。</span>
            <button type="button" className="font-bold underline" onClick={() => void handleConfirmCandidate()}>确认采用候选</button>
          </div>
        )}
        {(outlineError || adoptError) && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-[10px] leading-relaxed text-red-600"
          >
            {outlineError || adoptError}
          </div>
        )}

        <textarea
          data-prompt-surface="workspace-draft"
          value={novelId ? draftOutline : globalOutline}
          onChange={(e) =>
            novelId
              ? (setDraftOutline(e.target.value), setDraftDirty(true))
              : onGlobalOutlineChange(e.target.value)
          }
          disabled={isGeneratingOutline}
          placeholder={
            '在此规划整本小说的核心冲突与路线图；也可以输入初始创意，点击"AI 生成作品大纲"由 AI 为您生成卷轴级大纲...'
          }
          className="w-full h-40 bg-theme-sidebar border border-theme-border rounded-xl p-3 text-xs text-theme-text placeholder:text-theme-muted/40 resize-none shadow-sm font-serif leading-relaxed transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20 disabled:opacity-50"
        />
        {novelId && (
          <button
            type="button"
            onClick={() => void handleSaveDraft()}
            disabled={!draftDirty || isGeneratingOutline}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-theme-accent/40 px-2 py-1 text-[10px] font-bold text-theme-accent disabled:opacity-50"
          >
            <Save size={12} aria-hidden="true" />
            保存并设为主纲
          </button>
        )}
      </div>

      <OutlineGovernancePanel
        novelId={novelId}
        currentGlobalOutline={globalOutline}
        onCanonicalOutlineChange={onCanonicalOutlineChange}
        onAdoptOutline={onAdoptOutline}
      />

      <div className="space-y-3">
        <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider px-1">
          章节快速导航
        </h3>
        <div className="space-y-1.5 pb-8">
          {chapters.map((chapter, index) => (
            <button
              key={chapter.id}
              onClick={() => void onSelectChapter(chapter)}
              className={cn(
                'w-full text-left p-3 rounded-xl border transition-[background-color,border-color,box-shadow,color] duration-200 flex flex-col gap-1',
                currentChapter?.id === chapter.id
                  ? 'bg-theme-accent/5 border-theme-accent shadow-sm'
                  : 'bg-theme-sidebar border-theme-border/40 hover:border-theme-accent/20'
              )}
            >
              <div className="flex justify-between items-center">
                <span
                  className={cn(
                    'text-xs font-bold',
                    currentChapter?.id === chapter.id ? 'text-theme-accent' : 'text-theme-text'
                  )}
                >
                  第 {index + 1} 章: {chapter.title}
                </span>
                <span className="text-[9px] text-theme-muted">{chapter.wordCount} 字</span>
              </div>
              {currentChapter?.id === chapter.id && currentChapter.sceneBeats ? (
                <p className="text-[9px] text-theme-muted line-clamp-1 opacity-70">
                  {currentChapter.sceneBeats.substring(0, 50)}
                </p>
              ) : (chapter as Partial<Chapter>).sceneBeats ? (
                <p className="text-[9px] text-theme-muted line-clamp-1 opacity-70">
                  {(chapter as Partial<Chapter>).sceneBeats?.substring(0, 50)}
                </p>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
