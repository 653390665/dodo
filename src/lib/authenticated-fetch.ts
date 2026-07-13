interface AuthenticatedFetchOptions {
  originalFetch: typeof window.fetch;
  getAuthToken?: () => Promise<string | undefined> | string | undefined;
  isDev: boolean;
  location: Pick<Location, 'href' | 'origin'>;
}

export function createAuthenticatedFetch({
  originalFetch,
  getAuthToken,
  isDev,
  location,
}: AuthenticatedFetchOptions): typeof window.fetch {
  let cachedDevToken: string | undefined;

  return async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const target = new URL(rawUrl, location.href);
    const isProtectedApi =
      target.origin === location.origin
      && target.pathname.startsWith('/api/')
      && target.pathname !== '/api/db/events'
      && target.pathname !== '/api/dev-auth-token';

    if (!isProtectedApi) return originalFetch(input, init);

    let token = await getAuthToken?.();
    if (!token && isDev) {
      if (!cachedDevToken) {
        try {
          const response = await originalFetch('/api/dev-auth-token');
          if (response.ok) {
            const data = await response.json() as { token?: string };
            cachedDevToken = data.token;
          }
        } catch (error) {
          console.warn('Failed to bootstrap dev auth token:', error);
        }
      }
      token = cachedDevToken;
    }

    if (!token) return originalFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('Authorization', `Bearer ${token}`);
    return originalFetch(input, { ...init, headers });
  };
}
