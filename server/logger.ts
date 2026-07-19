/**
 * Server-side logger with user-content redaction.
 * Prevents chapter text, character bios, uploaded docs etc. from appearing
 * in stdout/stderr logs (which may be captured by Electron or persisted).
 */

const REDACT_FIELDS = new Set([
  'content', 'bio', 'summary', 'text', 'description', 'traits',
  'draftContent', 'sceneBeats', 'chapterContent', 'documentText',
  'globalOutline', 'worldRules', 'context', 'contextStr',
]);

function sanitize(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    if (obj.length > 200) return `[redacted ${obj.length} chars]`;
    return obj;
  }
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_FIELDS.has(key)) {
      out[key] = `[redacted]`;
    } else {
      out[key] = sanitize(value);
    }
  }
  return out;
}

export const logger = {
  error: (context: string, err?: unknown) => {
    const safe = err instanceof Error
      ? err.stack || `${err.name}: ${err.message}`
      : sanitize(err);
    console.error(`[ERROR] ${context}`, safe);
  },
  warn: (context: string, detail?: unknown) => {
    console.warn(`[WARN] ${context}`, sanitize(detail));
  },
  info: (context: string, detail?: unknown) => {
    console.log(`[INFO] ${context}`, sanitize(detail));
  },
};
