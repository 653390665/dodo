export type CreativeArtifactKind =
  | 'world'
  | 'character'
  | 'master-outline'
  | 'volume-outline'
  | 'chapter-outline'
  | 'scene-beats'
  | 'narrative-promise';

export type CreativeArtifactStatus = 'candidate' | 'active' | 'archived';

export interface CreativeArtifactRef {
  kind: CreativeArtifactKind;
  id: string;
  version: number;
}

export interface OutlineNode {
  id: string;
  parentNodeId?: string;
  type: 'premise' | 'conflict' | 'turn' | 'climax' | 'resolution' | 'character-arc' | 'foreshadowing';
  title: string;
  intent: string;
  order: number;
  characterIds: string[];
  foreshadowingIds: string[];
}

export interface StructuredOutlineCore {
  schemaVersion: 1;
  nodes: OutlineNode[];
}

export interface StructuredWorldCore {
  schemaVersion: 1;
  hardRules: Array<{ id: string; statement: string }>;
  powerConstraints: Array<{ id: string; statement: string; cost?: string }>;
  prohibitions: Array<{ id: string; statement: string }>;
  factionConstraints: Array<{ id: string; factionId: string; statement: string }>;
}

export interface CharacterCore {
  schemaVersion: 1;
  desire: string;
  externalGoal: string;
  internalNeed: string;
  fear: string;
  woundOrFalseBelief: string;
  strengths: string[];
  flaws: string[];
  contradictions: string[];
  speechPattern: string;
  habitualActions: string[];
  decisionPattern: string;
  relationshipTensions: Array<{ characterId: string; tension: string }>;
  arc: { start: string; turns: string[]; target: string };
  immutableFacts: string[];
}

export type ArtifactOperation = 'diagnose' | 'generate' | 'restructure' | 'optimize' | 'validate';

export interface ArtifactDiff {
  changed: boolean;
  fields: Array<{ path: string; before?: unknown; after?: unknown; kind: 'added' | 'removed' | 'changed' }>;
}

export interface ArtifactImpactReport {
  downstream: CreativeArtifactRef[];
  reviewRequired: CreativeArtifactRef[];
  affectedEntities?: Array<{
    kind: 'relationship' | 'narrative-promise';
    id: string;
    reviewRequired: boolean;
  }>;
  manuscriptConflict: boolean;
  reasons: string[];
}

export type ChapterCompletionGate =
  | 'drafting'
  | 'review-required'
  | 'needs-action'
  | 'ready'
  | 'accepted-risk';

export interface ArtifactCandidate<T = unknown> {
  id: string;
  novelId: string;
  target: CreativeArtifactRef;
  operation: ArtifactOperation;
  goal: string;
  baseFingerprint: string;
  sourceCapabilityVersions: Array<{ capabilityId: string; version: string }>;
  proposedCore: T;
  proposedContent?: string;
  diff: ArtifactDiff;
  impactReport: ArtifactImpactReport;
  status: 'pending' | 'accepted' | 'rejected' | 'stale';
}

export type CapabilityUsageMode = 'single-run' | 'persistent-rule' | 'flow-step';

export interface ArtifactCapabilityContract {
  artifactKinds: CreativeArtifactKind[];
  operations: ArtifactOperation[];
  allowedScopes: Array<'project' | 'volume' | 'chapter' | 'selection' | 'single-run'>;
  requiredInputs: CreativeArtifactKind[];
  output: 'diagnostic' | 'artifact-candidate' | 'transform-preview' | 'configuration';
  canonEffect: 'none' | 'candidate-only';
}

export interface CreationFlowStep {
  id: string;
  capabilityId: string;
  capabilityVersion: string;
  dependsOn: string[];
  requiredArtifactKinds: CreativeArtifactKind[];
  producedArtifactKind: CreativeArtifactKind;
  required: boolean;
}

export interface CapabilityCompositionConflict {
  field: string;
  capabilityIds: string[];
  rules: string[];
  resolution: 'author-choice-required' | 'compatible';
}
