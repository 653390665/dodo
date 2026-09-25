/**
 * 步骤阶段语义化（批次 B「步骤阶段语义化」，规格 docs/specs/capability-flow-graph-consolidation.md §5.3）。
 *
 * 问题（规格 §2.2 诊断）：链路步骤此前**没有自己的阶段声明**，注入阶段由关联资产的 `stage` 推断
 * （`polish`/`drafting` → writer、`planning` → planner、`review` → critic）。结果是 30 步里 25 步落在
 * writer ——「灵感/设定/大纲/分镜」类步骤的契约文本进了写手 prompt，而 assetId 的真实用途（大纲生成器、
 * 平台评分卡）与阶段错位。
 *
 * 本模块是**步骤目标阶段**的单一事实源（纯函数、无 IO）：
 * - `SkillSeriesFlowStep.stage` 显式声明（声明优先，且不因资产 stage 相同/不同而改变）；
 * - 未声明 → 回退资产 stage 并记 `FLOW_STEP_STAGE_UNDECLARED`（诊断可见，**不静默丢 prompt**）；
 * - 非法声明 → `FLOW_STEP_STAGE_INVALID` + 阶段为 null（不猜）；
 * - `stageClassForFlowOutput` / `stageForFlowOutput` 给出**输出语义类**（规划/正文/审稿），
 *   供审计脚本与测试核对「声明是否与步骤语义一致」——注意它与 `FlowStepGate.kind` 是两件事：
 *   注入阶段回答「这步的契约给哪个阶段的模型看」，质量门回答「这步能不能推进」。
 */
import type { CapabilityStage } from '../types/capability-execution.js';
import type { SkillSeriesFlow, SkillSeriesFlowStep } from '../types/prompt-assets-governed.js';

/** 阶段 canonical 顺序（与 shared/lib/flow-step-card-slot.ts 的 CAPABILITY_STAGES 同源语义）。 */
export const FLOW_STEP_STAGES = ['planner', 'writer', 'critic'] as const;

export const FLOW_STEP_STAGE_SOURCES = ['declared', 'asset-fallback', 'none'] as const;
export type FlowStepStageSource = (typeof FLOW_STEP_STAGE_SOURCES)[number];

export const FLOW_STEP_STAGE_WARNINGS = [
  /** 步骤未声明 stage，阶段来自关联资产（旧口径），需要补声明。 */
  'FLOW_STEP_STAGE_UNDECLARED',
  /** 步骤声明的 stage 不是 planner/writer/critic。 */
  'FLOW_STEP_STAGE_INVALID',
] as const;
export type FlowStepStageWarning = (typeof FLOW_STEP_STAGE_WARNINGS)[number];

/** 步骤语义类：规划（大纲/设定/灵感）、正文（写作/改稿）、审稿（诊断/校验）。 */
export const FLOW_STEP_STAGE_CLASSES = ['planning', 'drafting', 'review'] as const;
export type FlowStepStageClass = (typeof FLOW_STEP_STAGE_CLASSES)[number];

/**
 * 输出特征 → 语义类。键 = 链路目录里出现的全部 `step.output` 取值（六条链路 30 步）。
 * 例外说明：`chapters-final`（番茄第 5 步「正文精修与美学润色」）虽叫 final，动作是**改稿** → drafting；
 * `chapters-final-checked`（完读与节奏自检）是**校验** → review；`chapters-with-highlights`
 * （核心爽点黄金排布，动作是评估显露节奏）→ review；`polished-draft`（基础去 AI 腔的成稿动作）→ drafting。
 */
export const FLOW_OUTPUT_STAGE_CLASS: Readonly<Record<string, FlowStepStageClass>> = {
  // 规划类
  idea: 'planning',
  'hook-idea': 'planning',
  setting: 'planning',
  'world-setting': 'planning',
  'setting-outline': 'planning',
  characters: 'planning',
  outline: 'planning',
  'chapters-outline': 'planning',
  'climax-outline': 'planning',
  'scene-outline': 'planning',
  'detailed-outline': 'planning',
  title: 'planning',
  'deconstruction-cards': 'planning',
  'deconstruction-cards-hook': 'planning',
  // 正文类
  draft: 'drafting',
  'polished-draft': 'drafting',
  'chapter-content': 'drafting',
  'chapter-draft': 'drafting',
  'chapter-polished': 'drafting',
  'chapters-with-hooks': 'drafting',
  'chapters-final': 'drafting',
  // 审稿类
  'diagnostic-report': 'review',
  'chapters-with-highlights': 'review',
  'chapters-final-checked': 'review',
};

const STAGE_BY_CLASS: Readonly<Record<FlowStepStageClass, CapabilityStage>> = {
  planning: 'planner',
  drafting: 'writer',
  review: 'critic',
};

export function stageClassForFlowOutput(output: string): FlowStepStageClass | null {
  return FLOW_OUTPUT_STAGE_CLASS[output] ?? null;
}

/** 输出语义类对应的目标阶段（未知输出 → null，不猜）。 */
export function stageForFlowOutput(output: string): CapabilityStage | null {
  const stageClass = stageClassForFlowOutput(output);
  return stageClass ? STAGE_BY_CLASS[stageClass] : null;
}

export interface FlowStepStageResolution {
  readonly stage: CapabilityStage | null;
  readonly source: FlowStepStageSource;
  readonly warnings: readonly FlowStepStageWarning[];
  /** 声明值（含非法值原样回显，便于诊断）。 */
  readonly declared?: string;
}

/**
 * 解析步骤目标阶段：**声明优先**；未声明回退关联资产 stage（诊断 `UNDECLARED`）；非法声明不猜（`INVALID`）。
 */
export function resolveFlowStepStage(
  step: Pick<SkillSeriesFlowStep, 'stage'>,
  options: { assetStage?: CapabilityStage | null } = {}
): FlowStepStageResolution {
  const declared = typeof step.stage === 'string' ? step.stage.trim() : '';
  if (declared) {
    if ((FLOW_STEP_STAGES as readonly string[]).includes(declared)) {
      return { stage: declared as CapabilityStage, source: 'declared', warnings: [], declared };
    }
    return {
      stage: null,
      source: 'none',
      warnings: ['FLOW_STEP_STAGE_INVALID'],
      declared,
    };
  }
  const assetStage = options.assetStage ?? null;
  if (assetStage) {
    return { stage: assetStage, source: 'asset-fallback', warnings: ['FLOW_STEP_STAGE_UNDECLARED'] };
  }
  return { stage: null, source: 'none', warnings: ['FLOW_STEP_STAGE_UNDECLARED'] };
}

export interface FlowStepStageMismatch {
  readonly flowId: string;
  readonly stepId: string;
  readonly output: string;
  readonly declared: CapabilityStage | null;
  readonly semantic: CapabilityStage;
  readonly declaredClass: FlowStepStageClass | null;
}

export interface FlowStepStageDistribution {
  readonly flows: number;
  readonly steps: number;
  readonly declared: number;
  readonly fallback: number;
  readonly undeclared: number;
  readonly invalid: number;
  readonly byStage: Readonly<Record<CapabilityStage, number>>;
  readonly byClass: Readonly<Record<FlowStepStageClass, number>>;
  readonly undeclaredSteps: readonly { flowId: string; stepId: string }[];
  readonly unknownOutputs: readonly { flowId: string; stepId: string; output: string }[];
  /** 声明阶段与输出语义类不一致（审计可见，不阻断）。 */
  readonly semanticMismatches: readonly FlowStepStageMismatch[];
}

/**
 * 统计链路步骤的阶段分布：以**声明**为准（未声明回退资产 stage 并计数），
 * 并用输出语义类交叉核对（`semanticMismatches` 必须为空才算「分布与声明一致」）。
 */
export function stageDistributionOfFlows(
  flows: readonly SkillSeriesFlow[]
): FlowStepStageDistribution {
  const byStage: Record<CapabilityStage, number> = { planner: 0, writer: 0, critic: 0 };
  const byClass: Record<FlowStepStageClass, number> = { planning: 0, drafting: 0, review: 0 };
  const undeclaredSteps: { flowId: string; stepId: string }[] = [];
  const unknownOutputs: { flowId: string; stepId: string; output: string }[] = [];
  const semanticMismatches: FlowStepStageMismatch[] = [];
  let steps = 0;
  let declared = 0;
  let fallback = 0;
  let invalid = 0;

  for (const flow of flows) {
    for (const step of flow.steps) {
      steps += 1;
      const resolution = resolveFlowStepStage(step);
      if (resolution.source === 'declared') declared += 1;
      else if (resolution.source === 'asset-fallback') fallback += 1;
      if (resolution.warnings.includes('FLOW_STEP_STAGE_INVALID')) invalid += 1;
      if (resolution.warnings.includes('FLOW_STEP_STAGE_UNDECLARED'))
        undeclaredSteps.push({ flowId: flow.id, stepId: step.id });
      if (resolution.stage) byStage[resolution.stage] += 1;

      const declaredClass = stageClassForFlowOutput(step.output);
      if (!declaredClass) {
        unknownOutputs.push({ flowId: flow.id, stepId: step.id, output: step.output });
        continue;
      }
      byClass[declaredClass] += 1;
      const semantic = STAGE_BY_CLASS[declaredClass];
      if (resolution.stage !== semantic) {
        semanticMismatches.push({
          flowId: flow.id,
          stepId: step.id,
          output: step.output,
          declared: resolution.stage,
          semantic,
          declaredClass,
        });
      }
    }
  }

  return {
    flows: flows.length,
    steps,
    declared,
    fallback,
    undeclared: undeclaredSteps.length,
    invalid,
    byStage,
    byClass,
    undeclaredSteps,
    unknownOutputs,
    semanticMismatches,
  };
}
