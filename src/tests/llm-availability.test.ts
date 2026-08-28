import { describe, expect, test } from 'vitest';
import { deriveLlmAvailability, LLM_AVAILABILITY_COPY } from '../lib/llm-availability';

describe('LLM availability', () => {
  test('maps key and liveness states to the shared model', () => {
    expect(deriveLlmAvailability({ hasApiKey: true })).toBe('connected');
    expect(deriveLlmAvailability({ hasApiKey: false })).toBe('missing');
    expect(deriveLlmAvailability({ hasApiKey: true, livenessStatus: 'disconnected' })).toBe('missing');
    expect(deriveLlmAvailability({ hasApiKey: false, livenessStatus: 'unknown' })).toBe('unknown');
    expect(deriveLlmAvailability({ hasApiKey: true, livenessStatus: 'unknown' })).toBe('unknown');
  });

  test('exposes user-facing labels without technical state names', () => {
    expect(Object.values(LLM_AVAILABILITY_COPY).map((copy) => copy.label)).toEqual(['已连接', '未配置', '暂时无法确认']);
    expect(JSON.stringify(LLM_AVAILABILITY_COPY)).not.toMatch(/LOCAL_RESERVED|STATE_UNKNOWN/);
  });
});
