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

export interface StructuredAudit {
  score: number;
  fatalIssues: StructuredAuditIssue[];
  sceneChecks: StructuredAuditSceneCheck[];
  surgerySuggestions: string[];
}

const AUDIT_COMMENT_PREFIX = 'audit-structured:';

function stripCodeFences(raw: string): string {
  return raw.replace(/```json/g, '').replace(/```/g, '').trim();
}

function findJsonObject(raw: string): string {
  const trimmed = stripCodeFences(raw);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return trimmed;
  }
  return trimmed.slice(start, end + 1);
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
    case 'major':
    case 'moderate':
      return value;
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value != null ? String(value) : '';
}

function normalizeStructuredAuditIssue(item: unknown): StructuredAuditIssue | null {
  const r = asRecord(item);
  const snippet = stringValue(r.snippet).trim();
  const explanation = stringValue(r.planation || r.explanation || r.reason || '').trim();
  const patchHint = stringValue(r.patchHint || r.fix || '').trim();
  if (!snippet || !explanation || !patchHint) return null;

  return {
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

  return {
    score,
    fatalIssues,
    sceneChecks,
    surgerySuggestions,
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
}

export function parseAuditFiveDim(raw: string): AuditScores | null {
  try {
    const parsed = extractJsonPayload(raw);
    if (!parsed || !parsed.scores || !('totalScore' in parsed)) return null;
    const totalScore = Number(parsed.totalScore);
    if (!Number.isFinite(totalScore)) return null;
    return {
      scores: parsed.scores,
      totalScore,
      pass: parsed.pass ?? (totalScore >= 36),
      failReason: parsed.failReason || '',
      fatalIssues: Array.isArray(parsed.fatalIssues) ? parsed.fatalIssues as Array<Record<string, unknown>> : undefined,
      surgerySuggestions: Array.isArray(parsed.surgerySuggestions) ? parsed.surgerySuggestions.map(String) : undefined,
    };
  } catch {
    return null;
  }
}

export function convertFiveDimToStructured(fiveDim: AuditScores): StructuredAudit {
  const maxTotal = Object.keys(fiveDim.scores).length * 10;
  const score = maxTotal > 0 ? Math.round((fiveDim.totalScore / maxTotal) * 100) : 0;
  const fatalIssues = (fiveDim.fatalIssues || [])
    .map(normalizeStructuredAuditIssue)
    .filter((issue): issue is StructuredAuditIssue => Boolean(issue));
  const surgerySuggestions = fiveDim.surgerySuggestions || [];
  return {
    score,
    fatalIssues,
    sceneChecks: [],
    surgerySuggestions,
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
  lines.push(audit.pass ? '## PASS' : '## FAIL');
  if (!audit.pass && audit.failReason) lines.push(`**失败原因**: ${audit.failReason}`);
  lines.push('');
  lines.push('| 维度 | 评分 | 原因 |');
  lines.push('|------|------|------|');
  for (const [dim, val] of Object.entries(audit.scores)) {
    const v = val as { score: number; reason: string };
    const label = DIMENSION_LABELS[dim] || dim;
    lines.push(`| ${label} | ${v.score}/10 | ${v.reason || '-'} |`);
  }
  const maxTotal = Object.keys(audit.scores).length * 10;
  lines.push(`| **总分** | **${audit.totalScore}/${maxTotal}** | |`);

  if (audit.fatalIssues && audit.fatalIssues.length > 0) {
    lines.push('');
    lines.push('## 致命问题');
    const formattedIssues = audit.fatalIssues
      .map(normalizeStructuredAuditIssue)
      .filter((issue): issue is StructuredAuditIssue => Boolean(issue))
      .map((issue) => `- [${issue.issueType}/${issue.issueSubtype}] "${issue.snippet}"\n  - 问题：${issue.explanation}\n  - 修补建议：${issue.patchHint}`);
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
        .map((issue) => `- [${issue.issueType}/${issue.issueSubtype}] "${issue.snippet}"\n  - 问题：${issue.explanation}\n  - 修补建议：${issue.patchHint}`)
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
  ].join('\n');
}

export function embedStructuredAudit(markdown: string, audit: StructuredAudit): string {
  const encoded = Buffer.from(JSON.stringify(audit), 'utf8').toString('base64');
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
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
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
