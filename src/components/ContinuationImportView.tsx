import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, CheckCircle2, FileText, Loader2, PlusCircle, Upload } from 'lucide-react';

import type { ContinuationImportTargetMode, ContinuationPack, Novel } from '../../shared/types';
import { cn } from '../lib/utils';
import { listNovels } from '../lib/novel-client';
import { createContinuationImportSession, parseContinuationPack } from '../lib/prompt-client';
import { approveContinuationImport } from '../lib/continuation-client';
import {
  buildImportedNovelDraft,
  canApproveContinuationImportPack,
  isContinuationContradictionResolved,
  resolveContinuationImportTargetMode,
} from '../lib/continuation-import-flow';
import { buildCreationIntentDraft } from '../lib/continuation-pack';
import { expandContinuationZip } from '../lib/continuation-zip-client';
import { isSupportedContinuationDocument, sanitizeArchivePath } from '../../shared/lib/archive-limits';

// 校验文档是否是合法的、高熵的文本输入（排除系统临时文件如 .DS_Store 及 __MACOSX 目录）
const isValidDocument = isSupportedContinuationDocument;

// 消毒文件路径，防御 Zip Slip (路径遍历/穿透) 漏洞
const sanitizePath = sanitizeArchivePath;


interface ContinuationImportViewProps {
  onBack: () => void;
  onEnterEditor: (novel: Novel, approvedPackId: string, prefillIntent?: string) => void;
  initialNovelId?: string;
}

type Stage = 'upload' | 'confirm';

type ParsedPackState = {
  pack: ContinuationPack;
  targetModeAtParse: ContinuationImportTargetMode;
  selectedNovelIdAtParse: string;
};

const FLOW_STEPS = [
  { title: '上传资料', description: '世界观、大纲、任务单或正文片段一起丢进来。' },
  { title: '智能解析', description: '生成剧情位置、角色状态和关键硬设定候选摘要。' },
  { title: '人工确认', description: '你只看任务摘要与风险，不用手动管资料结构。' },
  { title: '进入续写', description: '确认后带着资料包进入编辑器继续写。' },
];

export function ContinuationImportView({ onBack, onEnterEditor, initialNovelId }: ContinuationImportViewProps) {
  const [stage, setStage] = useState<Stage>('upload');
  const [novels, setNovels] = useState<Novel[]>([]);
  const [targetMode, setTargetMode] = useState<ContinuationImportTargetMode>('new');
  const [selectedNovelId, setSelectedNovelId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [parsedState, setParsedState] = useState<ParsedPackState | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseStageText, setParseStageText] = useState('正在读取资料包并展开文档树...');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [conflictResolutionDrafts, setConflictResolutionDrafts] = useState<Record<string, string>>({});

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 处理拖拽逻辑
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer && e.dataTransfer.files) {
      processSelectedFiles(e.dataTransfer.files);
    }
  };

  // 核心解析选定文件、文件夹和压缩文件包的主逻辑
  const processSelectedFiles = async (selectedList: FileList | File[]) => {
    setError('');
    const newFiles: File[] = [];
    const filesToProcess = Array.from(selectedList);

    for (const file of filesToProcess) {
      const filename = file.name;
      // ZIP 在独立 Worker 内受资源预算约束地解压，避免阻塞渲染器或遭受 ZIP bomb。
      if (filename.toLowerCase().endsWith('.zip')) {
        try {
          newFiles.push(...await expandContinuationZip(file));
        } catch (err) {
          setError(`解包文件 ${filename} 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        // 如果是普通文件，或者 webkitdirectory 选中的多级文件夹文件
        const finalName = file.webkitRelativePath || file.name;
        if (isValidDocument(finalName)) {
          const cleanedRelativePath = sanitizePath(finalName);
          if (!cleanedRelativePath) continue;
          if (file.webkitRelativePath) {
            try {
              const contentBuffer = await file.arrayBuffer();
              const virtualFile = new File([contentBuffer], cleanedRelativePath, {
                type: file.type || 'application/octet-stream',
              });
              newFiles.push(virtualFile);
            } catch {
              newFiles.push(file);
            }
          } else {
            newFiles.push(file);
          }
        }
      }
    }

    if (newFiles.length > 0) {
      setFiles((prev) => {
        const merged = [...prev];
        for (const nf of newFiles) {
          // 根据文件名及大小进行双重去重，防止二次添加
          const exists = merged.some((f) => f.name === nf.name && f.size === nf.size);
          if (!exists) {
            merged.push(nf);
          }
        }
        return merged;
      });
    }
  };


  useEffect(() => {
    let isMounted = true;

    async function loadNovels() {
      try {
        const loadedNovels = await listNovels();
        if (!isMounted) return;
        setNovels(loadedNovels);
        const defaultMode = resolveContinuationImportTargetMode(loadedNovels);
        setTargetMode(defaultMode);
        const inheritedNovelId = initialNovelId && loadedNovels.some((novel) => novel.id === initialNovelId)
          ? initialNovelId
          : loadedNovels.length === 1
            ? loadedNovels[0].id
            : '';
        setSelectedNovelId(inheritedNovelId);
      } catch (e) {
        if (!isMounted) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (isMounted) {
          setIsBootstrapping(false);
        }
      }
    }

    loadNovels();
    return () => {
      isMounted = false;
    };
  }, [initialNovelId]);

  const selectedNovel = useMemo(
    () => novels.find((novel) => novel.id === selectedNovelId) || null,
    [novels, selectedNovelId],
  );

  const parsedPack = parsedState?.pack || null;
  const canConfirm = canApproveContinuationImportPack(parsedPack);
  const hasCanonFacts = Boolean(parsedPack?.canonFacts.length);
  const unresolvedHighConflictCount = parsedPack?.contradictions.filter((contradiction) => (
    contradiction.severity === 'high'
    && !isContinuationContradictionResolved(contradiction)
  )).length || 0;
  const suggestedDraft = parsedPack ? buildImportedNovelDraft(parsedPack.title) : null;
  const uploadActionDisabled = files.length === 0 || isParsing || (targetMode === 'existing' && !selectedNovelId);

  const resetParsedSession = () => {
    setParsedState(null);
    setIsParsing(false);
    setParseProgress(0);
    setParseStageText('正在读取资料包并展开文档树...');
    setConflictResolutionDrafts({});
  };

  const updateConflictResolutionDraft = (contradictionId: string, resolution: string) => {
    setConflictResolutionDrafts((previous) => ({ ...previous, [contradictionId]: resolution }));
    setParsedState((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        pack: {
          ...previous.pack,
          contradictions: previous.pack.contradictions.map((contradiction) => {
            if (contradiction.id !== contradictionId) return contradiction;
            const unresolvedContradiction = { ...contradiction };
            delete unresolvedContradiction.acceptedResolution;
            delete unresolvedContradiction.resolvedAt;
            return unresolvedContradiction;
          }),
        },
      };
    });
  };

  const acceptConflictResolution = (contradictionId: string) => {
    const resolution = conflictResolutionDrafts[contradictionId]?.trim();
    if (!resolution) return;
    setParsedState((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        pack: {
          ...previous.pack,
          contradictions: previous.pack.contradictions.map((contradiction) => (
            contradiction.id === contradictionId
              ? { ...contradiction, acceptedResolution: resolution, resolvedAt: Date.now() }
              : contradiction
          )),
        },
      };
    });
  };

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

  const handleParse = async () => {
    if (uploadActionDisabled) return;

    setIsParsing(true);
    setParseProgress(0);
    setParseStageText('正在读取资料包并展开文档树...');
    setError('');
    
    // Reset previous parse results safely without interrupting the active parsing state
    setParsedState(null);

    try {
      const parseNovelId = targetMode === 'existing'
        ? selectedNovelId
        : await createContinuationImportSession();
      const documents = await Promise.all(
        files.map(async (file) => ({
          filename: file.name,
          filedata: await fileToBase64(file),
        })),
      );
      const pack = await parseContinuationPack(
        {
          novelId: parseNovelId,
          title:
            targetMode === 'existing' && selectedNovel
              ? `${selectedNovel.title} 资料包`
              : `导入续写资料包 ${new Date().toLocaleDateString('zh-CN')}`,
          documents,
        },
        (progress, stageText) => {
          setParseProgress(progress);
          setParseStageText(stageText);
        }
      );

      setParseProgress(100);
      setParseStageText('解析完成！正在生成体验大盘...');
      await new Promise((resolve) => setTimeout(resolve, 600));

      setParsedState({
        pack,
        targetModeAtParse: targetMode,
        selectedNovelIdAtParse: selectedNovelId,
      });
      setConflictResolutionDrafts(Object.fromEntries(
        pack.contradictions.map((contradiction) => [
          contradiction.id,
          contradiction.acceptedResolution || contradiction.suggestedResolution || '',
        ]),
      ));
      setStage('confirm');
      setIsParsing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIsParsing(false);
    }
  };

  const handleConfirm = async () => {
    if (!parsedState || !parsedPack || !canConfirm) return;

    setIsSubmitting(true);
    setError('');

    try {
      if (
        parsedState.targetModeAtParse === 'existing'
        && !novels.some((novel) => novel.id === parsedState.selectedNovelIdAtParse)
      ) {
          throw new Error('未找到要导入的目标作品，请返回上一步重新选择。');
      }

      const draft = buildImportedNovelDraft(parsedPack.title);
      const approved = await approveContinuationImport({
        packId: parsedPack.id,
        mode: parsedState.targetModeAtParse,
        existingNovelId: parsedState.selectedNovelIdAtParse || undefined,
        newNovel: parsedState.targetModeAtParse === 'new'
          ? { title: draft.title, summary: draft.summary }
          : undefined,
        conflictResolutions: parsedPack.contradictions.flatMap((contradiction) => {
          const resolution = contradiction.acceptedResolution?.trim();
          return resolution ? [{ contradictionId: contradiction.id, resolution }] : [];
        }),
      });

      onEnterEditor(
        approved.novel,
        approved.pack.id,
        buildCreationIntentDraft(approved.pack) || undefined,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderUploadStage = () => (
    <div className="max-w-4xl mx-auto px-8 py-10 space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold tracking-[0.24em] text-theme-accent">资料续写</div>
          <h1 className="mt-2 text-3xl font-serif font-bold text-theme-text">导入资料续写</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-theme-muted">
            这不是资料管理页。你把世界观、大纲、任务说明或已有正文上传进来，系统先整理成续写任务包，确认后再进入写作。
          </p>
        </div>
        <button
          onClick={onBack}
          className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-theme-border bg-theme-sidebar px-4 py-2 text-sm font-bold text-theme-text hover:border-theme-accent/40"
        >
          <ArrowLeft size={16} />
          返回首页
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {FLOW_STEPS.map((step, index) => (
          <div key={step.title} className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
            <div className="text-[11px] font-bold tracking-[0.2em] text-theme-accent/70">第 {index + 1} 步</div>
            <div className="mt-2 text-sm font-bold text-theme-text">{step.title}</div>
            <p className="mt-1 text-xs leading-5 text-theme-muted">{step.description}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-theme-border bg-theme-sidebar p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-theme-accent/10 p-3 text-theme-accent">
            <Upload size={18} />
          </div>
          <div>
            <div className="text-base font-bold text-theme-text">上传本次续写所需资料</div>
            <div className="text-xs text-theme-muted mt-1">支持多文件 `.txt .md .json .docx`，会按一次任务整体解析。</div>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
          <div className="space-y-4 rounded-2xl border border-theme-border bg-theme-sidebar/40 p-5">
            {/* Drag and Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "rounded-2xl border-2 border-dashed p-6 transition-all duration-200 flex flex-col items-center justify-center min-h-[200px] bg-theme-sidebar/5",
                isDragging
                  ? "border-theme-accent bg-theme-accent/10 scale-[0.99] shadow-inner"
                  : "border-theme-border hover:border-theme-accent/30 hover:bg-theme-sidebar/10"
              )}
            >
              {/* Hidden Inputs */}
              <input
                type="file"
                ref={fileInputRef}
                multiple
                accept=".txt,.md,.json,.docx,.zip"
                onChange={(e) => {
                  if (e.target.files) processSelectedFiles(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
              <input
                type="file"
                ref={folderInputRef}
                multiple
                {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
                onChange={(e) => {
                  if (e.target.files) processSelectedFiles(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />

              <div className="flex flex-col items-center text-center space-y-3">
                <div className={cn(
                  "rounded-full p-3 transition-colors duration-200",
                  isDragging ? "bg-theme-accent/20 text-theme-accent" : "bg-theme-border/20 text-theme-muted"
                )}>
                  <Upload size={24} className={cn(isDragging && "animate-pulse")} />
                </div>
                <div>
                  <p className="text-sm font-bold text-theme-text">
                    {isDragging ? "松开鼠标以添加文件" : "将文件、文件夹或 ZIP 拖拽到此处"}
                  </p>
                  <p className="text-xs text-theme-muted mt-1">
                    支持解包 .zip 和多级目录，仅保留文本设定/正文
                  </p>
                </div>

                <div className="flex items-center gap-3 mt-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg bg-theme-sidebar border border-theme-border px-3 py-1.5 text-xs font-bold text-theme-text hover:border-theme-accent/40 hover:bg-theme-sidebar-hover transition-colors cursor-pointer"
                  >
                    选择文件 / ZIP
                  </button>
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="rounded-lg bg-theme-sidebar border border-theme-border px-3 py-1.5 text-xs font-bold text-theme-text hover:border-theme-accent/40 hover:bg-theme-sidebar-hover transition-colors cursor-pointer"
                  >
                    选择文件夹
                  </button>
                </div>
              </div>
            </div>

            {/* Queue List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-theme-muted uppercase tracking-wider">
                  待解析文件队列 ({files.length})
                </div>
                {files.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFiles([])}
                    className="text-xs font-bold text-theme-muted hover:text-red-500 transition-colors cursor-pointer"
                  >
                    清空队列
                  </button>
                )}
              </div>

              <div className="max-h-[220px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {files.length > 0 ? (
                  files.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      className="flex items-center gap-2 rounded-xl border border-theme-border bg-theme-sidebar/50 px-3 py-2 text-xs text-theme-text hover:border-theme-accent/30 hover:bg-theme-sidebar transition-colors"
                    >
                      <FileText size={14} className="text-theme-muted shrink-0" />
                      <span className="truncate flex-1" title={file.name}>
                        {file.name}
                      </span>
                      <span className="text-[10px] text-theme-muted shrink-0 font-mono">
                        ({(file.size / 1024).toFixed(1)} KB)
                      </span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== index))}
                        className="text-theme-muted hover:text-red-500 transition-colors p-0.5 rounded hover:bg-theme-border/20 cursor-pointer flex items-center justify-center"
                        title="移除此文件"
                      >
                        <PlusCircle size={14} className="rotate-45 transform" style={{ transform: 'rotate(45deg)' }} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-theme-border/60 bg-theme-sidebar/20 px-3 py-6 text-center text-xs text-theme-muted">
                    还没选择任何资料文件。至少上传一个资料文件后才能开始解析。
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-theme-border bg-theme-sidebar/10 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-theme-text">
                <BookOpen size={15} />
                导入目标
              </div>
              <div className="mt-3 grid gap-2">
                <div
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    targetMode === 'existing'
                      ? 'border-theme-accent bg-theme-accent/5'
                      : 'border-theme-border bg-theme-sidebar'
                    } ${novels.length === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:border-theme-accent/40'}`}
                >
                  <button
                    type="button"
                    onClick={() => setTargetMode('existing')}
                    disabled={novels.length === 0}
                    className="text-sm font-bold text-theme-text disabled:cursor-not-allowed"
                  >
                    导入到现有作品
                  </button>
                  <div className="mt-1 text-xs text-theme-muted">把解析结果接到已有作品里，确认资料包后继续写。</div>
                  {novels.length > 0 && (
                    <label className="mt-3 block text-xs font-bold text-theme-muted" htmlFor="continuation-import-target">
                      目标作品
                      <select
                        id="continuation-import-target"
                        aria-label="选择导入目标作品"
                        value={selectedNovelId}
                        onChange={(e) => {
                          setSelectedNovelId(e.target.value);
                          setTargetMode('existing');
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2 w-full rounded-xl border border-theme-border bg-theme-sidebar px-3 py-3 text-sm font-normal text-theme-text outline-none"
                      >
                        {novels.length > 1 && <option value="">请选择目标作品</option>}
                        {novels.map((novel) => (
                          <option key={novel.id} value={novel.id}>{novel.title}</option>
                        ))}
                      </select>
                      <span className="mt-2 block font-normal text-theme-text">
                        当前将导入到：{selectedNovel ? `《${selectedNovel.title}》` : '请选择目标作品'}
                      </span>
                    </label>
                  )}
                </div>
                <button
                  onClick={() => setTargetMode('new')}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    targetMode === 'new'
                      ? 'border-theme-accent bg-theme-accent/5'
                      : 'border-theme-border bg-theme-sidebar hover:border-theme-accent/40'
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-theme-text">
                    <PlusCircle size={15} />
                    新建作品
                  </div>
                  <div className="mt-1 text-xs text-theme-muted">为这批资料单独创建作品，再进入续写。</div>
                </button>
              </div>
            </div>

            {targetMode === 'new' ? (
              <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
                <div className="text-xs font-bold text-theme-muted">新建作品预览</div>
                <div className="mt-3 text-sm font-bold text-theme-text">
                  {suggestedDraft?.title || '解析后会生成候选作品名'}
                </div>
                <p className="mt-2 text-xs leading-5 text-theme-muted">
                  {suggestedDraft?.summary || '确认时会根据资料包标题生成默认标题与摘要。'}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-theme-muted">
            解析后你只需要确认任务摘要、风险和导入目标，不会让你手动整理长资料。
          </div>
          <button
            onClick={handleParse}
            disabled={uploadActionDisabled}
            className="inline-flex items-center gap-2 rounded-xl bg-theme-text px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {isParsing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            {isParsing ? '智能解析中...' : '开始解析资料'}
          </button>
        </div>
      </div>
    </div>
  );

  const renderConfirmStage = () => {
    if (!parsedPack || !parsedState) return null;

    const targetNovelLabel =
      parsedState.targetModeAtParse === 'existing'
        ? novels.find((novel) => novel.id === parsedState.selectedNovelIdAtParse)?.title || '未找到目标作品'
        : suggestedDraft?.title || '新建作品';

    return (
      <div className="max-w-4xl mx-auto px-8 py-10 space-y-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold tracking-[0.24em] text-theme-accent">写作前确认</div>
            <h1 className="mt-2 text-3xl font-serif font-bold text-theme-text">确认导入并进入续写</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-theme-muted">
              这里只展示本次续写必需的任务摘要。确认后会将资料包标记为本次续写资料，并带你进入编辑器。
            </p>
          </div>
          <div className="rounded-2xl border border-theme-border bg-theme-sidebar px-4 py-3 text-right">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-theme-muted">导入目标</div>
            <div className="mt-1 text-sm font-bold text-theme-text">{targetNovelLabel}</div>
            <div className="mt-1 text-xs text-theme-muted">
              {parsedState.targetModeAtParse === 'existing' ? '现有作品' : '确认时新建作品'}
            </div>
          </div>
        </div>

        {parsedPack.contradictions.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex items-center justify-between gap-3 font-bold">
              <div className="flex items-center gap-2">
              <AlertTriangle size={16} />
              发现资料冲突
              </div>
              {unresolvedHighConflictCount > 0 && (
                <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] text-red-700">
                  还有 {unresolvedHighConflictCount} 个高风险冲突待处理
                </span>
              )}
            </div>
            <div className="mt-3 space-y-3 text-xs leading-5">
              {parsedPack.contradictions.map((item) => {
                const resolutionDraft = conflictResolutionDrafts[item.id] ?? item.suggestedResolution ?? '';
                const acceptedResolution = item.acceptedResolution?.trim() || '';
                const isAccepted = Boolean(acceptedResolution && acceptedResolution === resolutionDraft.trim());
                const severityLabel = item.severity === 'high' ? '高风险' : item.severity === 'medium' ? '中风险' : '低风险';
                const severityClass = item.severity === 'high'
                  ? 'bg-red-100 text-red-700'
                  : item.severity === 'medium'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-blue-100 text-blue-700';
                return (
                  <div key={item.id} className="rounded-xl border border-amber-200 bg-white/60 p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${severityClass}`}>
                        {severityLabel}
                      </span>
                      <div className="font-bold text-theme-text">{item.summary}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-theme-muted">冲突证据</div>
                      {item.conflictingEvidence.length > 0 ? (
                        <ul className="mt-1 space-y-1 text-theme-muted">
                          {item.conflictingEvidence.map((evidence, index) => (
                            <li key={`${item.id}-evidence-${index}`}>- {evidence}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-1 text-theme-muted">未提供具体证据</div>
                      )}
                    </div>
                    <div>
                      <label htmlFor={`conflict-resolution-${item.id}`} className="text-[10px] font-bold uppercase tracking-wider text-theme-muted">
                        裁决方案
                      </label>
                      <textarea
                        id={`conflict-resolution-${item.id}`}
                        aria-label={`冲突方案：${item.summary}`}
                        value={resolutionDraft}
                        onChange={(event) => updateConflictResolutionDraft(item.id, event.target.value)}
                        rows={2}
                        maxLength={1000}
                        className="mt-1 w-full resize-y rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-theme-text outline-none focus:border-theme-accent"
                        placeholder="请填写本次续写应遵循的明确方案"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => acceptConflictResolution(item.id)}
                        disabled={!resolutionDraft.trim() || isAccepted}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 disabled:opacity-60"
                      >
                        <CheckCircle2 size={13} />
                        {isAccepted ? '已确认此方案' : '采用此方案'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!hasCanonFacts && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
            当前资料未提取出关键硬设定，仍可确认导入。建议先检查资料完整性，后续可在设定集中补充。
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-theme-border bg-theme-sidebar p-5">
            <div className="text-sm font-bold text-theme-text">续写任务</div>
            <p className="mt-3 text-sm leading-6 text-theme-muted">
              {parsedPack.continuationTask || '未识别到明确任务，请返回补充任务说明或正文上下文。'}
            </p>
          </section>

          <section className="rounded-2xl border border-theme-border bg-theme-sidebar p-5">
            <div className="text-sm font-bold text-theme-text">剧情锚点 / 即时冲突</div>
            <div className="mt-3 space-y-2 text-xs leading-5 text-theme-muted">
              <div><span className="font-bold text-theme-text">时间位置：</span>{parsedPack.plotState.currentTimeline || '未识别'}</div>
              <div><span className="font-bold text-theme-text">最新场景：</span>{parsedPack.plotState.latestScene || '未识别'}</div>
              <div><span className="font-bold text-theme-text">即时冲突：</span>{parsedPack.plotState.immediateConflict || '未识别'}</div>
              <div><span className="font-bold text-theme-text">下一步倾向：</span>{parsedPack.plotState.nextLikelyMove || '未识别'}</div>
            </div>
          </section>

          <section className="rounded-2xl border border-theme-border bg-theme-sidebar p-5">
            <div className="text-sm font-bold text-theme-text">关键硬设定</div>
            <div className="mt-3 space-y-2">
              {parsedPack.canonFacts.slice(0, 6).map((fact) => (
                <div key={fact.id} className="rounded-xl border border-theme-border bg-theme-sidebar/10 px-3 py-2 text-xs leading-5 text-theme-muted">
                  <span className="font-bold text-theme-text">{fact.category}</span> · {fact.text}
                </div>
              ))}
              {parsedPack.canonFacts.length === 0 && (
                <div className="text-xs text-theme-muted">未提取到可确认的硬设定。</div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-theme-border bg-theme-sidebar p-5">
            <div className="text-sm font-bold text-theme-text">人物状态</div>
            <div className="mt-3 space-y-2">
              {parsedPack.characterStates.slice(0, 5).map((character) => (
                <div key={`${character.name}-${character.currentGoal}`} className="rounded-xl border border-theme-border bg-theme-sidebar/10 px-3 py-2 text-xs leading-5 text-theme-muted">
                  <div className="font-bold text-theme-text">{character.name}</div>
                  <div>目标：{character.currentGoal || '未识别'}</div>
                  <div>情绪：{character.emotionalState || '未识别'}</div>
                </div>
              ))}
              {parsedPack.characterStates.length === 0 && (
                <div className="text-xs text-theme-muted">未识别到稳定的人物状态信息。</div>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-theme-border bg-theme-sidebar p-5">
          <div className="text-sm font-bold text-theme-text">资料缺口 / 风险</div>
          <div className="mt-3 space-y-2">
            {parsedPack.continuationGaps && parsedPack.continuationGaps.length > 0 ? (
              parsedPack.continuationGaps.slice(0, 6).map((gap) => (
                <div key={gap.id} className="rounded-xl border border-theme-border bg-theme-sidebar/10 px-3 py-3 text-xs leading-5 text-theme-muted">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      gap.severity === 'high'
                        ? 'bg-red-100 text-red-700'
                        : gap.severity === 'medium'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'
                    }`}>
                      {gap.severity}
                    </span>
                    <span className="font-bold text-theme-text">{gap.description}</span>
                  </div>
                  <div className="mt-1">建议方向：{gap.suggestedDirection || '未给出'}</div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-700">
                当前未发现明显资料缺口，可确认后进入续写。
              </div>
            )}
          </div>
        </section>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => {
              if (isSubmitting) return;
              resetParsedSession();
              setStage('upload');
              setError('');
            }}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-xl border border-theme-border bg-theme-sidebar px-4 py-3 text-sm font-bold text-theme-text hover:border-theme-accent/40"
          >
            <ArrowLeft size={16} />
            返回上一步
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || isSubmitting}
            className="inline-flex items-center gap-2 rounded-xl bg-theme-accent px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {isSubmitting
              ? '正在进入编辑器...'
              : unresolvedHighConflictCount > 0
                ? `先处理 ${unresolvedHighConflictCount} 个高风险冲突`
                : '确认并进入续写'}
          </button>
        </div>
      </div>
    );
  };

  const renderParsingStage = () => {
    return (
      <div className="flex h-full min-h-[500px] flex-col items-center justify-center p-6">
        <div className="relative w-full max-w-lg rounded-3xl border border-theme-border/60 bg-theme-sidebar/40 p-10 shadow-2xl backdrop-blur-md">
          {/* Subtle Glowing AI Halo */}
          <div className="absolute -top-12 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full bg-theme-text/10 blur-xl animate-pulse" />
          
          <div className="flex flex-col items-center text-center">
            {/* Spinning AI Orb */}
            <div className="relative mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-theme-text/5 text-theme-text border border-theme-border">
              <Loader2 className="h-10 w-10 animate-spin text-theme-text" />
              <div className="absolute inset-0 rounded-2xl border border-theme-text/25 animate-ping opacity-20" />
            </div>

            <h3 className="mb-2 text-xl font-bold tracking-tight text-theme-text">
              智能解析控制台
            </h3>
            <p className="mb-8 text-xs text-theme-muted">
              正在对导入的文本文档进行多维语义提炼，构建断代设定时空底盘
            </p>

            {/* Premium Progress Bar Wrapper */}
            <div className="w-full space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-theme-text">{parseStageText}</span>
                <span className="font-mono text-theme-text">{parseProgress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-theme-border/50">
                <div 
                  className="h-full rounded-full bg-gradient-to-r from-theme-text/60 to-theme-text transition-all duration-300 ease-out"
                  style={{ width: `${parseProgress}%` }}
                />
              </div>
            </div>

            {/* List of Parsing Status Items */}
            <div className="mt-8 w-full space-y-3.5 text-left border-t border-theme-border/40 pt-6">
              <div className={cn("flex items-center gap-3 text-xs transition-opacity duration-300", parseProgress >= 20 ? "text-theme-text font-medium" : "text-theme-muted")}>
                <div className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[10px]", parseProgress >= 20 ? "border-theme-text bg-theme-text/5 text-theme-text" : "border-theme-border")}>
                  {parseProgress >= 20 ? "✓" : "1"}
                </div>
                <span>分析文档拓扑，解包并提取基础语料</span>
              </div>
              <div className={cn("flex items-center gap-3 text-xs transition-opacity duration-300", parseProgress >= 50 ? "text-theme-text font-medium" : "text-theme-muted")}>
                <div className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[10px]", parseProgress >= 50 ? "border-theme-text bg-theme-text/5 text-theme-text" : "border-theme-border")}>
                  {parseProgress >= 50 ? "✓" : "2"}
                </div>
                <span>跨文档实体检索，标记角色与人设底稿</span>
              </div>
              <div className={cn("flex items-center gap-3 text-xs transition-opacity duration-300", parseProgress >= 73 ? "text-theme-text font-medium" : "text-theme-muted")}>
                <div className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[10px]", parseProgress >= 73 ? "border-theme-text bg-theme-text/5 text-theme-text" : "border-theme-border")}>
                  {parseProgress >= 73 ? "✓" : "3"}
                </div>
                <span>提取多维关系连线，梳理设定关联脉络</span>
              </div>
              <div className={cn("flex items-center gap-3 text-xs transition-opacity duration-300", parseProgress >= 88 ? "text-theme-text font-medium" : "text-theme-muted")}>
                <div className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[10px]", parseProgress >= 88 ? "border-theme-text bg-theme-text/5 text-theme-text" : "border-theme-border")}>
                  {parseProgress >= 88 ? "✓" : "4"}
                </div>
                <span>重构叙事大纲冲突，提取时间线与未决悬念</span>
              </div>
              <div className={cn("flex items-center gap-3 text-xs transition-opacity duration-300", parseProgress >= 96 ? "text-theme-text font-medium" : "text-theme-muted")}>
                <div className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[10px]", parseProgress >= 96 ? "border-theme-text bg-theme-text/5 text-theme-text" : "border-theme-border")}>
                  {parseProgress >= 96 ? "✓" : "5"}
                </div>
                <span>执行自适应质量审计，预防剧情逻辑崩坏</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (isBootstrapping) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-theme-border bg-theme-sidebar px-5 py-4 text-sm text-theme-muted">
          <Loader2 size={16} className="animate-spin" />
          正在加载作品列表...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-theme-bg/30">
      {isParsing 
        ? renderParsingStage() 
        : stage === 'upload' 
          ? renderUploadStage() 
          : renderConfirmStage()}
    </div>
  );
}
