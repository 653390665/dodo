import type { GovernedPromptAsset, PromptAssetActionKind, InferenceOutput } from '../types/prompt-assets-governed.js';
import type { Novel } from '../types.js';
import {
  GOVERNED_ASSETS_V2_REGISTRY,
  SKILL_SERIES_FLOWS,
  PROMPT_GOVERNANCE_CATALOG
} from './public-skill-catalog.js';

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
  const longformFlowId = SKILL_SERIES_FLOWS.find(flow => flow.name.includes('长篇商业连载'))?.id;
  const hasPremiumLongformFlow =
    [...profileTags, ...mountedSkillIds, ...mountedSkillLoadoutIds].some(id =>
      id === longformFlowId ||
      id === 'xiaofeiji' ||
      id === 'xiaofeiji-novel' ||
      id.includes('xiaofeiji')
    );

  const isShortAesthetic =
    textToSearch.includes('老福特') ||
    textToSearch.includes('lofter') ||
    textToSearch.includes('short');

  const isOutlineHeavy = textToSearch.includes('大纲');

  let activeSeriesId = 'generic-novel-flow';
  if (hasPremiumLongformFlow && longformFlowId) {
    activeSeriesId = longformFlowId;
  } else if (isShortAesthetic) {
    activeSeriesId = 'fenghua-short-flow';
  } else if (isOutlineHeavy) {
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

  const longformFlowId = SKILL_SERIES_FLOWS.find(flow => flow.name.includes('长篇商业连载'))?.id;
  const isPremiumLongformMatched =
    tags.includes(longformFlowId || '') ||
    tags.includes('长篇商业连载流程') ||
    textToSearch.includes('小飞鸡') ||
    textToSearch.includes('xiaofeiji') ||
    tags.includes('小飞鸡');

  const isShortAestheticMatched =
    textToSearch.includes('老福特') ||
    textToSearch.includes('lofter') ||
    textToSearch.includes('short');

  const isOutlineHeavyMatched = textToSearch.includes('大纲');

  // 决定推荐流程 ID 和平台
  let activeSeriesId = 'generic-novel-flow';
  let targetPlatform: string | undefined = undefined;
  let platformTagToApply: string[] = [];
  let explanation = '根据您的新书灵感，推荐您使用通用创作流程。';

  if (isShortAestheticMatched) {
    activeSeriesId = 'fenghua-short-flow';
    explanation = '检测到您偏向于老福特/短篇高美感创作，为您推荐短篇高美感流程。';
  } else if (isOutlineHeavyMatched) {
    activeSeriesId = 'tianma-outline-flow';
    explanation = '检测到您需要精细规划小说设定与大纲节奏，为您推荐结构化大纲流程。';
  } else if (isShortForm) {
    // 短篇/知乎/老福特：不误推长篇番茄流，即便带有“重生/系统”等词，也只走通用流
    activeSeriesId = 'generic-novel-flow';
    targetPlatform = undefined;
    explanation = '检测到您偏向于短篇/故事性创作，为您推荐最契合的通用创作流程，不误推平台流。';
  } else if (isPremiumLongformMatched && longformFlowId) {
    activeSeriesId = longformFlowId;
    platformTagToApply = [
      textToSearch.includes('小飞鸡') || tags.includes('小飞鸡') ? '小飞鸡' : '长篇商业连载流程'
    ];
    explanation = '识别到您的专属高级定制流偏好，推荐挂载长篇商业连载流程。';
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
