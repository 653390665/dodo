/**
 * Plan 269：门禁命中 → 段落级定点修复。
 *
 * 正文质量门在整章判定里会把「机械分达标、只有 3-4 处表层软命中」的好稿判死：
 * 实测 run（5772 字 / 机械分 89.6）只因为 3 个 tell_dont_show 副词与 1 处句长单调
 * 就落到 literary-slop/P1，整章被丢弃、回退模板保底稿。门禁的机械审查本来就带定位
 * 信息（`SlopHit.range` / `scope`，源码注释写明 "Source range for a local context
 * rewrite request"），只是生产链路从未消费它。
 *
 * 本模块只做两件纯事：**挑出可定点修的目标**与**把替换文本安全地写回**。
 * 判定、模型调用、失败后的整章重写/保底稿都留在管线侧
 * （`server/helpers/ai-production-pipeline.ts`）。这样切分的好处：
 * - 目标选择与写回可单测（无模型、无 DB）；
 * - 本模块不是新门禁、不放宽阈值：修完仍要过同一套 `validateCompleteChapterDraftQuality`。
 */

/** 只有这两类 finding 允许走定点修复；结构/模板/长度/机械分等硬缺陷一律不修。 */
export const LOCAL_REPAIR_ALLOWED_FINDING_CODES = ['literary-slop', 'literary-polish'] as const;

/** 机械审查里与「表层文风」相关的命中类别（slop-scorer 的 category 取值）。 */
export const LOCAL_REPAIR_CATEGORIES = ['ai_cliche', 'style_slop', 'tell_dont_show'] as const;

/** 单次定点修复最多处理的句子数——超过就交回整章重写，避免把改稿轮变成第二篇长文。 */
export const MAX_LOCAL_REPAIR_TARGETS = 6;

/** 单句替换文本的有效字符膨胀上限；超出视为模型扩写，丢弃该句。 */
export const MAX_LOCAL_REPAIR_GROWTH_CHARS = 320;

/** 每句取多少前后随文给 surgical-patch 判断衔接。 */
export const LOCAL_REPAIR_CONTEXT_CHARS = 240;

/** 命中片段扩到整句的长度上限；超过就退回原片段（整段长句交给模型容易扩写）。 */
export const MAX_LOCAL_REPAIR_SENTENCE_CHARS = 240;

/**
 * Plan 276：定点修复最多跑两轮。第一轮修不全时，用「修过但仍有残留」的正文重新挑目标再修一轮，
 * 而不是立刻回落到整章重写（实测一处残留就换掉整篇模型稿太贵）。
 */
export const MAX_LOCAL_REPAIR_ROUNDS = 2;

/** Plan 276：批量定点修复的响应标记；模型被要求每处输出一行 `@@FIX n@@` 再接那一处修好的整句。 */
export const LOCAL_REPAIR_BATCH_MARKER = '@@FIX';

/** 句末标点（含换行）：门禁的机械命中片段是截断的（实测 8 字符、无 range/scope），扩回整句靠它定位句首/句末。 */
const SENTENCE_END_CHARS = '。！？!?…；;';

/** 机械审查命中的运行时形态（契约类型只暴露 category/line/snippet/suggestion）。 */
export interface LocalRepairHitLike {
  category?: string;
  line?: number;
  snippet?: string;
  suggestion?: string;
  priority?: string;
  range?: { start?: number; end?: number };
  scope?: {
    paragraphStart?: number;
    paragraphEnd?: number;
    sentenceStart?: number;
    sentenceEnd?: number;
  };
}

/** 门禁 finding 的最小形态（只用于判定硬缺陷）。 */
export interface LocalRepairFindingLike {
  code?: string;
  severity?: string;
}

export interface LocalRepairTarget {
  /** 稳定键：类别 + 行号 + 起点，供日志与测试对照。 */
  key: string;
  category: string;
  line: number;
  /** 被点名片段所在的整句（模型只被要求改这一段）。 */
  snippet: string;
  suggestion?: string;
  /** 在整章正文里的字符区间（左闭右开），已夹紧到合法范围。 */
  start: number;
  end: number;
  /** 衔接用前后文（按 LOCAL_REPAIR_CONTEXT_CHARS 截断）。 */
  before: string;
  after: string;
}

export interface LocalRepairSelection {
  /** true = 有可定点修复的目标；false = 交回整章重写/保底稿。 */
  repair: boolean;
  targets: LocalRepairTarget[];
  /** repair=false 时的原因码（见 LOCAL_REPAIR_WARNING_REASONS 注释）。 */
  reason?: string;
  /** 命中里定位失败、重叠或超出上限而跳过的条数。 */
  skipped: number;
}

export interface LocalRepairApplication {
  text: string;
  applied: number;
  skipped: number;
}

/** 与门禁同口径的「有效字符」计数（去掉全部空白）。 */
export function compactTextLength(text: string): number {
  return String(text || '').replace(/\s+/g, '').length;
}

function clampRange(text: string, start: unknown, end: unknown): { start: number; end: number } | null {
  const rawStart = Math.floor(Number(start));
  const rawEnd = Math.floor(Number(end));
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;
  const clampedStart = Math.max(0, Math.min(text.length, rawStart));
  const clampedEnd = Math.max(0, Math.min(text.length, rawEnd));
  if (clampedEnd - clampedStart < 2) return null;
  return { start: clampedStart, end: clampedEnd };
}

function locateHit(
  text: string,
  hit: LocalRepairHitLike,
  snippet: string,
  line: number,
  lineOffsets: number[]
): { start: number; end: number } | null {
  // 1) 机械审查若带了精确区间，直接用（最可靠）。
  const ranged = clampRange(text, hit.range?.start, hit.range?.end);
  if (ranged) return ranged;
  // 2) 退到段落区间（scope）。
  const scoped = clampRange(text, hit.scope?.paragraphStart, hit.scope?.paragraphEnd);
  if (scoped) return scoped;
  // 3) 契约定型路径：按 line 起点的 snippet 首次出现定位；找不到再全篇找一次。
  if (!snippet) return null;
  const from = line > 0 && line <= lineOffsets.length ? lineOffsets[line - 1] : 0;
  let at = text.indexOf(snippet, Math.max(0, from));
  if (at < 0) at = text.indexOf(snippet);
  if (at < 0) return null;
  return { start: at, end: at + snippet.length };
}

/**
 * 把定位到的片段扩到所在整句。门禁的机械命中片段是截断的（实测 `极其简陋的黄色外`，8 字符、
 * 无 range/scope）：只替换片段会把半句话留在正文里（“黄色外”被换成整句 → “……卖界面。”残留）。
 * 扩到句末标点/换行；扩出来超过 MAX_LOCAL_REPAIR_SENTENCE_CHARS 就退回原片段。
 */
function expandToSentence(
  text: string,
  span: { start: number; end: number }
): { start: number; end: number } {
  let start = span.start;
  while (start > 0) {
    const previous = text[start - 1];
    if (previous === '\n' || SENTENCE_END_CHARS.includes(previous)) break;
    start -= 1;
  }
  let end = span.end;
  while (end < text.length) {
    const current = text[end];
    end += 1;
    if (current === '\n' || SENTENCE_END_CHARS.includes(current)) break;
  }
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  if (end - start < 2 || end - start > MAX_LOCAL_REPAIR_SENTENCE_CHARS) return span;
  return { start, end };
}

/**
 * 挑出可以定点修的句子。返回的区间按位置升序、互不重叠、条数受限。
 * 拒绝原因：`empty-draft` / `hard-defect:<code>` / `below-contract` / `no-localizable-hits`。
 */
export function selectLocalRepairTargets(input: {
  text: string;
  findings?: readonly LocalRepairFindingLike[];
  hits?: readonly LocalRepairHitLike[];
  minChars?: number;
}): LocalRepairSelection {
  const text = String(input.text || '');
  if (!text.trim()) {
    return { repair: false, targets: [], reason: 'empty-draft', skipped: 0 };
  }
  // 硬缺陷不修：任何非 P2 且不在白名单里的 finding 都意味着结构/模板/长度问题，
  // 定点改句救不回来（实测 duplicate-paragraph、metadata-residue 都属此类）。
  const allowed = LOCAL_REPAIR_ALLOWED_FINDING_CODES as readonly string[];
  const hardDefect = (input.findings || []).find(
    (finding) => finding.severity !== 'P2' && !allowed.includes(String(finding.code || ''))
  );
  if (hardDefect) {
    return {
      repair: false,
      targets: [],
      reason: `hard-defect:${hardDefect.code || 'unknown'}`,
      skipped: 0,
    };
  }
  // 未达篇幅合同不修：这是生成量问题，改句只会让稿子更短。
  if (
    typeof input.minChars === 'number' &&
    input.minChars > 0 &&
    compactTextLength(text) < input.minChars
  ) {
    return { repair: false, targets: [], reason: 'below-contract', skipped: 0 };
  }

  const lines = text.split('\n');
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const categorySet = new Set<string>(LOCAL_REPAIR_CATEGORIES);
  const candidates: LocalRepairTarget[] = [];
  const ranks = new Map<string, number>();
  const seen = new Set<string>();
  let skipped = 0;
  for (const hit of input.hits || []) {
    const category = String(hit.category || '');
    if (!categorySet.has(category)) continue;
    // 单条软命中可能只是 P2，但「3 条以上软命中」会被门判成 literary-slop/P1——
    // 所以不按优先级排除，只在超出条数上限时优先保 P0/P1。
    const line = Number.isFinite(hit.line) ? Number(hit.line) : 0;
    const snippet = String(hit.snippet || '').trim();
    const located = locateHit(text, hit, snippet, line, lineOffsets);
    if (!located) {
      skipped += 1;
      continue;
    }
    // 命中片段是截断的（实测 8 字符），只改片段会把半句话留下：先扩回整句再交给模型。
    const span = expandToSentence(text, located);
    const key = `${category}:${line}:${span.start}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    ranks.set(key, hit.priority === 'P2' ? 1 : 0);
    candidates.push({
      key,
      category,
      line,
      snippet: text.slice(span.start, span.end),
      suggestion: hit.suggestion,
      start: span.start,
      end: span.end,
      before: text.slice(Math.max(0, span.start - LOCAL_REPAIR_CONTEXT_CHARS), span.start),
      after: text.slice(span.end, Math.min(text.length, span.end + LOCAL_REPAIR_CONTEXT_CHARS)),
    });
  }

  // 先按位置去重（重叠命中只修最早的一条），再按优先级取前 N 条，最后回到位置序。
  candidates.sort((a, b) => a.start - b.start);
  const nonOverlapping: LocalRepairTarget[] = [];
  let cursor = -1;
  for (const candidate of candidates) {
    if (candidate.start < cursor) {
      skipped += 1;
      continue;
    }
    cursor = candidate.end;
    nonOverlapping.push(candidate);
  }
  nonOverlapping.sort((a, b) => {
    const rankDiff = (ranks.get(a.key) ?? 0) - (ranks.get(b.key) ?? 0);
    return rankDiff !== 0 ? rankDiff : a.start - b.start;
  });
  if (nonOverlapping.length > MAX_LOCAL_REPAIR_TARGETS) {
    skipped += nonOverlapping.length - MAX_LOCAL_REPAIR_TARGETS;
  }
  const targets = nonOverlapping.slice(0, MAX_LOCAL_REPAIR_TARGETS).sort((a, b) => a.start - b.start);
  if (!targets.length) {
    return { repair: false, targets: [], reason: 'no-localizable-hits', skipped };
  }
  return { repair: true, targets, skipped };
}

/**
 * 把替换文本写回正文。区间非法、替换为空、膨胀超限或相互重叠的条目一律跳过
 * （跳过数如实计入读数，不静默吞掉）。
 */
export function applyLocalRepairs(
  text: string,
  repairs: readonly { start: number; end: number; text: string }[],
  options: { maxGrowthChars?: number } = {}
): LocalRepairApplication {
  const original = String(text || '');
  const maxGrowth = options.maxGrowthChars ?? MAX_LOCAL_REPAIR_GROWTH_CHARS;
  const accepted: Array<{ start: number; end: number; text: string }> = [];
  let skipped = 0;
  for (const repair of repairs) {
    const replacement = String(repair.text || '').trim();
    const start = Math.floor(Number(repair.start));
    const end = Math.floor(Number(repair.end));
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end > original.length ||
      end - start < 2
    ) {
      skipped += 1;
      continue;
    }
    if (!replacement) {
      skipped += 1;
      continue;
    }
    if (compactTextLength(replacement) > compactTextLength(original.slice(start, end)) + maxGrowth) {
      skipped += 1;
      continue;
    }
    if (accepted.some((other) => start < other.end && end > other.start)) {
      skipped += 1;
      continue;
    }
    accepted.push({ start, end, text: replacement });
  }
  accepted.sort((a, b) => b.start - a.start);
  let output = original;
  for (const repair of accepted) {
    output = output.slice(0, repair.start) + repair.text + output.slice(repair.end);
  }
  return { text: output, applied: accepted.length, skipped };
}

/** 去掉模型多写的代码块围栏、标签行与包裹引号——替换文本要能直接写回正文。 */
function stripReplacementDecorations(segment: string): string {
  let text = String(segment || '')
    .replace(/^\s*```[A-Za-z0-9_-]*\s*/, '')
    .replace(/```\s*$/, '');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    // 契约只要求一句；模型若多写了说明行，取最长的一行（说明行通常最短）。
    text = lines.reduce((longest, line) => (line.length > longest.length ? line : longest), '');
  } else {
    text = lines[0] || '';
  }
  return text
    .replace(/^\s*(?:替换(?:后)?|修好(?:后)?|修复(?:后)?|改写(?:后)?|第\s*\d+\s*处)\s*[:：]\s*/, '')
    .replace(/^[「『“"']+/, '')
    .replace(/[」』”"']+$/, '')
    .trim();
}

/**
 * 解析批量定点修复的响应：按 `@@FIX n@@` 标记把第 n 处的替换文本取出来。
 * 返回长度恒为 count 的数组（缺失处为空串，由调用方决定补齐还是放弃）。
 */
export function parseLocalRepairBatchResponse(raw: string, count: number): string[] {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  const results = new Array<string>(total).fill('');
  if (total === 0) return results;
  const text = String(raw || '');
  const matches: Array<{ slot: number; start: number; markerAt: number; end: number }> = [];
  const pattern = /^[ \t]*@@FIX[ \t]*(\d+)[ \t]*@@[ \t]*$/gm;
  let match = pattern.exec(text);
  while (match) {
    matches.push({
      slot: Number(match[1]) - 1,
      start: (match.index || 0) + match[0].length,
      markerAt: match.index || 0,
      end: text.length,
    });
    match = pattern.exec(text);
  }
  if (!matches.length) {
    // 退化形态：只有一处时模型常直接给整句，不带标记。
    if (total === 1) results[0] = stripReplacementDecorations(text);
    return results;
  }
  matches.forEach((entry, index) => {
    const next = matches[index + 1];
    const segment = text.slice(entry.start, next ? next.markerAt : entry.end);
    if (Number.isInteger(entry.slot) && entry.slot >= 0 && entry.slot < total) {
      results[entry.slot] = stripReplacementDecorations(segment);
    }
  });
  return results;
}

/**
 * 通过门禁后仍留在稿里的 P2 软残留 code。产品口径是 P2 不阻断交付，
 * 但它必须可见（读数与日志），不能静默交付。
 */
export function residualP2Codes(findings?: readonly LocalRepairFindingLike[]): string[] {
  const codes = new Set<string>();
  for (const finding of findings || []) {
    if (finding.severity !== 'P2') continue;
    const code = String(finding.code || '').trim();
    if (code) codes.add(code);
  }
  return [...codes];
}
