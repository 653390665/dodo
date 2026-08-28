import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response, NextFunction } from 'express';

const TOKEN_PATH = path.join(os.homedir(), '.inkflow', '.auth-token');
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const SSE_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_SSE_TOKENS = 64;
const sseTokens = new Map<string, number>();

function isValidToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

function getOrCreateToken(): string {
  try {
    const dir = path.dirname(TOKEN_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TOKEN_PATH)) {
      const existing = fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
      if (isValidToken(existing)) {
        // Repair permissions on legacy files without changing a valid token.
        fs.chmodSync(TOKEN_PATH, 0o600);
        return existing;
      }
    }
    const token = crypto.randomBytes(32).toString('hex');
    const tempPath = `${TOKEN_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, token, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, TOKEN_PATH);
    return token;
  } catch {
    try { fs.unlinkSync(`${TOKEN_PATH}.${process.pid}.tmp`); } catch { /* best effort */ }
    // Fallback: generate per-session token (not persisted)
    return crypto.randomBytes(32).toString('hex');
  }
}

const AUTH_TOKEN = getOrCreateToken();

// Auth token is stored at ~/.inkflow/.auth-token (0600 permissions).
// Do NOT log the token — it would leak to startup logs in production.

// Server identity token: lets the Electron main process verify that the process
// answering on the port is the real InkFlow server, not an unrelated squatter
// that bound the port after a crash. Written only when orchestrated by Electron
// (INKFLOW_ELECTRON_MODE) so plain dev/test runs never touch the file.
const IDENTITY_TOKEN_PATH = path.join(os.homedir(), '.inkflow', '.server-identity');
const IDENTITY_TOKEN_PATTERN = TOKEN_PATTERN;

function persistIdentityToken(token: string): void {
  const dir = path.dirname(IDENTITY_TOKEN_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${IDENTITY_TOKEN_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, token, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(tempPath, 0o600);
  fs.renameSync(tempPath, IDENTITY_TOKEN_PATH);
}

function getOrCreateIdentityToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  if (process.env.INKFLOW_ELECTRON_MODE !== 'true') return token;
  try {
    persistIdentityToken(token);
  } catch {
    try { fs.unlinkSync(`${IDENTITY_TOKEN_PATH}.${process.pid}.tmp`); } catch { /* best effort */ }
  }
  return token;
}

const IDENTITY_TOKEN = getOrCreateIdentityToken();

export function isIdentityTokenValid(candidate: unknown): boolean {
  if (typeof candidate !== 'string' || !IDENTITY_TOKEN_PATTERN.test(candidate)) return false;
  return candidate.length === IDENTITY_TOKEN.length
    && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(IDENTITY_TOKEN));
}

function pruneSseTokens(now = Date.now()): void {
  for (const [token, expiresAt] of sseTokens) {
    if (expiresAt <= now) sseTokens.delete(token);
  }
}

export function issueDbEventToken(): { token: string; expiresAt: number } {
  const now = Date.now();
  pruneSseTokens(now);
  while (sseTokens.size >= MAX_ACTIVE_SSE_TOKENS) {
    const oldestToken = sseTokens.keys().next().value as string | undefined;
    if (!oldestToken) break;
    sseTokens.delete(oldestToken);
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = now + SSE_TOKEN_TTL_MS;
  sseTokens.set(token, expiresAt);
  return { token, expiresAt };
}

function isValidDbEventToken(candidate: unknown): boolean {
  if (typeof candidate !== 'string' || !isValidToken(candidate)) return false;
  const now = Date.now();
  pruneSseTokens(now);
  for (const [token, expiresAt] of sseTokens) {
    if (
      expiresAt > now
      && candidate.length === token.length
      && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(token))
    ) {
      return true;
    }
  }
  return false;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Native EventSource cannot set Authorization headers. It uses a short-lived,
  // process-local credential minted through the authenticated token endpoint.
  const eventToken = req.query?.token;
  if ((req.path === '/db/events' || req.path === '/api/db/events') && isValidDbEventToken(eventToken)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.slice(7);
  if (!isValidToken(token) || token.length !== AUTH_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(AUTH_TOKEN))) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  next();
}

export function getAuthToken(): string {
  return AUTH_TOKEN;
}
