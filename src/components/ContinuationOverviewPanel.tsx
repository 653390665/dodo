import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import FileWarning from 'lucide-react/dist/esm/icons/file-warning.js';
import Upload from 'lucide-react/dist/esm/icons/upload.js';
import type { ContinuationOverviewState } from '../types';

interface ContinuationOverviewPanelProps {
  state: ContinuationOverviewState;
  onImport: () => void;
  onReviewDraft: (packId: string) => void;
  onOpenPackManagement: () => void;
  onStartWriting: (packId: string) => void;
  onStartStoryboard?: (packId: string) => void;
  onOpenWorldSetup: () => void;
}

export function ContinuationOverviewPanel({
  state,
  onImport,
  onReviewDraft,
  onOpenPackManagement,
  onStartWriting,
  onStartStoryboard,
  onOpenWorldSetup,
}: ContinuationOverviewPanelProps) {
  const primaryPack = state.primaryPack;
  const statusLabel =
    state.kind === 'empty'
      ? '未接入资料包'
      : state.kind === 'draft'
        ? '已解析，待审核'
        : state.kind === 'risk'
          ? '可续写，但有风险'
          : '已接入资料包';
  const actionConfig =
    state.kind === 'empty'
      ? {
          accent: 'neutral' as const,
          eyebrow: '推荐动作',
          title: '先导入资料，再开始续写',
          description: '把世界观、大纲、任务或已有正文整理进资料包，后续自动生产才会稳定吃到上下文。',
          outcome: '导入后系统会先整理资料包，再进入审核，不会直接跳过确认环节。',
          primary: {
            label: '导入资料',
            icon: Upload,
            onClick: onImport,
          },
          secondary: {
            label: '查看世界设定',
            onClick: onOpenWorldSetup,
          },
        }
      : state.kind === 'draft' && state.draftPack
        ? {
            accent: 'neutral' as const,
            eyebrow: '推荐动作',
            title: '先审核这份资料包，再进入续写',
            description: '审核通过后，它会成为当前默认上下文，后续进入自动生产时直接挂上。',
            outcome: '确认完成后，再进入编辑器时会默认挂上这份资料包。',
            primary: {
              label: '审核资料包',
              icon: CheckCircle2,
              onClick: () => onReviewDraft(state.draftPack!.id),
            },
            secondary: {
              label: '重新导入资料',
              onClick: onImport,
            },
          }
        : state.kind === 'ready' && state.approvedPack
          ? {
              accent: 'ready' as const,
              eyebrow: '现在就能开始',
              title: '直接进入资料包续写',
              description: '系统会带着当前 approved pack 打开自动生产，你不用再手动挑一次资料包。',
              outcome: '点下去后会直接进入生产面板，并默认选中当前资料包。',
              primary: {
                label: '开始按资料续写',
                icon: ArrowRight,
                onClick: () => onStartWriting(state.approvedPack!.id),
              },
              secondary: {
                label: '更换资料包',
                onClick: onOpenPackManagement,
              },
            }
          : state.kind === 'risk' && state.approvedPack
            ? {
                accent: 'warning' as const,
                eyebrow: '谨慎继续',
                title: '这份资料包可以续写，但风险还没处理完',
                description: '如果现在就开始，系统仍会按当前资料包续写；如果你想更稳，先回资料包管理处理风险。',
                outcome: '现在继续也会吃到资料包，但冲突和缺口可能把后续章节带偏。',
                primary: {
                  label: '先处理风险',
                  icon: FileWarning,
                  onClick: onOpenPackManagement,
                },
                secondary: {
                  label: '仍然开始续写',
                  onClick: () => onStartWriting(state.approvedPack!.id),
                  tone: 'warning' as const,
                },
              }
            : null;
  const actionToneClasses =
    actionConfig?.accent === 'warning'
      ? {
          shell: 'border-amber-300 bg-amber-50/80',
          badge: 'border-amber-300 bg-white text-amber-800',
          accent: 'bg-amber-500/10 text-amber-800',
          outcome: 'border-amber-200 bg-white/80 text-amber-800',
        }
      : actionConfig?.accent === 'ready'
        ? {
            shell: 'border-emerald-200 bg-emerald-50/80',
            badge: 'border-emerald-200 bg-white text-emerald-800',
            accent: 'bg-emerald-500/10 text-emerald-800',
            outcome: 'border-emerald-200 bg-white/80 text-emerald-800',
          }
        : {
            shell: 'border-theme-border bg-theme-sidebar/18',
            badge: 'border-theme-border bg-white text-theme-text',
            accent: 'bg-theme-text/5 text-theme-text',
            outcome: 'border-theme-border bg-white/90 text-theme-muted',
          };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <section className="rounded-3xl border border-theme-border bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-theme-muted">资料续写总览</div>
            <h2 className="mt-2 text-2xl font-serif font-bold text-theme-text">{statusLabel}</h2>
            <p className="mt-2 text-sm text-theme-muted leading-6">
              {state.kind === 'empty'
                ? '还没有可用于续写的资料，请先导入世界观、大纲、任务或已有正文。'
                : `当前资料包：${primaryPack?.title || '未接入'}。本次自动生产将默认使用该资料包。`}
            </p>
          </div>
          {primaryPack ? (
            <div className="rounded-full border border-theme-border bg-theme-sidebar/20 px-3 py-1 text-xs text-theme-muted">
              更新于 {new Date(primaryPack.updatedAt).toLocaleString('zh-CN')}
            </div>
          ) : null}
        </div>
      </section>

      {primaryPack && (
        <p className="text-xs text-theme-muted leading-5 max-w-3xl">
          续写任务描述这次创作要推进的方向；分镜准备用于整理场景大纲和关键节点，结构确定后再进入正文。
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-theme-border bg-white p-5 shadow-sm">
          <div className="text-xs font-bold text-theme-muted">本次续写任务</div>
          <div className="mt-3 text-sm font-bold text-theme-text leading-6">
            {primaryPack?.continuationTask || '还没有续写任务摘要'}
          </div>
          <div className="mt-4 space-y-3 text-xs text-theme-muted">
            <div>
              <div className="font-bold text-theme-text">当前剧情锚点</div>
              <div className="mt-1 leading-6">{primaryPack?.plotState.latestScene || '暂无'}</div>
            </div>
            <div>
              <div className="font-bold text-theme-text">即时冲突</div>
              <div className="mt-1 leading-6">{primaryPack?.plotState.immediateConflict || '暂无'}</div>
            </div>
            <div>
              <div className="font-bold text-theme-text">下一步建议</div>
              <div className="mt-1 leading-6">{primaryPack?.plotState.nextLikelyMove || '暂无'}</div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-theme-border bg-white p-5 shadow-sm">
          <div className="text-xs font-bold text-theme-muted">风险与缺口</div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-theme-border px-2.5 py-1">冲突 {state.contradictionCount}</span>
            <span className="rounded-full border border-theme-border px-2.5 py-1">审读问题 {state.readingQuestionCount}</span>
            <span className="rounded-full border border-theme-border px-2.5 py-1">续写缺口 {state.continuationGapCount}</span>
          </div>
          <div className="mt-4 space-y-2">
            {state.highlightWarnings.length > 0 ? (
              state.highlightWarnings.map((warning) => (
                <div key={warning} className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {warning}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-theme-border bg-theme-sidebar/15 px-3 py-2 text-xs text-theme-muted">
                当前没有需要优先处理的风险提示。
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-theme-border bg-white p-5 shadow-sm">
        <div className="text-xs font-bold text-theme-muted">下一步动作</div>
        {actionConfig ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_280px]">
            <div className={`rounded-[28px] border p-5 shadow-sm ${actionToneClasses.shell}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] ${actionToneClasses.badge}`}>
                  {actionConfig.eyebrow}
                </span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${actionToneClasses.accent}`}>系统建议优先做这个</span>
              </div>
              <h3 className="mt-4 text-2xl font-serif font-bold text-theme-text">{actionConfig.title}</h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-theme-muted">{actionConfig.description}</p>
              <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm leading-6 ${actionToneClasses.outcome}`}>
                {actionConfig.outcome}
              </div>
              <button
                onClick={actionConfig.primary.onClick}
                className="mt-5 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-theme-text px-5 py-4 text-sm font-bold text-white shadow-sm transition-transform hover:-translate-y-0.5 sm:w-auto sm:min-w-[240px]"
              >
                <actionConfig.primary.icon size={16} />
                {actionConfig.primary.label}
              </button>
            </div>

            <div className="rounded-3xl border border-theme-border bg-white p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-theme-muted/80">备选动作</div>
              <p className="mt-2 text-sm leading-6 text-theme-muted">
                {actionConfig.accent === 'warning'
                  ? '如果你决定先冒险推进，仍然可以直接进入续写。'
                  : '如果你现在不走推荐路径，也可以先切换到这个动作。'}
              </p>
              <button
                onClick={actionConfig.secondary.onClick}
                className={
                  actionConfig.secondary.tone === 'warning'
                    ? 'mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-bold text-amber-800'
                    : 'mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-theme-border px-5 py-3 text-sm font-bold text-theme-text'
                }
              >
                {actionConfig.secondary.tone === 'warning' ? <AlertTriangle size={15} /> : null}
                {actionConfig.secondary.label}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {primaryPack && (
        <section className="rounded-3xl border border-theme-border bg-white p-5 shadow-sm">
          <div className="text-xs font-bold text-theme-muted">快捷操作</div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={() => onOpenPackManagement()}
              className="px-3 py-1.5 rounded-lg bg-theme-sidebar text-theme-text text-[10px] font-bold border border-theme-border hover:bg-theme-border/50 transition-colors"
            >
              编辑续写任务
            </button>
            <button
              onClick={() => onStartStoryboard?.(primaryPack.id)}
              className="px-3 py-1.5 rounded-lg bg-theme-accent text-white text-[10px] font-bold hover:opacity-90 transition-opacity"
            >
              进入分镜准备
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
