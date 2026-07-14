import type { AppConfig } from '../lib/config';

export type ModelDiscoveryResult = {
  models: string[];
  discovery: 'available' | 'unsupported';
};

const MAX_MODELS = 500;
const MAX_MODEL_LENGTH = 500;

/** True when the baseUrl points at Google's official Generative Language API. */
function isGoogleProvider(baseUrl: string): boolean {
  return !baseUrl || baseUrl.includes('generativelanguage.googleapis.com');
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * Trim, de-duplicate, sort, and cap the model list.
 * Never throws — invalid entries are silently dropped.
 */
export function normalizeModels(raw: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_MODEL_LENGTH) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  cleaned.sort((a, b) => a.localeCompare(b));
  return cleaned.slice(0, MAX_MODELS);
}

/**
 * Discover available models from the provider.
 *
 * - Google: uses `@google/genai` SDK `models.list()`, filters to text-generation models.
 * - OpenAI-compatible: `GET {baseUrl}/models` with Bearer auth.
 *
 * Returns `{ discovery: 'unsupported' }` for 404/405/501 or when the endpoint
 * does not look like a model list.  Auth failures (401/403) are re-thrown so
 * the caller can surface them as credential errors.
 */
export async function discoverModels(
  config: AppConfig,
  signal: AbortSignal,
): Promise<ModelDiscoveryResult> {
  if (isGoogleProvider(config.baseUrl)) {
    return discoverGoogleModels(config, signal);
  }
  return discoverOpenAIModels(config, signal);
}

async function discoverGoogleModels(
  config: AppConfig,
  signal: AbortSignal,
): Promise<ModelDiscoveryResult> {
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: config.apiKey });

  // The SDK list() method accepts a ListModelsParameters object.
  const page = await ai.models.list({ config: { httpOptions: { abortSignal: signal } } });

  const raw: string[] = [];
  for (const model of page) {
    // Only keep models that support text generation.
    const supported = model.supportedGenerationMethods;
    if (!supported || supported.includes('generateContent')) {
      // The SDK returns full resource names like "models/gemini-2.5-pro";
      // strip the "models/" prefix for display.
      const id = (model.name || '').replace(/^models\//, '');
      if (id) raw.push(id);
    }
  }

  return { models: normalizeModels(raw), discovery: 'available' };
}

async function discoverOpenAIModels(
  config: AppConfig,
  signal: AbortSignal,
): Promise<ModelDiscoveryResult> {
  let response: Response;
  try {
    response = await fetch(joinUrl(config.baseUrl, '/models'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal,
    });
  } catch {
    // Network error — treat as unsupported so caller can fall back.
    return { models: [], discovery: 'unsupported' };
  }

  // 404/405/501 — the provider does not implement model discovery.
  if (response.status === 404 || response.status === 405 || response.status === 501) {
    return { models: [], discovery: 'unsupported' };
  }

  // 401/403 — credential failure; re-throw so the caller can distinguish.
  if (response.status === 401 || response.status === 403) {
    const error = new Error(`Model discovery returned ${response.status}`);
    (error as Error & { status: number }).status = response.status;
    throw error;
  }

  if (!response.ok) {
    // Other HTTP errors — degrade gracefully.
    return { models: [], discovery: 'unsupported' };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { models: [], discovery: 'unsupported' };
  }

  const rawData = data as Record<string, unknown>;
  const list = Array.isArray(rawData?.data) ? rawData.data : Array.isArray(rawData) ? rawData : [];

  const raw: string[] = [];
  for (const item of list) {
    const rec = item as Record<string, unknown>;
    if (typeof rec?.id === 'string') {
      raw.push(rec.id);
    }
  }

  if (raw.length === 0) {
    return { models: [], discovery: 'unsupported' };
  }

  return { models: normalizeModels(raw), discovery: 'available' };
}