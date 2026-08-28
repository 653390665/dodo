import { extractJsonPayload } from './extract-skill-json';

export type StructuredAuditIssueType =
  | 'duplicate'
  | 'dialogue-logic'
  | 'syntax'
  | 'scene-execution'
  | 'style-slop'
  | 'action-chain'
  | 'hook-ending'
  | 'general';

export type StructuredAuditIssueSubtype =
  | 'duplicate-rupture'
  | 'dialogue-abrupt-info'
  | 'dialogue-answer-gap'
  | 'dialogue-general'
  | 'syntax-invalid-phrase'
  | 'scene-layer-missing'
  | 'ai-cliche'
  | 'tell-dont-show'
  | 'template-emotion'
  | 'sentence-monotony'
  | 'weak-action-chain'
  | 'dialogue-without-beat'
  | 'generic-ending'
  | 'exposition-dump'
  | 'general';

export interface StructuredAuditIssue {
  dimension?: string;
  issueType: StructuredAuditIssueType;
  issueSubtype: StructuredAuditIssueSubtype;
  severity: 'critical' | 'major' | 'moderate';
  snippet: string;
  explanation: string;
  patchHint: string;
}

export interface StructuredAuditSceneCheck {
  scene: string;
  status: 'ok' | 'weak' | 'missing';
  note: string;
}

export type StructuredAuditEvidenceCategory =
  | 'hard_canon'
  | 'character_state'
  | 'scene_execution'
  | 'pacing'
  | 'foreshadowing';

export interface StructuredAuditEvidence {
  category: StructuredAuditEvidenceCategory;
  severity: 'low' | 'medium' | 'high';
  quote: string;
  explanation: string;
  suggestedFix: string;
  location?: string;
}

export interface StructuredAudit {
  score: number;
  fatalIssues: StructuredAuditIssue[];
  sceneChecks: StructuredAuditSceneCheck[];
  surgerySuggestions: string[];
  evidence?: StructuredAuditEvidence[];
}

export type AuditContractMode = 'five-dim' | 'structured';

export interface AuditContractDiagnostic {
  valid: boolean;
  violation: string | null;
  rawIssueCount: number;
  normalizedIssueCount: number;
}

const CONTRACT_VIOLATIONS = {
  fatalIssuesMissing: 'fatal_issues_missing',
  fatalIssuesNotArray: 'fatal_issues_not_array',
  fatalIssuesFiltered: 'fatal_issues_filtered',
  incompleteLowScore: 'incomplete_low_score',
  passGateMismatch: 'pass_gate_mismatch',
  lowStructuredScoreWithoutIssues: 'low_structured_score_without_issues',
} as const;

const AUDIT_COMMENT_PREFIX = 'audit-structured:';

function encodeBase64Utf8(value: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64Utf8(value: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64').toString('utf8');
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function stripCodeFences(raw: string): string {
  return raw.replace(/```json/g, '').replace(/```/g, '').trim();
}

function stripReasoningBlocks(raw: string): string {
  const withoutClosed = raw.replace(/<(?:think|analysis|reasoning)>[\s\S]*?<\/(?:think|analysis|reasoning)>/gi, '');
  return withoutClosed.replace(/<(?:think|analysis|reasoning)>[\s\S]*$/i, '').trim();
}

interface BalancedJsonCandidate {
  candidate: string;
  root: 'object' | 'array' | 'none';
  start: number;
  truncated: boolean;
}

/** Extract the first balanced JSON root without trusting the last closing brace. */
function findBalancedJson(raw: string): BalancedJsonCandidate {
  const cleaned = stripReasoningBlocks(stripCodeFences(raw));
  let start = -1;
  let root: BalancedJsonCandidate['root'] = 'none';
  for (let index = 0; index < cleaned.length; index += 1) {
    if (cleaned[index] === '{' || cleaned[index] === '[') {
      start = index;
      root = cleaned[index] === '{' ? 'object' : 'array';
      break;
    }
  }
  if (start < 0) return { candidate: cleaned, root: 'none', start: -1, truncated: false };

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack[stack.length - 1] !== expected) {
        return { candidate: cleaned.slice(start, index + 1), root, start, truncated: false };
      }
      stack.pop();
      if (stack.length === 0) {
        return { candidate: cleaned.slice(start, index + 1), root, start, truncated: false };
      }
    }
  }
  return { candidate: cleaned.slice(start), root, start, truncated: true };
}

function findJsonObject(raw: string): string {
  const candidate = findBalancedJson(raw);
  return candidate.candidate;
}

/** Parse a balanced JSON object without normalizing characters inside strings. */
export function parseBalancedJsonObject(raw: string): Record<string, unknown> | null {
  const candidate = findBalancedJson(raw);
  if (candidate.root !== 'object' || candidate.truncated) return null;
  try {
    const parsed = JSON.parse(candidate.candidate);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function repairUnescapedQuotesInJson(raw: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];

    if (!inString) {
      result += char;
      if (char === '"') {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j += 1;
      const next = raw[j];
      const isStringBoundary = next === ':' || next === ',' || next === '}' || next === ']';

      if (isStringBoundary) {
        result += char;
        inString = false;
      } else {
        result += '\\"';
      }
      continue;
    }

    result += char;
  }

  return result;
}

function normalizeIssueType(value: string): StructuredAuditIssueType {
  switch (value) {
    case 'duplicate':
    case 'dialogue-logic':
    case 'syntax':
    case 'scene-execution':
    case 'style-slop':
    case 'action-chain':
    case 'hook-ending':
      return value;
    default:
      return 'general';
  }
}

function normalizeIssueSubtype(value: string): StructuredAuditIssueSubtype {
  switch (value) {
    case 'duplicate-rupture':
    case 'dialogue-abrupt-info':
    case 'dialogue-answer-gap':
    case 'dialogue-general':
    case 'syntax-invalid-phrase':
    case 'scene-layer-missing':
    case 'ai-cliche':
    case 'tell-dont-show':
    case 'template-emotion':
    case 'sentence-monotony':
    case 'weak-action-chain':
    case 'dialogue-without-beat':
    case 'generic-ending':
    case 'exposition-dump':
      return value;
    default:
      return 'general';
  }
}

function normalizeSeverity(value: string): StructuredAuditIssue['severity'] {
  switch (value) {
    case 'critical':
    case 'high':
      return 'critical';
    case 'major':
      return 'major';
    case 'moderate':
    case 'low':
      return 'moderate';
    default:
      return 'major';
  }
}

function normalizeSceneStatus(value: string): StructuredAuditSceneCheck['status'] {
  switch (value) {
    case 'ok':
    case 'weak':
    case 'missing':
      return value;
    default:
      return 'weak';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeEvidenceCategory(value: string): StructuredAuditEvidenceCategory | null {
  switch (value) {
    case 'hard_canon':
    case 'character_state':
    case 'scene_execution':
    case 'pacing':
    case 'foreshadowing':
      return value;
    default:
      return null;
  }
}

function normalizeEvidenceSeverity(value: string): StructuredAuditEvidence['severity'] | null {
  switch (value) {
    case 'low':
    case 'medium':
    case 'high':
      return value;
    default:
      return null;
  }
}

function normalizeEvidence(item: unknown): StructuredAuditEvidence | null {
  const r = asRecord(item);
  const category = normalizeEvidenceCategory(stringValue(r.category));
  const severity = normalizeEvidenceSeverity(stringValue(r.severity));
  const quote = stringValue(r.quote).trim();
  const explanation = stringValue(r.explanation).trim();
  const suggestedFix = stringValue(r.suggestedFix || r.fix).trim();
  if (!category || !severity || !quote || !explanation || !suggestedFix) return null;
  const location = stringValue(r.location).trim();
  return { category, severity, quote, explanation, suggestedFix, ...(location ? { location } : {}) };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value != null ? String(value) : '';
}

function normalizeStructuredAuditIssue(item: unknown): StructuredAuditIssue | null {
  const r = asRecord(item);
  const snippet = stringValue(r.snippet || r.quote || r.problem).trim();
  const explanation = stringValue(r.planation || r.explanation || r.reason || '').trim();
  const patchHint = stringValue(r.patchHint || r.fix || r.suggestedFix || r.suggestion).trim();
  if (!snippet || !explanation || !patchHint) return null;

  return {
    ...(stringValue(r.dimension).trim() ? { dimension: stringValue(r.dimension).trim() } : {}),
    issueType: normalizeIssueType(stringValue(r.issueType || 'general')),
    issueSubtype: normalizeIssueSubtype(stringValue(r.issueSubtype || 'general')),
    severity: normalizeSeverity(stringValue(r.severity || 'major')),
    snippet,
    explanation,
    patchHint,
  };
}

function normalizeSceneCheck(item: unknown): StructuredAuditSceneCheck | null {
  const r = asRecord(item);
  const scene = stringValue(r.scene).trim();
  const note = stringValue(r.note).trim();
  if (!scene || !note) return null;

  return {
    scene,
    status: normalizeSceneStatus(stringValue(r.status || 'weak')),
    note,
  };
}

function normalizeStructuredAuditPayload(parsed: unknown): StructuredAudit | null {
  const r = asRecord(parsed);
  const score = Number(r.score);
  if (!Number.isFinite(score)) return null;

  const fatalIssues = asArray(r.fatalIssues)
    .map(normalizeStructuredAuditIssue)
    .filter((issue): issue is StructuredAuditIssue => Boolean(issue));

  const sceneChecks = asArray(r.sceneChecks)
    .map(normalizeSceneCheck)
    .filter((check): check is StructuredAuditSceneCheck => Boolean(check));

  const surgerySuggestions = asArray(r.surgerySuggestions)
    .map((item) => stringValue(item).trim())
    .filter(Boolean);
  const evidence = asArray(r.evidence)
    .map(normalizeEvidence)
    .filter((item): item is StructuredAuditEvidence => Boolean(item));

  return {
    score,
    fatalIssues,
    sceneChecks,
    surgerySuggestions,
    evidence,
  };
}

export function parseStructuredAuditResponse(raw: string): StructuredAudit | null {
  const candidate = findJsonObject(raw);
  try {
    const parsed = JSON.parse(candidate);
    return normalizeStructuredAuditPayload(parsed);
  } catch {
    try {
      const repaired = JSON.parse(repairUnescapedQuotesInJson(candidate));
      return normalizeStructuredAuditPayload(repaired);
    } catch {
      return null;
    }
  }
}

export interface AuditScores {
  scores: Record<string, { score: number; reason: string }>;
  totalScore: number;
  pass: boolean;
  failReason?: string;
  fatalIssues?: Array<Record<string, unknown>>;
  surgerySuggestions?: string[];
  evidence?: unknown[];
}

const FIVE_DIMENSION_KEYS = ['可读性', '分镜执行度', '冲突推进度', '风格契合度', '网文章节感'] as const;

export function parseAuditFiveDim(raw: string): AuditScores | null {
  try {
    // Parse a balanced JSON candidate first. The legacy extractor normalizes
    // Chinese curly quotes globally, which corrupts valid quotes inside JSON
    // string values such as score reasons.
    let parsed: unknown;
    try {
      parsed = JSON.parse(findJsonObject(raw));
    } catch {
      // Keep compatibility with older providers that use curly quotes for keys.
      parsed = extractJsonPayload(raw);
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const payload = parsed as Record<string, unknown>;
    if (!payload.scores || typeof payload.scores !== 'object' || !('totalScore' in payload)) return null;
    const scores = payload.scores as Record<string, unknown>;
    const scoreKeys = Object.keys(scores);
    if (scoreKeys.length !== FIVE_DIMENSION_KEYS.length || FIVE_DIMENSION_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(scores, key))) return null;
    const normalizedScores: Record<string, { score: number; reason: string }> = {};
    for (const key of FIVE_DIMENSION_KEYS) {
      const value = scores[key];
      if (!value || typeof value !== 'object') return null;
      const entry = value as Record<string, unknown>;
      if (typeof entry.score !== 'number' || !Number.isFinite(entry.score) || entry.score < 0 || entry.score > 10 || typeof entry.reason !== 'string') return null;
      normalizedScores[key] = { score: entry.score, reason: entry.reason };
    }
    if (typeof payload.totalScore !== 'number') return null;
    const totalScore = payload.totalScore;
    if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > 50) return null;
    const scoreSum = FIVE_DIMENSION_KEYS.reduce((sum, key) => sum + normalizedScores[key].score, 0);
    if (Math.abs(scoreSum - totalScore) > 1e-9) return null;
    if ('pass' in payload && typeof payload.pass !== 'boolean') return null;
    return {
      scores: normalizedScores,
      totalScore,
      pass: typeof payload.pass === 'boolean' ? payload.pass : totalScore >= 36,
      failReason: typeof payload.failReason === 'string' ? payload.failReason : '',
      fatalIssues: Array.isArray(payload.fatalIssues) ? payload.fatalIssues as Array<Record<string, unknown>> : undefined,
      surgerySuggestions: Array.isArray(payload.surgerySuggestions) ? payload.surgerySuggestions.map(String) : undefined,
      evidence: Array.isArray(payload.evidence) ? payload.evidence : undefined,
    };
  } catch {
    return null;
  }
}

export type AuditResponseDiagnosticCode =
  | 'no_candidate'
  | 'truncated'
  | 'invalid_json'
  | 'missing_fatal_issues'
  | 'filtered_fatal_issue'
  | 'plain_text';

export interface AuditResponseDiagnostic {
  code: AuditResponseDiagnosticCode;
  summary: string;
  legacyCode: 'audit_response_unparseable' | null;
}

export interface AuditResponseParseResult {
  fiveDim?: AuditScores;
  structured?: StructuredAudit;
  diagnostic?: AuditResponseDiagnostic;
  root: 'object' | 'array' | 'none';
  candidateLength: number;
}

function auditDiagnostic(code: AuditResponseDiagnosticCode, summary: string): AuditResponseDiagnostic {
  return { code, summary, legacyCode: code === 'no_candidate' || code === 'truncated' || code === 'invalid_json' || code === 'plain_text' ? 'audit_response_unparseable' : null };
}

/** Strict parser used at Provider boundaries; tolerant legacy parser remains above for stored reports. */
export function parseAuditResponseWithDiagnostics(raw: string): AuditResponseParseResult {
  const candidate = findBalancedJson(raw);
  const trimmed = stripReasoningBlocks(stripCodeFences(raw)).trim();
  if (!trimmed || /^<(?:think|analysis|reasoning)>/i.test(trimmed)) {
    return { diagnostic: auditDiagnostic('no_candidate', '未找到审稿 JSON 候选'), root: candidate.root, candidateLength: 0 };
  }
  if (candidate.root === 'none') {
    return { diagnostic: auditDiagnostic('plain_text', 'Provider 返回了纯文本而非审稿 JSON'), root: 'none', candidateLength: 0 };
  }
  if (candidate.truncated) {
    return { diagnostic: auditDiagnostic('truncated', '审稿 JSON 未闭合，疑似达到输出长度上限'), root: candidate.root, candidateLength: candidate.candidate.length };
  }
  if (candidate.root !== 'object') {
    return { diagnostic: auditDiagnostic('invalid_json', '审稿 JSON 根节点必须是对象'), root: candidate.root, candidateLength: candidate.candidate.length };
  }

  let payload: Record<string, unknown>;
  try {
    payload = asRecord(JSON.parse(candidate.candidate));
  } catch {
    try {
      payload = asRecord(JSON.parse(repairUnescapedQuotesInJson(candidate.candidate)));
    } catch {
      return { diagnostic: auditDiagnostic('invalid_json', '审稿 JSON 语法无效'), root: candidate.root, candidateLength: candidate.candidate.length };
    }
  }

  const rawIssues = payload.fatalIssues;
  if (rawIssues === undefined || !Array.isArray(rawIssues)) {
    return { diagnostic: auditDiagnostic('missing_fatal_issues', '审稿 JSON 缺少合法 fatalIssues 数组'), root: candidate.root, candidateLength: candidate.candidate.length };
  }

  if (payload.scores !== undefined) {
    const fiveDim = parseAuditFiveDim(JSON.stringify(payload));
    if (!fiveDim) {
      return { diagnostic: auditDiagnostic('invalid_json', '审稿 JSON 未通过五维评分合同'), root: candidate.root, candidateLength: candidate.candidate.length };
    }
    const normalizedCount = convertFiveDimToStructured(fiveDim).fatalIssues.length;
    if (rawIssues.length > normalizedCount) {
      return { diagnostic: auditDiagnostic('filtered_fatal_issue', 'fatalIssues 含有字段不完整或非法条目'), root: candidate.root, candidateLength: candidate.candidate.length };
    }
    const contract = diagnoseAuditContract(JSON.stringify(payload), 'five-dim');
    if (!contract.valid) {
      const code: AuditResponseDiagnosticCode = contract.violation === 'fatal_issues_filtered' ? 'filtered_fatal_issue' : contract.violation === 'fatal_issues_missing' || contract.violation === 'fatal_issues_not_array' ? 'missing_fatal_issues' : 'invalid_json';
      return { diagnostic: auditDiagnostic(code, '审稿 JSON 未通过结构化合同校验'), root: candidate.root, candidateLength: candidate.candidate.length };
    }
    return { fiveDim, root: candidate.root, candidateLength: candidate.candidate.length };
  }

  const structured = normalizeStructuredAuditPayload(payload);
  if (!structured) {
    return { diagnostic: auditDiagnostic('invalid_json', '审稿 JSON 字段类型无效'), root: candidate.root, candidateLength: candidate.candidate.length };
  }
  if (rawIssues.length > structured.fatalIssues.length) {
    return { diagnostic: auditDiagnostic('filtered_fatal_issue', 'fatalIssues 含有字段不完整或非法条目'), root: candidate.root, candidateLength: candidate.candidate.length };
  }
  return { structured, root: candidate.root, candidateLength: candidate.candidate.length };
}

function parseDiagnosticPayload(input: unknown, mode: AuditContractMode): Record<string, unknown> | null {
  if (typeof input === 'string') {
    try {
      const parsed = mode === 'five-dim'
        ? (() => {
          try {
            return JSON.parse(findJsonObject(input));
          } catch {
            return extractJsonPayload(input);
          }
        })()
        : JSON.parse(findJsonObject(input));
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return input && typeof input === 'object' ? input as Record<string, unknown> : null;
}

/** Strict, sanitized contract diagnostics. The tolerant parsers above remain unchanged. */
export function diagnoseAuditContract(input: unknown, mode: AuditContractMode): AuditContractDiagnostic {
  const payload = parseDiagnosticPayload(input, mode);
  if (!payload) return { valid: false, violation: 'unparseable', rawIssueCount: 0, normalizedIssueCount: 0 };

  const rawIssues = payload.fatalIssues;
  const rawIssueCount = Array.isArray(rawIssues) ? rawIssues.length : 0;
  const parsed = mode === 'five-dim'
    ? parseAuditFiveDim(typeof input === 'string' ? input : JSON.stringify(payload))
    : parseStructuredAuditResponse(typeof input === 'string' ? input : JSON.stringify(payload));
  const normalizedIssueCount = parsed
    ? (mode === 'five-dim'
      ? (convertFiveDimToStructured(parsed as AuditScores).fatalIssues.length)
      : (parsed as StructuredAudit).fatalIssues.length)
    : 0;

  if (rawIssues === undefined) {
    return { valid: false, violation: CONTRACT_VIOLATIONS.fatalIssuesMissing, rawIssueCount, normalizedIssueCount };
  } else if (!Array.isArray(rawIssues)) {
    return { valid: false, violation: CONTRACT_VIOLATIONS.fatalIssuesNotArray, rawIssueCount, normalizedIssueCount };
  } else if (rawIssueCount > normalizedIssueCount) {
    return { valid: false, violation: CONTRACT_VIOLATIONS.fatalIssuesFiltered, rawIssueCount, normalizedIssueCount };
  }

  if (!parsed) return { valid: false, violation: 'invalid_scores', rawIssueCount, normalizedIssueCount };
  if (mode === 'structured') {
    const structured = parsed as StructuredAudit;
    if (structured.score < 60 && normalizedIssueCount === 0) {
      return { valid: false, violation: CONTRACT_VIOLATIONS.lowStructuredScoreWithoutIssues, rawIssueCount, normalizedIssueCount };
    }
  } else {
    const fiveDim = parsed as AuditScores;
    const gate = evaluateAuditGate(
      Object.fromEntries(Object.entries(fiveDim.scores).map(([key, value]) => [key, value.score])),
      (fiveDim.fatalIssues || []) as Array<{ dimension?: string; severity?: string }>,
    );
    if (fiveDim.pass !== gate.pass) return { valid: false, violation: CONTRACT_VIOLATIONS.passGateMismatch, rawIssueCount, normalizedIssueCount };
    const lowScore = fiveDim.totalScore < 30 || Object.values(fiveDim.scores).some((entry) => entry.score < 4);
    if (lowScore && normalizedIssueCount === 0) return { valid: false, violation: CONTRACT_VIOLATIONS.incompleteLowScore, rawIssueCount, normalizedIssueCount };
  }
  return { valid: true, violation: null, rawIssueCount, normalizedIssueCount };
}

export function convertFiveDimToStructured(fiveDim: AuditScores): StructuredAudit {
  const score = Math.round((fiveDim.totalScore / 50) * 100);
  const fatalIssues = (fiveDim.fatalIssues || [])
    .map(normalizeStructuredAuditIssue)
    .filter((issue): issue is StructuredAuditIssue => Boolean(issue));
  const surgerySuggestions = fiveDim.surgerySuggestions || [];
  const evidenceFromPayload = (fiveDim.evidence || [])
    .map(normalizeEvidence)
    .filter((item): item is StructuredAuditEvidence => Boolean(item));
  const evidence = evidenceFromPayload.length > 0 ? evidenceFromPayload : (fiveDim.fatalIssues || [])
    .map((item) => {
      const issue = normalizeStructuredAuditIssue(item);
      if (!issue) return null;
      const category: StructuredAuditEvidenceCategory = issue.issueType === 'scene-execution' || issue.issueSubtype === 'scene-layer-missing'
        ? 'scene_execution'
        : issue.issueType === 'action-chain' || issue.issueType === 'hook-ending' || issue.issueSubtype === 'generic-ending'
          ? 'foreshadowing'
          : issue.issueType === 'duplicate' || issue.issueType === 'syntax' || issue.issueType === 'style-slop'
            ? 'pacing'
            : issue.issueType === 'dialogue-logic'
              ? 'character_state'
              : 'hard_canon';
      const quote = issue.snippet.trim();
      if (!quote) return null;
      return {
        category,
        severity: issue.severity === 'critical' ? 'high' : issue.severity === 'moderate' ? 'low' : 'medium',
        quote,
        explanation: issue.explanation,
        suggestedFix: issue.patchHint,
      } satisfies StructuredAuditEvidence;
    })
    .filter((item): item is StructuredAuditEvidence => Boolean(item));
  return {
    score,
    fatalIssues,
    sceneChecks: [],
    surgerySuggestions,
    evidence,
  };
}

const DIMENSION_LABELS: Record<string, string> = {
  prose: '文笔',
  narrative: '叙事',
  character: '角色',
  setting: '设定',
  pacing: '节奏',
  readerPull: '追读力',
  platformFit: '番茄适配',
};

export function renderFiveDimMarkdown(audit: AuditScores): string {
  const lines: string[] = [];
  const gate = evaluateAuditGate(
    Object.fromEntries(Object.entries(audit.scores).map(([key, value]) => [key, value.score])),
    (audit.fatalIssues || []) as Array<{ dimension?: string; severity?: string }>,
  );
  lines.push(gate.pass ? '## PASS' : '## FAIL');
  if (!gate.pass) lines.push(`**失败原因**: ${gate.blockReason || audit.failReason || '未通过审计门禁'}`);
  lines.push('');
  lines.push('| 维度 | 评分 | 原因 |');
  lines.push('|------|------|------|');
  for (const [dim, val] of Object.entries(audit.scores)) {
    const v = val as { score: number; reason: string };
    const label = DIMENSION_LABELS[dim] || dim;
    lines.push(`| ${label} | ${v.score}/10 | ${v.reason || '-'} |`);
  }
  lines.push(`| **总分** | **${audit.totalScore}/50** | |`);

  if (audit.fatalIssues && audit.fatalIssues.length > 0) {
    lines.push('');
    lines.push('## 致命问题');
    const formattedIssues = audit.fatalIssues
      .map(normalizeStructuredAuditIssue)
      .filter((issue): issue is StructuredAuditIssue => Boolean(issue))
      .map((issue) => `- [${issue.issueType}/${issue.issueSubtype}]${issue.dimension ? ` [${issue.dimension}]` : ''} "${issue.snippet}"\n  - 问题：${issue.explanation}\n  - 修补建议：${issue.patchHint}`);
    if (formattedIssues.length > 0) {
      lines.push(formattedIssues.join('\n'));
    } else {
      lines.push('- 本轮未识别出明确致命问题。');
    }
  }

  if (audit.surgerySuggestions && audit.surgerySuggestions.length > 0) {
    lines.push('');
    lines.push('## 手术建议');
    lines.push(audit.surgerySuggestions.map((item) => `- ${item}`).join('\n'));
  }

  return lines.join('\n');
}

export function renderStructuredAuditMarkdown(audit: StructuredAudit): string {
  const issues = audit.fatalIssues.length > 0
    ? audit.fatalIssues
        .map((issue) => `- [${issue.issueType}/${issue.issueSubtype}]${issue.dimension ? ` [${issue.dimension}]` : ''} "${issue.snippet}"\n  - 问题：${issue.explanation}\n  - 修补建议：${issue.patchHint}`)
        .join('\n')
    : '- 本轮未识别出明确致命问题。';

  const sceneChecks = audit.sceneChecks.length > 0
    ? audit.sceneChecks
        .map((check) => `- ${check.scene} [${check.status}]：${check.note}`)
        .join('\n')
    : '- 本轮未返回分镜执行检查。';

  const surgerySuggestions = audit.surgerySuggestions.length > 0
    ? audit.surgerySuggestions.map((item) => `- ${item}`).join('\n')
    : '- 本轮未返回手术建议。';

  const evidenceItems = audit.evidence || [];
  const evidence = evidenceItems.length > 0
    ? evidenceItems.map((item) => `- [${item.category}/${item.severity}] "${item.quote}"\n  - 证据：${item.explanation}\n  - 修复：${item.suggestedFix}${item.location ? `\n  - 位置：${item.location}` : ''}`).join('\n')
    : '- 本轮未返回结构化证据。';

  return [
    '## 评分',
    `- ${audit.score}/100`,
    '',
    '## 致命问题',
    issues,
    '',
    '## 分镜执行检查',
    sceneChecks,
    '',
    '## 手术建议',
    surgerySuggestions,
    '',
    '## 结构化证据',
    evidence,
  ].join('\n');
}

export function embedStructuredAudit(markdown: string, audit: StructuredAudit): string {
  const encoded = encodeBase64Utf8(JSON.stringify(audit));
  return `${markdown.trim()}\n\n<!-- ${AUDIT_COMMENT_PREFIX}${encoded} -->`;
}

export function stripEmbeddedStructuredAudit(critique: string): string {
  if (!critique) return '';
  return critique.replace(/\s*<!--\s*audit-structured:[A-Za-z0-9+/=]*\s*-->/g, '').trim();
}

export function extractStructuredAudit(critique: string): StructuredAudit | null {
  const match = critique.match(/<!--\s*audit-structured:([A-Za-z0-9+/=]+)\s*-->/);
  if (!match?.[1]) return null;
  try {
    const decoded = decodeBase64Utf8(match[1]);
    return parseStructuredAuditResponse(decoded);
  } catch {
    return null;
  }
}

// ── Audit Gate (Novel-OS inspired) ──────────────────────────────────

export interface AuditGateResult {
  pass: boolean;
  blockReason: string | null;
  criticalFails: string[];
}

export function computeTrend(scores: number[]): 'rising' | 'falling' | 'flat' {
  if (scores.length < 2) return 'flat';
  const recent = scores.slice(-3);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (last > first + 0.5) return 'rising';
  if (last < first - 0.5) return 'falling';
  return 'flat';
}

export function evaluateAuditGate(
  scores: Record<string, number>,
  fatalIssues: Array<{ dimension?: string; severity?: string }>,
): AuditGateResult {
  const GATE_MIN_TOTAL = 30;
  const GATE_MIN_DIMENSION = 4;
  const GATE_MAX_CRITICAL = 0;

  const criticalFails: string[] = [];

  const scoreKeys = Object.keys(scores);
  const hasExactDimensions = scoreKeys.length === FIVE_DIMENSION_KEYS.length &&
    FIVE_DIMENSION_KEYS.every((key) => Object.prototype.hasOwnProperty.call(scores, key));
  if (!hasExactDimensions) {
    criticalFails.push('评分维度必须恰好包含固定五维');
  }

  for (const key of scoreKeys) {
    const score = scores[key];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10) {
      criticalFails.push(`${key} 评分必须为 0-10 的有限数字`);
    }
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total < GATE_MIN_TOTAL) {
    criticalFails.push(`总分 ${total} < 阈值 ${GATE_MIN_TOTAL}`);
  }

  for (const [dim, score] of Object.entries(scores)) {
    if (score < GATE_MIN_DIMENSION) {
      criticalFails.push(`${dim} ${score} < 阈值 ${GATE_MIN_DIMENSION}`);
    }
  }

  const criticalIssues = fatalIssues.filter(i => i.severity === 'critical');
  if (criticalIssues.length > GATE_MAX_CRITICAL) {
    criticalFails.push(`${criticalIssues.length} 个严重问题未解决`);
  }

  return {
    pass: criticalFails.length === 0,
    blockReason: criticalFails.length > 0 ? criticalFails.join('；') : null,
    criticalFails,
  };
}
