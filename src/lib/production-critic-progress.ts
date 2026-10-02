import type { ProductionRunSSEEvent } from './production-client';

export type ProductionCriticProgress = Extract<
  ProductionRunSSEEvent,
  { type: 'model_critic_progress' }
>;

const FALLBACK_RETRY_REASON = '转换策略';

/**
 * Plan 275（R-273-2）：critic 阶段在状态条上此前只有一条静态文案
 * （`AI critic 进行中...`），而这一段从 6 s（low 档）到 200 s+（high 档或解析重试）都可能，
 * 作者无从判断是在推进还是已经卡住。这里把管线侧上报的
 * 轮次 / 阶段 / 重试原因 / 分数转成作者可读的状态文案。
 */
export function criticProgressMessage(update: ProductionCriticProgress): string {
  const round = `第 ${update.attempt} 轮`;
  switch (update.stage) {
    case 'start':
      return `AI 正在审稿（${round}）…`;
    case 'retry':
      return `AI 审稿重试中（${round}）：${update.reason ?? FALLBACK_RETRY_REASON}…`;
    case 'parsed':
      return update.score === undefined
        ? `AI 审稿出分（${round}），正在整理结论…`
        : `AI 审稿出分（${round}）：${update.score}/100，正在整理结论…`;
    case 'unknown':
    default:
      return `AI 审稿未能定分（${round}）：${update.reason ?? '证据不足'}…`;
  }
}
