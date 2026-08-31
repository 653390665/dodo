// Shared JSON parsing for stored/LLM-produced payloads. Returns a result
// instead of throwing so each caller maps failures to its own error contract.

export type ParseStoredJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'EMPTY' | 'INVALID' | 'NOT_OBJECT' };

export function parseStoredJson(
  raw: string,
  options?: { stripFences?: boolean; requireObject?: boolean },
): ParseStoredJsonResult {
  const text = options?.stripFences
    ? raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    : raw;
  if (!text) return { ok: false, code: 'EMPTY' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: 'INVALID' };
  }
  if (options?.requireObject && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
    return { ok: false, code: 'NOT_OBJECT' };
  }
  return { ok: true, value: parsed };
}