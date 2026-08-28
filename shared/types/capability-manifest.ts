import type { CapabilityStage } from './capability-execution.js';
import type { DeconstructionCardType } from './skills.js';
import type { ArtifactCapabilityContract, CapabilityUsageMode } from './creative-artifacts.js';

export const CAPABILITY_KINDS = ['flow', 'technique', 'skill-card', 'diagnostic', 'utility', 'guardrail'] as const;
export const LEGACY_CAPABILITY_KINDS = ['role-skill', 'overlay'] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number] | (typeof LEGACY_CAPABILITY_KINDS)[number];
export type CapabilityAction =
  | 'activate-flow'
  | 'use-technique'
  | 'add-to-stack'
  | 'run-diagnostic'
  | 'run-utility'
  | 'automatic'
  | 'preview-transform'
  | 'assign-role'
  | 'use-this-time';
export type CapabilityScope = 'project' | 'chapter' | 'single-run' | 'system';

export interface CapabilityLaunchState {
  readonly novelId: string;
  readonly launchToken: number;
  readonly action: 'use-technique' | 'use-project-technique' | 'add-to-stack' | 'run-diagnostic' | 'run-utility' | 'use-overlay' | 'open-loadout';
  readonly assetId: string;
  readonly targetChapterId?: string;
  readonly sessionCardIds?: readonly string[];
}

export interface WorldCapabilityLaunchIntent {
  readonly novelId: string;
  readonly launchToken: number;
  readonly capabilityId: string;
  readonly artifactKind: 'world' | 'character';
  readonly targetEntityId?: string;
  readonly seedText?: string;
}

export interface CapabilityManifestEntry {
  readonly id: string;
  readonly version: string;
  readonly kind: CapabilityKind;
  readonly stages: readonly CapabilityStage[];
  readonly input: 'text' | 'outline-source';
  readonly output: 'configuration' | 'diagnostic' | 'transform-preview' | 'outline-candidate' | 'artifact-candidate';
  readonly action: CapabilityAction;
  readonly allowedScopes: readonly CapabilityScope[];
  /** Legacy compatibility projection. New code must use allowedScopes. */
  readonly persistence?: 'project' | 'chapter-session' | 'single-run' | 'system';
  readonly sideEffect: 'configuration' | 'none' | 'preview-only';
  readonly runtimeStatus: 'active' | 'unavailable' | 'deprecated';
  readonly sourceType: 'built-in' | 'plaza' | 'licensed';
  /** Required for governed skill-card assets; omitted for other capability kinds. */
  readonly deconstructionCardType?: DeconstructionCardType;
  readonly outputArtifact?: string;
  readonly displayStages?: readonly ('creative-setup' | 'active-drafting' | 'style-polish' | 'commercial-sign')[];
  /** Optional lifecycle and provenance metadata. */
  readonly trigger?: 'manual' | 'automatic' | 'recommended' | 'event' | string;
  readonly credentialType?: 'none' | 'api-key' | 'licensed' | 'user-authorized' | string;
  readonly revocationStatus?: 'active' | 'revoked' | 'pending' | string;
  readonly lineage?: Readonly<Record<string, unknown>>;
  readonly sourceVersion?: string;
  /** Explicit lifecycle semantics, independent of the artifact operation. */
  readonly usageModes?: readonly CapabilityUsageMode[];
  /** Catalog-projected contract required before a capability can transform an artifact. */
  readonly artifactContract?: Readonly<ArtifactCapabilityContract>;
}

export type CapabilityManifest = CapabilityManifestEntry;
