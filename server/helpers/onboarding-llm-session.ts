import { randomUUID } from 'node:crypto';

export type OnboardingLlmOperation = 'story-cards' | 'inspiration';

interface OnboardingWindow {
  expiresAt: number;
  remainingGrants: Record<OnboardingLlmOperation, number>;
}

interface OneTimeGrant {
  operation: OnboardingLlmOperation;
  expiresAt: number;
}

const SESSION_TTL_MS = 15 * 60_000;

// E2E 全套共享一个 webServer 进程：该配额窗是模块级全局态，向导类用例超过
// 6 个即触发跨用例 429（立项方案不渲染）。playwright.config 以该乘数放宽；
// 生产缺省 1，行为不变。
const GRANT_SCALE = Math.max(1, Number(process.env.INKFLOW_ONBOARDING_GRANT_SCALE) || 1);

const OPERATION_LIMITS: Record<OnboardingLlmOperation, number> = {
  'story-cards': 6 * GRANT_SCALE,
  inspiration: 12 * GRANT_SCALE,
};

let activeWindow: OnboardingWindow | null = null;
const oneTimeGrants = new Map<string, OneTimeGrant>();

export function issueOnboardingLlmSession(
  operation: OnboardingLlmOperation,
  now = Date.now()
):
  | { allowed: true; sessionId: string; expiresAt: number }
  | { allowed: false; status: 429; error: string } {
  if (!activeWindow || activeWindow.expiresAt <= now) {
    activeWindow = { expiresAt: now + SESSION_TTL_MS, remainingGrants: { ...OPERATION_LIMITS } };
    oneTimeGrants.clear();
  }
  if (activeWindow.remainingGrants[operation] <= 0) {
    return { allowed: false, status: 429, error: '新手引导模型次数已用完，请稍后再试。' };
  }

  activeWindow.remainingGrants[operation] -= 1;
  const sessionId = `onboarding_${randomUUID()}`;
  oneTimeGrants.set(sessionId, { operation, expiresAt: activeWindow.expiresAt });
  return { allowed: true, sessionId, expiresAt: activeWindow.expiresAt };
}

export function consumeOnboardingLlmSession(
  sessionId: unknown,
  operation: OnboardingLlmOperation,
  now = Date.now()
): { allowed: true } | { allowed: false; status: 400; error: string } {
  if (typeof sessionId !== 'string' || !sessionId) {
    return { allowed: false, status: 400, error: '新手引导模型会话无效或已过期，请重试。' };
  }
  const grant = oneTimeGrants.get(sessionId);
  oneTimeGrants.delete(sessionId);
  if (!grant || grant.expiresAt <= now || grant.operation !== operation) {
    return { allowed: false, status: 400, error: '新手引导模型会话无效、已过期或已使用，请重试。' };
  }
  return { allowed: true };
}

export const __onboardingLlmSessionTestHooks = {
  reset(): void {
    activeWindow = null;
    oneTimeGrants.clear();
  },
};
