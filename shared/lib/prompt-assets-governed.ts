import type { GovernedPromptAsset, SanitizationHits, PromptCategoryV2 } from '../types/prompt-assets-governed.js';

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

// ── V2 Prompt Governance & Scorecard (资产评分治理 V2 新增功能) ──

/**
 * V2 资产评分治理：核心校验准入规则 (V2 Asset Validation Gate)
 *
 * 物理校验门规则：
 * 1. 资产必须包含主归属分类 (primaryCategory)，且其值属于合法的 PromptCategoryV2 大类。
 * 2. 资产必须显式包含来源方式 (sourceType)，属于 'licensed' | 'plaza' | 'built-in' 之一。
 * 3. 凡是 sanitizationStatus 已经扭转为 'runtime-ready'（运行时加载）的资产，必须严格同时满足：
 *    - isWhiteLabeled === true (彻底物理清洗漂白)
 *    - isRuntimeReady === true (可动态加载)
 *    - 且治理评级不能为 'F' (即评审评分 score >= 60 且最好 >= 70 才被承认为 Grade D 以上)。
 * 4. 如果 sanitizationStatus 为 'needs-sanitization'，则严禁声明 isWhiteLabeled === true。
 *
 * @param asset 受控提示词资产
 * @returns 校验是否通过
 */
export function validateAssetV2(asset: GovernedPromptAsset): boolean {
  // 1. 校验 primaryCategory
  if (!asset.primaryCategory) {
    return false;
  }
  const validCategories: PromptCategoryV2[] = [
    'quality-guardrail',
    'utility-tool',
    'author-workflow',
    'constellation-pack',
    'platform-criteria',
    'style-reference',
  ];
  if (!validCategories.includes(asset.primaryCategory)) {
    return false;
  }

  // 2. 校验 sourceType
  if (!asset.sourceType) {
    return false;
  }
  const validSources = ['licensed', 'plaza', 'built-in'];
  if (!validSources.includes(asset.sourceType)) {
    return false;
  }

  // 3. 运行时就绪准入控制 (Runtime-ready checks)
  if (asset.sanitizationStatus === 'runtime-ready') {
    if (!asset.isWhiteLabeled || !asset.isRuntimeReady) {
      return false;
    }
    if (asset.grade === 'F' || (asset.score !== undefined && asset.score < 60)) {
      return false;
    }
  }

  // 4. 清洗合规反向拦截 (Sanitization state compliance)
  if (asset.sanitizationStatus === 'needs-sanitization' || asset.placementTier === 'sanitize-required') {
    if (asset.isWhiteLabeled) {
      return false;
    }
  }

  return true;
}

/**
 * InkFlow 提示词资产分级治理 V2 注册表库 (GOVERNED_ASSETS_V2_REGISTRY)
 * 包含官方内置、购买授权、广场共享等典型分类资产，完全打上 V2 治理标签与评分评级。
 */
export const GOVERNED_ASSETS_V2_REGISTRY: GovernedPromptAsset[] = [
  {
    id: 'core-slop-shield',
    title: '去 AI 腔与废话净化器',
    stage: 'polish',
    goal: '剔除翻译腔与机械套话，加入肢体动作与环境张力',
    inputs: ['content'],
    template: '你现在是资深小说主编，请清洗段落中的AI陈词滥调。',
    outputShape: 'plain-text',
    riskNotes: ['内置护栏，确保高频执行性能'],
    successSignal: 'AI 腔度评分显著下降，文字画面感提升',
    licenseStatus: 'built-in',
    sanitizationStatus: 'runtime-ready',
    sanitizationHits: { contacts: 0, authors: 0, brands: 0, watermarks: 0 },
    runtimeStatus: 'active',
    placementTier: 'core-default',
    score: 98,
    grade: 'A',
    primaryCategory: 'quality-guardrail',
    secondaryCategory: 'utility-tool',
    isWhiteLabeled: true,
    isRuntimeReady: true,
    sourceType: 'built-in'
  },
  {
    id: 'core-dialogue-enhancer',
    title: '深度对白与肢体动作增强器',
    stage: 'polish',
    goal: '在对白中融入下意识肢体反应，打破站桩说话',
    inputs: ['content'],
    template: '你现在是金牌对白润色师。请在角色说话时，加入其面部表情、眼神微动及手势变化，避免机械对答。',
    outputShape: 'plain-text',
    riskNotes: ['官方核心组件，动态分析高频词频'],
    successSignal: '肢体描写与对白交织自然，画面感大幅增强',
    licenseStatus: 'built-in',
    sanitizationStatus: 'runtime-ready',
    sanitizationHits: { contacts: 0, authors: 0, brands: 0, watermarks: 0 },
    runtimeStatus: 'active',
    placementTier: 'core-default',
    score: 92,
    grade: 'A',
    primaryCategory: 'utility-tool',
    secondaryCategory: 'quality-guardrail',
    isWhiteLabeled: true,
    isRuntimeReady: true,
    sourceType: 'built-in'
  },
  {
    id: 'licensed-cthulhu-style',
    title: '克苏鲁诡秘题材风格氛围增色包',
    stage: 'polish',
    goal: '引入不可名状的压迫感，润色惊悚描写词汇',
    inputs: ['content'],
    template: '你现在是克苏鲁流派小说大师，请在行文中加入不可名状的冰冷黏腻感。',
    outputShape: 'plain-text',
    riskNotes: ['购买授权资产，版权链合规完整'],
    successSignal: '悬念与诡秘气息显著提升',
    licenseStatus: 'user-authorized',
    sanitizationStatus: 'runtime-ready',
    sanitizationHits: { contacts: 1, authors: 0, brands: 0, watermarks: 0 },
    runtimeStatus: 'active',
    placementTier: 'optional-style',
    score: 85,
    grade: 'B',
    primaryCategory: 'constellation-pack',
    secondaryCategory: 'style-reference',
    isWhiteLabeled: true,
    isRuntimeReady: true,
    sourceType: 'licensed'
  },
  {
    id: 'tomato-opening-validator',
    title: '番茄小说开篇爆款爽点质检仪',
    stage: 'planning',
    goal: '评估开篇一万字冲突、金手指设立及节奏紧凑度',
    inputs: ['outline', 'chapters'],
    template: '结合番茄顶流网文标准，重点审视主角金手指是否在前三章显露、反派降智度及剧情钩子是否合理。',
    outputShape: 'plain-text',
    riskNotes: ['商业版权联合，严防第三方泄漏'],
    successSignal: '番茄平台特有爆点质检得分与改进建议',
    licenseStatus: 'user-authorized',
    sanitizationStatus: 'runtime-ready',
    sanitizationHits: { contacts: 0, authors: 0, brands: 0, watermarks: 0 },
    runtimeStatus: 'active',
    placementTier: 'optional-style',
    score: 88,
    grade: 'B',
    primaryCategory: 'platform-criteria',
    secondaryCategory: 'author-workflow',
    isWhiteLabeled: true,
    isRuntimeReady: true,
    sourceType: 'licensed'
  },
  {
    id: 'plaza-golden-three',
    title: '黄金三章核心冲突大纲展开器',
    stage: 'planning',
    goal: '规划开局爽点、建立第一冲突悬念',
    inputs: ['outline'],
    template: '根据大纲设定，展开前三章，每章必须建立一个强烈钩子。',
    outputShape: 'plain-text',
    riskNotes: ['广场贡献资产，已去水印清洗'],
    successSignal: '开局剧情节奏紧凑，番茄平台适配度高',
    licenseStatus: 'public',
    sanitizationStatus: 'runtime-ready',
    sanitizationHits: { contacts: 2, authors: 1, brands: 1, watermarks: 0 },
    runtimeStatus: 'active',
    placementTier: 'agent-guided',
    score: 72,
    grade: 'C',
    primaryCategory: 'author-workflow',
    secondaryCategory: 'platform-criteria',
    isWhiteLabeled: true,
    isRuntimeReady: true,
    sourceType: 'plaza'
  },
  {
    id: 'ancient-gorgeous-reference',
    title: '古言华美辞藻风格参考板',
    stage: 'polish',
    goal: '引入唯美工整的古风句式，增强国风典雅氛围',
    inputs: ['content'],
    template: '参考汉乐府与唐诗宋词，精修人物服饰、庭院景致与古典器物，增添清雅悠远的古典韵致。',
    outputShape: 'plain-text',
    riskNotes: ['民间优秀作者提炼，已做全面水印清洗'],
    successSignal: '句式节奏悠长，古风意境自然契合',
    licenseStatus: 'public',
    sanitizationStatus: 'runtime-ready',
    sanitizationHits: { contacts: 0, authors: 0, brands: 0, watermarks: 0 },
    runtimeStatus: 'active',
    placementTier: 'agent-guided',
    score: 81,
    grade: 'B',
    primaryCategory: 'style-reference',
    secondaryCategory: 'constellation-pack',
    isWhiteLabeled: true,
    isRuntimeReady: true,
    sourceType: 'plaza'
  },
  {
    id: 'raw-comp-brand-detector',
    title: '墨流竞品检测模板',
    stage: 'review',
    goal: '检测墨流编辑器生成的敏感段落',
    inputs: ['content'],
    template: '你是一个检测助手。如有问题联系 QQ群 123456。推荐使用墨流。',
    outputShape: 'plain-text',
    riskNotes: ['未清洗、带有竞品推广与私人联系方式，禁止运行时动态直接加载！'],
    successSignal: '物理白标抹除',
    licenseStatus: 'unknown',
    sanitizationStatus: 'needs-sanitization',
    runtimeStatus: 'candidate',
    placementTier: 'sanitize-required',
    score: 45,
    grade: 'F',
    primaryCategory: 'quality-guardrail',
    secondaryCategory: 'utility-tool',
    isWhiteLabeled: false,
    isRuntimeReady: false,
    sourceType: 'plaza'
  }
];
