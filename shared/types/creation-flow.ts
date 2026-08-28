import type { CreativeArtifactRef } from './creative-artifacts.js';
import type { CreationFlowStep } from './creative-artifacts.js';

export type { CreationFlowStep } from './creative-artifacts.js';

export interface CreationFlowDefinition {
  id: string;
  version: string;
  steps: CreationFlowStep[];
}

export interface CreationFlowDefinitionDraft {
  id: string;
  version: string;
  steps: Array<Omit<CreationFlowStep, 'capabilityVersion'>>;
}

export interface CreationFlowSession {
  id: string;
  novelId: string;
  definition: CreationFlowDefinition;
  currentStepId?: string;
  acceptedOutputRefs: CreativeArtifactRef[];
  status: 'active' | 'completed';
  databaseGeneration: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreationFlowReadiness {
  ready: boolean;
  missingArtifactKinds: Array<CreationFlowStep['producedArtifactKind']>;
}

export interface CreationFlowMigrationCandidate {
  sessionId: string;
  flowId: string;
  currentDefinition: CreationFlowDefinition;
  proposedDefinition: CreationFlowDefinition;
  changedCapabilities: Array<{
    capabilityId: string;
    fromVersion: string;
    toVersion: string;
  }>;
}
