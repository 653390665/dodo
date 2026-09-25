/**
 * 步骤可用性判定（批次 B「空壳链路清账」，规格 docs/specs/capability-flow-graph-consolidation.md §5.4）。
 *
 * 背景：治理货架里有一批复「引用壳」资产 —— `isRuntimeReady=true` / `runtimeStatus='active'` /
 * `sanitizationStatus='runtime-ready'`（治理面判定为可运行），正文却只有
 * 「[XX体] 围绕 【某提示词】执行」式转投语，**没有实际写作指导**（见 shared/lib/prompt-shell.ts）。
 * 链路步骤引用这些资产时形成「幻觉可运行」：提示词与界面都像有内容，实际注入等于噪音
 * （Plan 261 修复⑬起壳资产不再注入步骤 prompt）。本模块把这件事**显式化**：
 *
 * - `guidanceOnly: true`（目录声明）→ `availability='guidance'`：本步不指望资产生成正文，
 *   由作者用自己的模型/素材完成；UI 必须给出可见提示（GUIDANCE_ONLY_HINT）。
 * - 未声明却是壳 → `availability='unavailable'` + `FLOW_STEP_GUIDANCE_UNDECLARED_SHELL`
 *   （**静默幻觉**：仓内必须为 0，由 flow-audit 与测试守门）。
 * - 声明了「仅引导」但资产其实有可运行正文 → 仍按声明走 `guidance`，但记
 *   `FLOW_STEP_GUIDANCE_WITH_RUNNABLE_ASSET`（过度声明，诊断可见，供作者复核）。
 *
 * 纯函数、无 IO：资产侧事实（runnable / shell）由调用方判定后传入（运行时用治理字段 +
 * `isShellTemplatePrompt`，测试用夹具）。
 */
export const FLOW_STEP_AVAILABILITIES = ['asset', 'guidance', 'unavailable'] as const;
export type FlowStepAvailability = (typeof FLOW_STEP_AVAILABILITIES)[number];

export const FLOW_STEP_GUIDANCE_WARNINGS = [
  'FLOW_STEP_GUIDANCE_UNDECLARED_SHELL',
  'FLOW_STEP_GUIDANCE_WITH_RUNNABLE_ASSET',
] as const;
export type FlowStepGuidanceWarning = (typeof FLOW_STEP_GUIDANCE_WARNINGS)[number];

/** 界面上「仅引导」的标签文案（唯一的展示文案源）。 */
export const GUIDANCE_ONLY_LABEL = '仅引导';
/** 界面上「仅引导」的解释文案（链路详情 + 推进页共用）。 */
export const GUIDANCE_ONLY_HINT =
  '本步为「仅引导」：关联资产只有引用壳、没有可用正文，请用你自己的模型或素材完成这一步。';

export interface FlowStepAvailabilityInput {
  /** 目录里本步是否显式声明「仅引导」。 */
  readonly guidanceOnly?: boolean;
  /** 资产是否满足治理可运行门（isRuntimeReady && runtimeStatus==='active' && sanitizationStatus==='runtime-ready'）。 */
  readonly assetRunnable?: boolean;
  /** 资产正文是否为引用壳（isShellTemplatePrompt）。 */
  readonly assetIsShell?: boolean;
}

export interface FlowStepAvailabilityResolution {
  readonly availability: FlowStepAvailability;
  readonly declared: boolean;
  readonly warnings: readonly FlowStepGuidanceWarning[];
}

export function resolveFlowStepAvailability(
  input: FlowStepAvailabilityInput
): FlowStepAvailabilityResolution {
  const declared = input.guidanceOnly === true;
  const assetRunnable = input.assetRunnable === true;
  const assetIsShell = input.assetIsShell === true;
  const warnings: FlowStepGuidanceWarning[] = [];
  if (declared) {
    if (assetRunnable && !assetIsShell) {
      warnings.push('FLOW_STEP_GUIDANCE_WITH_RUNNABLE_ASSET');
    }
    return { availability: 'guidance', declared, warnings };
  }
  if (assetIsShell) {
    // 静默壳：既没有可用正文，也没有声明 → 必须被看见（仓内应为 0）。
    warnings.push('FLOW_STEP_GUIDANCE_UNDECLARED_SHELL');
    return { availability: 'unavailable', declared, warnings };
  }
  if (assetRunnable) {
    return { availability: 'asset', declared, warnings };
  }
  return { availability: 'unavailable', declared, warnings };
}

export interface FlowStepAvailabilitySummary {
  readonly asset: number;
  readonly guidance: number;
  readonly unavailable: number;
  readonly total: number;
}

/** 汇总可用性计数（flow-audit 与测试共用同一算法，避免两处各写一份）。 */
export function summarizeFlowStepAvailabilities(
  resolutions: readonly FlowStepAvailabilityResolution[]
): FlowStepAvailabilitySummary {
  const summary = { asset: 0, guidance: 0, unavailable: 0, total: resolutions.length };
  for (const item of resolutions) {
    if (item.availability === 'asset') summary.asset += 1;
    else if (item.availability === 'guidance') summary.guidance += 1;
    else summary.unavailable += 1;
  }
  return summary;
}

/** 可运行步骤占比（0-100，保留一位小数；空集合 → 0）。 */
export function runnableStepRatio(summary: FlowStepAvailabilitySummary): number {
  if (summary.total === 0) return 0;
  return Math.round(((summary.asset / summary.total) * 1000)) / 10;
}
