import type { GovernedPromptAsset, SanitizationHits } from '../types/prompt-assets-governed.js';

/**
 * 物理抹除水印清洗分析器 (White-Label Watermark Sanitizer & Analyzer)
 *
 * 核心设计准则（绝对物理删除原则）：
 * 彻底抹除、完全清除作者名、微信号、QQ群、联系电话、邮箱及竞品软件水印。
 * 绝不能保留任何诸如 "[微信号]"、"***"、"【已脱敏】" 类似的伪脱敏占位代称，一律替换为空字符串或进行空白折叠。
 * 
 * 针对 'fire'：将其加锁，仅在伴随有定制、出品、作者、by 等特定定制署名上下文中抹除，严禁误伤 standalone 普通英文单词 'fire'。
 *
 * @param text 待清洗的原始文本
 * @returns 彻底物理漂白后的安全文本及命中分类统计
 */
export function analyzeAndSanitize(text: string): { sanitizedText: string; hits: SanitizationHits } {
  const hits: SanitizationHits = {
    contacts: 0,
    authors: 0,
    brands: 0,
    watermarks: 0,
  };

  if (!text) {
    return { sanitizedText: '', hits };
  }

  let sanitized = text;

  // 1. 清洗 Contacts (微信、QQ群、手机、座机、邮箱等)
  const wechatRegex = /(?:微\s*信\s*(?:号)?|we\s*chat|vx\s*(?:号)?)\s*[：:\s-]*[a-zA-Z0-9_-]{5,}/gi;
  const qqGroupRegex = /(?:qq\s*(?:群)?\s*(?:号)?|q\s*群\s*(?:号)?)\s*[：:\s-]*\d{5,}/gi;
  const contactPhoneRegex = /(?:手\s*机\s*(?:号)?|电\s*话\s*(?:号)?|联\s*系\s*方\s*式|联\s*系\s*电\s*话|客\s*服\s*电\s*话)\s*[：:\s-]*(?:1[3-9]\d{9}|0\d{2,3}-\d{7,8})/g;
  const standaloneMobileRegex = /\b1[3-9]\d{9}\b/g;
  const standaloneLandlineRegex = /\b0\d{2,3}-\d{7,8}\b/g;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  const contactsRegexes = [
    wechatRegex,
    qqGroupRegex,
    contactPhoneRegex,
    standaloneMobileRegex,
    standaloneLandlineRegex,
    emailRegex
  ];

  for (const regex of contactsRegexes) {
    sanitized = sanitized.replace(regex, () => {
      hits.contacts++;
      return '';
    });
  }

  // 2. 清洗 Brands (竞品品牌墨流等)
  const competitorRegex = /(?:墨\s*流\s*(?:写\s*作\s*(?:助\s*手|软\s*件)?|编\s*辑\s*器)?|moliu)/gi;
  sanitized = sanitized.replace(competitorRegex, () => {
    hits.brands++;
    return '';
  });

  // 3. 清洗 Authors (作者姓名、署名元数据声明)
  // 中文作者：风华、沐殇、乐乐乐、牧殇 (可以 standalone 匹配，因为中文名字在普通指令中误伤概率极低)
  // 英文作者：fire (绝对加锁，仅在伴随定制、出品、作者、by 等特定上下文才抹除)
  const authorBracketsRegex = /【\s*(?:风\s*华|沐\s*殇|乐\s*乐\s*乐|fire|牧\s*殇)\s*出\s*品\s*】/gi;
  const authorSuffixRegex = /(?:风\s*华|沐\s*殇|乐\s*乐\s*乐|fire|牧\s*殇)\s*(?:出\s*品|专\s*用|定\s*制|开\s*发|制\s*作|原\s*创)/gi;
  const authorPrefixRegex = /(?:作\s*者|出\s*品\s*人|开\s*发\s*者|设\s*计\s*者|原\s*创\s*者)\s*[：:\s\-【[]*(?:风\s*华|沐\s*殇|乐\s*乐\s*乐|fire|牧\s*殇)\s*[】]]*/gi;
  const byAuthorRegex = /\bby\s*[：:\s-]*(?:风\s*华|沐\s*殇|乐\s*乐\s*乐|fire|牧\s*殇)/gi;
  const standaloneChineseAuthorsRegex = /(?:风\s*华|沐\s*殇|乐\s*乐\s*乐|牧\s*殇)/g;

  const authorsRegexes = [
    authorBracketsRegex,
    authorSuffixRegex,
    authorPrefixRegex,
    byAuthorRegex,
    standaloneChineseAuthorsRegex
  ];

  for (const regex of authorsRegexes) {
    sanitized = sanitized.replace(regex, () => {
      hits.authors++;
      return '';
    });
  }

  // 4. 清洗 Watermarks
  const watermarkRegex = /(?:水\s*印|water\s*mark)/gi;
  sanitized = sanitized.replace(watermarkRegex, () => {
    hits.watermarks++;
    return '';
  });

  // 5. 进行空白与换行折叠
  sanitized = sanitized.replace(/[ \t]+/g, ' '); // 连续空格合并为单个空格
  sanitized = sanitized.replace(/\n\s*\n\s*\n/g, '\n\n'); // 连续3个或以上换行合并为最多2个换行

  return {
    sanitizedText: sanitized.trim(),
    hits,
  };
}

/**
 * 物理抹除水印清洗过滤器，为了向下兼容
 */
export function whiteLabelSanitize(text: string): string {
  return analyzeAndSanitize(text).sanitizedText;
}

/**
 * 彻底白标清洗一个受控提示词资产
 * 对资产的所有核心文案字段（template、title、goal、riskNotes、successSignal）执行 analyzeAndSanitize
 * 汇总命中计数并置 sanitizationStatus 为 'sanitized'。
 *
 * @param asset 受控提示词资产
 * @returns 经过彻底物理漂白且携带命中统计的提示词资产
 */
export function sanitizeGovernedPromptAsset(asset: GovernedPromptAsset): GovernedPromptAsset {
  const hits: SanitizationHits = { contacts: 0, authors: 0, brands: 0, watermarks: 0 };

  const sanitizeAndAccumulate = (text: string | undefined): string => {
    if (!text) return '';
    const res = analyzeAndSanitize(text);
    hits.contacts += res.hits.contacts;
    hits.authors += res.hits.authors;
    hits.brands += res.hits.brands;
    hits.watermarks += res.hits.watermarks;
    return res.sanitizedText;
  };

  const title = sanitizeAndAccumulate(asset.title);
  const goal = sanitizeAndAccumulate(asset.goal);
  const template = sanitizeAndAccumulate(asset.template);
  const successSignal = sanitizeAndAccumulate(asset.successSignal);

  const sanitizedRiskNotes: string[] = [];
  if (asset.riskNotes) {
    for (const note of asset.riskNotes) {
      sanitizedRiskNotes.push(sanitizeAndAccumulate(note));
    }
  }

  return {
    ...asset,
    title,
    goal,
    template,
    successSignal,
    riskNotes: sanitizedRiskNotes.filter(Boolean),
    sanitizationStatus: 'sanitized', // 核心机制：最多只能推至 sanitized
    sanitizationHits: hits,
  };
}

/**
 * 经过评审得分（算 Grade）且确认清洗无严重安全隐患后，方能升级至 runtime-ready 运行时生命周期。
 *
 * @param asset 已通过 sanitized 的资产
 * @param score 评审评分 (0 - 100)
 * @returns 升级后的治理提示词资产
 */
export function promoteToRuntimeReady(asset: GovernedPromptAsset, score: number): GovernedPromptAsset {
  if (asset.sanitizationStatus !== 'sanitized') {
    throw new Error('Security Error: Prompt asset must be sanitized before promoting to runtime-ready.');
  }

  let grade: 'A' | 'B' | 'C' | 'D' | 'F' = 'F';
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';

  const isPassed = score >= 70;

  return {
    ...asset,
    score,
    grade,
    sanitizationStatus: isPassed ? 'runtime-ready' : 'sanitized',
    runtimeStatus: isPassed ? 'active' : 'rejected',
  };
}

/**
 * 判定资产是否是核心内置质量护栏 (审稿、去 AI 腔等)
 */
export function isCoreBuiltInAsset(asset: GovernedPromptAsset): boolean {
  return asset.placementTier === 'core-default' || asset.promptCategory === 'built-in';
}

/**
 * 判定资产是否是用户可选写作风格/流派/题材包
 */
export function isUserOptionalAsset(asset: GovernedPromptAsset): boolean {
  return asset.placementTier === 'optional-style' || asset.promptCategory === 'optional';
}
