import type { CardSourceKind } from './skills.js';
export type ContinuationImportTargetMode = 'existing' | 'new';

export interface ContinuationEditorLaunchState {
  approvedPackId: string;
  launchToken: number;
  shouldOpenProductionPanel: true;
  prefillIntent?: string;
  source: 'continuation-import' | 'world-overview' | 'storyboard' | 'cockpit-planning' | 'cockpit-production' | 'cockpit-resume' | 'cockpit-audit' | 'cockpit-polish';
  targetChapterId?: string;
}

export type ContinuationImportLaunchState = ContinuationEditorLaunchState;

export type ContinuationSourceKind =
  | 'world' | 'outline' | 'characters' | 'manuscript' | 'style_sample' | 'other';

export type ContinuationFactPriority = 'hard' | 'soft';

export interface ContinuationSourceDocument {
  id: string; packId: string; filename: string;
  kind: ContinuationSourceKind; text: string; excerpt: string; createdAt: number;
}

export interface ContinuationCanonFact {
  id: string; priority: ContinuationFactPriority;
  category: 'world' | 'character' | 'plot' | 'timeline' | 'relationship' | 'style';
  text: string; sourceDocumentId?: string; evidence: string;
}

export interface ContinuationCharacterState {
  name: string; role: string; currentGoal: string; emotionalState: string;
  secrets: string[]; relationshipNotes: string[]; evidence: string;
}

export interface ContinuationPlotState {
  currentTimeline: string; latestScene: string; unresolvedHooks: string[];
  immediateConflict: string; nextLikelyMove: string;
}

export interface ContinuationStyleProfile {
  pov: string; tense: string; pacing: string; dialogueDensity: string;
  proseTraits: string[]; avoidTraits: string[]; sampleEvidence: string;
}

export interface ContinuationContradiction {
  id: string; severity: 'low' | 'medium' | 'high';
  summary: string; conflictingEvidence: string[]; suggestedResolution: string;
}

export interface ContinuationPack {
  id: string; novelId: string; title: string; status: 'draft' | 'approved';
  sourceDocuments: ContinuationSourceDocument[];
  canonFacts: ContinuationCanonFact[];
  characterStates: ContinuationCharacterState[];
  plotState: ContinuationPlotState;
  styleProfile: ContinuationStyleProfile;
  contradictions: ContinuationContradiction[];
  continuationTask: string; createdAt: number; updatedAt: number;
  sourceMap?: ContinuationSourceMap;
  readingQuestions?: ContinuationReadingQuestion[];
  continuationGaps?: ContinuationGap[];
  sourceBadge?: CardSourceKind;
}

export interface ContinuationSourceMap {
  sections: Array<{
    title: string;
    summary: string;
    sourceIds: string[];
  }>;
  keyConflicts: string[];
}

export interface ContinuationReadingQuestion {
  id: string;
  question: string;
  context: string;
  category: 'world' | 'character' | 'plot' | 'style' | 'continuity';
}

export interface ContinuationGap {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  suggestedDirection: string;
  relatedFacts: string[];
}

export type ContinuationOverviewStateKind = 'empty' | 'draft' | 'ready' | 'risk';

export interface ContinuationOverviewState {
  kind: ContinuationOverviewStateKind;
  primaryPack: ContinuationPack | null;
  draftPack: ContinuationPack | null;
  approvedPack: ContinuationPack | null;
  contradictionCount: number;
  readingQuestionCount: number;
  continuationGapCount: number;
  highlightWarnings: string[];
}

declare global {
  interface Window {
    inkflow?: {
      setTitle: (title: string) => void;
      getAuthToken?: () => Promise<string>;
      saveConfig?: (config: unknown) => Promise<{ success: boolean; error?: string }>;
      onPrepareClose?: (callback: () => void | Promise<void>) => () => void;
      requestClose?: () => void;
      readyToClose?: () => void;
    };
  }
}
