import React from 'react';
import type { Chapter, ContinuationPack, ContextReceipt as ContextReceiptData } from '../../../shared/types';

interface ContextReceiptProps {
  currentChapter: Chapter | null;
  selectedContinuationPack: ContinuationPack | null;
  activeSkillsCount: number;
  bibleEntitiesCount: number;
  receipt?: ContextReceiptData;
}

export function ContextReceipt({
  currentChapter,
  selectedContinuationPack,
  activeSkillsCount,
  bibleEntitiesCount,
  receipt,
}: ContextReceiptProps) {
  const isActual = receipt?.actual === true;
  return (
    <details className="bg-theme-sidebar/40 rounded-xl border border-theme-border/60 p-3.5 mb-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[10px] font-bold text-theme-muted uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/50 focus-visible:ring-offset-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActual ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="truncate">
            {isActual ? '生成上下文已就绪' : receipt ? '生成上下文摘要' : '上下文来源未知'}
          </span>
        </span>
        <span className="shrink-0 font-medium normal-case tracking-normal text-theme-muted">
          查看详情
        </span>
      </summary>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        {receipt ? (
          <div className="col-span-full rounded-lg border border-theme-border/60 px-2 py-1.5 text-theme-muted">
            {receipt.actual ? '本次运行上下文凭证' : '选择摘要（非实际运行凭证）'} · {receipt.injectedChars} 字符 · {receipt.itemCount} 条{receipt.truncated ? ' · 已截断' : ''}
            {!receipt.actual && ' · 来源版本未知'}
            {receipt.sources?.map((source) => <div key={source.id}>{source.label} · {source.sha256 ? source.sha256.slice(0, 8) : 'legacy/unknown'} · {source.chars} 字符 · {source.itemCount} 条{source.truncated ? ' · 已截断' : ''}</div>)}
          </div>
        ) : (
          <div className="col-span-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-800">
            尚无实际运行凭证 · 来源版本未知
          </div>
        )}
        <div className="flex min-w-0 items-center gap-1.5 text-theme-muted">
          <div className="w-1.5 h-1.5 shrink-0 rounded-full bg-theme-accent" />
          <span className="min-w-0 truncate">
            目标章节: <strong className="text-theme-text">{currentChapter?.title || '未选择'}</strong>
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 text-theme-muted">
          <div className="w-1.5 h-1.5 shrink-0 rounded-full bg-amber-500" />
          <span className="min-w-0 truncate">
            资料包: <strong className="text-theme-text">{selectedContinuationPack?.title || '未绑定'}</strong>
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 text-theme-muted">
          <div className="w-1.5 h-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span className="min-w-0 truncate">
            能力卡: <strong className="text-theme-text">{activeSkillsCount}/3 个</strong>
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 text-theme-muted">
          <div className="w-1.5 h-1.5 shrink-0 rounded-full bg-indigo-500" />
          <span className="min-w-0 truncate">
            世界观条目: <strong className="text-theme-text">{bibleEntitiesCount} 条</strong>
          </span>
        </div>
      </div>
    </details>
  );
}
