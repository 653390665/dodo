import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __onboardingLlmSessionTestHooks,
  consumeOnboardingLlmSession,
  issueOnboardingLlmSession,
} from '../server/helpers/onboarding-llm-session';

test('onboarding LLM grants are server-issued, one-time, expiring, and operation-bounded', () => {
  __onboardingLlmSessionTestHooks.reset();
  const first = issueOnboardingLlmSession('story-cards', 1_000);
  assert.equal(first.allowed, true);
  if (!first.allowed) return;
  assert.deepEqual(consumeOnboardingLlmSession('forged', 'story-cards', 2_000), {
    allowed: false,
    status: 400,
    error: '新手引导模型会话无效、已过期或已使用，请重试。',
  });
  assert.deepEqual(consumeOnboardingLlmSession(first.sessionId, 'inspiration', 2_000), {
    allowed: false,
    status: 400,
    error: '新手引导模型会话无效、已过期或已使用，请重试。',
  });
  assert.deepEqual(consumeOnboardingLlmSession(first.sessionId, 'story-cards', 2_000), {
    allowed: false,
    status: 400,
    error: '新手引导模型会话无效、已过期或已使用，请重试。',
  });
  assert.deepEqual(consumeOnboardingLlmSession('', 'story-cards', 2_000), {
    allowed: false,
    status: 400,
    error: '新手引导模型会话无效或已过期，请重试。',
  });

  for (let index = 1; index < 6; index += 1) {
    const grant = issueOnboardingLlmSession('story-cards', 2_000);
    assert.equal(grant.allowed, true);
    if (grant.allowed) assert.equal(consumeOnboardingLlmSession(grant.sessionId, 'story-cards', 2_000).allowed, true);
  }
  const exhausted = issueOnboardingLlmSession('story-cards', 2_000);
  assert.deepEqual(exhausted, {
    allowed: false,
    status: 429,
    error: '新手引导模型次数已用完，请稍后再试。',
  });
  const expired = issueOnboardingLlmSession('inspiration', 2_000);
  assert.equal(expired.allowed, true);
  if (expired.allowed) {
    assert.equal(consumeOnboardingLlmSession(expired.sessionId, 'inspiration', expired.expiresAt).allowed, false);
    const renewed = issueOnboardingLlmSession('inspiration', expired.expiresAt);
    assert.equal(renewed.allowed, true);
    if (renewed.allowed) assert.notEqual(renewed.sessionId, expired.sessionId);
  }
});
