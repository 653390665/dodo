
export interface ChapterDecision {
  chapterId: string;
  timestamp: number;
  action: 'accept_draft' | 'reject_draft' | 'manual_rewrite' | 'edit_then_accept';
  instruction?: string;
  acceptedPortions?: string[];
  rejectedReason?: string;
}

import type { StoryContract } from './onboarding.js';
import type { SkillDimension } from './skills.js';
export interface ProjectPreferenceWeights {
  styleWeight: number;
  characterWeight: number;
  worldWeight: number;
  plotWeight: number;
  pacingWeight: number;
}

export interface QuotaLimits {
  extractSkillMax?: number;      // 拆书萃取最大免费次数
  extractSkillCount?: number;    // 当前已用拆书萃取次数
  generateProseMax?: number;     // 正文生成最大免费次数
  generateProseCount?: number;   // 当前已用正文生成次数
  advancedAuditMax?: number;     // 智能审稿/高级诊断最大免费次数
  advancedAuditCount?: number;   // 当前已用智能审稿/高级诊断次数
}

export interface ProjectPreferenceProfile {
  [key: string]: unknown;
  tags: string[];
  weights: ProjectPreferenceWeights;
  acceptedDimensions: SkillDimension[];
  rejectedDimensions: SkillDimension[];
  notes: string[];
  evidenceCount: number;
  contract?: StoryContract;
  decisions?: ChapterDecision[];
  commercialMode?: 'free' | 'paid' | 'strict'; // 商业化版本模式 (free | paid | strict)
  quotaLimits?: QuotaLimits; // 配额限制与当前计数
  activeSeriesId?: string; // 选中的黄金创作流程包 ID
  writingStyleConfirmation?: WritingStyleConfirmation;
  skillLoadoutSchemaVersion?: 2;
  capabilityModelVersion?: 3;
  capabilityProfile?: ProjectCapabilityProfile;
}

export interface ProjectSkillDeck {
  mainCardId?: string;
  supportCardIds: string[];
  updatedAt: number;
}

export interface CapabilityMembership {
  sourceId: string;
  sourceVersion: string;
  persistedSkillId?: string;
  sourceType: 'built-in' | 'plaza' | 'licensed' | 'book-extracted';
}

export interface ProjectCapabilityProfile {
  version: 3;
  activeFlowId?: string;
  projectSkillDeck: ProjectSkillDeck;
  favoriteTechniqueIds: string[];
  projectTechniqueIds?: string[];
  guardrailIds?: string[];
  capabilityMemberships?: CapabilityMembership[];
  migrationPendingIds?: string[];
}

export type WritingStyleMode = 'default' | 'skill-deck' | 'writer-skill' | 'continuation-pack' | 'blend';

export interface WritingStyleConfirmation {
  mode: WritingStyleMode;
  fingerprint: string;
  confirmedAt: number;
}

export type WritingStyleSourceKind = 'default' | 'project-tone' | 'skill-deck' | 'writer-skill' | 'continuation-pack' | 'writer-session' | 'technique';
export interface WritingStyleSourceSummary {
  kind: WritingStyleSourceKind;
  id?: string;
  label?: string;
  version?: number;
  status?: 'draft' | 'approved';
}
export interface WritingStyleCandidate {
  mode: WritingStyleMode;
  fingerprint: string;
  summary: string;
  sources: WritingStyleSourceSummary[];
}
export interface WritingStyleResolution {
  resolverVersion: number;
  fingerprint: string;
  mode: WritingStyleMode;
  summary: string;
  sources: WritingStyleSourceSummary[];
  allowedModes: WritingStyleMode[];
  warnings: string[];
  confirmed: boolean;
}

export interface FitScoreExplanation {
  summary: string;
  highlights: string[];
  risks: string[];
}

export type PreferenceFeedbackAction = 'more-like-me' | 'not-for-me' | 'project-only';
