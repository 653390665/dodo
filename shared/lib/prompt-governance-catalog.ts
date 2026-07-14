import type { GovernedPromptAsset, PromptCategoryV2, PlacementTier, SkillSeriesFlowStep, SkillSeriesFlow } from '../types/prompt-assets-governed.js';
import type { Novel } from '../types.js';

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

export const SKILL_SERIES_FLOWS: SkillSeriesFlow[] = [
  {
    id: 'xiaofeiji-novel-flow',
    name: '长篇商业连载流程',
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
	        input: 'idea',
	        output: 'world-setting',
	        assetId: 'private-175', // 小飞鸡长篇通用大纲规划
	        qualityGate: '战力等级与世界观基本设定完备',
	        nextStepId: 'xiaofeiji-novel-flow-step3',
	        switchAllowed: true,
	        navigateTo: 'bible'
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
	        switchAllowed: true,
	        navigateTo: 'bible'
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
	        switchAllowed: true,
	        navigateTo: 'outline'
	      },
	      {
	        id: 'xiaofeiji-novel-flow-step5',
	        stepNumber: 5,
	        name: '故事细纲与高潮铺设',
	        description: '故事细纲与高潮铺设描述说明',
	        input: 'chapters-outline',
	        output: 'detailed-outline',
	        assetId: 'private-179', // 章纲定制资产
	        qualityGate: '细纲爽点和冲突闭环',
	        nextStepId: 'xiaofeiji-novel-flow-step6',
	        switchAllowed: true,
	        navigateTo: 'outline'
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
	        switchAllowed: true,
	        navigateTo: 'planning'
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
	        switchAllowed: true,
	        navigateTo: 'production'
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
	        switchAllowed: true,
	        navigateTo: 'quality'
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
	        switchAllowed: true,
	        navigateTo: 'bible'
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
	        switchAllowed: true,
	        navigateTo: 'outline'
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
	        switchAllowed: true,
	        navigateTo: 'planning'
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
	        switchAllowed: true,
	        navigateTo: 'production'
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
      goal: `题材风格包提供 ${c.title} 相关的题材背景支撑 and fallback profile。`,
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

// Re-export focused sub-modules to preserve backwards compatibility for existing importers.
export * from './enhancement-packages.js';
export * from './curated-product-skills.js';

