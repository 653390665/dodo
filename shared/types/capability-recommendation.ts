import type { CapabilityManifestEntry } from './capability-manifest.js';
import type { ArtifactOperation, CreativeArtifactKind, CreativeArtifactRef } from './creative-artifacts.js';

export interface CapabilityRecommendationIssue {
  fingerprint: string;
  explanation?: string;
  suggestedFix?: string;
  recommendedCapabilityIds?: readonly string[];
}

export interface CapabilityRecommendationInput {
  issue: CapabilityRecommendationIssue;
  artifactKind: CreativeArtifactKind;
  operation: ArtifactOperation;
  scope: 'project' | 'volume' | 'chapter' | 'selection' | 'single-run';
  artifactVersion: string | number;
  upstreamVersion?: string | number;
  capabilities: readonly CapabilityManifestEntry[];
  availableArtifacts?: readonly CreativeArtifactRef[];
  availablePrerequisites?: readonly string[];
  accessibleCapabilityIds?: readonly string[];
  aiRankedCapabilityIds?: readonly string[];
  dismissedCapabilityIds?: readonly string[];
}

export interface CapabilityRecommendation {
  capabilityId: string;
  manifest: CapabilityManifestEntry;
  reason: string;
  diagnosis?: string;
  expectedArtifactChange?: string;
  usageMode: 'single-run' | 'persistent-rule' | 'flow-step';
}

export interface CapabilityRecommendationResult {
  fingerprint: string;
  context: Pick<CapabilityRecommendationInput, 'issue' | 'artifactKind' | 'operation' | 'scope' | 'artifactVersion' | 'upstreamVersion'>;
  primary?: CapabilityRecommendation;
  alternatives: CapabilityRecommendation[];
  recommendations: CapabilityRecommendation[];
  eligibleCapabilityIds: string[];
}

export interface CapabilityRecommendationDismissal {
  novelId: string;
  databaseGeneration: number;
  fingerprint: string;
  issueFingerprint: string;
  artifactVersion: string | number;
  upstreamVersion?: string | number;
  capabilityId: string;
}
