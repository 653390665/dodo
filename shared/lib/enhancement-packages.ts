import type { EnhancementPackage, EnhancementPackageStep } from '../types/prompt-assets-governed.js';

/**
 * Phase 9: 免费/付费增强包包装与判定
 */
export const ENHANCEMENT_PACKAGES: EnhancementPackage[] = [
  {
    id: 'free-basic-audit',
    name: '基础审稿增强包',
    type: 'free',
    description: '提供最基础的错别字、标点与常识性排查，确保格式规范。',
    assets: ['audit-cliche-detector'],
    version: '1', intendedOutcome: '完成章节写后基础审查',
    steps: [{ id: 'free-basic-audit-run', assetId: 'audit-cliche-detector', mode: 'run-now', trigger: 'after-draft', scope: 'chapter', order: 1, required: true }],
  },
  {
    id: 'free-basic-humanization',
    name: '基础去 AI 腔增强包',
    type: 'free',
    description: '过滤高频 AI 词汇（如：然而、不得不、闪烁、勾勒等），使行文更流畅。',
    assets: ['de-ai-slop-shield'],
    version: '1', intendedOutcome: '写前减少机械表达，写后提供去 AI 腔预览',
    steps: [
      { id: 'free-basic-humanization-before', assetId: 'de-ai-slop-shield', mode: 'schedule', trigger: 'before-draft', scope: 'chapter', order: 1, required: true },
      { id: 'free-basic-humanization-after', assetId: 'de-ai-slop-shield', mode: 'run-now', trigger: 'after-draft', scope: 'selection', order: 2, required: false, dependsOn: ['free-basic-humanization-before'] },
    ],
  },
  {
    id: 'free-onboarding-pack',
    name: '脑洞与角色构建包',
    type: 'free',
    description: '辅助展开最初的小说创意、起名以及构建基础人设。',
    assets: ['bible-world-builder', 'bible-character-arc'],
    version: '1', intendedOutcome: '建立可确认的世界观和人物设定候选',
    steps: [
      { id: 'free-onboarding-world', assetId: 'bible-world-builder', mode: 'configure', trigger: 'project-setup', scope: 'project', order: 1, required: true },
      { id: 'free-onboarding-character', assetId: 'bible-character-arc', mode: 'configure', trigger: 'project-setup', scope: 'project', order: 2, required: true, dependsOn: ['free-onboarding-world'] },
    ],
  },
  {
    id: 'free-first-chapter',
    name: '第一章闭环包',
    type: 'free',
    description: '支持完成正文第一章的基础写作与结构闭环。',
    assets: ['opening-gold-three', 'prose-action-booster'],
    version: '1', intendedOutcome: '先优化开篇结构，再安排第一章正文表达技法',
    steps: [
      { id: 'free-first-chapter-outline', assetId: 'opening-gold-three', mode: 'configure', trigger: 'outline', scope: 'project', order: 1, required: true },
      { id: 'free-first-chapter-prose', assetId: 'prose-action-booster', mode: 'schedule', trigger: 'before-draft', scope: 'chapter', order: 2, required: false, dependsOn: ['free-first-chapter-outline'] },
    ],
  },
  {
    id: 'paid-author-flows',
    name: '名家作者流程包',
    type: 'paid',
    description: '完整复现小飞鸡、风华等名家作者的定制创作全流程。',
    whyUpgrade: '您的创作已经初具规模，此时升级名家流程包可以像金牌主编一样进行多轮、系统化的步骤推荐，彻底打通人设到黄金正文的连贯叙事脉络！',
    assets: ['xiaofeiji-novel-flow', 'tomato-platform-flow', 'generic-novel-flow', 'book-deconstruction-flow'],
    version: '1', intendedOutcome: '从多个候选流程中显式选择一条作品创作流程',
    conflicts: ['同一作品只能选择一条创作流程'],
    steps: ['xiaofeiji-novel-flow', 'tomato-platform-flow', 'generic-novel-flow', 'book-deconstruction-flow'].map((assetId, index) => ({ id: `paid-author-flows-${index + 1}`, assetId, mode: 'recommend' as const, trigger: 'project-setup' as const, scope: 'project' as const, order: index + 1, required: false })),
  },
  {
    id: 'paid-platform-diagnostics',
    name: '爆款平台诊断包',
    type: 'paid',
    description: '结合番茄、起点等各平台完读率模型，诊断前十章是否立住、金手指是否吸睛。',
    whyUpgrade: '多平台发书面临完全不同的审核红线与爆款节奏。升级爆款平台诊断包可以对您的前十章大纲进行深度“X光”式爆点质检，大幅提高内投签约成功率！',
    assets: ['opening-novelty-hook', 'platform-tomato-scoring', 'platform-webnovel-criteria'],
    version: '1', intendedOutcome: '在开篇与阶段里程碑运行目标平台代理诊断',
    steps: [
      { id: 'paid-platform-hook', assetId: 'opening-novelty-hook', mode: 'run-now', trigger: 'outline', scope: 'single-run', order: 1, required: true },
      { id: 'paid-platform-tomato', assetId: 'platform-tomato-scoring', mode: 'recommend', trigger: 'milestone', scope: 'project', order: 2, required: false },
      { id: 'paid-platform-webnovel', assetId: 'platform-webnovel-criteria', mode: 'recommend', trigger: 'milestone', scope: 'project', order: 3, required: false },
    ],
  },
  {
    id: 'paid-cross-chapter-continuity',
    name: '跨章连贯性增强包',
    type: 'paid',
    description: '开启前十章及每十章循环的高级剧情预算与真相拦截器。',
    whyUpgrade: '大纲虽好，生成时却极其容易“提前泄底”或节奏透支。跨章连贯性增强包能在后台为您守死真相锁、锁定伏笔并在后续章节匀速释放冲突！',
    assets: ['deconstruct-golden-climax', 'deconstruct-suspense-hook'],
    version: '1', intendedOutcome: '把跨章节奏与悬念卡提交到作品卡组待选',
    steps: [
      { id: 'paid-continuity-pacing', assetId: 'deconstruct-golden-climax', mode: 'configure', trigger: 'project-setup', scope: 'project', order: 1, required: false },
      { id: 'paid-continuity-hook', assetId: 'deconstruct-suspense-hook', mode: 'configure', trigger: 'project-setup', scope: 'project', order: 2, required: false },
    ],
  },
  {
    id: 'paid-deconstruction-fusion',
    name: '神作拆书与文风融合包',
    type: 'paid',
    description: '支持从神作中动态拆解出节奏、钩子、反模式卡，并整理为待确认写作规则。',
    whyUpgrade: '想学习顶流神作的遣词造句？文风融合包会辅助提炼主笔文风、节奏与钩子候选卡；保存后由作者选择卡组位置并确认融合。',
    assets: ['style-cthulhu-mystique', 'style-ancient-elegance', 'deconstruct-golden-climax', 'deconstruct-suspense-hook'],
    version: '1', intendedOutcome: '形成可选择、可融合的拆书卡候选',
    steps: ['style-cthulhu-mystique', 'style-ancient-elegance', 'deconstruct-golden-climax', 'deconstruct-suspense-hook'].map((assetId, index) => ({ id: `paid-deconstruction-fusion-${index + 1}`, assetId, mode: 'recommend' as const, trigger: 'project-setup' as const, scope: 'project' as const, order: index + 1, required: false })),
  },
  {
    id: 'paid-advanced-audit-patch',
    name: '高级审稿与局部手术包',
    type: 'paid',
    description: '对对白、肢体、神态细节提供高密度、多维度的专项重塑与局部精细化重写。',
    whyUpgrade: '基础的禁词替换已经无法满足细节质感。升级局部手术包，您可以针对指定段落进行站桩说话净化，动态追加肢体表情微动作，让场景像电影般生动！',
    assets: ['de-ai-slop-shield', 'de-ai-rhythm-restorer', 'prose-action-booster'],
    version: '1', intendedOutcome: '在审查后生成局部精修预览，由作者确认应用',
    steps: ['de-ai-slop-shield', 'de-ai-rhythm-restorer', 'prose-action-booster'].map((assetId, index) => ({ id: `paid-advanced-audit-patch-${index + 1}`, assetId, mode: 'run-now' as const, trigger: 'after-draft' as const, scope: 'selection' as const, order: index + 1, required: index === 0 })),
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

/** Returns the step recipe while keeping legacy assets-only packages readable. */
export function getEnhancementPackageSteps(pkg: EnhancementPackage): readonly EnhancementPackageStep[] {
  if (pkg.steps?.length) return pkg.steps;
  return (pkg.assets || []).map((assetId, index) => ({
    id: `${pkg.id}-step-${index + 1}`, assetId, mode: 'recommend' as const, trigger: 'milestone' as const,
    scope: 'single-run' as const, order: index + 1, required: false,
  }));
}
