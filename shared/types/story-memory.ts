import type { CreativeArtifactRef } from './creative-artifacts.js';

export interface StoryMemorySourceRef {
  kind: StoryMemoryNodeKind;
  id: string;
  version?: number;
}

export interface NarrativePromisePlan {
  intent: string;
  revealConstraint?: string;
  plannedPlantRange?: { from: number; to: number };
  plannedHintRanges: Array<{ from: number; to: number }>;
  plannedPayoffRange?: { from: number; to: number };
  sourceOutlineNodeIds: string[];
}

export interface NarrativePromiseEvidence {
  chapterId: string;
  action: 'plant' | 'hint' | 'payoff';
  quote: string;
  location?: string;
  confirmedAt: number;
}

export interface NarrativePromiseCore {
  schemaVersion: 1;
  plan: NarrativePromisePlan;
  evidence: NarrativePromiseEvidence[];
}

export type StoryMemoryNodeKind =
  | 'character'
  | 'location'
  | 'item'
  | 'faction'
  | 'chapter'
  | 'timeline-event'
  | 'narrative-promise';

export type StoryMemoryEdgeKind =
  | 'relates-to'
  | 'appears-in'
  | 'holds'
  | 'occurs-in'
  | 'planted-in'
  | 'hinted-in'
  | 'paid-off-in'
  | 'supports-outline-node';

export interface StoryMemoryNode {
  id: string;
  novelId: string;
  kind: StoryMemoryNodeKind;
  source: CreativeArtifactRef | StoryMemorySourceRef;
  label: string;
}

export interface StoryMemoryEdge {
  id: string;
  novelId: string;
  kind: StoryMemoryEdgeKind;
  source: StoryMemoryNode['id'];
  target: StoryMemoryNode['id'];
  sourceArtifact?: CreativeArtifactRef;
}

export interface StoryMemoryProjection {
  novelId: string;
  nodes: StoryMemoryNode[];
  edges: StoryMemoryEdge[];
  generatedAt: number;
}
