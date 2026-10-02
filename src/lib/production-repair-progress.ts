import type { ProductionRunSSEEvent } from './production-client';

export type ProductionWriterRepairEvent = Extract<
  ProductionRunSSEEvent,
  { type: 'model_writer_repair' }
>;

/** Plan 277（R-276-3）：把定点修复的读数翻成作者能读的一行状态。 */
export function writerRepairMessage(update: ProductionWriterRepairEvent): string {
  const scope = `第 ${update.round} 轮 · 修补 ${update.applied}/${update.targets} 处`;
  if (update.status === 'passed') {
    return `已局部修好门禁命中的句子（${scope}），继续审稿…`;
  }
  if (update.status === 'residual') {
    const codes = update.residualCodes?.length ? `（${update.residualCodes.join('、')}）` : '';
    return `已局部修好门禁命中的句子（${scope}），仍有软残留${codes}…`;
  }
  return `局部修复未通过门禁（${scope}），转为整章重写…`;
}
