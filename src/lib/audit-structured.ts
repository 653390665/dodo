export type StructuredAuditIssueType =
  | 'duplicate'
  | 'dialogue-logic'
  | 'syntax'
  | 'scene-execution'
  | 'general';

export type StructuredAuditIssueSubtype =
  | 'duplicate-rupture'
  | 'dialogue-abrupt-info'
  | 'dialogue-answer-gap'
  | 'dialogue-general'
  | 'syntax-invalid-phrase'
  | 'scene-layer-missing'
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

export function parseStructuredAuditResponse(raw: string): StructuredAudit | null {
  const candidate = findJsonObject(raw);
  try {
    const parsed = JSON.parse(candidate);
    const score = Number(parsed?.score);
    if (!Number.isFinite(score)) return null;

    const fatalIssues = Array.isArray(parsed?.fatalIssues)
      ? parsed.fatalIssues
          .map((issue: any): StructuredAuditIssue | null => {
            const snippet = String(issue?.snippet || '').trim();
            const explanation = String(issue?.planation || issue?.explanation || '').trim();
            const patchHint = String(issue?.patchHint || '').trim();
            if (!snippet || !explanation || !patchHint) return null;
            return {
              issueType: normalizeIssueType(String(issue?.issueType || 'general')),
              issueSubtype: normalizeIssueSubtype(String(issue?.issueSubtype || 'general')),
              severity: normalizeSeverity(String(issue?.severity || 'major')),
              snippet,
              explanation,
              patchHint,
            };
          })
          .filter((issue): issue is StructuredAuditIssue => Boolean(issue))
      : [];

    const sceneChecks = Array.isArray(parsed?.sceneChecks)
      ? parsed.sceneChecks
          .map((check: any): StructuredAuditSceneCheck | null => {
            const scene = String(check?.scene || '').trim();
            const note = String(check?.note || '').trim();
            if (!scene || !note) return null;
            return {
              scene,
              status: normalizeSceneStatus(String(check?.status || 'weak')),
              note,
            };
          })
          .filter((check): check is StructuredAuditSceneCheck => Boolean(check))
      : [];

    const surgerySuggestions = Array.isArray(parsed?.surgerySuggestions)
      ? parsed.surgerySuggestions.map((item: any) => String(item || '').trim()).filter(Boolean)
      : [];

    return {
      score,
      fatalIssues,
      sceneChecks,
      surgerySuggestions,
    };
  } catch {
    try {
      const repaired = JSON.parse(repairUnescapedQuotesInJson(candidate));
      const score = Number(repaired?.score);
      if (!Number.isFinite(score)) return null;

      const fatalIssues = Array.isArray(repaired?.fatalIssues)
        ? repaired.fatalIssues
            .map((issue: any): StructuredAuditIssue | null => {
              const snippet = String(issue?.snippet || '').trim();
              const explanation = String(issue?.planation || issue?.explanation || '').trim();
              const patchHint = String(issue?.patchHint || '').trim();
              if (!snippet || !explanation || !patchHint) return null;
              return {
                issueType: normalizeIssueType(String(issue?.issueType || 'general')),
                issueSubtype: normalizeIssueSubtype(String(issue?.issueSubtype || 'general')),
                severity: normalizeSeverity(String(issue?.severity || 'major')),
                snippet,
                explanation,
                patchHint,
              };
            })
            .filter((issue): issue is StructuredAuditIssue => Boolean(issue))
        : [];

      const sceneChecks = Array.isArray(repaired?.sceneChecks)
        ? repaired.sceneChecks
            .map((check: any): StructuredAuditSceneCheck | null => {
              const scene = String(check?.scene || '').trim();
              const note = String(check?.note || '').trim();
              if (!scene || !note) return null;
              return {
                scene,
                status: normalizeSceneStatus(String(check?.status || 'weak')),
                note,
              };
            })
            .filter((check): check is StructuredAuditSceneCheck => Boolean(check))
        : [];

      const surgerySuggestions = Array.isArray(repaired?.surgerySuggestions)
        ? repaired.surgerySuggestions.map((item: any) => String(item || '').trim()).filter(Boolean)
        : [];

      return {
        score,
        fatalIssues,
        sceneChecks,
        surgerySuggestions,
      };
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
}

export function parseAuditFiveDim(raw: string): AuditScores | null {
  const trimmed = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (!parsed.scores || !('totalScore' in parsed)) return null;
    const totalScore = Number(parsed.totalScore);
    if (!Number.isFinite(totalScore)) return null;
    return {
      scores: parsed.scores,
      totalScore,
      pass: parsed.pass ?? (totalScore >= 30),
      failReason: parsed.failReason || '',
    };
  } catch {
    return null;
  }
}

export function renderFiveDimMarkdown(audit: AuditScores): string {
  const lines: string[] = [];
  lines.push(audit.pass ? '## PASS' : '## FAIL');
  if (!audit.pass && audit.failReason) lines.push(`**失败原因**: ${audit.failReason}`);
  lines.push('');
  lines.push('| 维度 | 评分 | 原因 |');
  lines.push('|------|------|------|');
  for (const [dim, val] of Object.entries(audit.scores)) {
    const v = val as { score: number; reason: string };
    lines.push(`| ${dim} | ${v.score}/10 | ${v.reason || '-'} |`);
  }
  lines.push(`| **总分** | **${audit.totalScore}/50** | |`);
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
