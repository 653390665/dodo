import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Global request timeout safety net. Long synchronous LLM routes opt out via
// LONG_REQUEST_TIMEOUT_ROUTES and get the listed ceiling instead.
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export const LONG_REQUEST_TIMEOUT_ROUTES = new Map<string, number>([
  // POST /api/continuation-packs/parse: LlmExecution self-caps at 180s (continuation.ts).
  ['POST /api/continuation-packs/parse', 200_000],
]);

export function createRequestTimeoutMiddleware(
  routeTimeouts: ReadonlyMap<string, number> = LONG_REQUEST_TIMEOUT_ROUTES,
  defaultTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeoutMs = routeTimeouts.get(`${req.method} ${req.path}`) ?? defaultTimeoutMs;
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timed out — server took too long to respond' });
        console.warn(`[RequestTimeout] exceeded ${timeoutMs}ms: ${req.method} ${req.path}`);
      }
    }, timeoutMs);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  };
}
