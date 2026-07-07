import type { Skill, QuotaLimits, ProjectPreferenceProfile } from '../../shared/types';
import { getNovel, updateNovel } from '../lib/db/novels.js';

/**
 * 默认免费额度上限配置
 * Default free-tier quota configuration
 */
export const DEFAULT_QUOTA_MAX = {
  extractSkill: 5,     // 免费拆书萃取次数上限
  generateProse: 10,   // 免费正文生成次数上限
  advancedAudit: 5,    // 免费智能审稿与高级诊断次数上限
};

/**
 * 配额检查返回结果接口
 * Response structure for quota validation checks
 */
export interface QuotaCheckResult {
  allowed: boolean;
  limitType?: 'extractSkill' | 'generateProse' | 'advancedAudit';
  count?: number;
  max?: number;
  error?: string;
}

/**
 * 配额卡控与看门狗服务 (Quota Guard Service)
 * Fully encapsulates commercial boundary rules and limits verification
 */

export function isPaidSkill(skill: Skill): boolean {
  // 1. 如果有显式指定的 accessTier，以其为准
  // If explicitly specified by the accessTier field
  if (skill.accessTier === 'paid') return true;
  if (skill.accessTier === 'free') return false;

  // 2. 如果 sourceType 为 licensed，也是付费精选卡
  if (skill.sourceType === 'licensed') return true;

  // 3. 默认判定规则 (Default fallback):
  // 仅看明确付费字段，不再因为评分 >= 90 或拥有 parentSkillId 自动判定付费。
  return false;
}

/**
 * 校验特定小说的 AI 功能调用额度
 * Validates whether the given novel has enough quota remaining for a specific action
 */
export function checkQuota(
  novelId: string | undefined,
  limitType: 'extractSkill' | 'generateProse' | 'advancedAudit'
): QuotaCheckResult {
  // 游客模式或未绑定小说的请求不作拦截
  // Free guest requests without a bound novelId are bypassing quota guard to lower adoption friction
  if (!novelId) {
    return { allowed: true };
  }

  const novel = getNovel(novelId);
  if (!novel) {
    return { allowed: true };
  }

  const profile = (novel.projectPreferenceProfile || {}) as ProjectPreferenceProfile;
  const commercialMode = profile.commercialMode || 'free';

  // 付费版 (paid | strict) 用户或小说，无限额度直接放行
  // Premium paid tier possesses infinite credits, direct pass
  if (commercialMode === 'paid' || commercialMode === 'strict') {
    return { allowed: true };
  }

  // 免费版配额校验
  // Validate limits against free-tier limits
  const limits: QuotaLimits = profile.quotaLimits || {} as QuotaLimits;
  
  let max = DEFAULT_QUOTA_MAX[limitType];
  let count = 0;

  if (limitType === 'extractSkill') {
    max = limits.extractSkillMax ?? DEFAULT_QUOTA_MAX.extractSkill;
    count = limits.extractSkillCount ?? 0;
  } else if (limitType === 'generateProse') {
    max = limits.generateProseMax ?? DEFAULT_QUOTA_MAX.generateProse;
    count = limits.generateProseCount ?? 0;
  } else if (limitType === 'advancedAudit') {
    max = limits.advancedAuditMax ?? DEFAULT_QUOTA_MAX.advancedAudit;
    count = limits.advancedAuditCount ?? 0;
  }

  if (count >= max) {
    const errorMsg = getQuotaErrorMessage(limitType, max);
    return {
      allowed: false,
      limitType,
      count,
      max,
      error: errorMsg,
    };
  }

  return {
    allowed: true,
    limitType,
    count,
    max,
  };
}

/**
 * 扣减/累加特定小说的配额消耗
 * Consumes 1 credit of the designated quota limit type, then persist back to SQLite
 */
export function consumeQuota(
  novelId: string | undefined,
  limitType: 'extractSkill' | 'generateProse' | 'advancedAudit'
): void {
  if (!novelId) return;

  const novel = getNovel(novelId);
  if (!novel) return;

  const profile: ProjectPreferenceProfile = {
    tags: [],
    weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    ...(novel.projectPreferenceProfile || {})
  };
  const commercialMode = profile.commercialMode || 'free';

  // 付费版模式下，无需递增和记录计数器
  // Do not increment counts if the novel is upgraded to premium
  if (commercialMode === 'paid' || commercialMode === 'strict') {
    return;
  }

  // 初始化计数结构
  // Initialize quota structure safely
  const limits: QuotaLimits = { ...(profile.quotaLimits || {}) };

  if (limitType === 'extractSkill') {
    limits.extractSkillMax = limits.extractSkillMax ?? DEFAULT_QUOTA_MAX.extractSkill;
    limits.extractSkillCount = (limits.extractSkillCount ?? 0) + 1;
  } else if (limitType === 'generateProse') {
    limits.generateProseMax = limits.generateProseMax ?? DEFAULT_QUOTA_MAX.generateProse;
    limits.generateProseCount = (limits.generateProseCount ?? 0) + 1;
  } else if (limitType === 'advancedAudit') {
    limits.advancedAuditMax = limits.advancedAuditMax ?? DEFAULT_QUOTA_MAX.advancedAudit;
    limits.advancedAuditCount = (limits.advancedAuditCount ?? 0) + 1;
  }

  profile.quotaLimits = limits;
  profile.commercialMode = 'free'; // 显式标识，确保落库模式锁定为免费版

  // 回写数据库 (Zero Migration serialization)
  updateNovel(novelId, { projectPreferenceProfile: profile });
}

/**
 * 获取友好的额度超限中文文案
 * Utility helper translating quota limit type to elegant customer-facing warnings
 */
function getQuotaErrorMessage(
  limitType: 'extractSkill' | 'generateProse' | 'advancedAudit',
  max: number
): string {
  switch (limitType) {
    case 'extractSkill':
      return `您的免费【拆书萃取】额度（${max} 次）已全部用尽。立即升舱 Premium 尊享无限次深度拆书体验！`;
    case 'generateProse':
      return `您的免费【正文生成】额度（${max} 次）已全部用尽。立即升舱 Premium 开启无限畅意写作！`;
    case 'advancedAudit':
      return `您的免费【智能审稿与高级诊断】额度（${max} 次）已全部用尽。立即升舱 Premium 全量解禁总编内审质量护栏！`;
    default:
      return '您的免费 AI 功能调用额度已用尽。请立即升级 Premium 会员以解锁无限权限。';
  }
}
