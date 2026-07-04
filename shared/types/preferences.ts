
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
}

export interface FitScoreExplanation {
  summary: string;
  highlights: string[];
  risks: string[];
}

export type PreferenceFeedbackAction = 'more-like-me' | 'not-for-me' | 'project-only';

