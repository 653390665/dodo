import type { ProductionRunSSEEvent } from './production-client';

export type ProductionRunBudgetEvent = Extract<
  ProductionRunSSEEvent,
  { type: 'model_run_budget' }
>;

const STAGE_HINTS: Record<string, string> = {
  'before-retry': '停止再次重写',
  'gate-fail': '停止再次重写',
  'local-repair': '停止局部修复',
  'critic-retry': '停止审稿重试',
};

function minutesOf(ms: number): number {
  return Math.max(0.1, Math.round((ms / 60_000) * 10) / 10);
}

/** Plan 283（R-282-3）：run 到时间上限时给作者一行实话——停在哪、交付的是什么。 */
export function runBudgetMessage(update: ProductionRunBudgetEvent): string {
  const hint = STAGE_HINTS[update.stage] || '停止继续重试';
  return `已到本次生成的时间上限（${minutesOf(update.elapsedMs)} 分钟 / 上限 ${minutesOf(update.budgetMs)} 分钟）：${hint}，交付当前最好的一稿供你审阅。`;
}
