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

export type SkillDimension =
  | 'style'
  | 'character'
  | 'world'
  | 'power'
  | 'plot'
  | 'pacing';

export interface SkillCompositionProfile {
  styleWeight: number;
  characterWeight: number;
  worldWeight: number;
  powerWeight: number;
  plotWeight: number;
  pacingWeight: number;
  conflictTags: string[];
  blendHints: string[];
}

export interface SkillUsageStats {
  mountedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  revisedCount: number;
  averageFitScore: number;
}

export interface MountedSkillLoadoutItem {
  slot: number;
  skillId: string;
  weight: number;
  lockedDimensions: SkillDimension[];
}

export interface Character {
  id: string;
  novelId: string;
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting' | 'extra';
  summary: string;
  traits: string[];
  bio: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface Location {
  id: string;
  novelId: string;
  name: string;
  description: string;
  region: string;
  createdAt: number;
  updatedAt: number;
}

export interface Item {
  id: string;
  novelId: string;
  name: string;
  description: string;
  type: string;
  createdAt: number;
  updatedAt: number;
}

export interface Faction {
  id: string;
  novelId: string;
  name: string;
  description: string;
  leader: string;
  territory: string;
  createdAt: number;
  updatedAt: number;
}

export interface PowerLevel {
  id: string;
  novelId: string;
  name: string;
  description: string;
  tier: number;
  characteristics: string;
  createdAt: number;
  updatedAt: number;
}

export interface TimelineEvent {
  id: string;
  novelId: string;
  title: string;
  description: string;
  timestamp: string;
  statusTag?: string;
  order: number;
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

export interface Skill {
  id: string;
  name: string;
  description: string;
  style: string;
  pacing: string;
  vocabulary?: string[];
  sentenceStructure?: string;
  imagery?: string[];
  bannedWords?: string[];
  fewShots?: string[];
  characterTraits?: string;
  worldBuilding?: string;
  foreshadowing?: string;
  plotPattern?: string;
  corePatterns?: string[];
  bannedElements?: string[];
  stabilityScore: number;
  evaluationFeedback: string;
  version: number;
  parentSkillId?: string;
  lineageRootId?: string;
  primaryDimension?: SkillDimension;
  dimensionTags?: SkillDimension[];
  compositionProfile?: SkillCompositionProfile;
  fusionMeta?: SkillFusionMeta;
  usageStats?: SkillUsageStats;
  feedbackScore?: number;
  deckGroupId?: string;
  evidenceCoverage?: SkillEvidenceCoverage;
  evidenceMoments?: BookEvidenceStage[];
  methodChain?: SkillMethodChain;
  whyThisSkillWorks?: string;
  sourceBadge?: CardSourceKind;
  createdAt: number;
  updatedAt?: number;
}

export type BookEvidenceStage = 'opening' | 'early-mid' | 'mid' | 'late-mid' | 'climax';

export type SkillEvidenceCoverage =
  | 'full-book-stable'
  | 'opening-heavy'
  | 'mid-book-heavy'
  | 'climax-heavy'
  | 'weak-evidence';

export interface BookEvidenceSegment {
  id: string;
  stage: BookEvidenceStage;
  label: string;
  excerpt: string;
  startRatio: number;
  endRatio: number;
}

export interface SkillSignalEvidence {
  dimension: SkillDimension;
  weight: number;
  evidence: string;
}

export interface SegmentSkillEvidence {
  stage: BookEvidenceStage;
  skillSignals: SkillSignalEvidence[];
}

export interface SkillDeckCard extends Skill {
  evidenceCoverage: SkillEvidenceCoverage;
  evidenceMoments: BookEvidenceStage[];
}

export interface AggregatedSkillDeck {
  mainCard: SkillDeckCard;
  supportCards: SkillDeckCard[];
  methodChain?: SkillMethodChain;
}

export interface SkillMethodQA {
  question: string;
  answer: string;
  formalization: string;
  steps: string[];
  boundary: string;
}

export interface SkillMethodChain {
  items: SkillMethodQA[];
  summary: string;
}

export interface SkillFusionMeta {
  mainSkillId: string;
  supportSkillId: string;
  retainedTraits: string[];
  absorbedTraits: string[];
  risks: string[];
}

export interface SkillFusionExplanation {
  retained: string[];
  absorbed: string[];
  risks: string[];
}

export interface SkillUsageRecord {
  id: string;
  novelId: string;
  chapterId?: string;
  mountedSkillIds: string[];
  fitScore: number;
  auditScore?: number;
  userAction: 'accepted' | 'revised' | 'rejected';
  notes?: string;
  createdAt: number;
}
export interface IdeaFragment {
  id: string;
  novelId?: string;
  content: string;
  type: 'scene' | 'dialogue' | 'character' | 'plot_hook' | 'world';
  status: 'raw' | 'expanded' | 'converted';
  aiExpansion?: string;
  targetChapterId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Foreshadowing {
  id: string;
  novelId: string;
  title: string;
  description: string;
  status: 'planted' | 'hinted' | 'payoff';
  plantedChapterId?: string;
  payoffChapterId?: string;
  relatedCharacterIds: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoryEntitySnapshot {
  id: string;
  name: string;
  kind: 'character' | 'location' | 'item' | 'faction' | 'powerLevel';
  summary: string;
  statusNote: string;
  updatedAt?: number;
}

export interface StoryStateLedger {
  novelId: string;
  title: string;
  summary: string;
  worldRules: string;
  globalOutline: string;
  recentChapters: Array<{
    id: string;
    title: string;
    order: number;
    sceneBeats: string;
    summary: string;
  }>;
  entityStates: {
    characters: StoryEntitySnapshot[];
    locations: StoryEntitySnapshot[];
    items: StoryEntitySnapshot[];
    factions: StoryEntitySnapshot[];
    powerLevels: StoryEntitySnapshot[];
  };
  timeline: Array<{
    id: string;
    title: string;
    timestamp: string;
    description: string;
    statusTag?: string;
    order: number;
  }>;
  openForeshadowings: Array<{
    id: string;
    title: string;
    description: string;
    status: Foreshadowing['status'];
    plantedChapterId?: string;
    payoffChapterId?: string;
    notes?: string;
  }>;
}

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

export interface StoryCardStarterSeeds {
  worldSeed: string;
  relationshipSeed: string;
  chapterOneSeed: string;
}

export interface StoryCardSkillSignal {
  tone: string;
  conflictType: string;
  worldWeight: number;
  characterWeight: number;
  pacingPreference: 'tight' | 'balanced' | 'slow-burn';
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

export type CardSourceKind =
  | 'ai-generated'
  | 'book-extracted'
  | 'user-uploaded'
  | 'manual'
  | 'fused';

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

export interface StorySkillRecommendation {
  skillId: string;
  skillName: string;
  score: number;
  reason: string;
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
}

export type AssistantSuggestionKind = 'prose' | 'scene-beat' | 'setting' | 'fragment';
export type AssistantPrimaryAction =
  | 'replace-selection'
  | 'append-content'
  | 'append-scene-beat'
  | 'extract-setting'
  | 'save-fragment';

export type AgentTab =
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

export type ViewType = 'welcome' | 'library' | 'editor' | 'world' | 'workspace' | 'ai' | 'skills' | 'factory';
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

export interface ProjectPreferenceWeights {
  styleWeight: number;
  characterWeight: number;
  worldWeight: number;
  plotWeight: number;
  pacingWeight: number;
}

export interface ProjectPreferenceProfile {
  tags: string[];
  weights: ProjectPreferenceWeights;
  acceptedDimensions: SkillDimension[];
  rejectedDimensions: SkillDimension[];
  notes: string[];
  evidenceCount: number;
}

export interface FitScoreExplanation {
  summary: string;
  highlights: string[];
  risks: string[];
}

export type PreferenceFeedbackAction = 'more-like-me' | 'not-for-me' | 'project-only';

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

declare global {
  interface Window {
    inkflow?: {
      setTitle: (title: string) => void;
    };
  }
}
