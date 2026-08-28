export type ChapterFactKind = 'character' | 'item' | 'timeline' | 'location' | 'power' | 'narrative-promise';
export type ChapterFactDecision = 'accepted' | 'rejected' | 'pending';

export interface ChapterFactTarget {
  kind: ChapterFactKind;
  id: string;
  label: string;
}

export interface ChapterFact {
  id: string;
  kind: ChapterFactKind;
  action: 'create' | 'update' | 'append';
  title: string;
  evidence: string;
  evidenceSpan: { start: number; end: number };
  target: ChapterFactTarget;
  proposedValue: Record<string, unknown>;
  destructive: boolean;
  ambiguous: boolean;
  selectable: boolean;
}

export interface ChapterFactCandidate {
  id: string;
  novelId: string;
  runId: string;
  manuscript: { contentHash: string; evidence: string };
  databaseGeneration: number;
  storyMemoryFingerprint: string;
  facts: ChapterFact[];
  status: 'pending';
}

export interface ChapterFactApplyInput {
  novelId: string;
  runId: string;
  databaseGeneration: number;
  candidateId: string;
  manuscriptContentHash: string;
  storyMemoryFingerprint: string;
  selectedFactIds?: string[];
  rejectedFactIds?: string[];
  factDecisions?: Partial<Record<string, ChapterFactDecision>>;
}

export interface ChapterFactApplyResult {
  candidate: ChapterFactCandidate;
  factStatuses: Record<string, ChapterFactDecision>;
}
