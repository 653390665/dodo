/**
 * 步骤卡片槽位解析（批次 B「步骤卡片槽位」，规格 docs/specs/capability-flow-graph-consolidation.md §5.1）。
 *
 * 链路步骤（`SkillSeriesFlowStep.cardRef = { role, stages, cardId? }`）声明「哪些阶段挂哪张卡」：
 * - 未声明 cardRef / 槽位未挂卡（无 cardId）→ 返回 null，调用方回退 assetId 旧路径（产物逐字节不变）；
 * - 槽位声明了但不能用（stages 非法 / 卡不在治理目录 / 非 runtime-ready / 壳卡）→ 返回 null + warning，
 *   仍然回退 assetId（失败不阻断写作，但诊断可见）；
 * - 挂卡成功 → `prompt` 为卡片正文，`stages` 为归一化后的声明阶段（canonical 顺序 planner→writer→critic，去重）。
 *
 * 角色：`role` 是步骤声明值；`projectedRole` 由目录投影（有 manifest 走 kind 投影，否则走治理分类投影）。
 * 两者不一致时**仍注入**，只记 `FLOW_STEP_CARD_ROLE_MISMATCH`——避免「声明字段成死参数」，
 * 也不在本小类引入拦截语义（角色语义对注入形态的作用留待「步骤阶段语义化」小类）。
 *
 * 纯函数 + 可注入依赖（findAsset / findManifest / isRejectedTemplate），便于单测不触碰真实目录。
 */
import { cardRoleForGovernedCategory, cardRoleForManifest, type CardRole } from './capability-card-role.js';
import { getCatalogCapabilityManifest } from './capability-manifest-catalog.js';
import { PROMPT_GOVERNANCE_CATALOG } from './prompt-governance-catalog.js';
import { isShellTemplatePrompt } from './prompt-shell.js';
import type { CapabilityStage } from '../types/capability-execution.js';
import type { CapabilityManifestEntry } from '../types/capability-manifest.js';
import type { FlowStepCardRef, GovernedPromptAsset } from '../types/prompt-assets-governed.js';
import { isRuntimeReadyAsset } from './capability-runtime-readiness.js';

/** 阶段 canonical 顺序（归一化顺序 + 运行时校验用；类型侧同名类型见 shared/types/capability-execution.ts）。 */
export const CAPABILITY_STAGES = ['planner', 'writer', 'critic'] as const;

export const FLOW_STEP_CARD_WARNINGS = [
  'FLOW_STEP_CARD_STAGES_INVALID',
  'FLOW_STEP_CARD_UNRESOLVED',
  'FLOW_STEP_CARD_NOT_RUNTIME_READY',
  'FLOW_STEP_CARD_SHELL',
  'FLOW_STEP_CARD_ROLE_MISMATCH',
] as const;
export type FlowStepCardWarning = (typeof FLOW_STEP_CARD_WARNINGS)[number];

export interface FlowStepCardDeps {
  /** 卡片正文来源：治理货架（PROMPT_GOVERNANCE_CATALOG）。 */
  findAsset?: (id: string) => GovernedPromptAsset | undefined;
  /** 角色投影来源：能力清单（可缺省 → 回退治理分类投影）。 */
  findManifest?: (id: string) => CapabilityManifestEntry | undefined;
  /** 壳卡判定（默认 isShellTemplatePrompt）。 */
  isRejectedTemplate?: (template: string | undefined) => boolean;
}

export interface FlowStepCardResolution {
  readonly cardId: string;
  /** 步骤声明角色。 */
  readonly role: CardRole;
  /** 目录投影角色（null = 目录里无对应投影，不视为不一致）。 */
  readonly projectedRole: CardRole | null;
  readonly stages: readonly CapabilityStage[];
  /** 卡片正文（治理货架 template）。 */
  readonly prompt: string;
  readonly warning?: FlowStepCardWarning;
}

export interface FlowStepCardAttempt {
  /** null = 调用方回退 assetId 旧路径。 */
  readonly resolution: FlowStepCardResolution | null;
  readonly warning?: FlowStepCardWarning;
}

export interface FlowStepCardSlotStep {
  readonly cardRef?: FlowStepCardRef;
}

export function resolveFlowStepCard(
  step: FlowStepCardSlotStep,
  deps: FlowStepCardDeps = {}
): FlowStepCardAttempt {
  const findAsset =
    deps.findAsset ?? ((id: string) => PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === id));
  const findManifest = deps.findManifest ?? ((id: string) => getCatalogCapabilityManifest(id));
  const isRejected = deps.isRejectedTemplate ?? isShellTemplatePrompt;

  const ref = step.cardRef;
  if (!ref) return { resolution: null }; // 未声明槽位 → assetId 旧路径，无警告
  const cardId = typeof ref.cardId === 'string' ? ref.cardId.trim() : '';
  if (!cardId) return { resolution: null }; // 槽位已声明但未挂卡（合法空槽）→ assetId 旧路径，无警告

  const rawStages: readonly unknown[] = Array.isArray(ref.stages) ? ref.stages : [];
  const stages = CAPABILITY_STAGES.filter((stage) => rawStages.includes(stage));
  if (stages.length === 0 || stages.length !== rawStages.length) {
    return { resolution: null, warning: 'FLOW_STEP_CARD_STAGES_INVALID' };
  }

  const asset = findAsset(cardId);
  if (!asset) return { resolution: null, warning: 'FLOW_STEP_CARD_UNRESOLVED' };
  if (!isRuntimeReadyAsset(asset)) {
    return { resolution: null, warning: 'FLOW_STEP_CARD_NOT_RUNTIME_READY' };
  }
  const template = asset.template ?? '';
  if (isRejected(template)) return { resolution: null, warning: 'FLOW_STEP_CARD_SHELL' };

  const manifest = findManifest(cardId);
  const projectedRole = manifest
    ? cardRoleForManifest(manifest)
    : cardRoleForGovernedCategory(asset.primaryCategory);
  const warning =
    projectedRole && projectedRole !== ref.role ? 'FLOW_STEP_CARD_ROLE_MISMATCH' : undefined;

  return {
    resolution: {
      cardId,
      role: ref.role,
      projectedRole,
      stages,
      prompt: template,
      ...(warning ? { warning } : {}),
    },
    ...(warning ? { warning } : {}),
  };
}

/** 卡片正文块（与步骤合同一同进入声明阶段的 prompt）。 */
export function renderFlowStepCardBlock(card: FlowStepCardResolution, stepContract: string): string {
  return `${stepContract}\n【步骤卡：${card.cardId}（${card.role}）】\n${card.prompt}`;
}
