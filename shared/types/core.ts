import type { StoryIdeaCard, StoryPlanningInput } from './novel.js';
import type { StorySkillRecommendation } from './skills.js';
export interface PacingData {
  chapterId: string;
  chapterTitle: string;
  order: number;
  wordCount: number;
  tensionScore: number;
  payoffCount: number;
  emotionLabel: string;
  suggestion?: string;
}

export type SetupTaskKey =
  | 'protagonist'
  | 'core-conflict'
  | 'world-rules'
  | 'relationship'
  | 'chapter-one'
  | 'tone'
  | 'story-scale';

export type SetupTaskStatus = 'empty' | 'drafted' | 'confirmed' | 'needs-work';

export interface SetupTaskDraft {
  key: SetupTaskKey;
  title: string;
  summary: string;
  status: SetupTaskStatus;
  source: 'story-card' | 'ai-refine' | 'user-edit';
}

export interface OnboardingDraftState {
  ideaSeed: string;
  planning: StoryPlanningInput;
  cards: StoryIdeaCard[];
  selectedCardId?: string;
  setupTasks: SetupTaskDraft[];
  acceptedSkillIds: string[];
  recommendedSkills: StorySkillRecommendation[];
  acceptedRecommendedSkills: boolean;
  warnings?: string[];
  source?: 'model' | 'fallback';
  storyCardJobId?: string;
}

export interface AssistantLaunchContext {
  source: 'workspace' | 'editor' | 'world';
  novelId: string;
  novelTitle: string;
  novelSummary?: string;
  chapterId?: string;
  chapterTitle?: string;
  sceneBeats?: string;
  currentExcerpt?: string;
  selectedText?: string;
  selectionStart?: number;
  selectionEnd?: number;
  intent?: string;
  worldRules?: string;
  globalOutline?: string;
  charactersContext?: string;
  foreshadowingsContext?: string;
  timelineContext?: string;
  capabilitySnapshot?: string;
}

export type AssistantMode = 'general' | 'bible';

/** 可安全放入状态快照的助手表面上下文。 */
export interface AssistantSurfaceContext {
  surface: 'welcome' | 'library' | 'workspace' | 'editor' | 'world' | 'ai';
  novelId?: string;
  continuationPackId?: string;
  chapterId?: string;
  worldBibleTab?: string;
  selectedEntityId?: string;
  intent?: string;
  selectedText?: string;
  selectionStart?: number;
  selectionEnd?: number;
}

export type AssistantSuggestionKind = 'prose' | 'scene-beat' | 'setting' | 'fragment';
export type AssistantActionIntent =
  | 'draft-prose'
  | 'plan-scene'
  | 'build-setting'
  | 'plan-structure'
  | 'save-fragment'
  | 'start-creation';
export interface AssistantActionPlan {
  intent: AssistantActionIntent;
  label: string;
  userRequest: string;
  novelId?: string;
  chapterId?: string;
  scope: 'project' | 'chapter' | 'single-run';
  executionMode: 'single-run' | 'workflow' | 'memory';
  outputArtifact: 'chapter-prose-candidate' | 'scene-beat-candidate' | 'world-candidate' | 'outline-candidate' | 'idea-fragment' | 'creation-flow';
  recommendedCapabilityId?: string;
  requiresReview: boolean;
}
export type AssistantPrimaryAction =
  | 'replace-selection'
  | 'append-content'
  | 'append-scene-beat'
  | 'extract-setting'
  | 'save-fragment';

export type AgentTab =
  | 'context'
  | 'bible'
  | 'planning'
  | 'quality'
  | 'trace'
  | 'skills'
  | 'versions'
  | 'copilot-home'
  | 'production'
  | 'outline'
  | 'pacing'
  | 'foreshadowing'
  | 'ideas';

export interface SniffedEntities {
  activeExisting: string[];
  newEntities: Array<{
    name: string;
    type: string;
    context: string;
  }>;
}

export type ViewType = 'welcome' | 'library' | 'editor' | 'world' | 'workspace' | 'ai' | 'skills' | 'factory' | 'continuation-import';
export type WorkspaceFocus = 'editor' | 'world';
export type WorkspaceNavKey = 'workspace-editor' | 'workspace-world';
export type CopilotStage =
  | 'missing-setup'
  | 'missing-beats'
  | 'ready-to-draft'
  | 'pending-audit'
  | 'pending-polish'
  | 'needs-memory-sync';

export type CopilotActionKey =
  | 'fill-setup'
  | 'generate-beats'
  | 'generate-draft'
  | 'run-audit'
  | 'run-polish'
  | 'sync-memory'
  | 'open-skills'
  | 'open-bible'
  | 'open-quality'
  | 'open-planning';

export interface CopilotAction {
  key: CopilotActionKey;
  label: string;
}

export interface CopilotReasons {
  ready: string[];
  missing: string[];
  risks: string[];
}

export interface CopilotSuggestion {
  stage: CopilotStage;
  stageLabel: string;
  title: string;
  summary: string;
  primaryAction: CopilotAction;
  secondaryActions: CopilotAction[];
  reasons: CopilotReasons;
}

export type PromptTemplateKey =
  | 'inspirationSystem'
  | 'storyCards'
  | 'setupTaskRefine'
  | 'editorAgent'
  | 'manualAudit'
  | 'orchestrateWriter'
  | 'orchestrateCritic'
  | 'extractSkill'
  | 'generateOutline';

export type PromptStage =
  | 'discovery'
  | 'foundation'
  | 'planning'
  | 'drafting'
  | 'polish'
  | 'review';

export type PromptOutputShape = 'json' | 'markdown' | 'plain-text';

export interface PromptAsset {
  id: PromptTemplateKey;
  title: string;
  stage: PromptStage;
  goal: string;
  inputs: string[];
  template: string;
  outputShape: PromptOutputShape;
  riskNotes: string[];
  successSignal: string;
}
