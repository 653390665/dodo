import React, { useEffect, useMemo, useRef, useState } from 'react';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Upload from 'lucide-react/dist/esm/icons/upload.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import PlusCircle from 'lucide-react/dist/esm/icons/circle-plus.js';
import BookOpen from 'lucide-react/dist/esm/icons/book-open.js';
import type { ContinuationImportTargetMode, ContinuationPack, Novel } from '../types';
import { listNovels, createNovel } from '../lib/novel-client';
import { parseContinuationPack } from '../lib/prompt-client';
import { updateContinuationPack } from '../lib/continuation-client';
import {
  buildImportedNovelDraft,
  canApproveContinuationImportPack,
  resolveContinuationImportTargetMode,
} from '../lib/continuation-import-flow';

interface ContinuationImportViewProps {
  onBack: () => void;
  onEnterEditor: (novel: Novel, approvedPackId: string) => void;
}

type Stage = 'upload' | 'confirm';

type ParsedPackState = {
  pack: ContinuationPack;
  targetModeAtParse: ContinuationImportTargetMode;
  selectedNovelIdAtParse: string;
};

const FLOW_STEPS = [
  { title: '上传资料', description: '世界观、大纲、任务单或正文片段一起丢进来。' },
  { title: 'AI解析', description: '自动整理剧情位置、角色状态和关键硬设定。' },
  { title: '人工确认', description: '你只看任务摘要与风险，不用手动管资料结构。' },
  { title: '进入续写', description: '确认后直接带着资料包进入编辑器继续写。' },
];

export function ContinuationImportView({ onBack, onEnterEditor }: ContinuationImportViewProps) {
  const [stage, setStage] = useState<Stage>('upload');
  const [novels, setNovels] = useState<Novel[]>([]);
  const [targetMode, setTargetMode] = useState<ContinuationImportTargetMode>('new');
  const [selectedNovelId, setSelectedNovelId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [parsedState, setParsedState] = useState<ParsedPackState | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const createdTargetNovelRef = useRef<Novel | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadNovels() {
      try {
        const loadedNovels = await listNovels();
        if (!isMounted) return;
        setNovels(loadedNovels);
        const defaultMode = resolveContinuationImportTargetMode(loadedNovels);
        setTargetMode(defaultMode);
        setSelectedNovelId(loadedNovels[0]?.id || '');
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
  }, []);

  const selectedNovel = useMemo(
    () => novels.find((novel) => novel.id === selectedNovelId) || null,
    [novels, selectedNovelId],
  );

  const parsedPack = parsedState?.pack || null;
  const canConfirm = canApproveContinuationImportPack(parsedPack);
  const suggestedDraft = parsedPack ? buildImportedNovelDraft(parsedPack.title) : null;
  const uploadActionDisabled = files.length === 0 || isParsing || (targetMode === 'existing' && !selectedNovelId);

  const resetParsedSession = () => {
    setParsedState(null);
    createdTargetNovelRef.current = null;
  };

  async function fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  const handleParse = async () => {
    if (uploadActionDisabled) return;

    const parseNovelId =
      targetMode === 'existing'
        ? selectedNovelId
        : `continuation-import-draft-${Date.now()}`;

    setIsParsing(true);
    setError('');
    resetParsedSession();

    try {
      const documents = await Promise.all(
        files.map(async (file) => ({
          filename: file.name,
          filedata: await fileToBase64(file),
        })),
      );
      const pack = await parseContinuationPack({
        novelId: parseNovelId,
        title:
          targetMode === 'existing' && selectedNovel
            ? `${selectedNovel.title} 资料包`
            : `导入续写资料包 ${new Date().toLocaleDateString('zh-CN')}`,
        documents,
      });

      setParsedState({
        pack,
        targetModeAtParse: targetMode,
        selectedNovelIdAtParse: selectedNovelId,
      });
      setStage('confirm');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsParsing(false);
    }
  };

  const handleConfirm = async () => {
    if (!parsedState || !parsedPack || !canConfirm) return;

    setIsSubmitting(true);
    setError('');

    try {
      let targetNovel: Novel | null = null;

      if (parsedState.targetModeAtParse === 'existing') {
        targetNovel = novels.find((novel) => novel.id === parsedState.selectedNovelIdAtParse) || null;
        if (!targetNovel) {
          throw new Error('未找到要导入的目标作品，请返回上一步重新选择。');
        }
      } else {
        targetNovel = createdTargetNovelRef.current;
        if (!targetNovel) {
          const now = Date.now();
          const draft = buildImportedNovelDraft(parsedPack.title);
          targetNovel = {
            id: now.toString(),
            title: draft.title,
            authorId: 'local-user',
            summary: draft.summary,
            status: 'ongoing',
            createdAt: now,
            updatedAt: now,
          };
          await createNovel(targetNovel);
          createdTargetNovelRef.current = targetNovel;
        }
      }

      await updateContinuationPack(parsedPack.id, {
        novelId: targetNovel.id,
        status: 'approved',
      });

      onEnterEditor(targetNovel, parsedPack.id);
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
          <div className="text-xs font-bold uppercase tracking-[0.24em] text-theme-accent">Continuation Import</div>
          <h1 className="mt-2 text-3xl font-serif font-bold text-theme-text">导入资料续写</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-theme-muted">
            这不是资料管理页。你把世界观、大纲、任务说明或已有正文上传进来，系统先整理成续写任务包，再带你直接进入写作。
          </p>
        </div>
        <button
          onClick={onBack}
          className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-theme-border bg-white px-4 py-2 text-sm font-bold text-theme-text hover:border-theme-accent/40"
        >
          <ArrowLeft size={16} />
          返回首页
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {FLOW_STEPS.map((step, index) => (
          <div key={step.title} className="rounded-2xl border border-theme-border bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-theme-accent/70">STEP {index + 1}</div>
            <div className="mt-2 text-sm font-bold text-theme-text">{step.title}</div>
            <p className="mt-1 text-xs leading-5 text-theme-muted">{step.description}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-theme-border bg-white p-6 space-y-6">
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
          <div className="rounded-2xl border border-dashed border-theme-border bg-theme-sidebar/15 p-5">
            <input
              type="file"
              multiple
              accept=".txt,.md,.json,.docx"
              onChange={(e) => {
                setFiles(Array.from(e.target.files || []));
                setError('');
              }}
              className="block w-full text-sm text-theme-muted file:mr-4 file:rounded-full file:border-0 file:bg-theme-text file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:opacity-90"
            />
            <div className="mt-4 text-xs text-theme-muted">
              建议一起上传：世界观设定、章节大纲、任务要求、已有正文片段、人物状态说明。
            </div>
            <div className="mt-4 space-y-2">
              {files.length > 0 ? (
                files.map((file) => (
                  <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-xl border border-theme-border bg-white px-3 py-2 text-xs text-theme-text">
                    <FileText size={13} className="text-theme-muted shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-theme-border bg-white px-3 py-4 text-xs text-theme-muted">
                  还没选择文件。至少上传一个资料文件后才能开始解析。
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-theme-border bg-theme-sidebar/10 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-theme-text">
                <BookOpen size={15} />
                导入目标
              </div>
              <div className="mt-3 grid gap-2">
                <button
                  onClick={() => setTargetMode('existing')}
                  disabled={novels.length === 0}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    targetMode === 'existing'
                      ? 'border-theme-accent bg-theme-accent/5'
                      : 'border-theme-border bg-white'
                  } ${novels.length === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:border-theme-accent/40'}`}
                >
                  <div className="text-sm font-bold text-theme-text">导入到现有作品</div>
                  <div className="mt-1 text-xs text-theme-muted">把解析结果接到已有项目里，直接继续写。</div>
                </button>
                <button
                  onClick={() => setTargetMode('new')}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    targetMode === 'new'
                      ? 'border-theme-accent bg-theme-accent/5'
                      : 'border-theme-border bg-white hover:border-theme-accent/40'
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

            {targetMode === 'existing' ? (
              <div className="rounded-2xl border border-theme-border bg-white p-4">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-theme-muted">Target Novel</div>
                {novels.length > 0 ? (
                  <select
                    value={selectedNovelId}
                    onChange={(e) => setSelectedNovelId(e.target.value)}
                    className="mt-3 w-full rounded-xl border border-theme-border bg-white px-3 py-3 text-sm text-theme-text outline-none"
                  >
                    {novels.map((novel) => (
                      <option key={novel.id} value={novel.id}>{novel.title}</option>
                    ))}
                  </select>
                ) : (
                  <div className="mt-3 rounded-xl border border-theme-border bg-theme-sidebar/10 px-3 py-3 text-xs text-theme-muted">
                    当前没有现有作品，默认只能走新建作品。
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-theme-border bg-white p-4">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-theme-muted">New Novel Preview</div>
                <div className="mt-3 text-sm font-bold text-theme-text">
                  {suggestedDraft?.title || '解析后会自动生成默认作品名'}
                </div>
                <p className="mt-2 text-xs leading-5 text-theme-muted">
                  {suggestedDraft?.summary || '确认时会根据资料包标题生成默认标题与摘要。'}
                </p>
              </div>
            )}
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
            {isParsing ? 'AI 解析中...' : '开始解析资料'}
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
            <div className="text-xs font-bold uppercase tracking-[0.24em] text-theme-accent">Review Before Writing</div>
            <h1 className="mt-2 text-3xl font-serif font-bold text-theme-text">确认导入并进入续写</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-theme-muted">
              这里只展示本次续写必需的任务摘要。确认后会将资料包标记为已启用，并直接把你送进编辑器。
            </p>
          </div>
          <div className="rounded-2xl border border-theme-border bg-white px-4 py-3 text-right">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-theme-muted">导入目标</div>
            <div className="mt-1 text-sm font-bold text-theme-text">{targetNovelLabel}</div>
            <div className="mt-1 text-xs text-theme-muted">
              {parsedState.targetModeAtParse === 'existing' ? '现有作品' : '确认时新建作品'}
            </div>
          </div>
        </div>

        {parsedPack.contradictions.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle size={16} />
              发现资料冲突
            </div>
            <div className="mt-2 space-y-2 text-xs leading-5">
              {parsedPack.contradictions.map((item) => (
                <div key={item.id}>
                  {item.summary}
                  {item.suggestedResolution ? ` 建议：${item.suggestedResolution}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}

        {!canConfirm && parsedPack.contradictions.length === 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
            当前资料未提取出足够的关键硬设定，暂时不能确认导入。请返回上一步补充更完整的资料。
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-theme-border bg-white p-5">
            <div className="text-sm font-bold text-theme-text">续写任务</div>
            <p className="mt-3 text-sm leading-6 text-theme-muted">
              {parsedPack.continuationTask || '未识别到明确任务，请返回补充任务说明或正文上下文。'}
            </p>
          </section>

          <section className="rounded-2xl border border-theme-border bg-white p-5">
            <div className="text-sm font-bold text-theme-text">剧情锚点 / 即时冲突</div>
            <div className="mt-3 space-y-2 text-xs leading-5 text-theme-muted">
              <div><span className="font-bold text-theme-text">时间位置：</span>{parsedPack.plotState.currentTimeline || '未识别'}</div>
              <div><span className="font-bold text-theme-text">最新场景：</span>{parsedPack.plotState.latestScene || '未识别'}</div>
              <div><span className="font-bold text-theme-text">即时冲突：</span>{parsedPack.plotState.immediateConflict || '未识别'}</div>
              <div><span className="font-bold text-theme-text">下一步倾向：</span>{parsedPack.plotState.nextLikelyMove || '未识别'}</div>
            </div>
          </section>

          <section className="rounded-2xl border border-theme-border bg-white p-5">
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

          <section className="rounded-2xl border border-theme-border bg-white p-5">
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

        <section className="rounded-2xl border border-theme-border bg-white p-5">
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
                当前未发现明显资料缺口，可直接进入续写。
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
            className="inline-flex items-center gap-2 rounded-xl border border-theme-border bg-white px-4 py-3 text-sm font-bold text-theme-text hover:border-theme-accent/40"
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
            {isSubmitting ? '正在进入编辑器...' : '确认并进入续写'}
          </button>
        </div>
      </div>
    );
  };

  if (isBootstrapping) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-theme-border bg-white px-5 py-4 text-sm text-theme-muted">
          <Loader2 size={16} className="animate-spin" />
          正在加载作品列表...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-theme-bg/30">
      {stage === 'upload' ? renderUploadStage() : renderConfirmStage()}
    </div>
  );
}
