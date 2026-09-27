/**
 * 创作链路审计（批次 B「步骤阶段语义化」口径）：每条 flow 的每一步，
 * 其**声明阶段**（step.stage）与输出语义类是否一致、资产是否可运行/是否壳卡。
 *
 * 关键变化：阶段不再读资产 stage（旧口径 25 writer / 5 planner），
 * 而是读步骤声明，并用 stageDistributionOfFlows 自校验「打印分布 == 逐条声明计数」。
 */
import { SKILL_SERIES_FLOWS, PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';
import {
  resolveFlowStepStage,
  stageClassForFlowOutput,
  stageDistributionOfFlows,
  stageForFlowOutput,
} from '../shared/lib/flow-step-stage.js';
import { isShellTemplatePrompt } from '../shared/lib/prompt-shell.js';
import {
  resolveFlowStepAvailability,
  runnableStepRatio,
  summarizeFlowStepAvailabilities,
  type FlowStepAvailabilityResolution,
} from '../shared/lib/flow-step-guidance.js';

const ASSET_STAGE_MAP: Record<string, string> = {
  discovery: 'planner',
  foundation: 'planner',
  planning: 'planner',
  drafting: 'writer',
  polish: 'writer',
  review: 'critic',
};

let totalSteps = 0;
let shellSteps = 0;
const availabilities: FlowStepAvailabilityResolution[] = [];
/** 每链路可用性：可运行 / 仅引导 / 不可用（回写规格 §2.2 用）。 */
const perFlow: Record<string, { asset: number; guidance: number; unavailable: number }> = {};
const declaredGuidance: string[] = [];
const shellStepIds: string[] = [];
const printed: Record<'planner' | 'writer' | 'critic', number> = { planner: 0, writer: 0, critic: 0 };

for (const flow of SKILL_SERIES_FLOWS) {
  console.log(`\n===== ${flow.id} | ${flow.name} | ${flow.steps.length} 步 =====`);
  const counts = { asset: 0, guidance: 0, unavailable: 0 };
  for (const step of flow.steps) {
    totalSteps += 1;
    const asset = PROMPT_GOVERNANCE_CATALOG.find((item) => item.id === step.assetId);
    const runnable = Boolean(
      asset?.isRuntimeReady && asset.runtimeStatus === 'active' && asset.sanitizationStatus === 'runtime-ready'
    );
    const shell = isShellTemplatePrompt(asset?.template);
    const availability = resolveFlowStepAvailability({
      guidanceOnly: step.guidanceOnly,
      assetRunnable: runnable,
      assetIsShell: shell,
    });
    availabilities.push(availability);
    counts[availability.availability] += 1;
    if (shell) {
      shellSteps += 1;
      shellStepIds.push(step.id);
    }
    if (availability.declared) declaredGuidance.push(step.id);
    const assetStage = asset ? (ASSET_STAGE_MAP[asset.stage] || '?') : '-';
    const status = availability.availability.toUpperCase() + (shell ? '/SHELL' : '');
    const resolution = resolveFlowStepStage(step, { assetStage: null });
    const declared = resolution.stage ?? '-';
    if (resolution.stage) printed[resolution.stage] += 1;
    const stageClass = stageClassForFlowOutput(step.output);
    const semantic = stageForFlowOutput(step.output) ?? '-';
    const drift = declared === semantic ? '' : `  <== 与语义类(${stageClass})不一致`;
    const availabilityNote = availability.declared
      ? ' [仅引导]'
      : availability.warnings.length > 0
        ? ` [${availability.warnings.join(',')}]`
        : '';
    console.log(
      `  ${String(step.stepNumber).padStart(2)}. ${step.name.slice(0, 16).padEnd(18)} asset=${step.assetId.padEnd(12)}` +
        ` declared=${String(declared).padEnd(7)} semantic=${String(semantic).padEnd(7)} assetStage=${assetStage.padEnd(7)} ${status}` +
        (step.navigateTo ? ` ->${step.navigateTo}` : '') +
        availabilityNote +
        (step.cardRef ? ` card=${step.cardRef.cardId ?? '(空槽)'}@${step.cardRef.stages.join('+')}` : '') +
        drift
    );
  }
  perFlow[flow.id] = counts;
}

const dist = stageDistributionOfFlows(SKILL_SERIES_FLOWS);
const availabilitySummary = summarizeFlowStepAvailabilities(availabilities);
const declaredGuidanceSet = [...declaredGuidance].sort();
const shellSet = [...shellStepIds].sort();

console.log('\n===== 汇总（声明口径） =====');
console.log(
  '总步骤:', totalSteps,
  '| 可运行:', availabilitySummary.asset,
  '| 仅引导:', availabilitySummary.guidance,
  '| 不可用:', availabilitySummary.unavailable,
  '| 壳卡:', shellSteps
);
console.log(
  '可运行步骤占比:', `${runnableStepRatio(availabilitySummary)}%`,
  '（验收①取「每条链路显式标注」分支；若 ≥80% 则可用占比分支）'
);
console.log('逐链路可用性:', JSON.stringify(perFlow));
console.log('声明 guidanceOnly 数:', declaredGuidance.length, '| 检测到壳卡数:', shellSteps);
console.log(
  '静默壳（壳但未声明 guidanceOnly）:',
  declaredGuidanceSet.length === shellSet.length && declaredGuidanceSet.every((id, i) => id === shellSet[i])
    ? 'PASS(0)'
    : `FAIL declared=${JSON.stringify(declaredGuidanceSet)} shell=${JSON.stringify(shellSet)}`
);
for (const flow of SKILL_SERIES_FLOWS) {
  const counts = perFlow[flow.id];
  const declaredCount = flow.steps.filter((step) => step.guidanceOnly === true).length;
  const ok = counts.guidance === declaredCount && counts.asset + counts.guidance + counts.unavailable === flow.steps.length;
  console.log(
    `  链路 ${flow.id}: 可运行 ${counts.asset} / 仅引导 ${counts.guidance}（声明 ${declaredCount}）/ 不可用 ${counts.unavailable}`,
    ok ? '' : '<== 不一致'
  );
}
console.log('流程数:', SKILL_SERIES_FLOWS.length, '| 平均步数:', (totalSteps / SKILL_SERIES_FLOWS.length).toFixed(1));
console.log(
  '阶段分布（声明）: planner', dist.byStage.planner,
  '| writer', dist.byStage.writer,
  '| critic', dist.byStage.critic,
  '| 未声明回退:', dist.fallback,
  '| 非法声明:', dist.invalid
);
console.log('语义类分布:', JSON.stringify(dist.byClass));
console.log('声明 vs 直方图一致:', JSON.stringify(printed) === JSON.stringify(dist.byStage) ? 'PASS' : `FAIL printed=${JSON.stringify(printed)}`);
console.log('语义一致性(声明==语义类):', dist.semanticMismatches.length === 0 ? 'PASS(0 不一致)' : `FAIL ${JSON.stringify(dist.semanticMismatches)}`);
console.log('未知输出（无语义映射）:', dist.unknownOutputs.length === 0 ? 'PASS(0)' : JSON.stringify(dist.unknownOutputs));
console.log('未声明步骤:', dist.undeclaredSteps.length === 0 ? 'PASS(0)' : JSON.stringify(dist.undeclaredSteps));
