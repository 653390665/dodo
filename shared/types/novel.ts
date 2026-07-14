import type { ProjectPreferenceProfile } from './preferences.js';
import type { CardSourceKind, MountedSkillLoadoutItem, StoryCardSkillSignal, StoryCardStarterSeeds } from './skills.js';
import type { Foreshadowing } from './world.js';
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
  }>;
  itemUpdates: Array<{
    itemId: string;
    descriptionAppend: string;
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
  }>;
  foreshadowingsToCreate: Array<{
    title: string;
    description: string;
    status: Foreshadowing['status'];
    plantedChapterId?: string;
  }>;
}

export interface ContinuityReport {
  score: number;
  issues: ContinuityIssue[];
  proposedPatch: ProposedLedgerPatch;
  continuationPackId?: string;
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
  createdAt: number;
  updatedAt: number;
}

export interface StoryPlanningInput {
  expectedWordCount: number;
  pacingPreference: 'tight' | 'balanced' | 'slow-burn';
  storyFocus: 'plot' | 'character' | 'world';
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
