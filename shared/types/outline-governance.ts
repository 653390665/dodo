import type { StructuredOutlineCore as BaseStructuredOutlineCore } from './creative-artifacts.js';

export type OutlineArtifactLevel = 'master' | 'volume' | 'chapter';
export type OutlineArtifactSource = 'user' | 'continuation-pack' | 'ai-proposal';
export type OutlineArtifactStatus = 'candidate' | 'active' | 'archived';

export interface SourceCapabilityVersion {
  capabilityId: string;
  version: string;
}

export interface OutlinePromiseAction {
  foreshadowingId: string;
  action: 'plant' | 'hint' | 'payoff';
  chapterRange?: { from: number; to: number };
}

/** Adds planned narrative-promise actions without changing the base outline node contract. */
export interface StructuredOutlineCore extends BaseStructuredOutlineCore {
  promiseActions?: OutlinePromiseAction[];
}

export interface OutlineArtifactScope {
  volumeName?: string;
  chapterStart?: number;
  chapterEnd?: number;
}

export interface OutlineArtifact {
  id: string;
  novelId: string;
  level: OutlineArtifactLevel;
  scope: OutlineArtifactScope;
  content: string;
  source: OutlineArtifactSource;
  status: OutlineArtifactStatus;
  baseFingerprint?: string;
  core?: StructuredOutlineCore;
  version?: number;
  sourceCapabilityVersions?: SourceCapabilityVersion[];
}

export type CanonPatchOperation =
  | { operation: 'create-master-outline'; content: string; core?: StructuredOutlineCore }
  | { operation: 'replace-outline'; targetArtifactId: string; content: string; core?: StructuredOutlineCore }
  | { operation: 'create-scoped-outline'; level: 'volume' | 'chapter'; scope: OutlineArtifactScope; content: string; core?: StructuredOutlineCore };

export interface CanonPatch {
  id: string;
  novelId: string;
  baseFingerprint: string;
  sourceAbilityId?: string;
  sourceCapabilityVersions?: SourceCapabilityVersion[];
  operations: readonly CanonPatchOperation[];
  status: 'pending' | 'accepted' | 'rejected' | 'stale';
}
