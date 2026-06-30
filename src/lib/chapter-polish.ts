import { extractStructuredAudit } from './audit-structured';

export interface PolishTargetWindow {
  start: number;
  end: number;
  targetText: string;
  beforeContext: string;
  afterContext: string;
  matchedSnippet: string;
}

export interface ExtractedPolishTargets {
  duplicateTargets: string[];
  rewriteTargets: string[];
}

export interface SelectedRewriteTarget {
  snippet: string;
  window: PolishTargetWindow;
  confidence: 'high' | 'medium';
  issueType: 'duplicate' | 'dialogue-logic' | 'syntax' | 'scene-execution' | 'general';
  issueSubtype:
    | 'duplicate-rupture'
    | 'dialogue-abrupt-info'
    | 'dialogue-answer-gap'
    | 'dialogue-general'
    | 'syntax-invalid-phrase'
    | 'scene-layer-missing'
    | 'general';
  priority: number;
}

function normalizeSnippet(snippet: string): string {
  return snippet
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '')
    .trim();
}

function getSnippetPrefixes(snippet: string): string[] {
  const normalized = normalizeSnippet(snippet);
  const prefixes = [normalized, normalized.replace(/[…—"“”]/g, '').trim()];
  const sentenceBreak = normalized.search(/[。！？]/);
  if (sentenceBreak > 0) {
    const firstSentence = normalized.slice(0, sentenceBreak + 1).trim();
    if (firstSentence.length >= 6) {
      prefixes.push(firstSentence);
    }
  }
  const softBreak = normalized.search(/[，、……]/);
  if (softBreak > 0) {
    const firstClause = normalized.slice(0, softBreak).trim();
    if (firstClause.length >= 6) {
      prefixes.push(firstClause);
    }
  }
  return uniqueInOrder(prefixes);
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function findParagraphBounds(content: string, start: number, end: number): { start: number; end: number } {
  const beforeBreak = content.lastIndexOf('\n\n', start);
  const afterBreak = content.indexOf('\n\n', end);
  return {
    start: beforeBreak === -1 ? 0 : beforeBreak + 2,
    end: afterBreak === -1 ? content.length : afterBreak,
  };
}

function countDuplicateParagraphs(text: string): number {
  const counts = new Map<string, number>();
  for (const paragraph of splitParagraphs(text)) {
    counts.set(paragraph, (counts.get(paragraph) || 0) + 1);
  }
  let duplicates = 0;
  for (const value of counts.values()) {
    if (value > 1) duplicates += value - 1;
  }
  return duplicates;
}

function classifyIssueType(context: string): SelectedRewriteTarget['issueType'] {
  if (/(重复|悬念崩塌|节奏断裂|字数虚增|重复危机)/.test(context)) {
    return 'duplicate';
  }
  if (/(上下文断裂|信息出现突兀|突兀|逻辑衔接|前因|铺垫|接住|半截信息)/.test(context)) {
    return 'dialogue-logic';
  }
  if (/(病句|不通顺|语义错误|规范词汇|疑似病句)/.test(context)) {
    return 'syntax';
  }
  if (/(写弱|缺失|分镜|关键道具|没写|执行情况)/.test(context)) {
    return 'scene-execution';
  }
  return 'general';
}

function classifyIssueSubtype(
  issueType: SelectedRewriteTarget['issueType'],
  context: string,
): SelectedRewriteTarget['issueSubtype'] {
  switch (issueType) {
    case 'duplicate':
      return 'duplicate-rupture';
    case 'dialogue-logic':
      if (/(信息出现突兀|突兀|半截信息)/.test(context)) return 'dialogue-abrupt-info';
      if (/(上下文断裂|逻辑衔接|前因|铺垫|接住)/.test(context)) return 'dialogue-answer-gap';
      return 'dialogue-general';
    case 'syntax':
      return 'syntax-invalid-phrase';
    case 'scene-execution':
      return 'scene-layer-missing';
    default:
      return 'general';
  }
}

function issuePriority(issueSubtype: SelectedRewriteTarget['issueSubtype']): number {
  switch (issueSubtype) {
    case 'duplicate-rupture':
      return 6;
    case 'dialogue-abrupt-info':
      return 5;
    case 'dialogue-answer-gap':
      return 4;
    case 'syntax-invalid-phrase':
      return 3;
    case 'scene-layer-missing':
      return 2;
    case 'dialogue-general':
      return 2;
    default:
      return 1;
  }
}

function buildRewriteIssueSignals(
  critique: string,
): Map<string, { issueType: SelectedRewriteTarget['issueType']; issueSubtype: SelectedRewriteTarget['issueSubtype']; priority: number }> {
  const structured = extractStructuredAudit(critique);
  if (structured) {
    return new Map(
      structured.fatalIssues
        .filter((issue) => issue.snippet)
        .map((issue) => [
          normalizeSnippet(issue.snippet),
          {
            issueType: issue.issueType,
            issueSubtype: issue.issueSubtype,
            priority: issuePriority(issue.issueSubtype),
          },
        ]),
    );
  }

  const signals = new Map<string, { issueType: SelectedRewriteTarget['issueType']; issueSubtype: SelectedRewriteTarget['issueSubtype']; priority: number }>();
  const lines = critique.split('\n');
  let inActionableSection = false;
  let issueHeading = '';
  let issueBody: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (/^##\s+致命问题/.test(trimmedLine) || /^##\s+分镜执行检查/.test(trimmedLine)) {
      inActionableSection = true;
      issueHeading = '';
      issueBody = [];
      continue;
    }
    if (/^##\s+手术建议/.test(trimmedLine)) {
      inActionableSection = false;
      issueHeading = '';
      issueBody = [];
      continue;
    }
    if (!inActionableSection) continue;

    if (/^###\s+/.test(trimmedLine)) {
      issueHeading = trimmedLine.replace(/^###\s+/, '');
      issueBody = [];
      continue;
    }

    if (trimmedLine.startsWith('>')) {
      const body = trimmedLine.replace(/^>\s*/, '').trim();
      const snippet = normalizeSnippet(body.replace(/——.*$/, '').trim());
      if (!snippet) continue;
      const context = [issueHeading, ...issueBody].join(' ');
      const issueType = classifyIssueType(context);
      const issueSubtype = classifyIssueSubtype(issueType, context);
      signals.set(snippet, { issueType, issueSubtype, priority: issuePriority(issueSubtype) });
      continue;
    }

    if (trimmedLine) {
      issueBody.push(trimmedLine);
    }
  }

  return signals;
}

export function extractPolishTargetsFromCritique(critique: string): ExtractedPolishTargets {
  const structured = extractStructuredAudit(critique);
  if (structured) {
    return {
      duplicateTargets: uniqueInOrder(
        structured.fatalIssues
          .filter((issue) => issue.issueType === 'duplicate')
          .map((issue) => normalizeSnippet(issue.snippet)),
      ),
      rewriteTargets: uniqueInOrder(
        structured.fatalIssues
          .filter((issue) => issue.issueType !== 'duplicate')
          .map((issue) => normalizeSnippet(issue.snippet)),
      ),
    };
  }

  const duplicateTargets: string[] = [];
  const rewriteTargets: string[] = [];
  const lines = critique.split('\n');
  let inActionableSection = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (/^##\s+致命问题/.test(trimmedLine) || /^##\s+分镜执行检查/.test(trimmedLine)) {
      inActionableSection = true;
      continue;
    }
    if (/^##\s+手术建议/.test(trimmedLine)) {
      inActionableSection = false;
      continue;
    }

    if (!inActionableSection) continue;
    if (!trimmedLine.startsWith('>')) continue;
    const body = trimmedLine.replace(/^>\s*/, '').trim();
    if (!body) continue;
    const snippet = normalizeSnippet(body.replace(/——.*$/, '').trim());
    if (!snippet) continue;
    if (/(出现[\s*]*(?:两|二|三|[2-9])[\s*]*次|重复|删除后续所有重复)/.test(body)) {
      duplicateTargets.push(snippet);
    } else {
      rewriteTargets.push(snippet);
    }
  }

  return {
    duplicateTargets: uniqueInOrder(duplicateTargets),
    rewriteTargets: uniqueInOrder(rewriteTargets),
  };
}

export function removeRepeatedQuotedBlocks(content: string, quotedSnippets: string[]): { content: string; removedCount: number } {
  const paragraphs = content.split(/\n{2,}/);
  const keep = new Array(paragraphs.length).fill(true);
  let removedCount = 0;

  for (const rawSnippet of quotedSnippets) {
    const snippet = normalizeSnippet(rawSnippet);
    if (!snippet) continue;
    const matchers = getSnippetPrefixes(snippet);

    let firstMatchSeen = false;
    for (let index = 0; index < paragraphs.length; index += 1) {
      if (!keep[index]) continue;
      const paragraph = paragraphs[index].trim();
      if (!matchers.some((matcher) => matcher && paragraph.includes(matcher))) continue;
      if (!firstMatchSeen) {
        firstMatchSeen = true;
        continue;
      }
      keep[index] = false;
      removedCount += 1;
    }
  }

  const seenParagraphs = new Set<string>();
  for (let index = 0; index < paragraphs.length; index += 1) {
    if (!keep[index]) continue;
    const paragraph = paragraphs[index].trim();
    if (paragraph.length < 6) continue;
    if (seenParagraphs.has(paragraph)) {
      keep[index] = false;
      removedCount += 1;
      continue;
    }
    seenParagraphs.add(paragraph);
  }

  return {
    content: keep
      .map((shouldKeep, index) => (shouldKeep ? paragraphs[index].trim() : null))
      .filter((value): value is string => value !== null && value.length > 0)
      .join('\n\n'),
    removedCount,
  };
}

export function findPatchWindow(content: string, snippet: string, contextChars = 240): PolishTargetWindow | null {
  const targetText = normalizeSnippet(snippet);
  if (!targetText) return null;
  let matchedText = targetText;
  let start = content.indexOf(targetText);
  if (start === -1) {
    for (const matcher of getSnippetPrefixes(targetText)) {
      if (!matcher) continue;
      const nextStart = content.indexOf(matcher);
      if (nextStart !== -1) {
        start = nextStart;
        matchedText = matcher;
        break;
      }
    }
  }
  if (start === -1) return null;
  const matchEnd = start + matchedText.length;
  const bounds = findParagraphBounds(content, start, matchEnd);
  const paragraphText = content.slice(bounds.start, bounds.end).trim();

  return {
    start: bounds.start,
    end: bounds.end,
    targetText: paragraphText,
    beforeContext: content.slice(Math.max(0, bounds.start - contextChars), bounds.start),
    afterContext: content.slice(bounds.end, Math.min(content.length, bounds.end + contextChars)),
    matchedSnippet: matchedText,
  };
}

export function applyPatchWindow(content: string, window: PolishTargetWindow, replacement: string): string {
  return `${content.slice(0, window.start)}${replacement.trim()}${content.slice(window.end)}`;
}

function scoreRewriteTarget(
  content: string,
  snippet: string,
  signal?: {
    issueType: SelectedRewriteTarget['issueType'];
    issueSubtype: SelectedRewriteTarget['issueSubtype'];
    priority: number;
  },
): SelectedRewriteTarget | null {
  const normalized = normalizeSnippet(snippet);
  const issueType = signal?.issueType || 'general';
  const issueSubtype = signal?.issueSubtype || 'general';
  const priority = signal?.priority || 1;
  if (!normalized || normalized.length < 6) return null;
  if (/描写段落$/.test(normalized)) return null;
  if (/…{1,}$/.test(normalized) && issueType !== 'scene-execution') return null;

  const window = findPatchWindow(content, normalized);
  if (!window) return null;

  let score = 0;
  if (window.matchedSnippet === normalized) score += 3;
  if (/[。！？]/.test(normalized)) score += 1;
  if (/["“”]/.test(normalized)) score -= 1;
  if (/……/.test(normalized)) score -= 1;
  if (/…{1,}$/.test(normalized)) score -= 1;
  if (normalized.length >= 10 && normalized.length <= 90) score += 1;
  if (window.targetText.length <= 220) score += 1;
  if (window.targetText.length > 320) score -= 2;
  if (issueSubtype === 'dialogue-abrupt-info') score += 2;
  if (issueSubtype === 'dialogue-answer-gap') score += 1;
  if (issueSubtype === 'syntax-invalid-phrase') score += 1;
  if (issueType === 'scene-execution') {
    const quoteCount = (window.targetText.match(/["“”]/g) || []).length;
    const sentenceCount = (window.targetText.match(/[。！？]/g) || []).length;
    if (window.targetText.length > 180) return null;
    if (quoteCount > 2) return null;
    if (sentenceCount > 3) return null;
  }
  score += priority;

  return {
    snippet,
    window,
    confidence: score >= 4 ? 'high' : 'medium',
    issueType,
    issueSubtype,
    priority,
  };
}

export function selectRewriteTargetsForPatch(content: string, rewriteTargets: string[], limit = 3, critique = ''): SelectedRewriteTarget[] {
  const signals = critique
    ? buildRewriteIssueSignals(critique)
    : new Map<string, { issueType: SelectedRewriteTarget['issueType']; issueSubtype: SelectedRewriteTarget['issueSubtype']; priority: number }>();
  return rewriteTargets
    .map((snippet) => scoreRewriteTarget(content, snippet, signals.get(normalizeSnippet(snippet))))
    .filter((entry): entry is SelectedRewriteTarget => Boolean(entry))
    .sort((left, right) => {
      if (left.priority !== right.priority) return right.priority - left.priority;
      const leftRank = left.confidence === 'high' ? 2 : 1;
      const rightRank = right.confidence === 'high' ? 2 : 1;
      if (leftRank !== rightRank) return rightRank - leftRank;
      return left.window.targetText.length - right.window.targetText.length;
    })
    .slice(0, limit);
}

export function validatePolishCandidate(original: string, candidate: string): { ok: boolean; reason?: string } {
  const trimmedCandidate = candidate.trim();
  if (!trimmedCandidate) {
    return { ok: false, reason: 'empty-result' };
  }

  const originalDuplicates = countDuplicateParagraphs(original);
  const candidateDuplicates = countDuplicateParagraphs(candidate);
  if (candidateDuplicates > originalDuplicates) {
    return { ok: false, reason: 'duplicate-regression' };
  }

  const originalLength = Math.max(original.trim().length, 1);
  const candidateLength = trimmedCandidate.length;
  const ratio = candidateLength / originalLength;
  if (ratio < 0.7 || ratio > 1.3) {
    return { ok: false, reason: 'length-regression' };
  }

  if (candidate === original) {
    return { ok: false, reason: 'no-change' };
  }

  return { ok: true };
}
