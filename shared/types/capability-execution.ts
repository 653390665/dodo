import type { ContextReceipt } from './continuation.js';
import type { ProjectCapabilityProfile } from './preferences.js';
import type {
  EnhancementPackageStep,
  FlowStepCapabilityResolution,
  FlowStepGate,
} from './prompt-assets-governed.js';

export type CapabilityStage = 'planner' | 'writer' | 'critic';

export type CapabilityApplicationStatus =
  'configured' | 'scheduled' | 'run' | 'recommended' | 'unavailable' | 'conflict' | 'skipped';
export interface CapabilityApplicationItemResult {
  readonly capabilityId: string;
  readonly stepId?: string;
  readonly status: CapabilityApplicationStatus;
  readonly reason?: string;
}
export interface CapabilityPackageStep extends Omit<EnhancementPackageStep, 'id' | 'dependsOn'> {
  readonly stepId: EnhancementPackageStep['id'];
  readonly dependsOn?: readonly string[];
}
export interface CapabilityApplicationResult {
  readonly applied: boolean;
  readonly idempotent: boolean;
  readonly databaseGeneration: number;
  readonly items: readonly CapabilityApplicationItemResult[];
  readonly profile?: ProjectCapabilityProfile;
}

export function isCapabilityApplicationResult(
  value: unknown
): value is CapabilityApplicationResult {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.applied !== 'boolean' ||
    typeof item.idempotent !== 'boolean' ||
    typeof item.databaseGeneration !== 'number' ||
    !Array.isArray(item.items)
  )
    return false;
  return item.items.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const row = entry as Record<string, unknown>;
    return (
      typeof row.capabilityId === 'string' &&
      (row.stepId === undefined || typeof row.stepId === 'string') &&
      [
        'configured',
        'scheduled',
        'run',
        'recommended',
        'unavailable',
        'conflict',
        'skipped',
      ].includes(String(row.status))
    );
  });
}
export interface ExecutionCanon {
  readonly novelId: string;
  readonly styleAnchors: readonly string[];
  readonly pack: Readonly<{
    id: string;
    status: 'draft' | 'approved';
    context: string;
    receipt: Readonly<ContextReceipt>;
    styleProfile: Readonly<Record<string, unknown>>;
  }> | null;
}
export interface ExecutionFlowStep {
  readonly activeFlowId: string;
  readonly currentStep: string;
  readonly name: string;
  readonly input: string;
  readonly output: string;
  readonly stage: CapabilityStage | null;
  /**
   * 阶段来源（批次 B「步骤阶段语义化」）：`declared` = 步骤自己声明；`asset-fallback` = 未声明时
   * 回退关联资产的 stage（同时记 `stageWarning`）；`none` = 无阶段（无声明也无资产 stage，或声明非法）。
   */
  readonly stageSource?: 'declared' | 'asset-fallback' | 'none';
  /** 阶段诊断（FLOW_STEP_STAGE_UNDECLARED / FLOW_STEP_STAGE_INVALID）。 */
  readonly stageWarning?: string;
  /**
   * 步骤可用性（批次 B「空壳链路清账」）：`asset` = 资产正文可用；`guidance` = 目录显式声明的
   * 「仅引导」（资产是引用壳，作者自备素材完成本步）；`unavailable` = 无可用正文且未声明（诊断态）。
   */
  readonly availability?: 'asset' | 'guidance' | 'unavailable';
  /** 目录声明的「仅引导」标记（`availability === 'guidance'` 时为 true）。 */
  readonly guidanceOnly?: boolean;
  /** 可用性诊断（FLOW_STEP_GUIDANCE_UNDECLARED_SHELL / FLOW_STEP_GUIDANCE_WITH_RUNNABLE_ASSET）。 */
  readonly guidanceWarning?: string;
  readonly assetId: string;
  /** 步骤质量门声明（null = 未声明）：提示词与界面展示同源，见 shared/lib/flow-step-gate.ts。 */
  readonly gate: FlowStepGate | null;
  readonly prompt: string;
  readonly warning?: string;
  /**
   * 步骤卡片槽位解析结果（批次 B「步骤卡片槽位」）：挂卡成功时按阶段给出卡片正文块，
   * 未挂卡/解析失败时缺省 —— 注入点回退 `stage === 声明阶段 ? prompt : undefined` 旧路径。
   */
  readonly stagePrompts?: Readonly<Partial<Record<CapabilityStage, string>>>;
  /** 步骤声明的卡片 ID（缺省 = 槽位未挂卡或未声明）。 */
  readonly cardId?: string;
  /** 卡片声明角色。 */
  readonly cardRole?: string;
  /** 卡片正文进入的阶段（归一化后）。 */
  readonly cardStages?: readonly CapabilityStage[];
  /** 槽位诊断（FLOW_STEP_CARD_*；空槽不产生诊断）。 */
  readonly cardWarning?: string;
  /**
   * 步骤能力引用解析结果（Plan 262 C5）：本步可触发一次的可执行工具卡元数据。
   * **不进提示词正文**（与 cardRef / assetId 的文本注入路径无关），供界面运行入口与执行回执展示。
   */
  readonly capabilityRef?: FlowStepCapabilityResolution;
  /** 能力引用诊断（FLOW_STEP_CAPABILITY_*；未声明能力引用时不产生）。 */
  readonly capabilityWarning?: string;
}
export interface ExecutionRoleSkills {
  readonly planner: readonly RoleSkillSnapshot[];
  readonly writer: readonly RoleSkillSnapshot[];
  readonly critic: readonly RoleSkillSnapshot[];
}
export interface RoleSkillSnapshot {
  readonly stage: CapabilityStage;
  readonly version: number;
  readonly rules: Readonly<Record<string, unknown>>;
}
export interface ExecutionOverlay {
  readonly id: string;
  readonly version: string | number;
  readonly source: string;
  readonly position: 'project-main' | 'project-support' | 'chapter';
  readonly type: string;
  readonly stages: readonly CapabilityStage[];
  readonly prompt: string;
  readonly dimensionOwners: Readonly<Record<string, string>>;
  readonly resolvedRules: Readonly<Record<string, unknown>>;
  readonly lineage: Readonly<Record<string, unknown>>;
}
export interface ExecutionGuardrail {
  readonly id: string;
  readonly stage: CapabilityStage;
  readonly prompt: string;
}
export interface ExecutionTechnique {
  readonly id: string;
  readonly stage: CapabilityStage;
  readonly version: string;
  readonly prompt: string;
  readonly outputArtifact?: string;
}
export interface ExecutionTechniques {
  readonly planner: readonly ExecutionTechnique[];
  readonly writer: readonly ExecutionTechnique[];
  readonly critic: readonly ExecutionTechnique[];
}
export interface ExecutionSkillStack {
  readonly mainCard: ExecutionOverlay | null;
  readonly projectSupportCards: readonly ExecutionOverlay[];
  readonly chapterCards: readonly ExecutionOverlay[];
  readonly effectiveCards: readonly ExecutionOverlay[];
}

/** Canonical runtime ownership for deconstruction cards. */
export const CARD_STAGE_MAP = {
  'worldview-card': ['planner'],
  'character-card': ['planner'],
  'hook-card': ['planner'],
  'conflict-card': ['planner'],
  'style-card': ['writer'],
  'pacing-card': ['planner', 'writer'],
  'platform-card': ['planner', 'writer'],
} as const satisfies Record<string, readonly CapabilityStage[]>;

export interface ExecutionSnapshot {
  readonly novelId: string;
  readonly chapterId?: string;
  readonly databaseGeneration?: number;
  readonly capabilityRefs?: readonly string[];
  readonly resolvedAtGeneration?: number;
  readonly canon: ExecutionCanon;
  readonly flowStep: ExecutionFlowStep | null;
  readonly roleSkills: ExecutionRoleSkills;
  readonly overlays: readonly ExecutionOverlay[];
  readonly guardrails: readonly ExecutionGuardrail[];
  readonly techniques: ExecutionTechniques;
  readonly skillStack: ExecutionSkillStack;
  readonly stageSkills: ExecutionRoleSkills;
  readonly stagePrompts: Readonly<{ planner: string; writer: string; critic: string }>;
  readonly writingStyleSummary: string;
  readonly writingStyleFingerprint: string;
}

export type ProjectExecutionContract = ExecutionSnapshot;
