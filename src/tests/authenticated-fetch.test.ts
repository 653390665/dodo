import { describe, expect, test, vi } from 'vitest';
import { createAuthenticatedFetch } from '../lib/authenticated-fetch';

const location = {
  href: 'http://127.0.0.1:3210/editor',
  origin: 'http://127.0.0.1:3210',
} as Location;

describe('authenticated fetch origin boundary', () => {
  test('never injects the local bearer token into a cross-origin /api URL', async () => {
    const originalFetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const getAuthToken = vi.fn(async () => 'local-secret');
    const authenticatedFetch = createAuthenticatedFetch({
      originalFetch,
      getAuthToken,
      isDev: false,
      location,
    });

    await authenticatedFetch('https://attacker.example/api/collect');

    expect(getAuthToken).not.toHaveBeenCalled();
    expect(originalFetch).toHaveBeenCalledWith('https://attacker.example/api/collect', undefined);
  });

  test('merges Request and init headers before adding auth for same-origin API calls', async () => {
    const originalFetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('{}'));
    const originalFetch = originalFetchMock as unknown as typeof fetch;
    const authenticatedFetch = createAuthenticatedFetch({
      originalFetch,
      getAuthToken: async () => 'local-secret',
      isDev: false,
      location,
    });
    const request = new Request('http://127.0.0.1:3210/api/db', {
      headers: { 'x-request-header': 'request-value' },
    });

    await authenticatedFetch(request, { headers: { 'x-init-header': 'init-value' } });

    const passedInit = originalFetchMock.mock.calls[0][1];
    const headers = new Headers(passedInit?.headers);
    expect(headers.get('x-request-header')).toBe('request-value');
    expect(headers.get('x-init-header')).toBe('init-value');
    expect(headers.get('authorization')).toBe('Bearer local-secret');
  });
});
