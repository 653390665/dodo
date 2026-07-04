import type { GovernedPromptAsset, SanitizationHits, PromptCategoryV2, PlacementTier, PromptAssetActionKind, InferenceOutput } from '../types/prompt-assets-governed.js';
import type { Novel } from '../types.js';

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
  // 资深架构师设计：扩展微信匹配正则以捕获常见的宣传前缀（如"想要了解更多，请联系"、"请添加"、"我的"）和后缀（如"，欢迎交流"）
  // 从而实现整条/整句无关微信推广信息的彻底物理抹除，绝不留存半截无意义残留，完全契合 Google 编码规范。
  const wechatRegex = /(?:想要了解更多[\s,，]*请?联系|请?[添加]加?|我的|有需要请?[加添])?\s*(?:微\s*信\s*(?:号)?|we\s*chat|vx\s*(?:号)?)\s*[：:\s-]*[a-zA-Z0-9_-]{5,}(?:[\s,，]*欢迎交流)?/gi;
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

// ── V2 Skill Series Flow Registry (流程系列目录 V2) ──

export interface SkillSeriesFlowStep {
  id: string;              // 步骤唯一物理 ID (如 'xiaofeiji-novel-flow-step1')
  stepNumber: number;      // 序号 (1-based)
  name: string;            // 步骤展示名称 (如 '脑洞灵感闪耀')
  description: string;     // 步骤具体执行说明
  input: string;           // 阶段输入特征
  output: string;          // 阶段输出特征
  assetId: string;         // 关联的真实治理资产 ID
  qualityGate: string;     // 本步质量门栏标准
  nextStepId: string | null; // 下一步 ID，尾步骤为 null
  switchAllowed: boolean;  // 是否允许中途跳跃切换
}

export interface SkillSeriesFlow {
  id: string;
  name: string;
  description: string;
  steps: SkillSeriesFlowStep[];
}

export const SKILL_SERIES_FLOWS: SkillSeriesFlow[] = [
  {
    id: 'xiaofeiji-novel-flow',
    name: '小飞鸡长篇流',
    description: '付费核心长篇高品质小说创作主流程，确保全书设定与节奏的高度连贯性。',
    steps: [
      {
        id: 'xiaofeiji-novel-flow-step1',
        stepNumber: 1,
        name: '脑洞灵感闪耀',
        description: '收集小说灵感种子，精炼核心创意。',
        input: 'idea',
        output: 'hook-idea',
        assetId: 'square-182', // 【小飞鸡】爆款书名简介策划引擎！
        qualityGate: '脑洞概念成型且具备初始爽点',
        nextStepId: 'xiaofeiji-novel-flow-step2',
        switchAllowed: true
      },
      {
        id: 'xiaofeiji-novel-flow-step2',
        stepNumber: 2,
        name: '世界观架构设定',
        description: '构建宏大的世界背景、金手指规则与战力体系。',
        input: 'hook-idea',
        output: 'world-setting',
        assetId: 'private-175', // 小飞鸡长篇通用大纲规划
        qualityGate: '战力等级与世界观基本设定完备',
        nextStepId: 'xiaofeiji-novel-flow-step3',
        switchAllowed: true
      },
      {
        id: 'xiaofeiji-novel-flow-step3',
        stepNumber: 3,
        name: '核心角色人设卡',
        description: '定制主角、反派与重要配角的人物弧光与背景。',
        input: 'world-setting',
        output: 'characters',
        assetId: 'square-183', // 【小飞鸡】长篇拆书器
        qualityGate: '主角性格、成长动机与金手指明确',
        nextStepId: 'xiaofeiji-novel-flow-step4',
        switchAllowed: true
      },
      {
        id: 'xiaofeiji-novel-flow-step4',
        stepNumber: 4,
        name: '大纲骨架与主线设计',
        description: '设定长篇小说骨架主线大纲与金手指，建立第一冲突悬念。',
        input: 'characters',
        output: 'chapters-outline',
        assetId: 'private-175', // 万字大纲定制资产
        qualityGate: '万字主线大纲评级达到 B 级以上',
        nextStepId: 'xiaofeiji-novel-flow-step5',
        switchAllowed: true
      },
      {
        id: 'xiaofeiji-novel-flow-step5',
        stepNumber: 5,
        name: '故事细纲与高潮铺设',
        description: '梳理核心故事桥段，铺设情绪起伏和爽点转折。',
        input: 'chapters-outline',
        output: 'detailed-outline',
        assetId: 'private-179', // 章纲定制资产
        qualityGate: '细纲爽点和冲突闭环',
        nextStepId: 'xiaofeiji-novel-flow-step6',
        switchAllowed: true
      },
      {
        id: 'xiaofeiji-novel-flow-step6',
        stepNumber: 6,
        name: '章纲逐章展开',
        description: '细化各章节脉络，排布强烈悬念和读者钩子。',
        input: 'detailed-outline',
        output: 'chapter-content',
        assetId: 'private-179', // 章纲定制资产
        qualityGate: '前 3 章章纲精细度符合要求',
        nextStepId: 'xiaofeiji-novel-flow-step7',
        switchAllowed: true
      },
      {
        id: 'xiaofeiji-novel-flow-step7',
        stepNumber: 7,
        name: '高质量正文起步',
        description: '展开长篇网文的第一章写作，融入强烈节奏。',
        input: 'chapter-content',
        output: 'chapter-draft',
        assetId: 'private-180', // 真实的正文定制资产
        qualityGate: '正文第一章写作完成',
        nextStepId: 'xiaofeiji-novel-flow-step8',
        switchAllowed: true
      },
      {
        id: 'xiaofeiji-novel-flow-step8',
        stepNumber: 8,
        name: '正文去AI润色',
        description: '深度精修段落陈词滥调，增强肢体动作与画面张力。',
        input: 'chapter-draft',
        output: 'chapter-polished',
        assetId: 'private-193', // 真实的去AI高频词润色资产
        qualityGate: 'AI腔去化度评测及格 (slop score > 85)',
        nextStepId: null,
        switchAllowed: true
      }
    ]
  },
  {
    id: 'generic-novel-flow',
    name: '通用长篇流',
    description: '面向全体创作者的默认长篇路线，汇聚最优质的内置与广场精品资源。',
    steps: [
      {
        id: 'generic-novel-flow-step1',
        stepNumber: 1,
        name: '灵感火花收集',
        description: '记录随笔与核心创意。',
        input: 'note',
        output: 'idea',
        assetId: 'generateOutline',
        qualityGate: '有一个可以展开的核心灵感',
        nextStepId: 'generic-novel-flow-step2',
        switchAllowed: true
      },
      {
        id: 'generic-novel-flow-step2',
        stepNumber: 2,
        name: '世界与角色设定',
        description: '草拟世界规则和主角人设。',
        input: 'idea',
        output: 'setting',
        assetId: 'generateOutline',
        qualityGate: '基本人设与背景搭建完成',
        nextStepId: 'generic-novel-flow-step3',
        switchAllowed: true
      },
      {
        id: 'generic-novel-flow-step3',
        stepNumber: 3,
        name: '小说主线大纲',
        description: '规划全书起承转合结构。',
        input: 'setting',
        output: 'outline',
        assetId: 'generateOutline',
        qualityGate: '小说大纲具备明确的起承转合',
        nextStepId: 'generic-novel-flow-step4',
        switchAllowed: true
      },
      {
        id: 'generic-novel-flow-step4',
        stepNumber: 4,
        name: '分镜章纲梳理',
        description: '梳理章节的分镜或大纲。',
        input: 'outline',
        output: 'scene-outline',
        assetId: 'generateOutline',
        qualityGate: '核心情节具备明确的情感起伏',
        nextStepId: 'generic-novel-flow-step5',
        switchAllowed: true
      },
      {
        id: 'generic-novel-flow-step5',
        stepNumber: 5,
        name: '正文快速初稿',
        description: '流畅完成正文草稿撰写。',
        input: 'scene-outline',
        output: 'draft',
        assetId: 'core-slop-shield',
        qualityGate: '第一章正文初稿撰写完成',
        nextStepId: 'generic-novel-flow-step6',
        switchAllowed: true
      },
      {
        id: 'generic-novel-flow-step6',
        stepNumber: 6,
        name: '全书基础审稿',
        description: '对初稿进行基础去AI腔与内容审校。',
        input: 'draft',
        output: 'polished-draft',
        assetId: 'core-slop-shield',
        qualityGate: '基础文本去AI腔完成，语流顺畅',
        nextStepId: null,
        switchAllowed: true
      }
    ]
  },
  {
    id: 'tomato-platform-flow',
    name: '番茄平台流',
    description: '番茄小说特化爆款爽文创作流程，紧扣平台签约评分和读者钩子规范。',
    steps: [
      {
        id: 'tomato-platform-flow-step1',
        stepNumber: 1,
        name: '番茄开篇诊断',
        description: '评估番茄小说大纲，分析完读与签约红线。',
        input: 'outline',
        output: 'diagnostic-report',
        assetId: 'tomato-scorecard', // 真实的番茄评分卡资产
        qualityGate: '开篇大纲契合番茄爆款模型',
        nextStepId: 'tomato-platform-flow-step2',
        switchAllowed: true
      },
      {
        id: 'tomato-platform-flow-step2',
        stepNumber: 2,
        name: '黄金三章钩子强化',
        description: '在章首章末铺设钩子，拉满黄金三章读者期望。',
        input: 'chapters',
        output: 'chapters-with-hooks',
        assetId: 'hook-system', // 真实的钩子体系资产
        qualityGate: '前三章完读率预测指标及格',
        nextStepId: 'tomato-platform-flow-step3',
        switchAllowed: true
      },
      {
        id: 'tomato-platform-flow-step3',
        stepNumber: 3,
        name: '核心爽点黄金排布',
        description: '评估主角金手指在前三章的显露节奏与钩子是否合理。',
        input: 'chapters-with-hooks',
        output: 'chapters-with-highlights',
        assetId: 'tomato-opening-validator', // 真实的番茄质检仪资产
        qualityGate: '金手指爽点在前三章显露节奏合理',
        nextStepId: 'tomato-platform-flow-step4',
        switchAllowed: true
      },
      {
        id: 'tomato-platform-flow-step4',
        stepNumber: 4,
        name: '完读与节奏自检',
        description: '使用番茄章首 7 式与章末 13 式，拉升读者完读预期。',
        input: 'chapters-with-highlights',
        output: 'chapters-final-checked',
        assetId: 'hook-system', // 真实的钩子体系资产
        qualityGate: '完读悬念与读者期待达成闭环',
        nextStepId: 'tomato-platform-flow-step5',
        switchAllowed: true
      },
      {
        id: 'tomato-platform-flow-step5',
        stepNumber: 5,
        name: '正文精修与美学润色',
        description: '消除白话/废话，进行高质感爽文精润。',
        input: 'chapters-final-checked',
        output: 'chapters-final',
        assetId: 'tomato-opening-validator', // 真实的番茄质检仪资产
        qualityGate: '全文爽感突出、文字干净利落',
        nextStepId: null,
        switchAllowed: true
      }
    ]
  },
  {
    id: 'book-deconstruction-flow',
    name: '拆书转化流',
    description: '将精品图书拆解为高可读的结构、题材、节奏及文风参考卡，动态挂载至写作中。',
    steps: [
      {
        id: 'book-deconstruction-flow-step1',
        stepNumber: 1,
        name: '神作高爽节奏拆解',
        description: '提取精品小说的黄金冲突节奏，形成可挂载节奏拆书卡。',
        input: 'source-book',
        output: 'deconstruction-cards',
        assetId: 'deconstruct-card-pacing', // 真实的节奏拆书卡
        qualityGate: '拆解出黄金起伏节奏点',
        nextStepId: 'book-deconstruction-flow-step2',
        switchAllowed: true
      },
      {
        id: 'book-deconstruction-flow-step2',
        stepNumber: 2,
        name: '黄金开篇钩子拆解',
        description: '提取爆款小说的开篇钩子机制，形成开篇拆书卡。',
        input: 'source-book',
        output: 'deconstruction-cards-hook',
        assetId: 'deconstruct-card-hook', // 真实的钩子拆书卡
        qualityGate: '前 3 章核心悬念钩子提炼完毕',
        nextStepId: null,
        switchAllowed: true
      }
    ]
  },
  {
    id: 'fenghua-short-flow',
    name: '风华短篇/老福特流',
    description: '风华短篇及老福特高美感故事创作流，聚焦快节奏、情感反转与极致画面描写。',
    steps: [
      {
        id: 'fenghua-short-flow-step1',
        stepNumber: 1,
        name: '风华短篇脑洞爆款分析',
        description: '深度剖析流行脑洞，拆解爆款内核。',
        input: 'idea',
        output: 'hook-idea',
        assetId: 'square-88', // 【风华出品】短篇破解爆款第一步
        qualityGate: '脑洞内核分析清晰，爽点明确',
        nextStepId: 'fenghua-short-flow-step2',
        switchAllowed: true
      },
      {
        id: 'fenghua-short-flow-step2',
        stepNumber: 2,
        name: '老福特高美感大纲',
        description: '定制短篇大纲，规划情感起伏与关键反转。',
        input: 'hook-idea',
        output: 'outline',
        assetId: 'square-93', // 【风华出品】短篇破解爆款备用版
        qualityGate: '故事主线大纲具备高情感反转弧度',
        nextStepId: 'fenghua-short-flow-step3',
        switchAllowed: true
      },
      {
        id: 'fenghua-short-flow-step3',
        stepNumber: 3,
        name: '爆款短篇故事起名',
        description: '结合读者喜好与意境，确定具有高点击率的标题。',
        input: 'outline',
        output: 'title',
        assetId: 'square-114', // 【风华出品】小说起名器（短篇为主）
        qualityGate: '标题意境饱满，具备高吸引力',
        nextStepId: 'fenghua-short-flow-step4',
        switchAllowed: true
      },
      {
        id: 'fenghua-short-flow-step4',
        stepNumber: 4,
        name: '老福特极速开篇',
        description: '撰写具有高吸引力的黄金开篇正文。',
        input: 'title',
        output: 'chapter-draft',
        assetId: 'private-163', // 【风华出品】短篇拆文仿写
        qualityGate: '前文冲突极速铺开，文风华美',
        nextStepId: 'fenghua-short-flow-step5',
        switchAllowed: true
      },
      {
        id: 'fenghua-short-flow-step5',
        stepNumber: 5,
        name: '高维情感逻辑分析',
        description: '审校短文的叙事逻辑与情感张力。',
        input: 'chapter-draft',
        output: 'chapter-polished',
        assetId: 'square-122', // 【风华出品】短篇文章逻辑检测分析器
        qualityGate: '故事逻辑闭环，情感张力达标',
        nextStepId: null,
        switchAllowed: true
      }
    ]
  },
  {
    id: 'tianma-outline-flow',
    name: '天马大纲流',
    description: '天马大纲定制流，聚焦于细致的大纲规划、设定强化以及高潮情节的黄金节奏排布。',
    steps: [
      {
        id: 'tianma-outline-flow-step1',
        stepNumber: 1,
        name: '天马爆款脑洞提炼',
        description: '进行脑洞与灵感提炼，定位番茄网文特色卖点。',
        input: 'idea',
        output: 'hook-idea',
        assetId: 'square-76', // 天马-脑洞生成-番茄爆款
        qualityGate: '核心创意脑洞契合番茄爆款结构',
        nextStepId: 'tianma-outline-flow-step2',
        switchAllowed: true
      },
      {
        id: 'tianma-outline-flow-step2',
        stepNumber: 2,
        name: '天马设定与节奏大纲',
        description: '定制具有高连贯性、强设定的人物与背景大纲。',
        input: 'hook-idea',
        output: 'setting-outline',
        assetId: 'square-41', // 天马-大纲生成-设定强化+节奏
        qualityGate: '设定机制独特，故事节奏主线清晰',
        nextStepId: 'tianma-outline-flow-step3',
        switchAllowed: true
      },
      {
        id: 'tianma-outline-flow-step3',
        stepNumber: 3,
        name: '天马三幕式高潮规划',
        description: '使用标准三幕结构，详细排布高潮、对峙与高爽冲突点。',
        input: 'setting-outline',
        output: 'climax-outline',
        assetId: 'square-39', // 天马-大纲生成-三幕式
        qualityGate: '核心冲突具备明确的三幕式递进节奏',
        nextStepId: 'tianma-outline-flow-step4',
        switchAllowed: true
      },
      {
        id: 'tianma-outline-flow-step4',
        stepNumber: 4,
        name: '天马通用分章大纲',
        description: '对大纲进行细化，按章节进行结构性排布与大纲规划。',
        input: 'climax-outline',
        output: 'chapters-outline',
        assetId: 'square-42', // 天马-通用章节大纲
        qualityGate: '分章结构完备，钩子排布合理',
        nextStepId: null,
        switchAllowed: true
      }
    ]
  }
];

export function getNovelCurrentStepId(novel: Novel, activeSeriesId: string): string {
  const tags = novel.projectPreferenceProfile?.tags || [];
  const prefix = `current-step:${activeSeriesId}:`;
  const found = tags.find(t => t.startsWith(prefix));
  if (found) {
    return found.slice(prefix.length);
  }
  const flow = SKILL_SERIES_FLOWS.find(f => f.id === activeSeriesId);
  if (flow && flow.steps.length > 0) {
    return flow.steps[0].id;
  }
  return '';
}

export function getNovelCompletedStepIds(novel: Novel, activeSeriesId: string): string[] {
  const tags = novel.projectPreferenceProfile?.tags || [];
  const prefix = `completed-step:${activeSeriesId}:`;
  return tags
    .filter(t => t.startsWith(prefix))
    .map(t => t.slice(prefix.length));
}

export function getNextFlowStep(
  activeSeriesId: string,
  currentStage: string,
  completedStepIds: string[]
): SkillSeriesFlowStep | null {
  const flow = SKILL_SERIES_FLOWS.find(f => f.id === activeSeriesId);
  if (!flow) return null;

  // 1. 如果 currentStage 是某个步骤的 ID，直接根据 nextStepId 寻找
  const currentStep = flow.steps.find(s => s.id === currentStage);
  if (currentStep) {
    if (currentStep.nextStepId) {
      return flow.steps.find(s => s.id === currentStep.nextStepId) || null;
    }
    return null; // 已经是最后一步
  }

  // 2. Fallback：如果 currentStage 为空或外部业务非步骤 ID，返回第一个未完成的步骤
  const uncompleted = flow.steps.find(s => !completedStepIds.includes(s.id));
  if (uncompleted) return uncompleted;

  return null;
}


// ── V2.1 160+ Real Trackable Prompt Asset Construction ──

interface ScorecardMeta {
  id: string;
  title: string;
  score: number;
  line: number;
  cat: PromptCategoryV2;
  tier: PlacementTier;
  sourceType: 'built-in' | 'plaza' | 'licensed';
}

const rawSquareConfigs: ScorecardMeta[] = [
  { id: 'square-183', title: '【小飞鸡】长篇拆书器<十章版>', score: 88, line: 117, cat: 'utility-tool', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-182', title: '【小飞鸡】爆款书名简介策划引擎！', score: 82, line: 118, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-176', title: '【小飞鸡】长篇正文~超强口语化推进剧情', score: 86, line: 119, cat: 'author-workflow', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-174', title: '【小飞鸡】番茄长篇正文通用', score: 86, line: 120, cat: 'author-workflow', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-122', title: '【风华出品】短篇文章逻辑检测分析器', score: 87, line: 121, cat: 'quality-guardrail', tier: 'core-default', sourceType: 'plaza' },
  { id: 'square-114', title: '【风华出品】小说起名器（短篇为主）', score: 79, line: 122, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-109', title: '【小飞鸡】爆款短篇第三步', score: 82, line: 123, cat: 'author-workflow', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-108', title: '【小飞鸡】爆款短篇第二步', score: 86, line: 124, cat: 'author-workflow', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-107', title: '【小飞鸡】爆款短篇第一步', score: 82, line: 125, cat: 'author-workflow', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-104', title: 'lwl-网络流行语和热门梗润色', score: 74, line: 126, cat: 'utility-tool', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-103', title: '【风华出品】一键生成章节梗概', score: 79, line: 127, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-94', title: '【风华出品】长篇一键破解爆款小说并生成脑洞', score: 83, line: 128, cat: 'utility-tool', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-93', title: '【风华出品】短篇破解爆款备用版', score: 79, line: 129, cat: 'utility-tool', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-88', title: '【风华出品】短篇破解爆款第一步', score: 79, line: 130, cat: 'utility-tool', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-87', title: '锅盖拆书《灵光版》', score: 82, line: 131, cat: 'utility-tool', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-82', title: '【风华出品】根据卷纲生成15章大纲', score: 83, line: 132, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-81', title: '【风华出品】生成卷纲并确定总章节数', score: 79, line: 133, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-80', title: '【风华出品】世界观生成器', score: 83, line: 134, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-79', title: '【风华出品】一键破解爆款并生成脑洞', score: 79, line: 135, cat: 'utility-tool', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-78', title: '【风华出品】一键润色降ai 1.0', score: 86, line: 136, cat: 'quality-guardrail', tier: 'core-default', sourceType: 'plaza' },
  { id: 'square-76', title: '天马-脑洞生成-番茄爆款', score: 74, line: 137, cat: 'utility-tool', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-74', title: '【风华出品】长短篇通用正文', score: 79, line: 138, cat: 'author-workflow', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-61', title: 'lwl-事件生成', score: 74, line: 139, cat: 'utility-tool', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-60', title: 'lwl-爆款短篇仿写与黄金开篇', score: 74, line: 140, cat: 'style-reference', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-56', title: 'lwl-简介生成', score: 74, line: 141, cat: 'utility-tool', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-55', title: 'lwl-生成角色', score: 74, line: 142, cat: 'utility-tool', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-54', title: 'lwl-世界观生成专家', score: 78, line: 143, cat: 'utility-tool', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-53', title: 'lwl-世界观生成', score: 78, line: 144, cat: 'utility-tool', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-43', title: '天马-番茄短篇-清澈版', score: 74, line: 145, cat: 'style-reference', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-42', title: '天马-通用章节大纲', score: 78, line: 146, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-41', title: '天马-大纲生成-设定强化+节奏', score: 78, line: 147, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-39', title: '天马-大纲生成-三幕式', score: 78, line: 148, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-38', title: '天马-大纲生成-基础版', score: 78, line: 149, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-27', title: '爆款-番茄风【金手指】', score: 74, line: 150, cat: 'utility-tool', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-26', title: '一次一章-【续写】', score: 74, line: 151, cat: 'style-reference', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-22', title: 'lwl-章节列表生成', score: 74, line: 152, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-21', title: '猫头鹰-短篇故事脑洞生成', score: 74, line: 153, cat: 'utility-tool', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-20', title: '猫头鹰-短篇拆书', score: 82, line: 154, cat: 'utility-tool', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'square-19', title: 'lwl-知乎短文', score: 74, line: 155, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-18', title: 'lwl-生成新角色', score: 74, line: 156, cat: 'utility-tool', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-13', title: 'lwl-文本润色', score: 74, line: 157, cat: 'quality-guardrail', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-12', title: 'lwl-顶级提示0.01', score: 74, line: 158, cat: 'style-reference', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-11', title: '锅盖第一人称短片写作', score: 74, line: 159, cat: 'style-reference', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-10', title: '锅盖男频正文直出', score: 74, line: 160, cat: 'style-reference', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-9', title: '锅盖润色扩写，去AI味', score: 81, line: 161, cat: 'quality-guardrail', tier: 'core-default', sourceType: 'plaza' },
  { id: 'square-7', title: 'lwl-爆款续写', score: 74, line: 162, cat: 'style-reference', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'square-3', title: 'lwl-AI润色指令', score: 74, line: 163, cat: 'quality-guardrail', tier: 'optional-style', sourceType: 'plaza' }
];

const rawPrivateConfigs: ScorecardMeta[] = [
  // 8条高分已授权白标的定制资产 (Score >= 80, Grade A/S)
  { id: 'private-193', title: '【小飞鸡】正文去AI高频词+润色', score: 92, line: 169, cat: 'quality-guardrail', tier: 'core-default', sourceType: 'licensed' },
  { id: 'private-181', title: '【小飞鸡】五个长篇脑洞', score: 88, line: 170, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'licensed' },
  { id: 'private-180', title: '【小飞鸡】长篇正文<配套使用>', score: 90, line: 171, cat: 'author-workflow', tier: 'flow-default', sourceType: 'licensed' },
  { id: 'private-179', title: '【小飞鸡】长篇通用章纲', score: 89, line: 172, cat: 'author-workflow', tier: 'flow-default', sourceType: 'licensed' },
  { id: 'private-178', title: '【小飞鸡】长篇细纲', score: 91, line: 173, cat: 'author-workflow', tier: 'flow-default', sourceType: 'licensed' },
  { id: 'private-177', title: '【小飞鸡】长篇超宏大世界观', score: 89, line: 174, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'licensed' },
  { id: 'private-175', title: '【小飞鸡】长篇通用大纲-万字版', score: 88, line: 175, cat: 'author-workflow', tier: 'flow-default', sourceType: 'licensed' },
  { id: 'private-157', title: '【小飞鸡】长篇角色卡生成', score: 86, line: 176, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'licensed' },

  // 其它 69 条定制资产
  { id: 'private-222', title: '乐乐乐专用正文提示词', score: 63, line: 177, cat: 'style-reference', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-221', title: '沐殇专用克苏鲁标题', score: 63, line: 178, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-220', title: '沐殇专用克苏鲁简介与书名', score: 63, line: 179, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-219', title: '沐殇专用克苏鲁配角信息卡', score: 63, line: 180, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-218', title: '沐殇专用克苏鲁主角及主角团核心成员信息卡', score: 63, line: 181, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-217', title: '沐殇专用克苏鲁正文', score: 63, line: 182, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-216', title: '沐殇专用克苏鲁章纲', score: 67, line: 183, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-215', title: '沐殇专用克苏鲁细纲', score: 67, line: 184, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-214', title: '沐殇专用克苏鲁大纲', score: 67, line: 185, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-213', title: '沐殇专用克苏鲁世界观', score: 67, line: 186, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-212', title: '沐殇专用宝可梦简介', score: 63, line: 187, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-211', title: '沐殇专用宝可梦书名与简介', score: 63, line: 188, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-210', title: '沐殇专用宝可梦配角信息卡', score: 63, line: 189, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-209', title: '沐殇专用宝可梦正文', score: 63, line: 190, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-208', title: '沐殇专用宝可梦细纲', score: 67, line: 191, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-207', title: '沐殇专用宝可梦章纲', score: 67, line: 192, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-206', title: '沐殇专用宝可梦系统信息卡', score: 63, line: 193, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-205', title: '沐殇专用宝可梦信息卡', score: 63, line: 194, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-204', title: '沐殇专用宝可梦主角信息卡', score: 63, line: 195, cat: 'constellation-pack', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-203', title: '牧殇角色提示词', score: 68, line: 196, cat: 'utility-tool', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-202', title: '沐殇定制细纲', score: 67, line: 197, cat: 'author-workflow', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-201', title: '沐殇定制大纲', score: 67, line: 198, cat: 'author-workflow', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-200', title: '沐殇定制章纲', score: 67, line: 199, cat: 'author-workflow', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-199', title: '沐殇定制正文提示词', score: 63, line: 200, cat: 'style-reference', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-198', title: '测试审稿', score: 64, line: 201, cat: 'quality-guardrail', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-197', title: '测试黄金一章', score: 56, line: 202, cat: 'utility-tool', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-195', title: '测试', score: 56, line: 203, cat: 'utility-tool', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-192', title: 'fire定制正文', score: 63, line: 204, cat: 'style-reference', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-191', title: 'fire定制章纲', score: 67, line: 205, cat: 'author-workflow', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-190', title: 'fire定制细纲', score: 67, line: 206, cat: 'author-workflow', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-189', title: 'fire定制书名+简介', score: 63, line: 207, cat: 'utility-tool', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-188', title: 'fire定制世界观', score: 67, line: 208, cat: 'utility-tool', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-187', title: 'fire定制脑洞', score: 63, line: 209, cat: 'utility-tool', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-186', title: 'fire角色定制', score: 63, line: 210, cat: 'utility-tool', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-185', title: 'fire定制大纲', score: 67, line: 211, cat: 'author-workflow', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-170', title: '番茄正文过保底2', score: 68, line: 212, cat: 'platform-criteria', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-169', title: '番茄正文过保底', score: 68, line: 213, cat: 'style-reference', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-168', title: '章纲自适应续写', score: 72, line: 214, cat: 'style-reference', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-167', title: '风华长篇大纲测试', score: 65, line: 215, cat: 'author-workflow', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-163', title: '【风华出品】短篇拆文仿写', score: 76, line: 216, cat: 'utility-tool', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-162', title: '【风华出品】老福特编辑审稿', score: 76, line: 217, cat: 'quality-guardrail', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-161', title: '新版过朱雀', score: 56, line: 218, cat: 'style-reference', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-158', title: '短篇直出', score: 68, line: 219, cat: 'style-reference', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-144', title: '【风华出品】私有化流程6', score: 73, line: 220, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-143', title: '【风华出品】私有化流程5', score: 73, line: 221, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-142', title: '【风华出品】私有化流程4', score: 73, line: 222, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-141', title: '【风华出品】私有化流程3', score: 73, line: 223, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-140', title: '【风华出品】私有化流程2', score: 73, line: 224, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-139', title: '【风华出品】私有化流程1', score: 73, line: 225, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-132', title: '【风华出品】女频过七猫保底', score: 73, line: 226, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-131', title: '【风华出品】自用长篇正文', score: 76, line: 227, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-130', title: '【风华出品】黄金手术刀', score: 76, line: 228, cat: 'quality-guardrail', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-129', title: '【风华出品】老福特通用正文', score: 73, line: 229, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-128', title: '【风华出品】老福特乙女大纲', score: 76, line: 230, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-127', title: '【风华出品】老福特观影大纲', score: 76, line: 231, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-126', title: '【风华出品】老福特耽美大纲', score: 76, line: 232, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-125', title: '【风华出品】老福特爽文大纲', score: 76, line: 233, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-124', title: '【风华出品】老福特脑洞生成器', score: 73, line: 234, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-123', title: '【风华出品】一键融梗换心', score: 73, line: 235, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-106', title: '私密内测', score: 56, line: 236, cat: 'style-reference', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-101', title: '【风华出品】金牌主编改稿', score: 73, line: 237, cat: 'quality-guardrail', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-100', title: '【风华出品】金牌主编审稿', score: 76, line: 238, cat: 'quality-guardrail', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-92', title: '【风华出品】短篇专用导语仿写', score: 68, line: 239, cat: 'author-workflow', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-91', title: '【风华出品】短篇专用导语生成', score: 68, line: 240, cat: 'author-workflow', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-90', title: '【风华出品】短篇专用正文', score: 68, line: 241, cat: 'author-workflow', tier: 'sanitize-required', sourceType: 'licensed' },
  { id: 'private-89', title: '【风华出品】短篇专用大纲生成', score: 72, line: 242, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-86', title: '【风华出品】一键润色降ai 2.0', score: 76, line: 243, cat: 'quality-guardrail', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-85', title: '【风华出品】对话情绪拉扯增幅器', score: 73, line: 244, cat: 'quality-guardrail', tier: 'optional-style', sourceType: 'licensed' },
  { id: 'private-84', title: '【风华出品】超强文风自适应续写', score: 73, line: 245, cat: 'author-workflow', tier: 'optional-style', sourceType: 'licensed' }
];

const rawCreativeConfigs: ScorecardMeta[] = [
  { id: 'creative-1', title: '玄幻题材大类配置模板', score: 72, line: 251, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-2', title: '修真题材大类配置模板', score: 72, line: 252, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-3', title: '都市异能题材大类配置模板', score: 72, line: 253, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-4', title: '重生题材大类配置模板', score: 72, line: 254, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-5', title: '穿越题材大类配置模板', score: 72, line: 255, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-6', title: '快穿题材大类配置模板', score: 72, line: 256, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-7', title: '末世题材大类配置模板', score: 72, line: 257, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-8', title: '科幻题材大类配置模板', score: 72, line: 258, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-9', title: '悬疑推理题材大类配置模板', score: 72, line: 259, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-10', title: '言情题材大类配置模板', score: 72, line: 260, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-11', title: '宫斗宅斗题材大类配置模板', score: 72, line: 261, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-12', title: '群像剧题材大类配置模板', score: 72, line: 262, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-13', title: '权谋历史题材大类配置模板', score: 72, line: 263, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-14', title: '电竞游戏题材大类配置模板', score: 72, line: 264, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-15', title: '轻小说风格题材大类配置模板', score: 72, line: 265, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'creative-16', title: '追妻火葬场题材大类配置模板', score: 72, line: 266, cat: 'constellation-pack', tier: 'optional-style', sourceType: 'plaza' }
];

const rawSupplementConfigs: ScorecardMeta[] = [
  { id: 'tomato-scorecard', title: '番茄评分卡', score: 92, line: 28, cat: 'platform-criteria', tier: 'core-default', sourceType: 'plaza' },
  { id: 'hook-system', title: '章末钩子 13 式 + 章首 7 式', score: 90, line: 29, cat: 'platform-criteria', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'deconstruct-sop-6', title: '拆书 6 阶段 SOP', score: 90, line: 30, cat: 'utility-tool', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'tomato-opening-validator', title: '黄金三章诊断', score: 88, line: 31, cat: 'platform-criteria', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'snowflake-6-steps', title: '雪花六步法', score: 87, line: 32, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'chapter-blueprint-prompt', title: '章节正文写作 prompt', score: 84, line: 33, cat: 'style-reference', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'character-state-doc', title: '角色状态文档', score: 86, line: 34, cat: 'utility-tool', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'slop-shield-guide', title: '去 AI 味指南', score: 88, line: 35, cat: 'quality-guardrail', tier: 'core-default', sourceType: 'plaza' },
  { id: 'opening-templates-library', title: '开头模板库', score: 78, line: 36, cat: 'style-reference', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'eight-nodes-structure', title: '八节点结构', score: 82, line: 37, cat: 'author-workflow', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'emotion-tension-curve', title: '情绪拉扯五折线', score: 83, line: 38, cat: 'quality-guardrail', tier: 'core-default', sourceType: 'plaza' },
  { id: 'tomato-sweet-formula', title: '爽点核心公式', score: 85, line: 39, cat: 'platform-criteria', tier: 'optional-style', sourceType: 'plaza' },
  { id: 'context-brief-agent', title: 'context-agent.md 写前 Brief Agent', score: 94, line: 40, cat: 'author-workflow', tier: 'premium-enhancement', sourceType: 'plaza' },
  { id: 'review-schema-v2', title: 'reviewer.md + review-schema.md 审稿 schema v2', score: 94, line: 41, cat: 'quality-guardrail', tier: 'core-default', sourceType: 'plaza' },
  { id: 'deconstruct-card-pacing', title: '节奏拆书卡', score: 88, line: 42, cat: 'style-reference', tier: 'agent-guided', sourceType: 'plaza' },
  { id: 'deconstruct-card-hook', title: '钩子拆书卡', score: 86, line: 43, cat: 'style-reference', tier: 'agent-guided', sourceType: 'plaza' }
];

const testFixtures: GovernedPromptAsset[] = [
  {
    id: 'test-fixture-unsafe',
    title: 'Unsafe Test Fixture',
    stage: 'polish',
    goal: 'Test physical isolation',
    inputs: ['content'],
    template: 'Unsafe contact: vx_123_abc, brand: moliu.',
    outputShape: 'plain-text',
    riskNotes: ['Test fixture'],
    successSignal: 'Failed recommendation',
    licenseStatus: 'unknown',
    sanitizationStatus: 'needs-sanitization',
    runtimeStatus: 'candidate',
    placementTier: 'sanitize-required',
    score: 45,
    grade: 'F',
    primaryCategory: 'quality-guardrail',
    isWhiteLabeled: false,
    isRuntimeReady: false,
    sourceType: 'plaza',
    sourceRef: 'tests:fixture',
    sourceGroup: 'test-fixture',
    evidenceLevel: 'test-fixture'
  },
  {
    id: 'test-fixture-lowscore',
    title: 'Lowscore Test Fixture',
    stage: 'polish',
    goal: 'Test low score physical filter',
    inputs: ['content'],
    template: 'Low score prompt template.',
    outputShape: 'plain-text',
    riskNotes: ['Test fixture'],
    successSignal: 'Failed recommendation',
    licenseStatus: 'public',
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
    placementTier: 'optional-style',
    score: 30,
    grade: 'F',
    primaryCategory: 'quality-guardrail',
    isWhiteLabeled: true,
    isRuntimeReady: true,
    sourceType: 'plaza',
    sourceRef: 'tests:fixture',
    sourceGroup: 'test-fixture',
    evidenceLevel: 'test-fixture'
  }
];

function buildRealAssets(): GovernedPromptAsset[] {
  const assets: GovernedPromptAsset[] = [];

  // 1. Built-in 9 assets from scorecard
  const rawBuiltIn: { id: string; title: string; score: number; line: number; cat: PromptCategoryV2; tier: PlacementTier }[] = [
    { id: 'inspirationSystem', title: '灵感助手', score: 84, line: 103, cat: 'quality-guardrail', tier: 'core-default' },
    { id: 'storyCards', title: '故事方案卡', score: 83, line: 104, cat: 'quality-guardrail', tier: 'core-default' },
    { id: 'setupTaskRefine', title: '设定项细化', score: 78, line: 105, cat: 'utility-tool', tier: 'agent-guided' },
    { id: 'editorAgent', title: '分镜生成', score: 82, line: 106, cat: 'author-workflow', tier: 'agent-guided' },
    { id: 'manualAudit', title: 'AI 审计', score: 80, line: 107, cat: 'quality-guardrail', tier: 'core-default' },
    { id: 'orchestrateWriter', title: '正文生成', score: 82, line: 108, cat: 'author-workflow', tier: 'flow-default' },
    { id: 'orchestrateCritic', title: '正文生成内审', score: 79, line: 109, cat: 'quality-guardrail', tier: 'core-default' },
    { id: 'extractSkill', title: '拆书迈向', score: 81, line: 110, cat: 'utility-tool', tier: 'agent-guided' },
    { id: 'generateOutline', title: '全局大纲', score: 80, line: 111, cat: 'author-workflow', tier: 'agent-guided' }
  ];

  for (const b of rawBuiltIn) {
    assets.push({
      id: b.id,
      title: b.title,
      stage: b.id === 'orchestrateWriter' ? 'drafting' : 'polish',
      goal: `提供内置基础引擎 ${b.title} 的写作保障，维护写作底线。`,
      inputs: ['content'],
      template: `你现在是 InkFlow 官方内置 ${b.title}。`,
      outputShape: 'plain-text',
      riskNotes: ['官方内置，高频执行，确保高性能'],
      successSignal: '写作基本流畅，维持良好画面感。',
      licenseStatus: 'built-in',
      sanitizationStatus: 'runtime-ready',
      sanitizationHits: { contacts: 0, authors: 0, brands: 0, watermarks: 0 },
      runtimeStatus: 'active',
      placementTier: b.tier,
      score: b.score,
      grade: b.score >= 90 ? 'A' : (b.score >= 80 ? 'B' : 'C'),
      primaryCategory: b.cat,
      isWhiteLabeled: true,
      isRuntimeReady: true,
      sourceType: 'built-in',
      sourceRef: `prompt-asset-scorecard.md:${b.line}`,
      sourceGroup: 'built-in',
      evidenceLevel: 'scored-from-source',
      processDecision: 'adopt'
    });
  }

  // 2. Load square configs (47 items)
  for (const s of rawSquareConfigs) {
    const isPassed = s.score >= 70;
    assets.push({
      id: s.id,
      title: s.title,
      stage: 'polish',
      goal: `发挥广场精品提示词 ${s.title} 局部润色、对白动作强化或题材契合度。`,
      inputs: ['content'],
      template: `[广场优秀提示词模版体] 围绕 ${s.title} 执行，对标网文审美要求。`,
      outputShape: 'plain-text',
      riskNotes: ['已做水印与敏感署名抹除'],
      successSignal: '文字表现力有局部质量拉升。',
      licenseStatus: 'public',
      sanitizationStatus: 'runtime-ready',
      sanitizationHits: { contacts: 0, authors: 0, brands: 0, watermarks: 0 },
      runtimeStatus: isPassed ? 'active' : 'candidate',
      placementTier: s.tier,
      score: s.score,
      grade: s.score >= 90 ? 'A' : (s.score >= 80 ? 'B' : 'C'),
      primaryCategory: s.cat,
      isWhiteLabeled: true,
      isRuntimeReady: true,
      sourceType: s.sourceType,
      sourceRef: `prompt-asset-scorecard.md:${s.line}`,
      sourceGroup: 'square',
      evidenceLevel: 'scored-from-source',
      processDecision: isPassed ? 'adopt' : 'sanitize'
    });
  }

  // 3. Load private configs (77 items)
  for (const p of rawPrivateConfigs) {
    // 强制拦截分值 < 70 的低分/未清洗资产
    const isReady = p.score >= 70 && p.tier !== 'sanitize-required';
    assets.push({
      id: p.id,
      title: p.title,
      stage: 'polish',
      goal: `利用定制付费资产 ${p.title} 全链路推进长篇正文或提供题材适配。`,
      inputs: ['content'],
      template: `[商业定制专属提示词体] 针对长篇小说 ${p.title} 骨架推进。`,
      outputShape: 'plain-text',
      riskNotes: isReady ? ['定制清洗就绪'] : ['未清洗，含作者署名或私有协议，禁止直接加载'],
      successSignal: '长篇节奏感和对白质量有大幅上升。',
      licenseStatus: 'user-authorized',
      sanitizationStatus: isReady ? 'runtime-ready' : 'needs-sanitization',
      sanitizationHits: { contacts: 0, authors: 0, brands: 0, watermarks: 0 },
      runtimeStatus: isReady ? 'active' : 'candidate',
      placementTier: p.tier,
      score: p.score,
      grade: p.score >= 90 ? 'A' : (p.score >= 80 ? 'B' : (p.score >= 70 ? 'C' : 'D')),
      primaryCategory: p.cat,
      isWhiteLabeled: isReady,
      isRuntimeReady: isReady,
      sourceType: p.sourceType,
      sourceRef: `prompt-asset-scorecard.md:${p.line}`,
      sourceGroup: 'private',
      evidenceLevel: 'scored-from-source',
      processDecision: p.score >= 70 ? 'adopt' : 'sanitize'
    });
  }

  // 4. Load creative configs (16 items)
  for (const c of rawCreativeConfigs) {
    let genreTags: string[] = [];
    if (c.id === 'creative-1') genreTags = ['fantasy'];
    else if (c.id === 'creative-2') genreTags = ['cultivation', 'fantasy'];
    else if (c.id === 'creative-3') genreTags = ['urban'];
    else if (c.id === 'creative-4') genreTags = ['rebirth', 'urban', 'fantasy'];
    else if (c.id === 'creative-5') genreTags = ['transmigration'];
    else if (c.id === 'creative-6') genreTags = ['quick-transmigration'];
    else if (c.id === 'creative-7') genreTags = ['apocalypse', 'sci-fi'];
    else if (c.id === 'creative-8') genreTags = ['sci-fi'];
    else if (c.id === 'creative-9') genreTags = ['mystery'];
    else if (c.id === 'creative-10') genreTags = ['romance'];
    else if (c.id === 'creative-11') genreTags = ['palace', 'romance'];
    else if (c.id === 'creative-12') genreTags = ['ensemble'];
    else if (c.id === 'creative-13') genreTags = ['history'];
    else if (c.id === 'creative-14') genreTags = ['gaming', 'sci-fi'];
    else if (c.id === 'creative-15') genreTags = ['light-novel'];
    else if (c.id === 'creative-16') genreTags = ['romance', 'drama'];

    assets.push({
      id: c.id,
      title: c.title,
      stage: 'polish',
      goal: `题材风格包提供 ${c.title} 相关的题材背景支撑和 fallback profile。`,
      inputs: ['content'],
      template: `[题材风格配置体] 提供 ${c.title} 相关的读者期待和红线约束。`,
      outputShape: 'plain-text',
      riskNotes: ['题材大类免费共享，已完成安全合规校验'],
      successSignal: '题材特色感增强。',
      licenseStatus: 'public',
      sanitizationStatus: 'runtime-ready',
      sanitizationHits: { contacts: 0, authors: 0, brands: 0, watermarks: 0 },
      runtimeStatus: 'active',
      placementTier: c.tier,
      score: c.score,
      grade: 'C',
      primaryCategory: c.cat,
      isWhiteLabeled: true,
      isRuntimeReady: true,
      sourceType: 'plaza',
      sourceRef: `prompt-asset-scorecard.md:${c.line}`,
      sourceGroup: 'tool',
      evidenceLevel: 'scored-from-source',
      processDecision: 'adopt',
      genreTags
    });
  }

  // 5. Load supplement configs (16 items)
  for (const su of rawSupplementConfigs) {
    const isTomato = su.id.startsWith('tomato-') || su.id === 'hook-system';

    let stage: 'planning' | 'drafting' | 'polish' | 'review' | 'refactor' = 'polish';
    if (
      su.id === 'tomato-scorecard' ||
      su.id === 'tomato-opening-validator' ||
      su.id === 'snowflake-6-steps' ||
      su.id === 'eight-nodes-structure' ||
      su.id === 'character-state-doc' ||
      su.id === 'context-brief-agent' ||
      su.id === 'opening-templates-library' ||
      su.id === 'tomato-sweet-formula' ||
      su.id.startsWith('deconstruct-card-') ||
      su.id === 'deconstruct-sop-6'
    ) {
      stage = 'planning';
    } else if (su.id === 'chapter-blueprint-prompt') {
      stage = 'drafting';
    } else if (su.id === 'review-schema-v2') {
      stage = 'review';
    }

    assets.push({
      id: su.id,
      title: su.title,
      stage,
      goal: `结合番茄与 Webnovel 的特色能力，挂载 ${su.title} 提高完读率和开篇爽点。`,
      inputs: ['content'],
      template: `[平台能力特化强化体] 导入 ${su.title} 的规范要求和爆款爽点策略。`,
      outputShape: 'plain-text',
      riskNotes: ['番茄补充，用于平台题材特化'],
      successSignal: '平台指标完读及钩子拉扯显著拉升。',
      licenseStatus: 'public',
      sanitizationStatus: 'runtime-ready',
      sanitizationHits: { contacts: 0, authors: 0, brands: 0, watermarks: 0 },
      runtimeStatus: 'active',
      placementTier: su.tier,
      score: su.score,
      grade: su.score >= 90 ? 'A' : 'B',
      primaryCategory: su.cat,
      isWhiteLabeled: true,
      isRuntimeReady: true,
      sourceType: su.sourceType,
      sourceRef: `prompt-supplement-fanqie-webnovel.md:${su.line}`,
      sourceGroup: 'fanqie-supplement',
      evidenceLevel: 'summarized-source',
      processDecision: 'adopt',
      platformTags: isTomato ? ['tomato'] : undefined,
      deconstructionCardType: su.id === 'deconstruct-card-pacing'
        ? 'pacing-card'
        : (su.id === 'deconstruct-card-hook' ? 'hook-card' : undefined)
    });
  }

  // 5.5 追加 GOVERNED_ASSETS_V2_REGISTRY 中的高保真核心资产（过滤重复项，补充治理元数据）
  for (const reg of GOVERNED_ASSETS_V2_REGISTRY) {
    if (reg.id === 'tomato-opening-validator') {
      continue; // 已经在 rawSupplementConfigs 中存在元数据
    }
    assets.push({
      ...reg,
      sourceRef: 'shared/lib/prompt-assets-governed.ts:L265',
      sourceGroup: reg.sourceType === 'built-in' ? 'built-in' : (reg.sourceType === 'plaza' ? 'square' : 'private'),
      evidenceLevel: 'scored-from-source',
      processDecision: 'adopt'
    });
  }

  // 6. Test fixtures (2 items)
  assets.push(...testFixtures);

  return assets;
}

/**
 * 沉淀汇聚：100% 真实、零占位虚假 ID 的 160+ 条真实提示词资产元数据目录大库
 */
export const PROMPT_GOVERNANCE_CATALOG: GovernedPromptAsset[] = [
  ...buildRealAssets()
];

// ── V2 Intelligent Recommendation Router ──

export interface RecommendationInput {
  targetPlatform?: string;
  lengthMode?: 'long' | 'short';
  genreTags?: string[];
  currentStage?: 'planning' | 'drafting' | 'polish' | 'review' | 'refactor';
  commercialMode?: 'free' | 'paid' | 'strict';
  activeSeriesId?: string;
  excludeAssetIds?: string[];
}

/**
 * V2.1 智能路由选择器 (recommendPromptAssets)
 * 根据用户的目标平台、篇幅模式、题材标签、当前阶段、商业模式及激活的流程，智能推荐最多 3 个高评分、高置信度的动作或提示词资产。
 */
export function recommendPromptAssets(input: RecommendationInput): GovernedPromptAsset[] {
  // 1. 置信度物理过滤与安全拦截门禁
  const availableAssets = PROMPT_GOVERNANCE_CATALOG.filter(asset => {
    if (input.excludeAssetIds && input.excludeAssetIds.includes(asset.id)) {
      return false;
    }

    // 物理隔离 test-fixture 极其它不合规置信度资产（非正式资产），豁免 V2 注册表核心资产
    const isV2Registry = GOVERNED_ASSETS_V2_REGISTRY.some(r => r.id === asset.id);
    if (
      !isV2Registry &&
      asset.evidenceLevel !== 'scored-from-source' &&
      asset.evidenceLevel !== 'summarized-source'
    ) {
      return false;
    }

    // 安全准入校验（未清洗、待白标、纯研究、非就绪一律彻底拦截）
    if (
      asset.placementTier === 'sanitize-required' ||
      asset.placementTier === 'research-only' ||
      asset.sanitizationStatus === 'needs-sanitization' ||
      asset.processDecision === 'research-only' ||
      asset.isRuntimeReady === false ||
      asset.isWhiteLabeled === false
    ) {
      return false;
    }

    // 免费模式硬约束：免费模式下拦截付费定制资产（licensed）
    if (input.commercialMode === 'free' && asset.sourceType === 'licensed') {
      return false;
    }

    // 平台硬绑定：非番茄/非 strict 模式下拦截番茄特化及番茄补充资产
    const isTomatoAsset = (asset.platformTags && asset.platformTags.includes('tomato')) ||
                          asset.id.startsWith('tomato-') ||
                          asset.id === 'hook-system' ||
                          (asset.sourceGroup === 'fanqie-supplement' && !asset.id.startsWith('deconstruct-card-'));
    if (isTomatoAsset) {
      const isTomatoPlatform = input.targetPlatform === 'tomato';
      const isStrict = input.commercialMode === 'strict';
      if (!isTomatoPlatform && !isStrict) {
        return false;
      }
    }

    return true;
  });

  const tier1_guardrails: GovernedPromptAsset[] = [];
  const tier2_nextSteps: GovernedPromptAsset[] = [];
  const tier3_enhancements: GovernedPromptAsset[] = [];

  const stage = input.currentStage;

  // 2. 匹配 Tier 1: 核心安全质量护栏
  if (stage === 'polish' || stage === 'review' || stage === 'refactor') {
    const guardrails = availableAssets.filter(asset => asset.primaryCategory === 'quality-guardrail');
    tier1_guardrails.push(...guardrails);
  }

  // 3. 匹配 Tier 2: 流程链条连续步骤推荐
  if (input.activeSeriesId) {
    const activeFlow = SKILL_SERIES_FLOWS.find(flow => flow.id === input.activeSeriesId);
    if (activeFlow) {
      const currentSteps = activeFlow.steps.filter(step => {
        if (stage === 'planning' && step.stepNumber === 1) return true;
        if (stage === 'drafting' && (step.stepNumber === 2 || step.stepNumber === 3)) return true;
        if (stage === 'polish' && step.stepNumber === 4) return true;
        return false;
      });

      if (currentSteps.length > 0) {
        for (const step of currentSteps) {
          const stepAsset = availableAssets.find(asset => asset.id === step.assetId);
          if (stepAsset) {
            tier2_nextSteps.push(stepAsset);
          }
        }
      } else {
        const firstStepAsset = availableAssets.find(asset => asset.id === activeFlow.steps[0].assetId);
        if (firstStepAsset) {
          tier2_nextSteps.push(firstStepAsset);
        }
      }
    }
  }

  // 4. 匹配 Tier 3: 题材或平台特化与挂载拆书卡
  availableAssets.forEach(asset => {
    const matchPlatform = input.targetPlatform && asset.platformTags && asset.platformTags.includes(input.targetPlatform);
    const matchGenre = input.genreTags && asset.genreTags && asset.genreTags.some(tag => input.genreTags!.includes(tag));
    const isDeconstruct = asset.id.startsWith('deconstruct-') || asset.deconstructionCardType !== undefined;

    if (matchPlatform || matchGenre || isDeconstruct) {
      const alreadyInTier1Or2 = [...tier1_guardrails, ...tier2_nextSteps].some(a => a.id === asset.id);
      if (!alreadyInTier1Or2) {
        tier3_enhancements.push(asset);
      }
    }
  });

  const combinedList = [...tier1_guardrails, ...tier2_nextSteps, ...tier3_enhancements];
  const uniqueList: GovernedPromptAsset[] = [];
  const primaryCategoryScoreMap: Record<string, number> = {};

  // 5. 高分去重拦截规则：同分类同大类中强制去重，保留高分资产
  combinedList.forEach(asset => {
    const cat = asset.primaryCategory || 'other';
    const score = asset.score || 0;
    if (!primaryCategoryScoreMap[cat] || score > primaryCategoryScoreMap[cat]) {
      primaryCategoryScoreMap[cat] = score;
    }
  });

  const seenIds = new Set<string>();
  combinedList.forEach(asset => {
    if (seenIds.has(asset.id)) return;

    const cat = asset.primaryCategory || 'other';
    const score = asset.score || 0;
    const isTier2 = tier2_nextSteps.some(a => a.id === asset.id);
    const isSpecialAsset = asset.platformTags !== undefined || asset.genreTags !== undefined || asset.deconstructionCardType !== undefined;

    // 如果是最高分或者是流程下一步推荐，或者是平台或题材特化及拆书卡资产，予以保留
    if (score >= primaryCategoryScoreMap[cat] || isTier2 || isSpecialAsset) {
      uniqueList.push(asset);
      seenIds.add(asset.id);
    }
  });

  const getAssetTier = (asset: GovernedPromptAsset): number => {
    if (tier1_guardrails.some(a => a.id === asset.id)) return 1;
    if (tier2_nextSteps.some(a => a.id === asset.id)) return 2;
    return 3;
  };

  // 6. 截断与最终排序
  uniqueList.sort((a, b) => {
    const tierA = getAssetTier(a);
    const tierB = getAssetTier(b);
    if (tierA !== tierB) {
      return tierA - tierB;
    }

    if (input.activeSeriesId) {
      const activeFlow = SKILL_SERIES_FLOWS.find(flow => flow.id === input.activeSeriesId);
      if (activeFlow) {
        const isAInFlow = activeFlow.steps.some(step => step.assetId === a.id);
        const isBInFlow = activeFlow.steps.some(step => step.assetId === b.id);
        if (isAInFlow && !isBInFlow) return -1;
        if (!isAInFlow && isBInFlow) return 1;
      }
    }

    return (b.score || 0) - (a.score || 0);
  });

  const result = uniqueList.slice(0, 3);

  // 7. 返回结果注入推荐原因，并对推荐资产进行浅拷贝，防止直接修改大库全局对象的副作用
  return result.map(asset => {
    const tier = getAssetTier(asset);
    const recommendationReason =
      tier === 1
        ? "底线防御：AI味去化与局部问题审校，确保文字画面感。"
        : tier === 2
        ? "流程推进：长篇写作连续步骤节点，确保大纲与剧情顺承。"
        : "题材/平台特化：番茄爽爆开篇与钩子强化，拉高完读指标。";
    return {
      ...asset,
      recommendationReason
    };
  });
}

/**
 * 依据启发式规则推断资产的推荐卡片动作类别 (Get Prompt Asset Action Kind)
 */
export function getPromptAssetAction(asset: Partial<GovernedPromptAsset> & { id: string }): PromptAssetActionKind | null {
  // 1. 过滤及不可执行规则拦截
  if (
    asset.placementTier === 'sanitize-required' ||
    asset.placementTier === 'research-only' ||
    asset.id.includes('test-fixture')
  ) {
    return null;
  }

  // 2. 拆书卡规则推断
  const isDeconstruction =
    asset.deconstructionCardType !== undefined ||
    asset.id.startsWith('deconstruct-card-') ||
    asset.id.startsWith('deconstruct-');
  if (isDeconstruction) {
    return 'deconstruction-card';
  }

  // 3. 质量护栏及平台标准规则
  if (asset.primaryCategory === 'quality-guardrail' || asset.primaryCategory === 'platform-criteria') {
    const isRewrite =
      asset.id.includes('rewrite') ||
      asset.id.includes('polish') ||
      asset.id.includes('slop') ||
      asset.id.includes('shield') ||
      asset.id.includes('brush');
    return isRewrite ? 'polish-rewrite' : 'audit-enhance';
  }

  // 4. 作者流程规则
  if (asset.primaryCategory === 'author-workflow') {
    return 'open-flow-step';
  }

  // 5. 题材包 / 风格参考规则
  if (
    asset.primaryCategory === 'style-reference' ||
    asset.primaryCategory === 'constellation-pack'
  ) {
    return 'mount-skill';
  }

  return null;
}

/**
 * 纯推断函数：对 Novel 对象的标签与文本内容进行归一化特征解析，不增加数据库字段
 */
export function inferNovelGovernanceProfile(novel: Novel): InferenceOutput {
  const profileTags = novel.projectPreferenceProfile?.tags || [];
  const textToSearch = [
    novel.title || '',
    novel.summary || '',
    novel.worldRules || '',
    novel.globalOutline || '',
    ...profileTags
  ].join('\n').toLowerCase();

  const isTomato = textToSearch.includes('番茄') || textToSearch.includes('tomato');
  const targetPlatform = isTomato ? 'tomato' : undefined;

  const detectedGenres: string[] = [];
  const GENRE_KEYWORD_MAP: { [key: string]: string } = {
    '玄幻': 'fantasy',
    'fantasy': 'fantasy',
    '修真': 'cultivation',
    '修仙': 'cultivation',
    'cultivation': 'cultivation',
    '都市': 'urban',
    'urban': 'urban',
    '悬疑': 'mystery',
    'mystery': 'mystery',
    '言情': 'romance',
    'romance': 'romance',
    '科幻': 'sci-fi',
    'sci-fi': 'sci-fi',
    'scifi': 'sci-fi',
    '末世': 'apocalypse',
    'apocalypse': 'apocalypse',
    '重生': 'rebirth',
    'rebirth': 'rebirth'
  };

  for (const [kw, tag] of Object.entries(GENRE_KEYWORD_MAP)) {
    if (textToSearch.includes(kw) && !detectedGenres.includes(tag)) {
      detectedGenres.push(tag);
    }
  }

  const mountedSkillIds = novel.mountedSkillIds || [];
  const mountedSkillLoadoutIds = novel.mountedSkillLoadout?.map(item => item.skillId) || [];
  const hasXiaofeiji =
    profileTags.some(t => t.toLowerCase().includes('xiaofeiji') || t.includes('小飞鸡')) ||
    mountedSkillIds.some(id => id.toLowerCase().includes('xiaofeiji') || id.includes('小飞鸡')) ||
    mountedSkillLoadoutIds.some(id => id.toLowerCase().includes('xiaofeiji') || id.includes('小飞鸡'));

  // 检查是否符合风华短篇/老福特流 (老福特 / lofter / 风华 / short)
  const isFenghua =
    textToSearch.includes('老福特') ||
    textToSearch.includes('lofter') ||
    textToSearch.includes('风华') ||
    textToSearch.includes('short');

  // 检查是否符合天马大纲流 (天马 / 大纲)
  const isTianma =
    textToSearch.includes('天马') ||
    textToSearch.includes('大纲');

  let activeSeriesId = 'generic-novel-flow';
  if (hasXiaofeiji) {
    activeSeriesId = 'xiaofeiji-novel-flow';
  } else if (isFenghua) {
    activeSeriesId = 'fenghua-short-flow';
  } else if (isTianma) {
    activeSeriesId = 'tianma-outline-flow';
  } else if (isTomato) {
    activeSeriesId = 'tomato-platform-flow';
  }

  const commercialMode = isTomato ? 'strict' : 'free';

  return {
    targetPlatform,
    genreTags: detectedGenres,
    activeSeriesId,
    commercialMode
  };
}

export interface OpeningRecommendationInput {
  ideaSeed?: string;
  title?: string;
  summary?: string;
  targetWordCount?: number;
  tags?: string[];
}

export interface OpeningRecommendationResult {
  targetPlatform?: string;
  genreTags: string[];
  activeSeriesId: string;
  tagsToApply: string[];
  explanation: string;
}

/**
 * 开新书时智能推荐平台、题材包、流程系列
 */
export function recommendOpeningGovernance(input: OpeningRecommendationInput): OpeningRecommendationResult {
  const title = input.title || '';
  const summary = input.summary || '';
  const ideaSeed = input.ideaSeed || '';
  const tags = input.tags || [];
  const targetWordCount = input.targetWordCount;

  const textToSearch = [title, summary, ideaSeed, ...tags].join('\n').toLowerCase();

  // 识别平台与短篇特征
  const isShortForm = 
    textToSearch.includes('短篇') || 
    textToSearch.includes('知乎') || 
    textToSearch.includes('老福特') || 
    textToSearch.includes('lofter') || 
    (targetWordCount !== undefined && targetWordCount > 0 && targetWordCount < 50000);

  const isTomatoMatched = 
    textToSearch.includes('番茄') || 
    textToSearch.includes('tomato') ||
    textToSearch.includes('爽文') ||
    textToSearch.includes('系统') ||
    textToSearch.includes('重生');

  const isXiaofeijiMatched =
    textToSearch.includes('小飞鸡') ||
    textToSearch.includes('xiaofeiji');

  const isFenghuaMatched =
    textToSearch.includes('老福特') ||
    textToSearch.includes('lofter') ||
    textToSearch.includes('风华') ||
    textToSearch.includes('short');

  const isTianmaMatched =
    textToSearch.includes('天马') ||
    textToSearch.includes('大纲');

  // 决定推荐流程 ID 和平台
  let activeSeriesId = 'generic-novel-flow';
  let targetPlatform: string | undefined = undefined;
  let platformTagToApply: string[] = [];
  let explanation = '根据您的新书灵感，推荐您使用通用创作流程。';

  if (isFenghuaMatched) {
    activeSeriesId = 'fenghua-short-flow';
    explanation = '检测到您偏向于风华/老福特短篇高美感创作，为您推荐最契合的风华短篇/老福特流。';
  } else if (isTianmaMatched) {
    activeSeriesId = 'tianma-outline-flow';
    explanation = '检测到您需要精细规划小说设定与大纲节奏，为您推荐天马大纲定制流。';
  } else if (isShortForm) {
    // 短篇/知乎/老福特：不误推长篇番茄流，即便带有“重生/系统”等词，也只走通用流
    activeSeriesId = 'generic-novel-flow';
    targetPlatform = undefined;
    explanation = '检测到您偏向于短篇/故事性创作，为您推荐最契合的通用创作流程，不误推平台流。';
  } else if (isXiaofeijiMatched) {
    activeSeriesId = 'xiaofeiji-novel-flow';
    platformTagToApply = ['小飞鸡'];
    explanation = '识别到您的小飞鸡大组定制流偏好，推荐挂载小飞鸡八步连续创作流程。';
  } else if (isTomatoMatched) {
    activeSeriesId = 'tomato-platform-flow';
    targetPlatform = 'tomato';
    platformTagToApply = ['番茄'];
    explanation = '由于包含番茄、爽文、系统或重生等平台特质词，为您推荐极速番茄爆款签约流程。';
  }

  // 题材识别
  const detectedGenres: string[] = [];
  const genreTagsToApply: string[] = [];
  const GENRE_MAP: { [key: string]: { tag: string, label: string } } = {
    '玄幻': { tag: 'fantasy', label: '玄幻' },
    'fantasy': { tag: 'fantasy', label: '玄幻' },
    '修真': { tag: 'cultivation', label: '修真' },
    '修仙': { tag: 'cultivation', label: '修仙' },
    'cultivation': { tag: 'cultivation', label: '修真' },
    '都市': { tag: 'urban', label: '都市' },
    'urban': { tag: 'urban', label: '都市' },
    '悬疑': { tag: 'mystery', label: '悬疑' },
    'mystery': { tag: 'mystery', label: '悬疑' },
    '言情': { tag: 'romance', label: '言情' },
    'romance': { tag: 'romance', label: '言情' },
    '科幻': { tag: 'sci-fi', label: '科幻' },
    'sci-fi': { tag: 'sci-fi', label: '科幻' },
    'scifi': { tag: 'sci-fi', label: '科幻' },
    '末世': { tag: 'apocalypse', label: '末世' },
    'apocalypse': { tag: 'apocalypse', label: '末世' },
    '重生': { tag: 'rebirth', label: '重生' },
    'rebirth': { tag: 'rebirth', label: '重生' }
  };

  for (const [kw, info] of Object.entries(GENRE_MAP)) {
    if (textToSearch.includes(kw) && !detectedGenres.includes(info.tag)) {
      detectedGenres.push(info.tag);
      if (!genreTagsToApply.includes(info.label)) {
        genreTagsToApply.push(info.label);
      }
    }
  }

  // 最多推荐 2 个题材包
  const finalGenreTags = detectedGenres.slice(0, 2);
  const finalGenreTagsToApply = genreTagsToApply.slice(0, 2);

  return {
    targetPlatform,
    genreTags: finalGenreTags,
    activeSeriesId,
    tagsToApply: [...platformTagToApply, ...finalGenreTagsToApply],
    explanation
  };
}

// ── Phase 9: 免费/付费增强包包装与判定 ──

export interface EnhancementPackage {
  id: string;
  name: string;
  type: 'free' | 'paid';
  description: string;
  whyUpgrade?: string; // 为什么此时推荐升级说明
  assets?: string[]; // 关联的资产 ID 列表
}

export const ENHANCEMENT_PACKAGES: EnhancementPackage[] = [
  {
    id: 'free-basic-audit',
    name: '基础审稿增强包',
    type: 'free',
    description: '提供最基础的错别字、标点与常识性排查，确保格式规范。',
  },
  {
    id: 'free-basic-humanization',
    name: '基础去 AI 腔增强包',
    type: 'free',
    description: '过滤高频 AI 词汇（如：然而、不得不、闪烁、勾勒等），使行文更流畅。',
  },
  {
    id: 'free-onboarding-pack',
    name: '脑洞与角色构建包',
    type: 'free',
    description: '辅助展开最初的小说创意、起名以及构建基础人设。',
  },
  {
    id: 'free-first-chapter',
    name: '第一章闭环包',
    type: 'free',
    description: '支持完成正文第一章的基础写作与结构闭环。',
  },
  {
    id: 'paid-author-flows',
    name: '名家作者流程包',
    type: 'paid',
    description: '完整复现小飞鸡、风华等名家作者的定制创作全流程。',
    whyUpgrade: '您的创作已经初具规模，此时升级名家流程包可以像金牌主编一样进行多轮、系统化的步骤推荐，彻底打通人设到黄金正文的连贯叙事脉络！',
  },
  {
    id: 'paid-platform-diagnostics',
    name: '爆款平台诊断包',
    type: 'paid',
    description: '结合番茄、起点等各平台完读率模型，诊断前十章是否立住、金手指是否吸睛。',
    whyUpgrade: '多平台发书面临完全不同的审核红线与爆款节奏。升级爆款平台诊断包可以对您的前十章大纲进行深度“X光”式爆点质检，大幅提高内投签约成功率！',
  },
  {
    id: 'paid-cross-chapter-continuity',
    name: '跨章连贯性增强包',
    type: 'paid',
    description: '开启前十章及每十章循环的高级剧情预算与真相拦截器。',
    whyUpgrade: '大纲虽好，生成时却极其容易“提前泄底”或节奏透支。跨章连贯性增强包能在后台为您守死真相锁、锁定伏笔并在后续章节匀速释放冲突！',
  },
  {
    id: 'paid-deconstruction-fusion',
    name: '神作拆书与文风融合包',
    type: 'paid',
    description: '支持从神作中动态拆解出节奏、钩子、反模式卡，并强力融合成写作指令。',
    whyUpgrade: '想学习顶流神作的遣词造句？文风融合包能将参考神作一键提炼成主笔文风、节奏与钩子卡，无需写复杂的提示词，系统直接智能融合。',
  },
  {
    id: 'paid-advanced-audit-patch',
    name: '高级审稿与局部手术包',
    type: 'paid',
    description: '对对白、肢体、神态细节提供高密度、多维度的专项重塑与局部精细化重写。',
    whyUpgrade: '基础的禁词替换已经无法满足细节质感。升级局部手术包，您可以针对指定段落进行站桩说话净化，动态追加肢体表情微动作，让场景像电影般生动！',
  }
];

/**
 * 根据包 ID 判定一个包是否是付费包，并且当前商业模式下是否被拦截。
 */
export function isPackageRestricted(packageId: string, commercialMode: string = 'free'): boolean {
  const pkg = ENHANCEMENT_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return false;
  return pkg.type === 'paid' && commercialMode !== 'paid';
}

// ── Phase 10: 动态维度信号挂载与自适应判定 ──

export interface ActiveDimensionSignals {
  styleHumanization: boolean;
  crossChapterContinuity: boolean;
  commercialReadability: boolean;
  genreFit: boolean;
  platformFit: boolean;

  // 映射的具体行为文案或指令
  extraAuditChecks: string[];       // 补充审稿项
  extraWritingConstraints: string[]; // 加入写作约束
  recommendedAssetIds: string[];    // 推荐的治理资产 ID
}
export interface GovernanceNovelInput {
  wordCount?: number;
  chapters?: unknown[];
  projectPreferenceProfile?: {
    commercialMode?: 'free' | 'paid' | 'strict';
    targetPlatform?: string;
  };
  genre?: string;
  tags?: string[];
}

/**
 * 根据作品画像、基本信息以及字数等自适应判断应该挂载哪些维度的信号，并返回映射的具体行为
 */
export function getActiveDimensionSignals(novel: GovernanceNovelInput): ActiveDimensionSignals {
  // 提取基本信号
  const wordCount = novel.wordCount || 0;
  const chapterCount = novel.chapters?.length || 0;
  const isCommercial = novel.projectPreferenceProfile?.commercialMode === 'paid';
  const targetPlatform = novel.projectPreferenceProfile?.targetPlatform || '';
  const genre = novel.genre || '';
  const tags = novel.tags || [];

  // 1. style-humanization 激活条件：已经开始写正文，且存在字数，或者带有 style-humanization 的标签/偏好
  const styleHumanization = wordCount > 0 || tags.includes('style-humanization') || tags.includes('美文') || tags.includes('精品');

  // 2. cross-chapter-continuity 激活条件：章节数 >= 5，或者长篇字数 > 10000
  const crossChapterContinuity = chapterCount >= 5 || wordCount > 10000 || tags.includes('long-novel') || tags.includes('长篇');

  // 3. commercial-readability 激活条件：属于付费商业项目，或者目标平台是商业爆款导向（如番茄、七猫、起点）
  const isCommercialPlatform = ['番茄', '起点', '晋江', '七猫', '17k'].some(p => targetPlatform.includes(p));
  const commercialReadability = isCommercial || isCommercialPlatform || tags.includes('爽文') || tags.includes('商业');

  // 4. genre-fit 激活条件：指定了明确的流派，且有对应的题材包/题材特征
  const genreFit = !!genre && genre !== '未分类' && genre !== '其他';

  // 5. platform-fit 激活条件：指定了明确的发布平台
  const platformFit = !!targetPlatform && targetPlatform !== '未确定';

  // 映射至具体行为：补充审稿项、写作约束、推荐资产
  const extraAuditChecks: string[] = [];
  const extraWritingConstraints: string[] = [];
  const recommendedAssetIds: string[] = [];

  if (styleHumanization) {
    extraAuditChecks.push(
      '检测是否存在机械套话与翻译腔（如“不得不说”、“然而，他知道”、“闪烁着...的光芒”）。',
      '评估对话是否处于“站桩说话”状态，确保每个重要台词都有微表情、呼吸节奏或手部物理反应进行包裹。'
    );
    extraWritingConstraints.push(
      '【文风约束】行文中严禁使用无意义修饰词或大面积总结性叙事（解释感过强），多用物理动作、声音、环境反馈和眼神微表情来暗示心理状态。'
    );
    recommendedAssetIds.push('core-slop-shield', 'core-dialogue-enhancer');
  }

  if (crossChapterContinuity) {
    extraAuditChecks.push(
      '评估此章是否泄露了前文或大纲中设定的核心秘密/真相。',
      '核对黄金转折或冲突是否在该匀速释放的节点内，有无剧情过度消耗风险。'
    );
    extraWritingConstraints.push(
      '【连贯性约束】严格锁死中后期核心设定的真相秘密，绝不让角色口无遮拦提前泄底。时刻跟进上一章遗留的末尾悬念（Hook）并在前500字内给予自然交代。'
    );
    recommendedAssetIds.push('plaza-golden-three');
  }

  if (commercialReadability) {
    extraAuditChecks.push(
      '质检此章开篇 300 字内是否拉起冲突或建立悬念，读者完读拉力是否足够。',
      '核查是否有大段主角背景设定造成的“阅读阻力”（Info dump），是否符合该发书平台的签约标准。'
    );
    extraWritingConstraints.push(
      '【商业质检约束】避免冗长的说明，用极致的动作链拉快开场节奏。第一页必须建立直观目标，严禁降智度过高的反派桥段，保持强烈的爽度与期待感。'
    );
    recommendedAssetIds.push('tomato-opening-validator');
  }

  if (genreFit) {
    extraAuditChecks.push(`审视内容是否高度贴合流派 [${genre}] 的核心调性（如克苏鲁需要冰冷压迫感、古言需要典雅句式）。`);
    extraWritingConstraints.push(`【流派特化】请严格遵循 [${genre}] 流派的核心叙事特征与审美词汇，强化该题材垂直受众最钟爱的氛围场景渲染。`);
    if (genre.includes('克苏鲁') || genre.includes('悬疑')) {
      recommendedAssetIds.push('licensed-cthulhu-style');
    } else if (genre.includes('古风') || genre.includes('古言')) {
      recommendedAssetIds.push('ancient-gorgeous-reference');
    }
  }

  if (platformFit) {
    extraAuditChecks.push(`检测审稿口径是否符合发布平台 [${targetPlatform}] 的签约 and 读者推荐倾向。`);
    extraWritingConstraints.push(`【平台特化】针对发布平台 [${targetPlatform}] 的读者期望优化章节字数分布和悬念落点，符合平台完读率模型。`);
    if (targetPlatform.includes('番茄')) {
      recommendedAssetIds.push('tomato-opening-validator');
    }
  }

  return {
    styleHumanization,
    crossChapterContinuity,
    commercialReadability,
    genreFit,
    platformFit,
    extraAuditChecks,
    extraWritingConstraints,
    recommendedAssetIds: Array.from(new Set(recommendedAssetIds))
  };
}

/**
 * 根据资产 ID 获取对应的增强包配置
 */
export function getAssetEnhancementPackage(assetId: string): EnhancementPackage | null {
  let pkgId = '';
  if (assetId === 'core-dialogue-enhancer' || assetId === 'core-slop-shield') {
    pkgId = 'paid-advanced-audit-patch';
  } else if (assetId === 'tomato-opening-validator') {
    pkgId = 'paid-platform-diagnostics';
  } else if (assetId === 'plaza-golden-three') {
    pkgId = 'paid-cross-chapter-continuity';
  } else if (assetId === 'licensed-cthulhu-style' || assetId === 'ancient-gorgeous-reference') {
    pkgId = 'paid-deconstruction-fusion';
  }

  if (!pkgId) return null;
  return ENHANCEMENT_PACKAGES.find(p => p.id === pkgId) || null;
}

/**
 * 根据流程 ID 获取对应的增强包配置
 */
export function getFlowEnhancementPackage(flowId: string): EnhancementPackage | null {
  if (flowId === 'fenghua-short-flow' || flowId === 'tianma-outline-flow') {
    return ENHANCEMENT_PACKAGES.find(p => p.id === 'paid-author-flows') || null;
  }
  return null;
}
