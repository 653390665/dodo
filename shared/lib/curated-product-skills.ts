import type { CuratedProductSkill } from '../types/prompt-assets-governed.js';

/**
 * 精选白标白名单货架 - 8 大航道（每航道 2 张，共计 16 张高等级卡牌元数据）
 */
export const CURATED_PRODUCT_SKILLS: CuratedProductSkill[] = [
  // 1. opening (开篇)
  {
    id: 'opening-gold-three',
    title: '黄金三章核心冲突大纲展开器',
    curatedCategory: 'opening',
    goal: '规划开局爽点、建立第一冲突悬念，吸引读者持续阅读。',
    successSignal: '开局剧情节奏紧凑，前三章完读预期和爽点极高。',
    score: 95,
    grade: 'A',
    sourceType: 'built-in',
    primaryCategory: 'author-workflow',
    inputs: ['outline'],
    actionType: 'equip'
  },
  {
    id: 'opening-novelty-hook',
    title: '网文黄金前三章爽点质检仪',
    curatedCategory: 'opening',
    goal: '全面评估开篇冲突、金手指设立及节奏紧凑度，消除前期无用铺垫。',
    successSignal: '开局爽点、金手指节奏与完读率预测通过。',
    score: 92,
    grade: 'A',
    sourceType: 'licensed',
    primaryCategory: 'quality-guardrail',
    inputs: ['content'],
    actionType: 'direct-exec'
  },
  // 2. bible (设定)
  {
    id: 'bible-world-builder',
    title: '长篇超宏大世界观设定器',
    curatedCategory: 'bible',
    goal: '自动构建具有高度自洽性的宏大世界背景、力量等级与基本律法。',
    successSignal: '力量体系极其严密，世界观代入感和背景宏大感极强。',
    score: 96,
    grade: 'S',
    sourceType: 'licensed',
    primaryCategory: 'author-workflow',
    inputs: ['idea'],
    actionType: 'equip'
  },
  {
    id: 'bible-character-arc',
    title: '核心角色人设卡与成长弧光生成',
    curatedCategory: 'bible',
    goal: '生成具有强烈内在冲突、情感纠葛、金手指适配的核心角色设定卡。',
    successSignal: '核心人设极具画面感，情感线、冲突线埋藏得当。',
    score: 91,
    grade: 'A',
    sourceType: 'built-in',
    primaryCategory: 'author-workflow',
    inputs: ['idea'],
    actionType: 'equip'
  },
  // 3. prose (正文)
  {
    id: 'prose-mouth-flavor',
    title: '超强口语化推进剧情正文器',
    curatedCategory: 'prose',
    goal: '将复杂的剧情通过干净利落、极具代入感的网文式口语化语言推进，提升阅读体验。',
    successSignal: '情节极速推进，文字白话却极具画面代入感与情绪爽感。',
    score: 93,
    grade: 'A',
    sourceType: 'plaza',
    primaryCategory: 'author-workflow',
    inputs: ['scene-outline'],
    actionType: 'equip'
  },
  {
    id: 'prose-action-booster',
    title: '场景肢体动作与画面张力正文器',
    curatedCategory: 'prose',
    goal: '在情节推进中融入细节饱满的下意识肢体反应与视听语言，打破站桩。',
    successSignal: '画面感爆棚，肢体动作与眼神交流无缝交织。',
    score: 94,
    grade: 'A',
    sourceType: 'built-in',
    primaryCategory: 'author-workflow',
    inputs: ['scene-outline'],
    actionType: 'equip'
  },
  // 4. audit (审稿)
  {
    id: 'audit-logical-sanity',
    title: '段落情节逻辑检测分析器',
    curatedCategory: 'audit',
    goal: '高灵敏度检测段落中的常识性漏洞、智障反派、逻辑硬伤与突兀转变。',
    successSignal: '段落逻辑漏洞尽显，诊断意见极其具体具有手术级可操作性。',
    score: 92,
    grade: 'A',
    sourceType: 'plaza',
    primaryCategory: 'quality-guardrail',
    inputs: ['content'],
    actionType: 'direct-exec'
  },
  {
    id: 'audit-cliche-detector',
    title: '去AI腔腔调与废话净化质检仪',
    curatedCategory: 'audit',
    goal: '全面质检和剔除AI生成的各类翻译腔、套话排比和无意义心理描述。',
    successSignal: '机械AI味完全抹除，大白话和灵性文学语流大幅回归。',
    score: 95,
    grade: 'A',
    sourceType: 'built-in',
    primaryCategory: 'quality-guardrail',
    inputs: ['content'],
    actionType: 'direct-exec'
  },
  // 5. de-ai (去AI)
  {
    id: 'de-ai-slop-shield',
    title: '深度AI句式与套话物理抹除器',
    curatedCategory: 'de-ai',
    goal: '强力冲洗段落中的翻译腔、无意义情绪渲染和空洞的“高阶”词组。',
    successSignal: '空洞心理与AI陈词滥调一扫而空，内容饱满紧凑。',
    score: 97,
    grade: 'S',
    sourceType: 'built-in',
    primaryCategory: 'quality-guardrail',
    inputs: ['content'],
    actionType: 'equip'
  },
  {
    id: 'de-ai-rhythm-restorer',
    title: '文字灵性语流节奏重建增强包',
    curatedCategory: 'de-ai',
    goal: '重构由于AI生成而死板的句子长短、断句和段落结构，恢复文字灵性气韵。',
    successSignal: '句子节奏疏密有致，通俗易懂且带有高超的行文灵性。',
    score: 92,
    grade: 'A',
    sourceType: 'plaza',
    primaryCategory: 'quality-guardrail',
    inputs: ['content'],
    actionType: 'equip'
  },
  // 6. platform (平台)
  {
    id: 'platform-tomato-scoring',
    title: '番茄爽文爆款完读率诊断评分仪',
    curatedCategory: 'platform',
    goal: '诊断大纲与章节是否具有爆款番茄脑洞，评估金手指冲击力和留存指标。',
    successSignal: '番茄风爽感、黄金留存钩子和反转节奏被完全识别 and 打分。',
    score: 94,
    grade: 'S',
    sourceType: 'licensed',
    primaryCategory: 'platform-criteria',
    inputs: ['content'],
    actionType: 'direct-exec'
  },
  {
    id: 'platform-webnovel-criteria',
    title: '海外主流网文海外通吃爽点自检仪',
    curatedCategory: 'platform',
    goal: '检查出海玄幻、狼人或霸总作品在西方完读文化下的爽度机制 and 剧情节奏。',
    successSignal: '西方读者代入感和出海畅销指数得到深度提炼。',
    score: 89,
    grade: 'B',
    sourceType: 'licensed',
    primaryCategory: 'platform-criteria',
    inputs: ['content'],
    actionType: 'direct-exec'
  },
  // 7. style (风格)
  {
    id: 'style-cthulhu-mystique',
    title: '克苏鲁不可名状寒风氛围风格增色包',
    curatedCategory: 'style',
    goal: '渲染神秘、粘稠、冰冷和充满未知疯狂的克苏鲁式惊悚美学氛围。',
    successSignal: '极高水准的克式惊悚、疯狂与压迫感氛围油然而生。',
    score: 93,
    grade: 'A',
    sourceType: 'licensed',
    primaryCategory: 'style-reference',
    inputs: ['content'],
    actionType: 'equip'
  },
  {
    id: 'style-ancient-elegance',
    title: '古言华美辞藻典雅国风参考包',
    curatedCategory: 'style',
    goal: '参考古典诗词乐府，精琢人物服饰、背景器物与古风句式，增强雅致底蕴。',
    successSignal: '言辞温润、画面优雅，国风神韵极其自然地渗透进字里行间。',
    score: 91,
    grade: 'A',
    sourceType: 'plaza',
    primaryCategory: 'style-reference',
    inputs: ['content'],
    actionType: 'equip'
  },
  // 8. deconstruct (拆书)
  {
    id: 'deconstruct-golden-climax',
    title: '神作黄金高爽节奏与钩子拆书卡',
    curatedCategory: 'deconstruct',
    goal: '拆解爆款名篇的高爽高潮节点与悬念段落分布，转化为本章可套用节奏指南。',
    successSignal: '成功形成结构化的、可用于本地套用创作的高爽剧情黄金节奏排卡。',
    score: 95,
    grade: 'S',
    sourceType: 'plaza',
    primaryCategory: 'skill-card',
    inputs: ['content'],
    actionType: 'equip'
  },
  {
    id: 'deconstruct-suspense-hook',
    title: '神作高潮段落悬念精细拆解卡',
    curatedCategory: 'deconstruct',
    goal: '拆解高人气作品的核心反转悬念、多线索铺垫和草蛇灰线的读者期待拉扯结构。',
    successSignal: '完美解析出悬念铺垫时间线与心跳波形图，形成极品钩子模版。',
    score: 91,
    grade: 'A',
    sourceType: 'plaza',
    primaryCategory: 'skill-card',
    inputs: ['content'],
    actionType: 'equip'
  }
];
