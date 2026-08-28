/**
 * Shared vocabulary for deterministic draft-quality gates.
 *
 * P0/P1/P2 are intentionally coarse product priorities, not a semantic score:
 * P0 blocks unsafe/non-prose output, P1 flags structural defects, and P2 marks
 * style or template signals that can be reviewed without invalidating content.
 */
export const DRAFT_QUALITY_SEVERITIES = ['P0', 'P1', 'P2'] as const;
export type DraftQualitySeverity = (typeof DRAFT_QUALITY_SEVERITIES)[number];

export type DraftQualityCategory =
  | 'empty'
  | 'metadata'
  | 'instruction-residue'
  | 'reasoning'
  | 'structured-state'
  | 'internal-label'
  | 'encoding'
  | 'control-character'
  | 'noise'
  | 'duplication'
  | 'repetition'
  | 'template'
  | 'chapter-readiness'
  | 'semantic-review';

export interface DraftQualityViolation {
  code: string;
  message: string;
  severity: DraftQualitySeverity;
  category: Exclude<DraftQualityCategory, 'semantic-review'>;
  evidence?: Array<{
    line?: number;
    snippet: string;
    suggestion?: string;
  }>;
}

export interface DraftQualityMechanicalReview {
  status: 'pass' | 'needs-action';
  score: number;
  threshold: number;
  summary: string;
  hits: Array<{
    category: string;
    line: number;
    snippet: string;
    suggestion?: string;
  }>;
}

export type SemanticReviewCheckId =
  | 'chapter-goal'
  | 'character-consistency'
  | 'world-rule-consistency'
  | 'foreshadowing';

export type DraftQualitySemanticStatus = 'unknown' | 'pass' | 'needs-action';

export const DRAFT_QUALITY_SEMANTIC_LABELS: Record<SemanticReviewCheckId, string> = {
  'chapter-goal': '章节目标',
  'character-consistency': '人物一致性',
  'world-rule-consistency': '世界规则',
  foreshadowing: '伏笔与悬念',
};

export interface DraftQualitySemanticEvidence {
  quote: string;
  explanation: string;
  suggestedFix: string;
  severity: 'low' | 'medium' | 'high';
  location?: string;
}

/**
 * Deterministic checks cannot prove narrative intent or continuity. Consumers
 * can use this contract to surface a human/LLM review without claiming a pass.
 */
export interface DraftQualitySemanticReview {
  status: DraftQualitySemanticStatus;
  checks: Array<{
    id: SemanticReviewCheckId;
    status: DraftQualitySemanticStatus;
    category: 'semantic-review';
    reason: string;
    evidence?: DraftQualitySemanticEvidence[];
  }>;
}

export interface DraftQualityReport {
  ok: boolean;
  /** Backwards-compatible messages consumed by existing routes and UI. */
  violations: string[];
  /** Structured findings for severity/category-aware consumers. */
  findings: DraftQualityViolation[];
  /** Mechanical style signals are reported for complete chapter candidates. */
  mechanicalReview?: DraftQualityMechanicalReview;
  /** Narrative checks remain explicitly unknown until semantic review runs. */
  semanticReview: DraftQualitySemanticReview;
}

/** Origin of a manuscript candidate. Fallback output is never an ordinary acceptance source. */
export type DraftAcceptanceSource =
  | 'model'
  | 'fallback'
  | 'user'
  | 'unknown';

export type DraftAcceptanceStatus = 'eligible' | 'blocked' | 'review-required' | 'risk-accepted';

/** Unified result consumed by candidate acceptance flows. */
export interface DraftAcceptanceEvaluation {
  accepted: boolean;
  status: DraftAcceptanceStatus;
  source: DraftAcceptanceSource;
  completeChapter: boolean;
  quality: DraftQualityReport;
  reasons: string[];
}

export const DEFAULT_SEMANTIC_REVIEW: DraftQualitySemanticReview = {
  status: 'unknown',
  checks: [
    {
      id: 'chapter-goal',
      status: 'unknown',
      category: 'semantic-review',
      reason: '章节目标是否完成需要语义审阅，确定性质量门禁不作判断。',
    },
    {
      id: 'character-consistency',
      status: 'unknown',
      category: 'semantic-review',
      reason: '角色动机与状态是否一致需要语义审阅，确定性质量门禁不作判断。',
    },
    {
      id: 'world-rule-consistency',
      status: 'unknown',
      category: 'semantic-review',
      reason: '世界规则是否冲突需要语义审阅，确定性质量门禁不作判断。',
    },
    {
      id: 'foreshadowing',
      status: 'unknown',
      category: 'semantic-review',
      reason: '伏笔与悬念是否有效需要语义审阅，确定性质量门禁不作判断。',
    },
  ],
};
