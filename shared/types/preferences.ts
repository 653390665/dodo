
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

export interface ProjectPreferenceProfile {
  tags: string[];
  weights: ProjectPreferenceWeights;
  acceptedDimensions: SkillDimension[];
  rejectedDimensions: SkillDimension[];
  notes: string[];
  evidenceCount: number;
  contract?: StoryContract;
  decisions?: ChapterDecision[];
}

export interface FitScoreExplanation {
  summary: string;
  highlights: string[];
  risks: string[];
}

export type PreferenceFeedbackAction = 'more-like-me' | 'not-for-me' | 'project-only';

