function normalizeQuotes(raw: string): string {
  return raw
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/＂/g, '"');
}

function stripCodeFences(raw: string): string {
  return normalizeQuotes(raw)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

export type ModelJsonDiagnostic = {
  parserStage?: 'no_candidate' | 'strict_parse' | 'quote_repair';
  candidateRoot?: 'object' | 'array' | 'none';
  candidateStart?: number;
  candidateLength?: number;
  balanced?: boolean;
  parseOffset?: number;
};

export class ModelJsonTruncatedError extends Error {
  readonly diagnostic?: ModelJsonDiagnostic;

  constructor(diagnostic?: ModelJsonDiagnostic) {
    super('模型返回了不完整的 JSON。');
    this.name = 'ModelJsonTruncatedError';
    this.diagnostic = diagnostic;
  }
}

export class ModelJsonSyntaxError extends Error {
  readonly diagnostic?: ModelJsonDiagnostic;

  constructor(diagnostic?: ModelJsonDiagnostic) {
    super('模型返回的内容不是有效 JSON。');
    this.name = 'ModelJsonSyntaxError';
    this.diagnostic = diagnostic;
  }
}

function findJsonCandidateInfo(raw: string): { candidate: string; cleaned: string; start: number; balanced: boolean; root: 'object' | 'array' } | null {
  const cleaned = stripCodeFences(raw);
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  const start =
    firstBrace === -1
      ? firstBracket
      : firstBracket === -1
        ? firstBrace
        : Math.min(firstBrace, firstBracket);

  if (start === -1) {
    return null;
  }

  const jsonStart = cleaned[start];
  const jsonEnd = jsonStart === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === jsonStart) {
      depth += 1;
      continue;
    }

    if (char === jsonEnd) {
      depth -= 1;
      if (depth === 0) {
        return { candidate: cleaned.slice(start, index + 1), cleaned, start, balanced: true, root: jsonStart === '{' ? 'object' : 'array' };
      }
    }
  }

  return { candidate: cleaned.slice(start), cleaned, start, balanced: false, root: jsonStart === '{' ? 'object' : 'array' };
}

function findJsonCandidate(raw: string): string {
  const info = findJsonCandidateInfo(raw);
  if (!info) throw new Error('模型未返回可解析的 JSON。');
  return info.candidate;
}

function parseOffset(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : '';
  const match = message.match(/position\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function repairUnescapedQuotesInJson(raw: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];

    if (!inString) {
      result += char;
      if (char === '"') {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j += 1;
      const next = raw[j];
      const isStringBoundary = next === ':' || next === ',' || next === '}' || next === ']';

      if (isStringBoundary) {
        result += char;
        inString = false;
      } else {
        result += '\\"';
      }
      continue;
    }

    result += char;
  }

  return result;
}

function closeJsonStructures(raw: string): string {
  let result = '';
  const closingStack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    result += char;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      closingStack.push('}');
    } else if (char === '[') {
      closingStack.push(']');
    } else if ((char === '}' || char === ']') && closingStack[closingStack.length - 1] === char) {
      closingStack.pop();
    }
  }

  let normalized = result.trimEnd().replace(/[,:]\s*$/g, '');
  if (inString) {
    normalized += '"';
  }
  return normalized + closingStack.reverse().join('');
}

function tryParseTruncatedJson<T = unknown>(raw: string): T {
  const trimmed = raw.trimEnd();
  const minLength = Math.max(0, trimmed.length - 400);

  for (let end = trimmed.length; end >= minLength; end -= 1) {
    const candidate = trimmed.slice(0, end).trimEnd();
    if (!candidate) continue;
    try {
      return JSON.parse(closeJsonStructures(candidate)) as T;
    } catch {
      // Keep trimming backward until we land on a parsable boundary.
    }
  }

  throw new Error('模型返回了不完整的 JSON。');
}

export function parseModelJsonPayload<T = unknown>(raw: string): T {
  const candidate = findJsonCandidate(raw);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const repairedQuotes = repairUnescapedQuotesInJson(candidate);
    try {
      return JSON.parse(repairedQuotes) as T;
    } catch {
      return tryParseTruncatedJson<T>(repairedQuotes);
    }
  }
}

/** Strict parser for payloads where closeJsonStructures would create unsafe data. */
export function parseModelJsonPayloadStrict<T = unknown>(raw: string, options: { expectedRoot?: 'object' | 'array' } = {}): T {
  const cleaned = stripCodeFences(raw);
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (typeof parsed === 'string' && /^(?:\{|\[)/.test(parsed.trim())) {
      return JSON.parse(parsed) as T;
    }
    return parsed as T;
  } catch (fullError) {
    const info = findJsonCandidateInfo(raw);
    if (!info) {
      throw new ModelJsonSyntaxError({ parserStage: 'no_candidate', candidateRoot: 'none', balanced: false, parseOffset: parseOffset(fullError) });
    }
    const baseDiagnostic: ModelJsonDiagnostic = {
      parserStage: 'strict_parse',
      candidateRoot: info.root,
      candidateStart: info.start,
      candidateLength: info.candidate.length,
      balanced: info.balanced,
      parseOffset: parseOffset(fullError),
    };
    if (!info.balanced) throw new ModelJsonTruncatedError(baseDiagnostic);
    if (options.expectedRoot && info.root !== options.expectedRoot) {
      throw new ModelJsonSyntaxError(baseDiagnostic);
    }
    try {
      return JSON.parse(info.candidate) as T;
    } catch (candidateError) {
      try {
        return JSON.parse(repairUnescapedQuotesInJson(info.candidate)) as T;
      } catch {
        throw new ModelJsonSyntaxError({ ...baseDiagnostic, parserStage: 'quote_repair', parseOffset: parseOffset(candidateError) });
      }
    }
  }
}
