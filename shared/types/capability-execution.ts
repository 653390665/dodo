
import type { ContextReceipt } from './continuation.js';
import type { ProjectCapabilityProfile } from './preferences.js';
import type { EnhancementPackageStep } from './prompt-assets-governed.js';

export type CapabilityStage = 'planner' | 'writer' | 'critic';

export type CapabilityApplicationStatus = 'configured' | 'scheduled' | 'run' | 'recommended' | 'unavailable' | 'conflict' | 'skipped';
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

export function isCapabilityApplicationResult(value: unknown): value is CapabilityApplicationResult {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (typeof item.applied !== 'boolean' || typeof item.idempotent !== 'boolean' || typeof item.databaseGeneration !== 'number' || !Array.isArray(item.items)) return false;
  return item.items.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const row = entry as Record<string, unknown>;
    return typeof row.capabilityId === 'string'
      && (row.stepId === undefined || typeof row.stepId === 'string')
      && ['configured', 'scheduled', 'run', 'recommended', 'unavailable', 'conflict', 'skipped'].includes(String(row.status));
  });
}
export interface ExecutionCanon {
  readonly novelId: string;
  readonly styleAnchors: readonly string[];
  readonly pack: Readonly<{ id: string; status: 'draft' | 'approved'; context: string; receipt: Readonly<ContextReceipt>; styleProfile: Readonly<Record<string, unknown>> }> | null;
}
export interface ExecutionFlowStep {
  readonly activeFlowId: string;
  readonly currentStep: string;
  readonly name: string;
  readonly input: string;
  readonly output: string;
  readonly stage: CapabilityStage | null;
  readonly assetId: string;
  readonly qualityGate: string;
  readonly prompt: string;
  readonly warning?: string;
}
export interface ExecutionRoleSkills {
  readonly planner: readonly RoleSkillSnapshot[];
  readonly writer: readonly RoleSkillSnapshot[];
  readonly critic: readonly RoleSkillSnapshot[];
}
export interface RoleSkillSnapshot { readonly stage: CapabilityStage; readonly version: number; readonly rules: Readonly<Record<string, unknown>>; }
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
  readonly sessionCards: readonly ExecutionOverlay[];
  readonly stagePrompts: Readonly<{ planner: string; writer: string; critic: string }>;
  readonly writingStyleSummary: string;
  readonly writingStyleFingerprint: string;
}

export type ProjectExecutionContract = ExecutionSnapshot;
