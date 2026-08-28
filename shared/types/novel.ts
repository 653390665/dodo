import type { ProjectPreferenceProfile } from './preferences.js';
import type { CardSourceKind, MountedSkillLoadoutItem, StoryCardSkillSignal, StoryCardStarterSeeds } from './skills.js';
import type { Foreshadowing } from './world.js';
import type { ChapterCompletionGate } from './creative-artifacts.js';
import type { DraftQualitySemanticReview } from '../lib/quality-contract.js';
export interface Novel {
  id: string;
  title: string;
  authorId: string;
  summary: string;
  coverImage?: string;
  status: 'ongoing' | 'completed' | 'hiatus';
  worldRules?: string; // 规划层：全局世界观设定
  globalOutline?: string; // 规划层：全局大纲
  mountedSkillIds?: string[]; // 挂载的 Skill IDs
  mountedSkillLoadout?: MountedSkillLoadoutItem[];
  projectPreferenceProfile?: ProjectPreferenceProfile;
  createdAt: number;
  updatedAt: number;
}

export interface ChapterVersion {
  id: string;
  chapterId: string;
  content: string;
  wordCount: number;
  author: 'user' | 'writer-agent' | 'editor-agent' | 'auto';
  createdAt: number;
}

export interface Chapter {
  id: string;
  novelId: string;
  volumeName?: string; // 规划层：卷名
  title: string;
  content: string;
  order: number;
  wordCount: number;
  sceneBeats?: string;     // 规划层：场景大纲/细纲
  critique?: string;       // 质量层：AI 评审意见
  createdAt: number;
  updatedAt: number;
  workflowMeta?: ChapterWorkflowMeta;
}

export type ChapterAuditStatus = 'pass' | 'fail' | 'unknown' | 'not_run';
export type ReviewIssueStatus = 'open' | 'previewed' | 'applied' | 'deferred' | 'accepted-risk' | 'rejected' | 'stale';
export type ChapterReviewGate = 'review-required' | 'needs-action' | 'pass' | 'accepted-risk' | 'unknown';
export interface ReviewIssue {
  id: string;
  source: 'chapter-audit' | 'production-audit' | 'utility';
  issueType?: string;
  issueSubtype?: string;
  category?: string;
  severity: 'critical' | 'major' | 'moderate' | 'high' | 'medium' | 'low';
  snippet?: string;
  location?: string;
  explanation: string;
  suggestedFix?: string;
  recommendedCapabilityIds: string[];
  status: ReviewIssueStatus;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  decisionReason?: string;
}
export interface ChapterReviewState {
  schemaVersion: 1;
  contentHash: string;
  issues: ReviewIssue[];
  gate: ChapterReviewGate;
  semanticReview?: DraftQualitySemanticReview;
  lastReviewedAt?: number;
  lastRecheckHash?: string;
}
export interface ChapterWorkflowMeta {
  version: 1;
  lastAudit?: { status: ChapterAuditStatus; contentHash: string; completedAt: number; source: 'model' | 'fallback' };
  reviewState?: ChapterReviewState;
  lastPolish?: { inputHash: string; outputHash: string; completedAt: number };
  capabilityState?: {
    techniqueIds: string[];
    overlayCardIds: string[];
    updatedAt: number;
    /** Runtime scope metadata. Optional for legacy records. */
    novelId?: string;
    databaseGeneration?: number;
    techniqueVersions?: Record<string, string | number>;
    overlayVersions?: Record<string, string | number>;
  };
  completionGate?: ChapterCompletionGate;
  completionContentHash?: string;
  completionDecisionAt?: number;
  factCandidateId?: string;
  factCandidateRunId?: string;
}

export type ChapterMetadata = Omit<Chapter, 'content' | 'sceneBeats' | 'critique'>;

export type ContinuityIssueSeverity = 'low' | 'medium' | 'high';
export type ContinuityIssueCategory =
  | 'character'
  | 'item'
  | 'location'
  | 'power'
  | 'logic'
  | 'timeline'
  | 'foreshadowing';

export interface ContinuityIssue {
  severity: ContinuityIssueSeverity;
  category: ContinuityIssueCategory;
  message: string;
  evidence?: string;
  suggestedFix?: string;
}

export interface ProposedLedgerPatch {
  characterUpdates: Array<{
    characterId: string;
    summaryAppend: string;
    evidenceQuote?: string;
  }>;
  itemUpdates: Array<{
    itemId: string;
    descriptionAppend: string;
    evidenceQuote?: string;
  }>;
  locationUpdates?: Array<{
    locationId: string;
    descriptionAppend: string;
    evidenceQuote?: string;
  }>;
  powerUpdates?: Array<{
    powerLevelId: string;
    descriptionAppend: string;
    evidenceQuote?: string;
  }>;
  foreshadowingUpdates: Array<{
    foreshadowingId: string;
    status: Foreshadowing['status'];
    notesAppend: string;
  }>;
  timelineEventsToCreate: Array<{
    title: string;
    timestamp: string;
    description: string;
    statusTag: string;
    evidenceQuote?: string;
  }>;
  foreshadowingsToCreate: Array<{
    title: string;
    description: string;
    status: Foreshadowing['status'];
    plantedChapterId?: string;
  }>;
  narrativePromiseCandidates?: Array<{
    targetType: 'existing' | 'discovered';
    foreshadowingId?: string;
    title?: string;
    description?: string;
    action: 'plant' | 'hint' | 'payoff';
    evidenceQuote: string;
    location?: string;
  }>;
}

export interface ContinuityReport {
  /** Database generation captured when the production run started. */
  databaseGeneration?: number;
  /** Hash of the target chapter at run creation; used to reject stale applies. */
  targetChapterBaselineHash?: string;
  score?: number;
  issues: ContinuityIssue[];
  proposedPatch: ProposedLedgerPatch;
  continuationPackId?: string;
  auditMeta?: {
    status: 'pass' | 'fail' | 'unknown' | 'not_run';
    source: 'fallback' | 'model';
    score?: number;
  };
  contextReceipt?: import('./continuation.js').ContextReceipt;
  executionReceipt?: ProductionExecutionReceipt;
}

export interface ProductionExecutionReceipt {
  version: 1;
  capabilityRefs: string[];
  writingStyleFingerprint: string;
  resolvedAtGeneration?: number;
  contextDimensions: Array<'world' | 'character' | 'foreshadowing'>;
  contextRefs: Array<{
    dimension: 'world' | 'character' | 'location' | 'item' | 'faction' | 'powerLevel' | 'foreshadowing';
    id: string;
    version: number;
  }>;
}

export type ChapterProductionRunStatus =
  | 'running'
  | 'review_required'
  | 'applied'
  | 'rejected'
  | 'failed';

export interface ChapterProductionRun {
  id: string;
  novelId: string;
  targetChapterId?: string;
  status: ChapterProductionRunStatus;
  userIntent: string;
  sceneBeats: string;
  draftContent: string;
  styleAudit: string;
  continuityReport: ContinuityReport;
  errorMessage?: string;
  reviewVersionId?: string;
  reviewVersionHash?: string;
  reviewVersionSource?: ChapterProductionRunVersionSource;
  createdAt: number;
  updatedAt: number;
}

export type ChapterProductionRunVersionSource = 'fallback' | 'model';
export interface ChapterProductionRunVersion {
  id: string; runId: string; novelId: string; targetChapterId?: string;
  source: ChapterProductionRunVersionSource; sceneBeats: string; draftContent: string;
  styleAudit: string; continuityReport: ContinuityReport; contentHash: string; createdAt: number;
}

export interface StoryPlanningInput {
  expectedWordCount: number;
  pacingPreference: 'tight' | 'balanced' | 'slow-burn';
  storyFocus: 'plot' | 'character' | 'world';
  styleAnchors?: string[];
}

export interface StoryPlanningFit {
  recommendedLength: string;
  recommendedFocus: string;
  recommendedPacing: string;
  reason: string;
}

export interface StoryIdeaCard {
  id: string;
  hook: string;
  protagonist: string;
  coreConflict: string;
  tone: string;
  whyItWorks: string;
  starterSeeds: StoryCardStarterSeeds;
  planningFit: StoryPlanningFit;
  riskNote: string;
  mixTags: string[];
  signals: StoryCardSkillSignal;
  sourceBadge?: CardSourceKind;
}

export interface Scene {
  id: string;
  novelId: string;
  chapterId: string;
  title: string;
  content: string;
  order: number;
  wordCount: number;
  pov?: string;
  status: 'draft' | 'revision' | 'done';
  timelinePosition?: string;
  createdAt: number;
  updatedAt: number;
}
