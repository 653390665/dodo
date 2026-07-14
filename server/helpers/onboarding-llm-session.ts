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
const OPERATION_LIMITS: Record<OnboardingLlmOperation, number> = {
  'story-cards': 6,
  inspiration: 12,
};

let activeWindow: OnboardingWindow | null = null;
const oneTimeGrants = new Map<string, OneTimeGrant>();

export function issueOnboardingLlmSession(
  operation: OnboardingLlmOperation,
  now = Date.now(),
): { allowed: true; sessionId: string; expiresAt: number } | { allowed: false; status: 429; error: string } {
  if (!activeWindow || activeWindow.expiresAt <= now) {
    activeWindow = { expiresAt: now + SESSION_TTL_MS, remainingGrants: { ...OPERATION_LIMITS } };
    oneTimeGrants.clear();
  }
  if (activeWindow.remainingGrants[operation] <= 0) {
    return { allowed: false, status: 429, error: 'Onboarding model session limit reached' };
  }

  activeWindow.remainingGrants[operation] -= 1;
  const sessionId = `onboarding_${randomUUID()}`;
  oneTimeGrants.set(sessionId, { operation, expiresAt: activeWindow.expiresAt });
  return { allowed: true, sessionId, expiresAt: activeWindow.expiresAt };
}

export function consumeOnboardingLlmSession(
  sessionId: unknown,
  operation: OnboardingLlmOperation,
  now = Date.now(),
): { allowed: true } | { allowed: false; status: 400; error: string } {
  if (typeof sessionId !== 'string' || !sessionId) {
    return { allowed: false, status: 400, error: 'Onboarding model session is invalid or expired' };
  }
  const grant = oneTimeGrants.get(sessionId);
  oneTimeGrants.delete(sessionId);
  if (!grant || grant.expiresAt <= now || grant.operation !== operation) {
    return { allowed: false, status: 400, error: 'Onboarding model session is invalid, expired, or already used' };
  }
  return { allowed: true };
}

export const __onboardingLlmSessionTestHooks = {
  reset(): void {
    activeWindow = null;
    oneTimeGrants.clear();
  },
};
