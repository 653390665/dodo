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

export type DeconstructionCardType =
  | 'worldview-card'
  | 'character-card'
  | 'pacing-card'
  | 'hook-card'
  | 'conflict-card'
  | 'style-card'
  | 'platform-card';

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
  deconstructionCardType?: DeconstructionCardType;
  executionScore?: number;
  accessTier?: 'free' | 'paid'; // 卡片访问等级：free (免费版可用), paid (仅专业版可用)
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
  mainSkillId?: string;
  supportSkillId?: string;
  retainedTraits?: string[];
  absorbedTraits?: string[];
  risks?: string[];
  deconstructionCardType?: DeconstructionCardType;
  executionScore?: number;
  accessTier?: 'free' | 'paid'; // 融合卡片访问等级：free | paid
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

export type CardSourceKind =
  | 'ai-generated'
  | 'book-extracted'
  | 'user-uploaded'
  | 'manual'
  | 'fused';

export interface StorySkillRecommendation {
  skillId: string;
  skillName: string;
  score: number;
  reason: string;
}

