import type { Skill, QuotaLimits, ProjectPreferenceProfile } from '../../shared/types';
import { randomUUID } from 'node:crypto';
import { getNovel, updateNovel } from '../lib/db/novels.js';
import { getDatabaseGeneration, runInSerializedWrite } from '../lib/db-instance.js';

/**
 * 默认免费额度上限配置
 * Default free-tier quota configuration
 */
export const DEFAULT_QUOTA_MAX = {
  extractSkill: 5,     // 免费拆书萃取次数上限
  generateProse: 10,   // 免费正文生成次数上限
  advancedAudit: 5,    // 免费智能审稿与高级诊断次数上限
};

export type QuotaLimitType = 'extractSkill' | 'generateProse' | 'advancedAudit';

/**
 * 配额检查返回结果接口
 * Response structure for quota validation checks
 */
export interface QuotaCheckResult {
  allowed: boolean;
  limitType?: QuotaLimitType;
  count?: number;
  max?: number;
  error?: string;
  reservationId?: string;
}

type ReservationStatus = 'active' | 'committed' | 'refunded';

interface QuotaReservation {
  id: string;
  novelId: string;
  limitType: QuotaLimitType;
  status: ReservationStatus;
  createdAt: number;
  databaseGeneration: number;
}

const quotaReservations = new Map<string, QuotaReservation>();
const RESERVATION_TTL_MS = 60 * 60 * 1000;

function pruneReservations(): void {
  const cutoff = Date.now() - RESERVATION_TTL_MS;
  for (const [id, reservation] of quotaReservations.entries()) {
    if (reservation.createdAt < cutoff) {
      quotaReservations.delete(id);
    }
  }
}

function createReservationId(): string {
  return `qres_${randomUUID()}`;
}

/**
 * 配额卡控与看门狗服务 (Quota Guard Service)
 * Fully encapsulates commercial boundary rules and limits verification
 */

export function isPaidSkill(skill: Skill): boolean {
  if (skill.accessTier === 'paid') return true;
  if (skill.accessTier === 'free') return false;
  if (skill.sourceType === 'licensed') return true;
  return false;
}

export function checkQuota(
  novelId: string | undefined,
  limitType: QuotaLimitType,
): QuotaCheckResult {
  if (!novelId) {
    return { allowed: true };
  }

  const novel = getNovel(novelId);
  if (!novel) {
    return { allowed: true };
  }

  const profile = (novel.projectPreferenceProfile || {}) as ProjectPreferenceProfile;
  const commercialMode = profile.commercialMode || 'free';

  if (commercialMode === 'paid' || commercialMode === 'strict') {
    return { allowed: true };
  }

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

export function consumeQuota(
  novelId: string | undefined,
  limitType: QuotaLimitType,
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
    ...(novel.projectPreferenceProfile || {}),
  };
  const commercialMode = profile.commercialMode || 'free';

  if (commercialMode === 'paid' || commercialMode === 'strict') {
    return;
  }

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
  profile.commercialMode = 'free';

  updateNovel(novelId, { projectPreferenceProfile: profile });
}

export async function checkAndConsumeQuota(
  novelId: string | undefined,
  limitType: QuotaLimitType,
): Promise<QuotaCheckResult> {
  if (!novelId) {
    return { allowed: true };
  }

  return runInSerializedWrite<QuotaCheckResult>(() => {
    const novel = getNovel(novelId);
    if (!novel) {
      return { allowed: true };
    }

    const profile: ProjectPreferenceProfile = {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      ...(novel.projectPreferenceProfile || {}),
    };
    const commercialMode = profile.commercialMode || 'free';

    if (commercialMode === 'paid' || commercialMode === 'strict') {
      return { allowed: true };
    }

    const limits: QuotaLimits = { ...(profile.quotaLimits || {}) };

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
    profile.commercialMode = 'free';

    updateNovel(novelId, { projectPreferenceProfile: profile });

    return {
      allowed: true,
      limitType,
      count: count + 1,
      max,
    };
  });
}

function getQuotaErrorMessage(limitType: QuotaLimitType, max: number): string {
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

function decrementQuotaCounter(novelId: string, limitType: QuotaLimitType): void {
  const novel = getNovel(novelId);
  if (!novel) return;

  const profile: ProjectPreferenceProfile = {
    tags: [],
    weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    ...(novel.projectPreferenceProfile || {}),
  };
  const commercialMode = profile.commercialMode || 'free';
  if (commercialMode === 'paid' || commercialMode === 'strict') return;

  const limits: QuotaLimits = { ...(profile.quotaLimits || {}) };

  if (limitType === 'extractSkill') {
    limits.extractSkillMax = limits.extractSkillMax ?? DEFAULT_QUOTA_MAX.extractSkill;
    limits.extractSkillCount = Math.max(0, (limits.extractSkillCount ?? 0) - 1);
  } else if (limitType === 'generateProse') {
    limits.generateProseMax = limits.generateProseMax ?? DEFAULT_QUOTA_MAX.generateProse;
    limits.generateProseCount = Math.max(0, (limits.generateProseCount ?? 0) - 1);
  } else if (limitType === 'advancedAudit') {
    limits.advancedAuditMax = limits.advancedAuditMax ?? DEFAULT_QUOTA_MAX.advancedAudit;
    limits.advancedAuditCount = Math.max(0, (limits.advancedAuditCount ?? 0) - 1);
  }

  profile.quotaLimits = limits;
  profile.commercialMode = 'free';
  updateNovel(novelId, { projectPreferenceProfile: profile });
}

/**
 * Atomically pre-allocate one quota credit before any LLM work begins.
 * Returns a unique reservationId when a free-tier credit was consumed.
 */
export async function reserveQuota(
  novelId: string | undefined,
  limitType: QuotaLimitType,
): Promise<QuotaCheckResult> {
  pruneReservations();
  const databaseGeneration = getDatabaseGeneration();
  const result = await checkAndConsumeQuota(novelId, limitType);
  if (!result.allowed || !novelId || result.reservationId) {
    return result;
  }

  // Paid/unlimited paths do not consume counters — no reservation ledger entry needed.
  if (result.count === undefined) {
    return result;
  }

  // The consumed counter belonged to a database that has since been replaced.
  // Do not create a reservation capable of mutating the newly imported file.
  if (databaseGeneration !== getDatabaseGeneration()) {
    return { allowed: false, error: '数据库已切换，请重试当前操作' };
  }

  const reservationId = createReservationId();
  quotaReservations.set(reservationId, {
    id: reservationId,
    novelId,
    limitType,
    status: 'active',
    createdAt: Date.now(),
    databaseGeneration,
  });

  return { ...result, reservationId };
}

/**
 * Return one pre-allocated quota credit on failure.
 * Idempotent: repeated calls for the same reservationId refund at most once.
 */
export async function refundQuota(reservationId: string | undefined): Promise<boolean> {
  if (!reservationId) return false;

  return runInSerializedWrite(() => {
    const reservation = quotaReservations.get(reservationId);
    if (!reservation || reservation.status !== 'active') {
      return false;
    }

    if (reservation.databaseGeneration !== getDatabaseGeneration()) {
      reservation.status = 'refunded';
      return false;
    }

    decrementQuotaCounter(reservation.novelId, reservation.limitType);
    reservation.status = 'refunded';
    return true;
  });
}

/** Mark a reservation as successfully delivered — credit stays consumed. */
export function commitQuotaReservation(reservationId: string | undefined): boolean {
  if (!reservationId) return false;
  const reservation = quotaReservations.get(reservationId);
  if (reservation && reservation.status === 'active') {
    if (reservation.databaseGeneration !== getDatabaseGeneration()) {
      reservation.status = 'refunded';
      return false;
    }
    reservation.status = 'committed';
    return true;
  }
  return false;
}

/**
 * Finish a reserved request according to whether user-visible content was
 * delivered. Delivered fallback text is billable even when later critic work
 * fails; requests that delivered nothing remain refundable and retryable.
 */
export async function settleQuotaReservation(
  reservationId: string | undefined,
  contentDelivered: boolean,
): Promise<boolean> {
  if (contentDelivered) {
    return commitQuotaReservation(reservationId);
  }
  return refundQuota(reservationId);
}

/** @internal Test-only access to reservation ledger. */
export const __quotaTestHooks = {
  quotaReservations,
  pruneReservations,
};
