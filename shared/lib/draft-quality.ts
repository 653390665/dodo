import {
  DEFAULT_SEMANTIC_REVIEW,
  DRAFT_QUALITY_SEMANTIC_LABELS,
  type DraftQualityCategory,
  type DraftAcceptanceEvaluation,
  type DraftAcceptanceSource,
  type DraftQualityMechanicalReview,
  type DraftQualityReport,
  type DraftQualitySeverity,
  type DraftQualityViolation,
} from './quality-contract';
import type { StructuredAudit } from './audit-structured';
import type { ContinuityReport } from '../types/novel';
import { scoreSlop, slopSummary } from './slop-scorer';

type StructuredEvidenceCategory = NonNullable<StructuredAudit['evidence']>[number]['category'];

export type {
  DraftQualityCategory,
  DraftAcceptanceEvaluation,
  DraftAcceptanceSource,
  DraftAcceptanceStatus,
  DraftQualityMechanicalReview,
  DraftQualityReport,
  DraftQualitySeverity,
  DraftQualitySemanticStatus,
  DraftQualityViolation,
} from './quality-contract';

/**
 * Kept as a named alias so existing imports remain source-compatible while
 * exposing the structured report fields to newer consumers.
 */
export type DraftQualityResult = DraftQualityReport;

function semanticStatusForAudit(
  audit: StructuredAudit,
  id: keyof typeof DRAFT_QUALITY_SEMANTIC_LABELS,
): { status: 'unknown' | 'pass' | 'needs-action'; reason: string; evidence?: NonNullable<StructuredAudit['evidence']> } {
  const issues = audit.fatalIssues || [];
  const evidence = audit.evidence || [];
  // Low-severity evidence records coverage and should not be interpreted as
  // a defect merely because its category name matches a dimension. Medium
  // and high evidence remains actionable and is included in issue matching.
  const actionableEvidence = evidence.filter((item) => item.severity !== 'low');
  const issueText = (issue: (typeof issues)[number]) => `${issue.dimension || ''} ${issue.issueType} ${issue.issueSubtype} ${issue.explanation}`.toLowerCase();
  const evidenceText = (item: (typeof evidence)[number]) => `${item.category} ${item.explanation} ${item.suggestedFix}`.toLowerCase();
  const matches = (pattern: RegExp) => issues.some((issue) => pattern.test(issueText(issue))) || actionableEvidence.some((item) => pattern.test(evidenceText(item)));

  const hasChapterGoalEvidence = audit.sceneChecks.length > 0 || evidence.some((item) => ['scene_execution', 'pacing'].includes(item.category));
  const hasDimensionEvidence = id === 'chapter-goal'
    ? hasChapterGoalEvidence
    : evidence.some((item) => evidenceCategoriesFor(id).includes(item.category));
  const needsAction = id === 'chapter-goal'
    ? audit.score < 60 || audit.sceneChecks.some((check) => check.status !== 'ok') || matches(/scene-execution|action-chain|hook-ending|scene_execution|pacing/)
    : id === 'character-consistency'
      ? matches(/dialogue-logic|character_state|character|人物|动机|人设/)
      : id === 'world-rule-consistency'
        ? matches(/hard_canon|canon|setting|world|世界|设定|逻辑|timeline|power|location|item/)
        : matches(/foreshadowing|hook-ending|action-chain|悬念|伏笔|钩子/);

  const evidenceCategories: Record<typeof id, Array<NonNullable<StructuredAudit['evidence']>[number]['category']>> = {
    'chapter-goal': ['scene_execution', 'pacing'],
    'character-consistency': ['character_state'],
    'world-rule-consistency': ['hard_canon'],
    foreshadowing: ['foreshadowing'],
  };
  const matchedEvidence = evidence.filter((item) => evidenceCategories[id].includes(item.category));
  if (needsAction) {
    return {
      status: 'needs-action',
      reason: `${DRAFT_QUALITY_SEMANTIC_LABELS[id]}存在审稿证据，需要修复后复核。`,
      ...(matchedEvidence.length ? { evidence: matchedEvidence } : {}),
    };
  }
  if (!hasDimensionEvidence) {
    return { status: 'unknown', reason: `${DRAFT_QUALITY_SEMANTIC_LABELS[id]}缺少针对本维度的可验证审阅证据。` };
  }
  return {
    status: 'pass',
    reason: `${DRAFT_QUALITY_SEMANTIC_LABELS[id]}已完成本轮结构审阅，未发现阻断证据。`,
  };
}

function evidenceCategoriesFor(id: keyof typeof DRAFT_QUALITY_SEMANTIC_LABELS): StructuredEvidenceCategory[] {
  return {
    'chapter-goal': ['scene_execution', 'pacing'],
    'character-consistency': ['character_state'],
    'world-rule-consistency': ['hard_canon'],
    foreshadowing: ['foreshadowing'],
  }[id] as StructuredEvidenceCategory[];
}

export function semanticReviewFromStructuredAudit(audit: StructuredAudit | null | undefined) {
  if (!audit) return DEFAULT_SEMANTIC_REVIEW;
  const ids: Array<keyof typeof DRAFT_QUALITY_SEMANTIC_LABELS> = [
    'chapter-goal',
    'character-consistency',
    'world-rule-consistency',
    'foreshadowing',
  ];
  const checks = ids.map((id) => {
    const result = semanticStatusForAudit(audit, id);
    return { id, ...result, category: 'semantic-review' as const };
  });
  return {
    status: checks.some((check) => check.status === 'needs-action')
      ? 'needs-action' as const
      : checks.some((check) => check.status === 'unknown')
        ? 'unknown' as const
        : 'pass' as const,
    checks,
  };
}

export function semanticReviewFromContinuityReport(report: ContinuityReport | null | undefined) {
  if (!report) return DEFAULT_SEMANTIC_REVIEW;
  const auditStatus = report.auditMeta?.status || 'not_run';
  const categoryByCheck = {
    'chapter-goal': ['logic', 'timeline'],
    'character-consistency': ['character'],
    'world-rule-consistency': ['item', 'location', 'power', 'logic', 'timeline'],
    foreshadowing: ['foreshadowing'],
  } as const;
  const checks = (Object.keys(categoryByCheck) as Array<keyof typeof categoryByCheck>).map((id) => {
    const matching = report.issues.filter((issue) => (categoryByCheck[id] as readonly string[]).includes(issue.category));
    const needsAction = matching.length > 0 || (id === 'chapter-goal' && auditStatus === 'fail');
    const unknown = !needsAction && (auditStatus === 'unknown' || auditStatus === 'not_run');
    return {
      id,
      status: needsAction ? 'needs-action' as const : unknown ? 'unknown' as const : 'pass' as const,
      category: 'semantic-review' as const,
      reason: needsAction
        ? `${DRAFT_QUALITY_SEMANTIC_LABELS[id]}存在连续性审稿证据，需要修复后复核。`
        : unknown
          ? `${DRAFT_QUALITY_SEMANTIC_LABELS[id]}尚未完成模型语义审阅。`
          : `${DRAFT_QUALITY_SEMANTIC_LABELS[id]}已完成本轮连续性审阅，未发现阻断证据。`,
      ...(matching.length ? {
        evidence: matching.map((issue) => ({
          quote: issue.evidence || issue.message,
          explanation: issue.message,
          suggestedFix: issue.suggestedFix || '根据证据修正正文后重新审稿。',
          severity: issue.severity,
        })),
      } : {}),
    };
  });
  return {
    status: checks.some((check) => check.status === 'needs-action')
      ? 'needs-action' as const
      : checks.some((check) => check.status === 'unknown')
        ? 'unknown' as const
        : 'pass' as const,
    checks,
  };
}

export function attachSemanticReview(report: DraftQualityReport, audit: StructuredAudit | null | undefined): DraftQualityReport {
  return { ...report, semanticReview: semanticReviewFromStructuredAudit(audit) };
}

const REQUIRED_SEMANTIC_CHECKS: Array<keyof typeof DRAFT_QUALITY_SEMANTIC_LABELS> = [
  'chapter-goal',
  'character-consistency',
  'world-rule-consistency',
  'foreshadowing',
];

function normalizeAcceptanceSemanticReview(review: DraftQualityReport['semanticReview']): DraftQualityReport['semanticReview'] {
  const hasNeedsAction = review.status === 'needs-action' || review.checks.some((check) => check.status === 'needs-action');
  const allRequiredChecksPass = REQUIRED_SEMANTIC_CHECKS.every((id) => review.checks.some((check) => check.id === id && check.status === 'pass'));
  const status = hasNeedsAction
    ? 'needs-action' as const
    : review.status === 'pass' && allRequiredChecksPass
      ? 'pass' as const
      : 'unknown' as const;
  return status === review.status ? review : { ...review, status };
}

const META_LINE = /^(?:作品|摘要|世界规则|全局大纲|关键人物|关键道具|开放伏笔|人物状态|地点状态|道具状态|势力状态|力量体系|时间线)\s*[:：]/i;
const META_TOKEN = /(?:作品|摘要|无摘要|世界规则|全局大纲|关键人物|关键道具|开放伏笔|人物状态|地点状态|道具状态|势力状态|力量体系|时间线)\s*[:：]|(?:^|[\s【】])(?:mystery|tomato|urban|fantasy|system)(?:$|[\s】])/i;
const EXPLANATION_LINE = /^(?:问题|答案|问|答|说明|注释|analysis|answer|question)\s*[:：]/i;
const THINK_TAG = /<\/?think>|<\/?analysis>|<\/?reasoning>/i;
const STRUCTURED_METADATA = /\((?:role|traits|region|type|leader|territory|tier|characteristics)\s*=[^)]*\)/i;
const MOJIBAKE = /(?:[ÃÂ]|[åæçèé][\u0080-\u00BF]|â[\u0080-\u00BF]{1,2}|ï¿½|ðŸ)/i;
const SYMBOL_NOISE = /(?:[@#$%^*_+=~`\\|<>]){3,}|([!?！？。])\1{3,}/;
const TEMPLATE_RESIDUE = /(?:延续上一章剧情|接着上文继续|继续写正文|正文如下|以下是正文|下面是正文|写作提示|创作说明)/i;
const INTERNAL_CONTEXT_RESIDUE = /(?:RAG\s*Context|前情提要(?:及剧情内存)?|剧情内存|送模上下文|上下文记忆|直接围绕[^。！？\n]{2,80}打造|第一章从[^。！？\n]{2,80}开场)/i;
const PARAMETER_RESIDUE = /(?:目标?平台|题材参数|篇幅参数|字数(?:目标|上限|要求)?|文风参数|写作风格参数|(?:platform|genre|word\s*count|writing\s*style)\s*(?:parameter|目标|上限)?)[\s:=：]/i;
const EMPTY_PLACEHOLDER_LINE = /^(?:空|暂无|无内容|正文为空|待补充|placeholder|empty)\s*[。.!！…：:]?$/i;
const MARKDOWN_RESIDUE = /(?:^|\n)\s*(?:#{1,6}\s+|```|---\s*$)|\*\*[^*\n]+\*\*/m;
const EVIDENCE_LABEL_SEGMENT = /(?:世界|角色|人物|伏笔|设定|道具|分镜|冲突)证据\s*[-—:：][^。！？!?\n]*(?:[。！？!?]|$)/g;
const EVIDENCE_LABEL_RESIDUE = /(?:世界|角色|人物|伏笔|设定|道具|分镜|冲突)证据\s*[-—:：]/i;

export const MIN_COMPLETE_SCENE_CHARS = 800;
/** Product contract for a complete generated chapter. Whitespace is excluded. */
export const MIN_COMPLETE_CHAPTER_CHARS = 4000;
/** Initial mechanical-quality release gate; tune only against reviewed samples. */
export const MIN_COMPLETE_CHAPTER_SLOP_SCORE = 85;

function normalizeParagraph(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) || 0;
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
}

export function validateDraftQuality(text: string, semanticReview = DEFAULT_SEMANTIC_REVIEW): DraftQualityResult {
  const findings: DraftQualityViolation[] = [];
  const emittedCodes = new Set<string>();
  const addFinding = (
    code: string,
    message: string,
    severity: DraftQualitySeverity,
    category: Exclude<DraftQualityCategory, 'semantic-review'>,
    evidence?: DraftQualityViolation['evidence'],
  ) => {
    if (emittedCodes.has(code)) return;
    emittedCodes.add(code);
    findings.push({ code, message, severity, category, ...(evidence?.length ? { evidence } : {}) });
  };
  const paragraphs = text.split(/\n\s*\n+/).map(normalizeParagraph).filter(Boolean);
  const counts = new Map<string, number>();

  for (const line of text.split(/\n+/).map((item) => item.trim()).filter(Boolean)) {
    if (META_LINE.test(line) || META_TOKEN.test(line)) addFinding('metadata', '正文包含作品/摘要等上下文元数据', 'P0', 'metadata');
    if (EXPLANATION_LINE.test(line) || /(?:^|[\s【】])(?:问题|答案|问|答|说明|注释|analysis|answer|question)\s*[:：]/i.test(line)) addFinding('instruction-residue', '正文包含问答或说明性残片', 'P0', 'instruction-residue');
    if (THINK_TAG.test(line)) addFinding('reasoning-tag', '正文包含模型推理标签', 'P0', 'reasoning');
    if (STRUCTURED_METADATA.test(line) || /\b(?:role|traits|region|type|leader|territory|tier|characteristics)\s*=\s*[^\s)]+/i.test(line)) addFinding('structured-state', '正文包含结构化状态字段', 'P0', 'structured-state');
    if (/(?:^|[\s【】])(?:mystery|tomato|urban|fantasy|system)(?:$|[\s】])/i.test(line)) addFinding('internal-label', '正文包含内部题材或平台标签', 'P0', 'internal-label');
    if (/�|\\uFFFD/.test(line)) addFinding('replacement-character', '正文包含乱码字符', 'P0', 'encoding');
    if (MOJIBAKE.test(line)) addFinding('mojibake', '正文包含疑似 UTF-8 解码乱码', 'P0', 'encoding');
    if (containsControlCharacter(line)) addFinding('control-character', '正文包含不可见控制字符', 'P0', 'control-character');
    if (SYMBOL_NOISE.test(line)) addFinding('symbol-noise', '正文包含异常符号噪声', 'P1', 'noise');
    if (TEMPLATE_RESIDUE.test(line) || EMPTY_PLACEHOLDER_LINE.test(line)) addFinding('template-residue', '正文包含生成过程提示或空占位', 'P1', 'instruction-residue');
    if (INTERNAL_CONTEXT_RESIDUE.test(line)) addFinding('context-residue', '正文包含前情上下文或规划说明残留', 'P0', 'instruction-residue');
    if (PARAMETER_RESIDUE.test(line)) addFinding('parameter-residue', '正文包含平台、题材、篇幅或写作参数', 'P0', 'metadata');
    if (EVIDENCE_LABEL_RESIDUE.test(line)) addFinding('evidence-label-residue', '正文包含世界/角色/伏笔证据标签', 'P0', 'metadata');
  }
  if (MARKDOWN_RESIDUE.test(text)) addFinding('markdown-residue', '正文包含 Markdown 标记或分镜模板残留', 'P1', 'template');

  for (const paragraph of paragraphs) counts.set(paragraph, (counts.get(paragraph) || 0) + 1);
  if ([...counts.values()].some((count) => count > 1)) addFinding('duplicate-paragraph', '正文包含重复段落', 'P1', 'duplication');
  const sentences = text.split(/[。！？!?；;\n]+/).map(normalizeParagraph).filter((sentence) => sentence.length >= 8);
  const sentenceCounts = new Map<string, number>();
  for (const sentence of sentences) {
    const normalized = sentence.replace(/[“”「」『』"']/g, '').replace(/\s+/g, ' ').trim();
    // Short, reusable cadence lines are the high-confidence template signal;
    // long repeated sentences can be intentional refrains in a scene.
    if (normalized.length >= 12 && normalized.length <= 40 && (normalized.includes('局面再次偏转') || (!/[，,]/.test(normalized) && !/^(?:他|她|它|有人|对方|众人|门外|屋里|守门人|林舟|第\d+次)/.test(normalized)))) sentenceCounts.set(normalized, (sentenceCounts.get(normalized) || 0) + 1);
  }
  if ([...sentenceCounts.values()].some((count) => count >= 3)) addFinding('duplicate-sentence', '正文包含高密度重复完整句', 'P1', 'duplication');
  const openings = new Map<string, number>();
  for (const sentence of sentences) {
    const opening = sentence.slice(0, 6);
    if (!/^(他|她|它|这|那|有人|对方|众人|门外|屋里)/.test(opening)) {
      openings.set(opening, (openings.get(opening) || 0) + 1);
    }
  }
  if ([...openings.values()].some((count) => count >= 3)) addFinding('repeated-opening', '正文包含重复句式开头', 'P2', 'repetition');
  const mechanicalOpenings = text.match(/(?:他没有|没有人|这一次|危险却没有退去|他把这点异样记在心里)/g) || [];
  if (mechanicalOpenings.length >= 10) addFinding('mechanical-cadence', '正文包含高密度保底句式重复', 'P1', 'repetition');
  if (/核心冲突：[^。]{4,}因此被推到/.test(text)) {
    addFinding('fallback-template', '正文包含保底模板化节奏', 'P2', 'template');
  }
  if (paragraphs.length === 0) addFinding('empty', '正文为空', 'P0', 'empty');

  return {
    // P2 is an editorial warning. P0/P1 remain hard blockers; P2 is surfaced
    // in the candidate preview so the author can decide whether to polish.
    ok: findings.every((finding) => finding.severity === 'P2'),
    violations: findings.map((finding) => finding.message),
    findings,
    semanticReview,
  };
}

function isEvidenceLabelPayload(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  const matches = compact.match(EVIDENCE_LABEL_SEGMENT) || [];
  if (matches.length < 2) return false;
  const labelLines = text.split(/\n+/).map((line) => line.trim()).filter((line) => /^(?:世界|角色|人物|伏笔)证据\s*[-—:：]/.test(line));
  if (labelLines.length >= 2) return true;
  const remainder = compact
    .replace(EVIDENCE_LABEL_SEGMENT, '')
    .replace(/[，,；;、。！？!?\-—:：]/g, '');
  return remainder.length <= Math.max(12, Math.floor(compact.length * 0.2));
}

/**
 * Full-chapter gate. This only proves a minimum prose shape; narrative intent
 * remains unknown until the structured semantic review has run.
 */
export function validateChapterDraftQuality(
  text: string,
  semanticReview = DEFAULT_SEMANTIC_REVIEW,
): DraftQualityResult {
  const base = validateDraftQuality(text, semanticReview);
  const findings = [...base.findings];
  const emittedCodes = new Set(findings.map((finding) => finding.code));
  const addFinding = (code: string, message: string) => {
    if (emittedCodes.has(code)) return;
    emittedCodes.add(code);
    findings.push({ code, message, severity: 'P1', category: 'chapter-readiness' });
  };
  const compactChars = text.replace(/\s/g, '').length;

  if (isEvidenceLabelPayload(text)) {
    addFinding('evidence-label-only', '正文主要由世界/角色/伏笔证据标签组成，不是可阅读的小说场景');
  }
  if (compactChars < MIN_COMPLETE_SCENE_CHARS) {
    addFinding('chapter-too-short', `正文不足 ${MIN_COMPLETE_SCENE_CHARS} 个有效字符，尚未形成完整场景`);
  } else {
    const paragraphCount = text.split(/\n\s*\n+/).map(normalizeParagraph).filter(Boolean).length;
    const sentenceCount = (text.match(/[。！？!?]/g) || []).length;
    if (paragraphCount < 3 || sentenceCount < 8) {
      addFinding('chapter-structure-incomplete', '正文缺少完整场景所需的段落与句子结构');
    }
  }

  return {
    ok: findings.every((finding) => finding.severity === 'P2'),
    violations: findings.map((finding) => finding.message),
    findings,
    semanticReview,
  };
}

/**
 * Full-chapter gate used by initial drafting and final chapter acceptance.
 * Short editor fragments intentionally continue to use validateDraftQuality or
 * validateCandidateDraftQuality instead.
 */
export function validateCompleteChapterDraftQuality(
  text: string,
  semanticReview = DEFAULT_SEMANTIC_REVIEW,
): DraftQualityResult {
  const result = validateChapterDraftQuality(text, semanticReview);
  const findings = [...result.findings];
  const compactChars = text.replace(/\s/g, '').length;
  if (compactChars < MIN_COMPLETE_CHAPTER_CHARS && !findings.some((finding) => finding.code === 'chapter-below-contract')) {
    findings.push({
      code: 'chapter-below-contract',
      message: `正文不足 ${MIN_COMPLETE_CHAPTER_CHARS} 个有效字符，未达到整章交付标准`,
      severity: 'P1',
      category: 'chapter-readiness',
    });
  }
  const mechanical = scoreSlop(text);
  const mechanicalReview: DraftQualityMechanicalReview = {
    status: mechanical.score >= MIN_COMPLETE_CHAPTER_SLOP_SCORE ? 'pass' : 'needs-action',
    score: mechanical.score,
    threshold: MIN_COMPLETE_CHAPTER_SLOP_SCORE,
    summary: slopSummary(mechanical),
    hits: mechanical.hits,
  };
  const hardLiteraryHits = mechanical.hits.filter((hit) => (
    hit.category === 'ai_cliche'
      || hit.category === 'style_slop'
      || hit.category === 'tell_dont_show'
      || (hit.category === 'structural' && hit.priority === 'P1' && ['paragraph-opening', 'scene-template'].includes(hit.signal || ''))
  ));
  if (hardLiteraryHits.length > 0 && !findings.some((finding) => finding.code === 'literary-slop')) {
    findings.push({
      code: 'literary-slop',
      message: '正文包含高置信 AI 套话或结构化叙述缺陷，需要精修后才能进入整章交付',
      severity: 'P1',
      category: 'template',
      evidence: hardLiteraryHits.slice(0, 5).map((hit) => ({
        line: hit.line,
        snippet: hit.snippet,
        ...(hit.suggestion ? { suggestion: hit.suggestion } : {}),
      })),
    });
  }
  if (mechanicalReview.status === 'needs-action' && !findings.some((finding) => finding.code === 'mechanical-quality')) {
    findings.push({
      code: 'mechanical-quality',
      message: `机械审查分数 ${mechanical.score.toFixed(1)} 低于整章交付要求 ${MIN_COMPLETE_CHAPTER_SLOP_SCORE}`,
      severity: 'P1',
      category: 'repetition',
      evidence: mechanical.hits.slice(0, 3).map((hit) => ({
        line: hit.line,
        snippet: hit.snippet,
        ...(hit.suggestion ? { suggestion: hit.suggestion } : {}),
      })),
    });
  }
  return {
    ...result,
    ok: findings.every((finding) => finding.severity === 'P2'),
    violations: findings.map((finding) => finding.message),
    findings,
    mechanicalReview,
  };
}

/**
 * Single acceptance contract for manuscript candidates.
 *
 * Deterministic validators remain useful for editor previews, but only a
 * complete, mechanically clean, semantically reviewed non-fallback candidate
 * can be accepted as a chapter. This keeps the legacy report API unchanged
 * while giving all callers one explicit acceptance decision.
 */
export function evaluateDraftAcceptance(
  text: string,
  options: {
    source?: DraftAcceptanceSource;
    semanticReview?: DraftQualityReport['semanticReview'];
    allowRiskAcceptance?: boolean;
    operation?: 'draft' | 'rewrite' | 'polish';
    baseline?: string;
  } = {},
): DraftAcceptanceEvaluation {
  const source = options.source || 'unknown';
  const semanticReview = normalizeAcceptanceSemanticReview(options.semanticReview || DEFAULT_SEMANTIC_REVIEW);
  const compactChars = text.replace(/\s/g, '').length;
  const completeChapter = compactChars >= MIN_COMPLETE_CHAPTER_CHARS;
  const localRewrite = options.operation === 'rewrite' && !completeChapter;
  const quality = completeChapter
    ? validateCompleteChapterDraftQuality(text, semanticReview)
    : localRewrite
      ? validateCandidateDraftQuality(text, options.baseline || '', semanticReview)
      : compactChars >= MIN_COMPLETE_SCENE_CHARS
        ? validateChapterDraftQuality(text, semanticReview)
        : validateDraftQuality(text, semanticReview);
  const reasons = quality.findings
    .filter((finding) => finding.severity !== 'P2')
    .map((finding) => finding.message);

  if (source === 'fallback') {
    return {
      accepted: false,
      status: 'blocked',
      source,
      completeChapter,
      quality,
      reasons: ['保底草稿不能作为普通接受结果，请重新生成或人工确认。', ...reasons],
    };
  }
  if (source === 'unknown' && completeChapter) {
    return {
      accepted: false,
      status: 'blocked',
      source,
      completeChapter: true,
      quality,
      reasons: ['正文版本来源未知，不能作为整章普通接受结果，请重新生成。', ...reasons],
    };
  }
  if (!completeChapter && !localRewrite) {
    return {
      accepted: false,
      status: 'review-required',
      source,
      completeChapter: false,
      quality,
      reasons: [`正文不足 ${MIN_COMPLETE_CHAPTER_CHARS} 个有效字符，只能作为预览。`, ...reasons],
    };
  }
  if (!quality.ok) {
    return { accepted: false, status: 'blocked', source, completeChapter, quality, reasons };
  }
  if (localRewrite) {
    return { accepted: true, status: 'eligible', source, completeChapter: false, quality, reasons };
  }
  if (options.allowRiskAcceptance && source === 'user' && semanticReview.status !== 'pass') {
    return {
      accepted: true,
      status: 'risk-accepted',
      source,
      completeChapter: true,
      quality,
      reasons: [
        semanticReview.status === 'unknown'
          ? '作者已明确接受尚未完成语义审阅的风险。'
          : '作者已明确接受语义审阅发现的问题。',
        ...reasons,
      ],
    };
  }
  if (semanticReview.status !== 'pass') {
    return {
      accepted: false,
      status: 'review-required',
      source,
      completeChapter: true,
      quality,
      reasons: [
        semanticReview.status === 'unknown'
          ? '正文尚未完成语义审阅，不能普通接受。'
          : '正文存在需要修复的语义审阅问题。',
        ...reasons,
      ],
    };
  }
  return { accepted: true, status: 'eligible', source, completeChapter: true, quality, reasons };
}

/**
 * Candidate edits operate on the whole chapter, but short working fragments
 * are still valid editor state. Once the baseline is a complete scene, an
 * edit must preserve the complete-scene quality boundary as well.
 */
export function validateCandidateDraftQuality(
  candidate: string,
  baseline: string,
  semanticReview = DEFAULT_SEMANTIC_REVIEW,
): DraftQualityResult {
  const baselineChars = baseline.replace(/\s/g, '').length;
  return baselineChars >= MIN_COMPLETE_CHAPTER_CHARS
    ? validateCompleteChapterDraftQuality(candidate, semanticReview)
    : baselineChars >= MIN_COMPLETE_SCENE_CHARS
    ? validateChapterDraftQuality(candidate, semanticReview)
    : validateDraftQuality(candidate, semanticReview);
}

export function sanitizeFallbackContext(context: string): string[] {
  return context
    .split(/\n+/)
    .map((line) => line.replace(/^[\s*\-•]+/, '').trim())
    .filter((line) => line.length > 8)
    .filter((line) => !INTERNAL_CONTEXT_RESIDUE.test(line) && !PARAMETER_RESIDUE.test(line))
    .map((line) => {
      const cleaned = line.replace(STRUCTURED_METADATA, '').replace(/\s{2,}/g, ' ').trim();
      const match = cleaned.match(/^([^:：]{1,80})[:：]\s*(.+)$/);
      if (!match) return cleaned;
      const [, label, value] = match;
      if (/^作品$/i.test(label.trim())) return '';
      if (/^(?:摘要|全局大纲)$/i.test(label.trim())) return '';
      if (/^(?:chapter|章节(?:标题)?|当前章节)$/i.test(label.trim()) && /^(?:无|暂无|空|empty|none)?$/i.test(value.trim())) return '';
      if (/^(?:世界规则|入场钩子|核心冲突|关键动作链|退场钩子|近期章节|关键人物|关键道具|未回收伏笔|开放伏笔|时间线|(?:世界|角色|人物|伏笔|设定|道具|分镜|冲突)证据)$/i.test(label.trim())) return value.trim();
      return `${label.trim()}，${value.trim()}`;
    })
    .map((line) => line.replace(/\b(?:role|traits|region|type|leader|territory|tier|characteristics)\s*=\s*[^\s)；，。]+/gi, '').replace(/\s{2,}/g, ' ').trim())
    .map((line) => line.replace(/^(?:世界|角色|人物|伏笔|设定|道具|分镜|冲突)证据\s*[-—:：]\s*/i, '').trim())
    .filter((line) => line.length > 8)
    .filter((line) => !/^(?:chapter|摘要|全局大纲|人物状态|地点状态|道具状态|势力状态|力量体系|场景\s*\d+)\s*[,，]?$/i.test(line))
    .filter((line) => line.length > 8)
    .slice(0, 8);
}
