/**
 * Prompt Quality Gates — Three-layer defense for AI endpoints.
 *
 * Layer 1: Input Gate  — reject garbage before the model sees it.
 * Layer 2: Model Self-Check — prompt instructs model to refuse; code parses refusal.
 * Layer 3: Output Gate — validate model output before user sees it.
 *
 * Each function is pure and independently testable.
 */

// ============================================================================
// Layer 1: Input Gate for extractSkill
// ============================================================================

export interface InputGateResult {
  accepted: boolean;
  rejectedReason?: string;
  chineseCharCount?: number;
  chineseDiversity?: number;
}

/** Count Chinese characters (CJK Unified Ideographs block). */
function countChineseChars(text: string): number {
  const m = text.match(/[一-鿿]/g);
  return m ? m.length : 0;
}

/** Count unique Chinese characters / total Chinese characters ratio. */
function calcChineseDiversity(text: string): number {
  const chinese = text.replace(/[^一-鿿]/g, '');
  if (chinese.length === 0) return 0;
  return new Set(chinese).size / chinese.length;
}

function countUniqueChineseChars(text: string): number {
  const chinese = text.replace(/[^一-鿿]/g, '');
  return chinese.length === 0 ? 0 : new Set(chinese).size;
}

/** True when a single character occupies > 55% of all Chinese characters — spam signal. */
function detectCharSpam(text: string): boolean {
  const chinese = text.replace(/[^一-鿿]/g, '');
  if (chinese.length < 6) return false;
  const freq = new Map<string, number>();
  for (const ch of chinese) freq.set(ch, (freq.get(ch) || 0) + 1);
  return Math.max(...freq.values()) / chinese.length > 0.55;
}

/** True when the Chinese portion is mostly function words with few concrete terms. */
function hasConcreteTerms(text: string): boolean {
  const chinese = text.replace(/[^一-鿿]/g, '');
  if (chinese.length === 0) return false;
  // Function words: 的得地了是我不人在有这个他她它来去上下中着就和那也要会可以还能没说过与自之们一个后大小多少怎么如因为所以但是然而却已经只
  const functionWordRe = /[的了得地是我不人在有这个他她它来去上下中着就和那也要会可以还能没说过与自之们一个后大小多少怎么如因为所以但是然而却已经只]/g;
  const funcCount = (chinese.match(functionWordRe) || []).length;
  return funcCount / chinese.length < 0.65;
}

function looksLikeNarrativeExcerpt(text: string, chineseCharCount: number): boolean {
  if (chineseCharCount < 30) return false;
  if (!hasConcreteTerms(text)) return false;
  return /[，。！？；：]/.test(text);
}

/**
 * Layer 1 input gate for extractSkill endpoint.
 * Rejects: empty text, no Chinese content, too few Chinese chars,
 * character spam, no concrete terms.
 */
export function validateExtractSkillInput(text: string): InputGateResult {
  const trimmed = (text || '').trim();

  if (!trimmed) {
    return { accepted: false, rejectedReason: '上传的文本为空，请粘贴小说正文后再试。' };
  }

  const chineseCharCount = countChineseChars(trimmed);

  if (chineseCharCount === 0) {
    return {
      accepted: false,
      rejectedReason: '未检测到中文内容。当前端点仅支持中文小说文本，请检查文件编码或内容。',
      chineseCharCount: 0,
    };
  }

  // Character spam detection — run BEFORE minimum length check so short
  // spam (e.g. "啊啊啊啊啊啊啊啊啊啊啊啊") is caught correctly.
  if (detectCharSpam(trimmed)) {
    return {
      accepted: false,
      rejectedReason: '输入文本中存在大量重复单字，看起来不像完整的叙事文本。请上传正常的小说正文。',
      chineseCharCount,
    };
  }

  if (chineseCharCount < 50 && !looksLikeNarrativeExcerpt(trimmed, chineseCharCount)) {
    return {
      accepted: false,
      rejectedReason: `中文内容仅 ${chineseCharCount} 字，不足以提炼写作风格。请上传至少 200 字的小说正文片段。`,
      chineseCharCount,
    };
  }

  const diversity = calcChineseDiversity(trimmed);
  const uniqueChineseChars = countUniqueChineseChars(trimmed);
  if (chineseCharCount >= 80 && chineseCharCount <= 2000 && diversity < 0.2) {
    return {
      accepted: false,
      rejectedReason: '文本中文用字过于单一，可能不是自然叙事文本。请上传正常的小说正文。',
      chineseCharCount,
      chineseDiversity: diversity,
    };
  }

  if (chineseCharCount > 2000 && uniqueChineseChars < 120) {
    return {
      accepted: false,
      rejectedReason: '文本中文用字过于单一，可能不是自然叙事文本。请上传正常的小说正文。',
      chineseCharCount,
      chineseDiversity: diversity,
    };
  }

  // Check for concrete terms — reject if mostly function words
  if (!hasConcreteTerms(trimmed)) {
    return {
      accepted: false,
      rejectedReason: '文本几乎全是虚词（的、了、是、在...），缺少具体的人物、场景或事件描写。请上传有实质叙事内容的文本。',
      chineseCharCount,
      chineseDiversity: diversity,
    };
  }

  return {
    accepted: true,
    chineseCharCount,
    chineseDiversity: diversity,
  };
}

// ============================================================================
// Layer 2: Model Self-Check helpers
// ============================================================================

export interface ModelRefusal {
  status: 'needs_clarification' | 'unanalyzable';
  reason: string;
}

/**
 * Check if the parsed model output is a refusal instead of valid capability cards.
 * The extractSkill prompt instructs the model to output
 * { "status": "needs_clarification", "reason": "..." } when the text is
 * unanalyzable or too short.
 */
export function parseModelRefusal(parsed: unknown): ModelRefusal | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (
    (obj.status === 'needs_clarification' || obj.status === 'unanalyzable') &&
    typeof obj.reason === 'string'
  ) {
    return { status: obj.status, reason: obj.reason };
  }
  return null;
}

export function hasModelRefusal(parsed: unknown): boolean {
  return parseModelRefusal(parsed) !== null;
}

// ============================================================================
// Layer 3: Output Gate for extractSkill
// ============================================================================

/**
 * Known hollow/boilerplate style descriptions that the model produces
 * when the input has no real stylistic signal. These are the "万能模板".
 */
const GENERIC_STYLE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /文笔流畅/, label: '文笔流畅' },
  { pattern: /文笔[细精优]美?/, label: '文笔空泛评价' },
  { pattern: /描写[细精生]微?入微?/, label: '描写空泛评价' },
  { pattern: /节奏(感强|把控[得当恰]|张弛有度|明快)/, label: '节奏空泛评价' },
  { pattern: /人物(形象|塑造)(鲜明|丰满|立体)/, label: '人物空泛评价' },
  { pattern: /情节(紧凑|跌宕起伏|环环相扣|引人入胜)/, label: '情节空泛评价' },
  { pattern: /语言[精炼优美洁]|文字功底/, label: '语言空泛评价' },
  { pattern: /意象[丰美]富|意境深远|画面感强/, label: '意象空泛评价' },
  { pattern: /引人入胜|扣人心弦/, label: '套路化评价' },
  { pattern: /(功底扎实|笔力深厚|行云流水|收放自如)/, label: '套路化评价' },
  { pattern: /叙事[手法巧]|叙述方式/, label: '叙事空泛评价' },
  { pattern: /情感[表刻渲]|情绪[把掌调]/, label: '情感空泛评价' },
];

/**
 * Score how generic a style description is. Returns 0-1, where 1 means
 * the style field is entirely composed of boilerplate patterns.
 */
export function scoreStyleGenericness(style: string): number {
  const trimmed = (style || '').trim();
  if (trimmed.length === 0) return 1; // empty is maximally generic

  // Count matching generic patterns
  const matchedLabels = new Set<string>();
  let patternCoverage = 0;
  for (const { pattern, label } of GENERIC_STYLE_PATTERNS) {
    if (pattern.test(trimmed)) {
      matchedLabels.add(label);
      // Rough character coverage — each match accounts for ~8 chars of boilerplate
      patternCoverage += 8;
    }
  }

  if (matchedLabels.size === 0) return 0;

  // If the style is short and matches patterns, it's fully generic
  if (trimmed.length <= 30 && matchedLabels.size >= 1) return 1;
  if (trimmed.length <= 60 && matchedLabels.size >= 2) return 1;

  // Otherwise, ratio of pattern coverage to total length
  return Math.min(1, patternCoverage / trimmed.length);
}

/**
 * Check if an entire skill card's style/pacing fields are too generic.
 * Returns { isGeneric: true } if the main descriptive fields are hollow.
 */
export function skillCardIsGeneric(skill: Record<string, unknown>): { isGeneric: boolean; reason?: string } {
  const style = (typeof skill.style === 'string' ? skill.style : '').trim();
  const pacing = (typeof skill.pacing === 'string' ? skill.pacing : '').trim();
  const description = (typeof skill.description === 'string' ? skill.description : '').trim();

  // If both style and pacing are empty, card is hollow
  if (!style && !pacing) {
    return { isGeneric: true, reason: 'style 和 pacing 字段均为空' };
  }

  const styleScore = scoreStyleGenericness(style);
  if (styleScore >= 1) {
    return { isGeneric: true, reason: `style 字段完全由模板化评价构成："${style}"` };
  }

  // If description is also generic, check combined
  if (styleScore >= 0.7) {
    const descGeneric = scoreStyleGenericness(description);
    if (descGeneric >= 0.7) {
      return { isGeneric: true, reason: 'style 和 description 均为模板化评价' };
    }
  }

  return { isGeneric: false };
}

/**
 * Extract meaningful Chinese n-grams (2-4 chars) from text for anchoring check.
 * Skips common stop characters and function words.
 */
export function extractAnchoringKeywords(text: string, maxKeywords: number = 12): string[] {
  const cleaned = text.replace(/[，,。！？、；：""''（）()\s\n\r]+/g, '');
  if (cleaned.length < 4) return [];

  // Extract bigrams and trigrams, skip pure function-word combinations
  const functionWords = new Set([
    '一个', '这个', '那个', '什么', '怎么', '为什么', '可以', '还是',
    '但是', '因为', '所以', '如果', '虽然', '已经', '而且', '我的',
    '你的', '他的', '我们', '他们', '你们', '关于', '自己', '没有',
    '不是', '就是', '的话', '来说', '这样', '那样', '如何', '不过',
    '是的', '在了', '着就', '地去', '要来', '会去', '能把', '被一',
    '于是', '因此', '然而', '并且', '或者', '只是', '不过', '由于',
    '为了', '那么', '这么', '一切', '所有', '可能', '应该', '已经',
    '知道', '觉得', '认为', '一般', '一样', '也许', '或许', '一定',
  ]);

  const seen = new Set<string>();
  const keywords: string[] = [];

  // Bigrams
  for (let i = 0; i < cleaned.length - 1 && keywords.length < maxKeywords * 2; i++) {
    const bg = cleaned.slice(i, i + 2);
    if (!seen.has(bg) && !functionWords.has(bg)) {
      seen.add(bg);
      keywords.push(bg);
    }
  }

  // Deduplicate substrings — prefer longer forms
  const filtered = keywords.filter((kw) => {
    // Remove 2-char keys that are fully contained in a longer keyword we already have
    if (kw.length === 2) {
      return !keywords.some((k) => k.length > 2 && k.includes(kw));
    }
    return true;
  });

  return filtered.slice(0, maxKeywords);
}

/**
 * Score how well skill output anchors to the input text.
 * Returns 0-1 where 1 means strong keyword overlap.
 */
export function scoreSkillOutputAnchoring(
  skills: Array<Record<string, unknown>>,
  inputText: string,
): number {
  if (!skills || skills.length === 0) return 0;
  const keywords = extractAnchoringKeywords(inputText, 15);
  if (keywords.length === 0) return 1; // can't check, pass

  // Gather all text fields from all capability cards.
  const outputText = skills
    .map((s) =>
      [
        s.style,
        s.description,
        s.pacing,
        s.characterTraits,
        s.worldBuilding,
        s.plotPattern,
        s.foreshadowing,
        s.name,
      ]
        .filter((v): v is string => typeof v === 'string')
        .join(''),
    )
    .join('');

  const cleaned = outputText.replace(/[，,。！？、；：\s]+/g, '');
  const hits = keywords.filter((kw) => cleaned.includes(kw)).length;
  return Math.min(1, hits / Math.max(1, Math.ceil(keywords.length * 0.25)));
}

/** Required fields that must be non-empty for a skill card to be valid. */
const SKILL_REQUIRED_FIELDS = ['name', 'style', 'pacing', 'primaryDimension'] as const;

/**
 * Check field completeness across all capability cards.
 * Returns a per-field completeness map and overall ratio.
 */
export function evaluateSkillFieldCompleteness(
  skills: Array<Record<string, unknown>>,
): { perField: Record<string, number>; overall: number } {
  if (!skills || skills.length === 0) {
    return { perField: {}, overall: 0 };
  }

  const perField: Record<string, number> = {};
  let totalFields = 0;
  let filledFields = 0;

  for (const field of SKILL_REQUIRED_FIELDS) {
    const filledCount = skills.filter((s) => {
      const val = s[field];
      return val !== undefined && val !== null && String(val).trim() !== '';
    }).length;
    perField[field] = filledCount / skills.length;
    totalFields += skills.length;
    filledFields += filledCount;
  }

  return {
    perField,
    overall: filledFields / Math.max(1, totalFields),
  };
}

// ============================================================================
// Composite output gate result
// ============================================================================

export interface SkillOutputQualityReport {
  passed: boolean;
  anchoringScore: number;
  genericSkillCount: number;
  totalSkillCount: number;
  genericDetails: string[];
  fieldCompleteness: number;
  perFieldCompleteness: Record<string, number>;
  issue: string | null;
}

/**
 * Full Layer 3 output gate for extractSkill.
 * Combines anchoring check, template detection, and field completeness
 * into a single pass/fail report.
 */
export function evaluateSkillOutputQuality(
  skills: Array<Record<string, unknown>>,
  inputText: string,
): SkillOutputQualityReport {
  const totalSkillCount = skills.length;
  const anchoringScore = scoreSkillOutputAnchoring(skills, inputText);
  const fieldReport = evaluateSkillFieldCompleteness(skills);

  const genericDetails: string[] = [];
  let genericSkillCount = 0;
  for (const skill of skills) {
    const { isGeneric, reason } = skillCardIsGeneric(skill);
    if (isGeneric) {
      genericSkillCount += 1;
      genericDetails.push(
        `${(skill.name as string) || '(未命名)'}: ${reason || '模板化输出'}`,
      );
    }
  }

  // Pass conditions:
  // 1. No more than 1 skill is fully generic
  // 2. Anchoring score >= 0.15 (at least some keyword overlap)
  // 3. Field completeness >= 0.5
  const passed =
    genericSkillCount <= 1 &&
    anchoringScore >= 0.15 &&
    fieldReport.overall >= 0.5;

  let issue: string | null = null;
  if (!passed) {
    const reasons: string[] = [];
    if (genericSkillCount > 1) {
      reasons.push(`${genericSkillCount}/${totalSkillCount} 张能力卡为模板化输出`);
    }
    if (anchoringScore < 0.15) {
      reasons.push('输出未充分引用原文关键词，可能是虚构的能力卡');
    }
    if (fieldReport.overall < 0.5) {
      reasons.push('能力卡必要字段缺失严重');
    }
    issue = reasons.join('；');
  }

  return {
    passed,
    anchoringScore,
    genericSkillCount,
    totalSkillCount,
    genericDetails,
    fieldCompleteness: fieldReport.overall,
    perFieldCompleteness: fieldReport.perField,
    issue,
  };
}
