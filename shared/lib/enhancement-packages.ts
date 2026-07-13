import type { EnhancementPackage } from '../types/prompt-assets-governed.js';

/**
 * Phase 9: 免费/付费增强包包装与判定
 */
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
