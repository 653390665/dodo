import type { AppConfig } from "./config";
import { setLivenessStatus } from "./config";
import { randomUUID } from 'node:crypto';
import { applyInputGuard, checkOutputGuard, buildCorrectionPrompt, isCreativeWritingRequest } from '../helpers/prompt-guard';
import { getDb } from "./db-instance.js";

export type OutputDiagnostic = {
  provider: 'deepseek' | 'minimax' | 'google' | 'openai-compatible';
  responseFormatMode: 'json_object' | 'plain_fallback' | 'none';
  thinkingMode: 'disabled' | 'provider_default';
  finishReason?: string;
  contentLength: number;
  sanitizedLength: number;
  reasoningContentPresent: boolean;
  thinkTagState: 'none' | 'closed_removed' | 'unclosed';
  parserStage?: 'no_candidate' | 'strict_parse' | 'quote_repair';
  candidateRoot?: 'object' | 'array' | 'none';
  candidateStart?: number;
  candidateLength?: number;
  balanced?: boolean;
  parseOffset?: number;
  providerHttpStatus?: number;
  rejectedParameter?: 'response_format' | 'thinking' | 'unknown';
  providerErrorCode?: string;
  compatibilityMode: 'none' | 'omit_thinking' | 'plain_fallback';
  providerRequestCount: number;
};

type RejectedParameter = NonNullable<OutputDiagnostic['rejectedParameter']>;
type CompatibilityMode = OutputDiagnostic['compatibilityMode'];

export interface GenerateTextOptions {
  prompt: string;
  /** Selects the output contract. Structured audit responses bypass prose-only guards. */
  outputMode?: 'prose' | 'audit-json';
  systemInstruction?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  maxTokens?: number;
  responseMimeType?: string;
  disableThinking?: boolean;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  novelId?: string;
  onComplete?: (metadata: { finishReason?: string; truncated: boolean; outputDiagnostic: OutputDiagnostic }) => void;
  traceId?: string;
}

export type ProviderErrorCode =
  | 'configuration' | 'authentication' | 'billing' | 'parameter_incompatible' | 'rate_limit'
  | 'service_unavailable' | 'network' | 'timeout' | 'empty_response' | 'quality_rejected';

export type ProviderErrorPhase = 'request' | 'response' | 'parse';
export type ProviderErrorReason = 'no_content' | 'reasoning_only' | 'length_exhausted';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly httpStatus?: number;
  readonly phase: ProviderErrorPhase;
  readonly attempt: number;
  readonly finishReason?: string;
  readonly reason?: ProviderErrorReason;
  readonly retriable: boolean;
  readonly traceId: string;
  readonly rejectedParameter?: RejectedParameter;
  readonly providerErrorCode?: string;
  readonly providerRequestCount: number;
  readonly compatibilityMode: CompatibilityMode;
  readonly provider: OutputDiagnostic['provider'];

  constructor(fields: { code: ProviderErrorCode; phase: ProviderErrorPhase; attempt: number; traceId: string; provider?: OutputDiagnostic['provider']; httpStatus?: number; finishReason?: string; reason?: ProviderErrorReason; retriable?: boolean; rejectedParameter?: RejectedParameter; providerErrorCode?: string; providerRequestCount?: number; compatibilityMode?: CompatibilityMode; message: string }) {
    super(fields.message);
    this.name = 'ProviderError';
    this.code = fields.code;
    this.httpStatus = fields.httpStatus;
    this.phase = fields.phase;
    this.attempt = fields.attempt;
    this.finishReason = fields.finishReason;
    this.reason = fields.reason;
    this.retriable = fields.retriable ?? (fields.reason === 'reasoning_only' || fields.reason === 'length_exhausted' ? false : ['rate_limit', 'service_unavailable', 'network', 'timeout', 'empty_response'].includes(fields.code));
    this.traceId = fields.traceId;
    this.rejectedParameter = fields.rejectedParameter;
    this.providerErrorCode = fields.providerErrorCode;
    this.providerRequestCount = fields.providerRequestCount || 0;
    this.compatibilityMode = fields.compatibilityMode || 'none';
    this.provider = fields.provider || 'openai-compatible';
  }
}

export type ProviderErrorEnvelope = {
  error: string;
  code: ProviderErrorCode;
  traceId: string;
  retriable: boolean;
  finishReason?: string;
  reason?: ProviderErrorReason;
};

export function toProviderErrorEnvelope(error: ProviderError): ProviderErrorEnvelope {
  return {
    error: error.message,
    code: error.code,
    traceId: error.traceId,
    retriable: error.retriable,
    ...(error.reason ? { reason: error.reason } : {}),
    ...(error.finishReason ? { finishReason: error.finishReason } : {}),
  };
}

const OPENAI_TIMEOUT_MS = 75_000;
const OPENAI_MAX_ATTEMPTS = 3;

function isGoogleProvider(baseUrl: string) {
  return !baseUrl || baseUrl.includes("generativelanguage.googleapis.com");
}

export interface EmbeddingModelInfo {
  provider: 'google' | 'openai-compatible';
  model: string;
  modelId: string;
}

/** Keep status metadata and the actual embedding request on the same model. */
export function getEmbeddingModelInfo(config: AppConfig): EmbeddingModelInfo {
  if (isGoogleProvider(config.baseUrl)) {
    const model = config.model && config.model.includes('embedding') ? config.model : 'text-embedding-004';
    return { provider: 'google', model, modelId: `google:${model}` };
  }

  const normalizedModel = config.model?.toLowerCase() || '';
  const isChatModel = normalizedModel.includes('chat') || normalizedModel.includes('gpt-')
    || normalizedModel.includes('claude-') || normalizedModel.includes('deepseek-');
  const model = isChatModel ? 'text-embedding-3-small' : (config.model || 'text-embedding-3-small');
  return { provider: 'openai-compatible', model, modelId: `openai-compatible:${model}` };
}

function isMiniMaxProvider(baseUrl: string) {
  return baseUrl.includes("api.minimaxi.com") || baseUrl.includes("api.minimax.io");
}

function isDeepSeekProvider(baseUrl: string) {
  return /deepseek/i.test(baseUrl);
}

function getProviderName(baseUrl: string): OutputDiagnostic['provider'] {
  if (isGoogleProvider(baseUrl)) return 'google';
  if (isDeepSeekProvider(baseUrl)) return 'deepseek';
  if (isMiniMaxProvider(baseUrl)) return 'minimax';
  return 'openai-compatible';
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function extractOpenAIText(data: unknown): string {
  const rec = asRecord(data);
  const choices = asArray(rec.choices);
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice.message);
  return extractOpenAIMessageText(message);
}

function extractOpenAIMessageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const partRec = asRecord(part);
        return typeof partRec.text === "string" ? partRec.text : "";
      })
      .join("");
  }
  return "";
}

function sanitizeModelTextWithDiagnostic(text: string, reasoningContentPresent = false) {
  const hasClosedThink = /<(?:think|analysis|reasoning)>[\s\S]*?<\/(?:think|analysis|reasoning)>/i.test(text);
  const hasThinkStart = /<(?:think|analysis|reasoning)>/i.test(text);
  const hasThinkEnd = /<\/(?:think|analysis|reasoning)>/i.test(text);
  const thinkTagState: OutputDiagnostic['thinkTagState'] = hasThinkStart && !hasThinkEnd
    ? 'unclosed'
    : hasClosedThink ? 'closed_removed' : 'none';
  let sanitized = text.replace(/<(?:think|analysis|reasoning)>[\s\S]*?<\/(?:think|analysis|reasoning)>/gi, '');
  const unclosedStart = sanitized.search(/<(?:think|analysis|reasoning)>/i);
  if (unclosedStart >= 0) sanitized = sanitized.slice(0, unclosedStart);
  sanitized = sanitized.trim();
  return {
    text: sanitized,
    contentLength: text.length,
    sanitizedLength: sanitized.length,
    reasoningContentPresent: reasoningContentPresent || hasThinkStart,
    thinkTagState,
  };
}

function sanitizeModelText(text: string): string {
  return sanitizeModelTextWithDiagnostic(text).text;
}

function emptyOutputReason(text: string, reasoningContentPresent: boolean, finishReason?: string): ProviderErrorReason {
  const sanitized = sanitizeModelTextWithDiagnostic(text, reasoningContentPresent);
  if (sanitized.text) return 'no_content';
  if (/length|max[_ -]?tokens/i.test(finishReason || '')) return 'length_exhausted';
  if (reasoningContentPresent || sanitized.thinkTagState !== 'none') return 'reasoning_only';
  return 'no_content';
}

function buildOutputDiagnostic(
  baseUrl: string,
  responseFormatMode: OutputDiagnostic['responseFormatMode'],
  disableThinking: boolean | undefined,
  text: string,
  finishReason?: string,
  reasoningContentPresent = false,
  options: { compatibilityMode?: CompatibilityMode; providerRequestCount?: number; providerHttpStatus?: number; rejectedParameter?: RejectedParameter; providerErrorCode?: string } = {},
): OutputDiagnostic {
  const sanitized = sanitizeModelTextWithDiagnostic(text, reasoningContentPresent);
  return {
    provider: getProviderName(baseUrl),
    responseFormatMode,
    thinkingMode: disableThinking ? 'disabled' : 'provider_default',
    finishReason,
    contentLength: sanitized.contentLength,
    sanitizedLength: sanitized.sanitizedLength,
    reasoningContentPresent: sanitized.reasoningContentPresent,
    thinkTagState: sanitized.thinkTagState,
    compatibilityMode: options.compatibilityMode || 'none',
    providerRequestCount: options.providerRequestCount || 0,
    providerHttpStatus: options.providerHttpStatus,
    rejectedParameter: options.rejectedParameter,
    providerErrorCode: options.providerErrorCode,
  };
}

export function buildGoogleGenerateContentRequest(options: Pick<GenerateTextOptions, "prompt" | "systemInstruction" | "maxTokens" | "responseMimeType" | "disableThinking" | "signal">) {
  const { prompt, systemInstruction, maxTokens, responseMimeType, disableThinking, signal } = options;
  const config = {
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
    ...(responseMimeType ? { responseMimeType } : {}),
    ...(disableThinking ? { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } } : {}),
    ...(signal ? { abortSignal: signal } : {}),
  };

  return {
    model: "gemini-2.5-pro",
    contents: prompt,
    ...(Object.keys(config).length > 0 ? { config } : {}),
  };
}

export function buildOpenAICompatibleChatRequest(
  config: Pick<AppConfig, "baseUrl" | "model">,
  options: Pick<GenerateTextOptions, "prompt" | "systemInstruction" | "maxTokens" | "responseMimeType" | "disableThinking" | "onToken"> & { includeResponseFormat?: boolean },
) {
  const { prompt, systemInstruction, maxTokens, responseMimeType, disableThinking, onToken, includeResponseFormat = true } = options;
  const request: Record<string, unknown> = {
    model: config.model,
    messages: [
      ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
      { role: "user", content: prompt },
    ],
    stream: !!onToken,
  };

  if (isMiniMaxProvider(config.baseUrl)) {
    if (maxTokens) {
      request.max_completion_tokens = Math.min(maxTokens, 2048);
    }
    if (disableThinking) {
      request.reasoning_split = true;
    }
    return request;
  }

  if (maxTokens) {
    request.max_tokens = maxTokens;
  }
  if (isDeepSeekProvider(config.baseUrl) && disableThinking) {
    request.thinking = { type: 'disabled' };
  }
  if (responseMimeType === "application/json" && includeResponseFormat) {
    // Siliconflow's API gateway fails or drops connection when response_format is sent
    const isSiliconFlow = config.baseUrl.includes("siliconflow");
    if (!isSiliconFlow) {
      request.response_format = { type: "json_object" };
    }
  }

  return request;
}

function isRetryableStatus(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
}

function providerError(fields: Omit<ConstructorParameters<typeof ProviderError>[0], 'message'> & { message?: string }): ProviderError {
  const safeMessages: Record<ProviderErrorCode, string> = {
    configuration: '模型配置不可用，请检查设置',
    authentication: '模型服务鉴权失败，请检查 API Key',
    billing: '模型服务额度不足，请充值或更换可用模型',
    parameter_incompatible: '模型服务不支持当前请求参数',
    rate_limit: '模型服务暂时限流，请稍后重试',
    service_unavailable: '模型服务暂时不可用，请稍后重试',
    network: '模型服务网络请求失败',
    timeout: '模型服务请求超时',
    empty_response: '模型服务返回空结果',
    quality_rejected: '模型输出未通过质量校验，请重试',
  };
  return new ProviderError({ ...fields, message: fields.message || safeMessages[fields.code] });
}

type ReasoningStreamFilter = { push: (chunk: string) => void; flush: () => void };

/** Incrementally removes <think>/<analysis>/<reasoning> blocks without leaking split tags. */
function createReasoningStreamFilter(onToken: (token: string) => void): ReasoningStreamFilter {
  const starts = ['<think>', '<analysis>', '<reasoning>'];
  const ends = ['</think>', '</analysis>', '</reasoning>'];
  let pending = '';
  let inside = false;

  const findMarker = (value: string, markers: string[]) => {
    const lowered = value.toLowerCase();
    let best = -1;
    for (const marker of markers) {
      const index = lowered.indexOf(marker);
      if (index >= 0 && (best < 0 || index < best)) best = index;
    }
    return best;
  };

  const markerPrefixSuffixLength = (value: string, markers: string[]) => {
    const lowered = value.toLowerCase();
    const maxLength = Math.min(value.length, Math.max(...markers.map((marker) => marker.length - 1)));
    for (let length = maxLength; length > 0; length -= 1) {
      const suffix = lowered.slice(-length);
      if (markers.some((marker) => marker.startsWith(suffix))) return length;
    }
    return 0;
  };

  const drain = (flush = false) => {
    while (pending) {
      if (inside) {
        const end = findMarker(pending, ends);
        if (end < 0) {
          if (!flush) {
            const keepLength = markerPrefixSuffixLength(pending, ends);
            pending = keepLength > 0 ? pending.slice(-keepLength) : '';
          }
          else pending = '';
          return;
        }
        pending = pending.slice(end + ends.find((marker) => pending.slice(end).toLowerCase().startsWith(marker))!.length);
        inside = false;
        continue;
      }

      const start = findMarker(pending, starts);
      if (start < 0) {
        if (flush) {
          onToken(pending);
          pending = '';
        } else {
          const keepLength = markerPrefixSuffixLength(pending, starts);
          if (pending.length > keepLength) onToken(pending.slice(0, pending.length - keepLength));
          pending = keepLength > 0 ? pending.slice(-keepLength) : '';
        }
        return;
      }
      if (start > 0) onToken(pending.slice(0, start));
      const marker = starts.find((item) => pending.slice(start).toLowerCase().startsWith(item))!;
      pending = pending.slice(start + marker.length);
      inside = true;
    }
  };

  return {
    push(chunk) {
      pending += chunk;
      drain(false);
    },
    flush() {
      drain(true);
    },
  };
}

function classifyProviderStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 402) return 'billing';
  if (status === 429) return 'rate_limit';
  if (status >= 500 && status <= 599) return 'service_unavailable';
  return 'parameter_incompatible';
}

function getParameterRejection(status: number, body: string): { rejectedParameter: RejectedParameter; providerErrorCode?: string } | undefined {
  if (status !== 400 && status !== 422) return undefined;
  let parsedError: Record<string, unknown> = {};
  try {
    parsedError = asRecord(asRecord(JSON.parse(body)).error);
  } catch {
    // The provider may return a plain text parameter error.
  }
  const parameter = typeof parsedError.param === 'string' ? parsedError.param : '';
  const providerErrorCode = typeof parsedError.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(parsedError.code)
    ? parsedError.code
    : undefined;
  const signal = `${parameter} ${typeof parsedError.message === 'string' ? parsedError.message : ''} ${body}`;
  if (/response[_ -]?format|json[_ -]?object/i.test(signal)) return { rejectedParameter: 'response_format', providerErrorCode };
  if (/thinking/i.test(signal)) return { rejectedParameter: 'thinking', providerErrorCode };
  if (parameter) return { rejectedParameter: 'unknown', providerErrorCode };
  return undefined;
}

function isRetryableNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("UND_ERR_SOCKET") ||
    message.includes("fetch failed") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("timed out") ||
    message.includes("other side closed")
  );
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|timeout|ETIMEDOUT/i.test(message);
}

function isRetryableModelOutputError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("LLM returned empty response") ||
    message.includes("LLM response contained only thinking/reasoning content")
  );
}

function classifyStreamFailure(error: unknown): ProviderErrorCode | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (/SSE ended before \[DONE\]|Response body is empty|empty response/i.test(message)) return 'empty_response';
  if (/SSE returned invalid JSON/i.test(message)) return 'network';
  return undefined;
}

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function buildCharacterRelationshipContext(novelId: string): string {
  try {
    const database = getDb();
    const characters = database.prepare(
      'SELECT id, name, role, summary, traits, bio, current_state FROM characters WHERE novel_id = ?'
    ).all(novelId) as Array<{
      id: string;
      name: string;
      role: string;
      summary: string;
      traits: string;
      bio: string;
      current_state: string;
    }>;

    const relationships = database.prepare(
      'SELECT sourceId, targetId, relationshipType, description FROM entity_relationships WHERE novelId = ?'
    ).all(novelId) as Array<{
      sourceId: string;
      targetId: string;
      relationshipType: string;
      description: string;
    }>;

    if (characters.length === 0) return '';

    let context = '\n\n【全局角色设定与人物关系图谱（剧情一致性对齐防崩坏）】\n';
    context += '角色名册：\n';
    const charMap = new Map<string, string>();
    for (const char of characters) {
      charMap.set(char.id, char.name);

      let traitsStr = '';
      try {
        if (char.traits) {
          const parsed = JSON.parse(char.traits);
          traitsStr = Array.isArray(parsed) ? parsed.join(', ') : String(parsed);
        }
      } catch {
        traitsStr = char.traits || '';
      }

      context += `- **${char.name}** (${char.role || '配角'}): ${char.summary || ''}\n`;
      if (traitsStr) context += `  * 标签特质: ${traitsStr}\n`;
      if (char.bio) context += `  * 背景小传: ${char.bio}\n`;
      if (char.current_state) context += `  * 当前状态/处境: ${char.current_state}\n`;
    }

    if (relationships.length > 0) {
      context += '\n人物情感/阵营羁绊：\n';
      for (const rel of relationships) {
        const sourceName = charMap.get(rel.sourceId) || rel.sourceId;
        const targetName = charMap.get(rel.targetId) || rel.targetId;
        context += `- **${sourceName}** 与 **${targetName}** 之间的关系为 [${rel.relationshipType || '普通羁绊'}]: ${rel.description || ''}\n`;
      }
    }
    return context;
  } catch {
    return '';
  }
}

export async function generateText(config: AppConfig, options: GenerateTextOptions): Promise<string> {
  const outputMode = options.outputMode || 'prose';
  if (outputMode === 'audit-json') {
    // Audit payloads are data, not prose. Keep transport safeguards while
    // bypassing the prose prompt/output quality gates.
    return generateTextRaw(config, {
      ...options,
      responseMimeType: options.responseMimeType || 'application/json',
    });
  }
  const guardLevel = config.promptGuardLevel || 'strict';

  if (guardLevel === 'disabled') {
    return generateTextRaw(config, options);
  }

  // Build character relationship context if novelId is present
  let updatedSystemInstruction = options.systemInstruction;
  if (options.novelId && isCreativeWritingRequest(options.prompt, options.systemInstruction)) {
    const charContext = buildCharacterRelationshipContext(options.novelId);
    if (charContext) {
      updatedSystemInstruction = (options.systemInstruction || '') + charContext;
    }
  }

  // 1. Input Gate: Apply prompt guard rules to systemInstruction or prompt if creative writing
  const guarded = applyInputGuard(options.prompt, updatedSystemInstruction);
  const deferQualityGuardedTokens = guardLevel === 'strict'
    && isCreativeWritingRequest(options.prompt, updatedSystemInstruction)
    && typeof options.onToken === 'function';
  const effectiveOptions = {
    ...options,
    prompt: guarded.prompt,
    systemInstruction: guarded.systemInstruction,
    // Keep the provider in streaming mode for latency/backpressure semantics,
    // but swallow raw chunks until the complete draft passes the output gate.
    ...(deferQualityGuardedTokens ? { onToken: () => undefined } : {}),
  };

  // 2. Execute raw generation
  const rawResult = await generateTextRaw(config, effectiveOptions);

  // If this request is not creative-writing-related or level is balanced, skip output guard and corrective retry
  if (guardLevel === 'balanced' || !isCreativeWritingRequest(options.prompt, updatedSystemInstruction)) {
    return rawResult;
  }

  // 3. Output Gate: Check for AI slop and cliches
  const guardResult = checkOutputGuard(rawResult);
  if (guardResult.pass) {
    if (deferQualityGuardedTokens) options.onToken?.(rawResult);
    return rawResult;
  }

  // 4. Correction Gate: If output failed quality gate, run self-correction retry
  try {
    const correctionPrompt = buildCorrectionPrompt(rawResult, guardResult.violations);
    const correctionOptions = {
      ...effectiveOptions,
      prompt: correctionPrompt,
      // Disable streaming token emissions on correction to avoid disjointed UI streaming
      onToken: undefined,
      maxAttempts: 1, // Restrict to exactly 1 attempt to avoid API budget/time bloating
    };

    const correctedResult = await generateTextRaw(config, correctionOptions);

    // Validate the corrected result
    const secondGuardResult = checkOutputGuard(correctedResult);
    if (secondGuardResult.pass) {
      if (deferQualityGuardedTokens) options.onToken?.(correctedResult);
      return correctedResult;
    }

    // A failed correction is not a valid writing result. Returning the raw draft
    // here made low-quality output look successful to every caller.
    throw providerError({
      code: 'quality_rejected',
      phase: 'response',
      attempt: 2,
      traceId: options.traceId || `llm_${randomUUID()}`,
      provider: getProviderName(config.baseUrl),
      retriable: true,
      message: `模型输出未通过质量校验：${secondGuardResult.violations.slice(0, 2).join('；') || '请重试'}`,
    });
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'quality_rejected') throw error;
    throw providerError({
      code: 'quality_rejected',
      phase: 'response',
      attempt: 2,
      traceId: options.traceId || `llm_${randomUUID()}`,
      provider: getProviderName(config.baseUrl),
      retriable: true,
      message: '模型输出未通过质量校验，请重试',
    });
  }
}

async function generateTextRaw(config: AppConfig, options: GenerateTextOptions): Promise<string> {
  const {
    prompt,
    systemInstruction,
    timeoutMs = OPENAI_TIMEOUT_MS,
    maxAttempts = OPENAI_MAX_ATTEMPTS,
    maxTokens,
    responseMimeType,
    disableThinking,
    onToken,
  } = options;
  const traceId = options.traceId || `llm_${randomUUID()}`;

  if (!config.apiKey) {
    throw providerError({ code: 'configuration', phase: 'request', attempt: 0, traceId, provider: getProviderName(config.baseUrl) });
  }

  if (isGoogleProvider(config.baseUrl)) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutError = new Error(`LLM request timed out after ${timeoutMs / 1000}s`);
      const timeoutId = setTimeout(() => controller.abort(timeoutError), timeoutMs);
      const onExternalAbort = () => {
        controller.abort(options.signal?.reason || new Error('AbortError'));
      };

      if (options.signal?.aborted) {
        clearTimeout(timeoutId);
        throw options.signal.reason || new Error('AbortError');
      }
      options.signal?.addEventListener('abort', onExternalAbort, { once: true });

      try {
        const { GoogleGenAI } = await import("@google/genai");
        if (controller.signal.aborted) {
          throw controller.signal.reason || new Error('AbortError');
        }
        const ai = new GoogleGenAI({ apiKey: config.apiKey });
        const request = buildGoogleGenerateContentRequest({
          prompt,
          systemInstruction,
          maxTokens,
          responseMimeType,
          disableThinking,
          signal: controller.signal,
        });
        request.model = config.model || request.model;

        if (onToken) {
          if (controller.signal.aborted) {
            throw controller.signal.reason || new Error('AbortError');
          }
          const responseStream = await ai.models.generateContentStream(request);
          let fullText = '';
          let finishReason: string | undefined;
          const reasoningFilter = createReasoningStreamFilter(onToken);
          for await (const chunk of responseStream) {
            if (controller.signal.aborted) {
              throw controller.signal.reason || new Error('AbortError');
            }
            const text = chunk.text || '';
            const candidateFinishReason = String(asRecord(asArray(asRecord(chunk).candidates)[0]).finishReason || '');
            if (candidateFinishReason) finishReason = candidateFinishReason;
            if (text) {
              fullText += text;
              reasoningFilter.push(text);
            }
          }
          reasoningFilter.flush();
          if (controller.signal.aborted) {
            throw controller.signal.reason || new Error('AbortError');
          }
          const sanitized = sanitizeModelTextWithDiagnostic(fullText);
          if (!sanitized.text) {
            throw providerError({
              code: 'empty_response',
              phase: 'response',
              attempt,
              traceId,
              provider: getProviderName(config.baseUrl),
              finishReason,
              reason: emptyOutputReason(fullText, sanitized.reasoningContentPresent, finishReason),
              retriable: emptyOutputReason(fullText, sanitized.reasoningContentPresent, finishReason) === 'no_content',
            });
          }
          options.onComplete?.({
            truncated: false,
            outputDiagnostic: {
              ...buildOutputDiagnostic(config.baseUrl, responseMimeType === 'application/json' ? 'json_object' : 'none', disableThinking, fullText, finishReason),
              contentLength: sanitized.contentLength,
              sanitizedLength: sanitized.sanitizedLength,
              reasoningContentPresent: sanitized.reasoningContentPresent,
              thinkTagState: sanitized.thinkTagState,
            },
          });
          return sanitized.text;
        }

        if (controller.signal.aborted) {
          throw controller.signal.reason || new Error('AbortError');
        }
        const response = await ai.models.generateContent(request);
        if (controller.signal.aborted) {
          throw controller.signal.reason || new Error('AbortError');
        }
        const finishReason = String(asRecord(asArray(asRecord(response).candidates)[0]).finishReason || '');
        const rawText = response.text || '';
        const diagnostic = buildOutputDiagnostic(config.baseUrl, responseMimeType === 'application/json' ? 'json_object' : 'none', disableThinking, rawText, finishReason || undefined);
        options.onComplete?.({ finishReason: finishReason || undefined, truncated: /length|max[_ -]?tokens/i.test(finishReason), outputDiagnostic: diagnostic });
        const text = sanitizeModelText(rawText);
        if (!text) {
          const reason = emptyOutputReason(rawText, diagnostic.reasoningContentPresent, finishReason);
          throw providerError({ code: 'empty_response', phase: 'response', attempt, traceId, provider: getProviderName(config.baseUrl), finishReason, reason, retriable: reason === 'no_content' });
        }
        return text;
      } catch (error) {
        lastError = controller.signal.aborted
          ? (controller.signal.reason || error)
          : error;

        const externallyAborted = options.signal?.aborted === true;
        const isTimeout = lastError instanceof Error && lastError.message.includes("timed out");
        if (!externallyAborted && attempt < maxAttempts && (isTimeout || isRetryableNetworkError(lastError) || isRetryableModelOutputError(lastError))) {
          await sleep(400 * attempt);
          continue;
        }

        if (options.signal?.aborted) throw options.signal.reason || lastError;
        if (lastError instanceof ProviderError) throw lastError;
        throw providerError({
          code: isTimeoutError(lastError) ? 'timeout' : isRetryableNetworkError(lastError) ? 'network' : 'service_unavailable',
          phase: 'request', attempt, traceId, provider: getProviderName(config.baseUrl),
        });
      } finally {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', onExternalAbort);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  let lastError: unknown;
  let includeResponseFormat = true;
  let omitThinking = false;
  let compatibilityMode: CompatibilityMode = 'none';
  let providerRequestCount = 0;
  let attempt = 1;

  while (attempt <= maxAttempts) {
    const controller = new AbortController();
    const timeoutError = new Error(`LLM request timed out after ${timeoutMs / 1000}s`);
    const abortTimeoutId = setTimeout(() => controller.abort(timeoutError), timeoutMs);
    const onExternalAbort = () => {
      controller.abort(options.signal?.reason || new Error('AbortError'));
    };

    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(abortTimeoutId);
        throw options.signal.reason || new Error("AbortError");
      }
      options.signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    // Double safety net: Promise.race with a hard timeout in case AbortController
    // fails to terminate the connection (observed with some API providers).
    let raceTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const raceTimeoutPromise = new Promise<never>((_, reject) => {
      raceTimeoutId = setTimeout(() => reject(new Error(`LLM request timed out after ${timeoutMs / 1000}s`)), timeoutMs + 2000);
    });

    try {
      const result = await Promise.race([
        (async () => {
          providerRequestCount += 1;
          const response = await fetch(joinUrl(config.baseUrl, "/chat/completions"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(
              buildOpenAICompatibleChatRequest(
                { baseUrl: config.baseUrl, model: config.model },
                { prompt, systemInstruction, maxTokens, responseMimeType, disableThinking: disableThinking && !omitThinking, onToken, includeResponseFormat },
              ),
            ),
            signal: controller.signal
          });

          if (!response.ok) {
            const errorText = await response.text();
            const rejection = getParameterRejection(response.status, errorText);
            if (rejection) {
              throw providerError({
              code: 'parameter_incompatible', phase: 'response', attempt, traceId, provider: getProviderName(config.baseUrl), httpStatus: response.status,
                rejectedParameter: rejection.rejectedParameter, providerErrorCode: rejection.providerErrorCode,
                providerRequestCount, compatibilityMode,
              });
            }
            const code = classifyProviderStatus(response.status);
            throw providerError({ code, phase: 'response', attempt, traceId, provider: getProviderName(config.baseUrl), httpStatus: response.status, providerRequestCount, compatibilityMode });
          }

          if (onToken) {
            const body = response.body;
            if (!body) throw new Error("Response body is empty");
            const reader = body.getReader();
            const decoder = new TextDecoder("utf-8");
            let fullText = '';
            let buffer = '';
            let sawDone = false;
            let finishReason: string | undefined;
            let reasoningContentPresent = false;
            let emittedContent = false;
            const reasoningFilter = createReasoningStreamFilter((token) => {
              onToken(token);
              emittedContent = true;
            });

            const processSseLine = (line: string) => {
              if (controller.signal.aborted) {
                throw controller.signal.reason || new Error('AbortError');
              }
              const cleaned = line.trim();
              if (!cleaned) return;
              if (cleaned === 'data: [DONE]') {
                sawDone = true;
                return;
              }
              if (!cleaned.startsWith('data: ')) return;

              let parsed: unknown;
              try {
                parsed = JSON.parse(cleaned.substring(6));
              } catch {
                throw new Error('LLM SSE returned invalid JSON');
              }
              const delta = asRecord(asRecord(asArray(asRecord(parsed).choices)[0]).delta);
              const token = delta.content;
              const reasoningToken = delta.reasoning_content || delta.reasoningContent;
              if (typeof reasoningToken === 'string' && reasoningToken) reasoningContentPresent = true;
              const choice = asRecord(asArray(asRecord(parsed).choices)[0]);
              const chunkFinishReason = String(choice.finish_reason || choice.finishReason || '');
              if (chunkFinishReason) finishReason = chunkFinishReason;
              if (typeof token === 'string' && token) {
                if (controller.signal.aborted) {
                  throw controller.signal.reason || new Error('AbortError');
                }
                fullText += token;
                reasoningFilter.push(token);
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              if (controller.signal.aborted) {
                throw controller.signal.reason || new Error('AbortError');
              }
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                processSseLine(line);
              }
            }
            buffer += decoder.decode();
            if (buffer.trim()) processSseLine(buffer);
            reasoningFilter.flush();
            if (!sawDone) {
              throw providerError({ code: 'network', phase: 'parse', attempt, traceId, provider: getProviderName(config.baseUrl), finishReason, providerRequestCount, compatibilityMode });
            }
            const sanitized = sanitizeModelTextWithDiagnostic(fullText);
            if (!sanitized.text) {
              throw providerError({
                code: 'empty_response',
                phase: 'response',
                attempt,
                traceId,
                provider: getProviderName(config.baseUrl),
                finishReason,
                providerRequestCount,
                compatibilityMode,
                reason: emptyOutputReason(fullText, reasoningContentPresent || sanitized.reasoningContentPresent, finishReason),
                retriable: emptyOutputReason(fullText, reasoningContentPresent || sanitized.reasoningContentPresent, finishReason) === 'no_content',
              });
            }
            if (!emittedContent) onToken(sanitized.text);
            options.onComplete?.({
              truncated: false,
              outputDiagnostic: {
                ...buildOutputDiagnostic(config.baseUrl, responseMimeType === 'application/json' ? (includeResponseFormat ? 'json_object' : 'plain_fallback') : 'none', disableThinking && !omitThinking, fullText, finishReason, false, { compatibilityMode, providerRequestCount }),
                contentLength: sanitized.contentLength,
                sanitizedLength: sanitized.sanitizedLength,
                reasoningContentPresent: sanitized.reasoningContentPresent,
                thinkTagState: sanitized.thinkTagState,
              },
            });
            return sanitized.text;
          } else {
            const data = await response.json();
            const finishReason = String(asRecord(asArray(asRecord(data).choices)[0]).finish_reason || '');
            const firstChoice = asRecord(asArray(asRecord(data).choices)[0]);
            const message = asRecord(firstChoice.message);
            const text = extractOpenAIMessageText(message);
            const diagnostic = buildOutputDiagnostic(
              config.baseUrl,
              responseMimeType === 'application/json' ? (includeResponseFormat ? 'json_object' : 'plain_fallback') : 'none',
              disableThinking && !omitThinking,
              text,
              finishReason || undefined,
              typeof message.reasoning_content === 'string' || typeof message.reasoningContent === 'string',
              { compatibilityMode, providerRequestCount },
            );
            options.onComplete?.({ finishReason: finishReason || undefined, truncated: /length|max[_ -]?tokens/i.test(finishReason), outputDiagnostic: diagnostic });
            if (!text) throw providerError({ code: 'empty_response', phase: 'response', attempt, traceId, provider: getProviderName(config.baseUrl), finishReason, providerRequestCount, compatibilityMode, reason: emptyOutputReason(text, diagnostic.reasoningContentPresent, finishReason), retriable: emptyOutputReason(text, diagnostic.reasoningContentPresent, finishReason) === 'no_content' });
            const sanitized = sanitizeModelText(text);
            if (!sanitized) {
              throw providerError({ code: 'empty_response', phase: 'parse', attempt, traceId, provider: getProviderName(config.baseUrl), finishReason, providerRequestCount, compatibilityMode, reason: emptyOutputReason(text, diagnostic.reasoningContentPresent, finishReason), retriable: emptyOutputReason(text, diagnostic.reasoningContentPresent, finishReason) === 'no_content' });
            }
            return sanitized;
          }
        })(),
        raceTimeoutPromise,
      ]);
      // Successfully connected and received response -> Mark liveness as connected
      setLivenessStatus('connected');
      return result;
    } catch (error) {
      // Node undici fetch aborts are wrapped as TypeError: fetch failed with a nested AbortError cause.
      // Check both nested cause name and standard error names.
      const isAbort = controller.signal.aborted ||
                      (error instanceof Error && error.name === "AbortError") ||
                      (error instanceof Error && error.message.includes("fetch failed") &&
                       (error.cause instanceof Error) && error.cause.name === "AbortError") ||
                      (error instanceof Error && error.message.includes("The user aborted a request"));
      if (controller.signal.aborted) {
        lastError = controller.signal.reason || error;
      } else if (isAbort) {
        lastError = new Error(`LLM request timed out after ${timeoutMs / 1000}s`);
      } else {
        lastError = error;
      }

      if (error instanceof ProviderError && error.code === 'parameter_incompatible' && responseMimeType === 'application/json') {
        if (isDeepSeekProvider(config.baseUrl) && disableThinking && !omitThinking && (error.rejectedParameter === 'thinking' || error.rejectedParameter === 'unknown')) {
          omitThinking = true;
          compatibilityMode = 'omit_thinking';
          continue;
        }
        if (!isDeepSeekProvider(config.baseUrl) && includeResponseFormat && error.rejectedParameter === 'response_format') {
          includeResponseFormat = false;
          compatibilityMode = 'plain_fallback';
          continue;
        }
      }

      if (options.signal?.aborted) throw options.signal.reason || error;

      // Do not retry if request was explicitly aborted or timed out to prevent compounding delays.
      const isRetryable = !controller.signal.aborted && !isAbort && (
        (error instanceof ProviderError ? error.code === 'rate_limit' || error.code === 'service_unavailable' || (error.code === 'empty_response' && (error.reason === undefined || error.reason === 'no_content')) : false) ||
        isRetryableStatus(error instanceof ProviderError ? error.httpStatus || 0 : error instanceof Error ? parseInt(error.message.match(/\((\d+)\)/)?.[1] || '0') : 0) ||
        isRetryableNetworkError(error) ||
        isRetryableModelOutputError(error)
      );

      if (attempt < maxAttempts && isRetryable) {
        // DeepSeek may drop a request carrying its disabled-thinking option. On a
        // retry, omit only that option while preserving JSON response formatting.
        if (isDeepSeekProvider(config.baseUrl) && disableThinking && !omitThinking && isRetryableNetworkError(error)) {
          omitThinking = true;
          compatibilityMode = 'omit_thinking';
        }
        const retryDelay = 400 * attempt;
        attempt += 1;
        await sleep(retryDelay);
        continue;
      }

      // Final failure for this request -> set liveness to unknown
      setLivenessStatus('unknown');
      if (lastError instanceof ProviderError) throw lastError;
      const streamFailureCode = classifyStreamFailure(lastError);
      throw providerError({
        code: isAbort || isTimeoutError(lastError) ? 'timeout' : isRetryableNetworkError(lastError) ? 'network' : streamFailureCode || (isRetryableModelOutputError(lastError) ? 'empty_response' : 'service_unavailable'),
        phase: streamFailureCode ? 'parse' : 'request', attempt, traceId, provider: getProviderName(config.baseUrl),
        providerRequestCount,
        compatibilityMode,
      });
    } finally {
      clearTimeout(abortTimeoutId);
      options.signal?.removeEventListener('abort', onExternalAbort);
      if (raceTimeoutId !== null) clearTimeout(raceTimeoutId);
    }
    attempt += 1;
  }

  setLivenessStatus('unknown');
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function generateEmbedding(
  config: AppConfig,
  text: string,
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<number[]> {
  if (!config.apiKey) {
    throw new Error("API key not configured");
  }

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(signal?.reason || new Error('Embedding request aborted'));
  if (signal?.aborted) onExternalAbort();
  else signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(new Error('Embedding request timed out')), timeoutMs);

  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason || new Error('Embedding request aborted');
    }
    if (isGoogleProvider(config.baseUrl)) {
      const { GoogleGenAI } = await import("@google/genai");
      if (controller.signal.aborted) {
        throw controller.signal.reason || new Error('Embedding request aborted');
      }
      const ai = new GoogleGenAI({ apiKey: config.apiKey });
      const modelName = getEmbeddingModelInfo(config).model;
      if (controller.signal.aborted) {
        throw controller.signal.reason || new Error('Embedding request aborted');
      }
      const response = await ai.models.embedContent({
        model: modelName,
        contents: text,
        config: { abortSignal: controller.signal },
      });
      const responseRec = asRecord(response);
      const embeddingField = asRecord(responseRec.embedding);
      const embeddingsArray = asArray(responseRec.embeddings);
      const firstEmbedding = asRecord(embeddingsArray[0]);

      const values = (Array.isArray(embeddingField.values) ? (embeddingField.values as number[]) : null) ||
                     (Array.isArray(firstEmbedding.values) ? (firstEmbedding.values as number[]) : null);
      if (!values) {
        throw new Error("Google GenAI returned empty embedding");
      }
      return values;
    }

    const model = getEmbeddingModelInfo(config).model;

    const response = await fetch(joinUrl(config.baseUrl, "/embeddings"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        input: text,
        model: model,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error("OpenAI returned invalid embedding format");
    }
    return embedding;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
