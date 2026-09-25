/**
 * 运行时准入判据的唯一事实源（remediation-plan M5② / R5）。
 *
 * 背景：`isRuntimeReady && runtimeStatus === 'active' && sanitizationStatus === 'runtime-ready'`
 * 这组三元判据曾被手抄到十余处前后端代码里；任何一处漂移，未消毒/未就绪的资产就会从侧门进入
 * 渲染投影或写作注入通道。所有"这张卡能不能用"的判定必须走这里，禁止再手抄比较。
 */
export interface RuntimeReadinessFields {
  readonly isRuntimeReady?: boolean | null;
  readonly runtimeStatus?: string | null;
  readonly sanitizationStatus?: string | null;
}

/** 运行时准入：已标注就绪 + 运行时 active + 消毒完成，三者缺一不可。 */
export function isRuntimeReadyAsset(asset: RuntimeReadinessFields | null | undefined): boolean {
  return Boolean(
    asset &&
      asset.isRuntimeReady === true &&
      asset.runtimeStatus === 'active' &&
      asset.sanitizationStatus === 'runtime-ready'
  );
}

/** 只问"消毒面是否已完成"的调用点（准入判据里还嵌套其它条件时使用）。 */
export function hasRuntimeReadySanitization(
  asset: RuntimeReadinessFields | null | undefined
): boolean {
  return asset?.sanitizationStatus === 'runtime-ready';
}
