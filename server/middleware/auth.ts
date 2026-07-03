import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response, NextFunction } from 'express';

const TOKEN_PATH = path.join(os.homedir(), '.inkflow', '.auth-token');

function getOrCreateToken(): string {
  try {
    const dir = path.dirname(TOKEN_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TOKEN_PATH)) return fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
    return token;
  } catch {
    // Fallback: generate per-session token (not persisted)
    return crypto.randomBytes(32).toString('hex');
  }
}

const AUTH_TOKEN = getOrCreateToken();

// Auth token is stored at ~/.inkflow/.auth-token (0600 permissions).
// Do NOT log the token — it would leak to startup logs in production.

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // SSE endpoint is read-only and only sends {} notifications — exempt from auth
  // In Express, when mounted under /api, req.path is relative to the router (e.g. /db/events)
  if (req.path === '/db/events') {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.slice(7);
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  next();
}

export function getAuthToken(): string {
  return AUTH_TOKEN;
}