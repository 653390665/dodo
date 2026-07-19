import type { AppConfig } from "./config";
import { setLivenessStatus } from "./config";
import { applyInputGuard, checkOutputGuard, buildCorrectionPrompt, isCreativeWritingRequest } from '../helpers/prompt-guard';
import { getDb } from "./db-instance.js";

interface GenerateTextOptions {
  prompt: string;
  systemInstruction?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  maxTokens?: number;
  responseMimeType?: string;
  disableThinking?: boolean;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  novelId?: string;
}

const OPENAI_TIMEOUT_MS = 75_000;
const OPENAI_MAX_ATTEMPTS = 3;

function isGoogleProvider(baseUrl: string) {
  return !baseUrl || baseUrl.includes("generativelanguage.googleapis.com");
}

function isMiniMaxProvider(baseUrl: string) {
  return baseUrl.includes("api.minimaxi.com") || baseUrl.includes("api.minimax.io");
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

function sanitizeModelText(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
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
  options: Pick<GenerateTextOptions, "prompt" | "systemInstruction" | "maxTokens" | "responseMimeType" | "disableThinking" | "onToken">,
) {
  const { prompt, systemInstruction, maxTokens, responseMimeType, disableThinking, onToken } = options;
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
  if (responseMimeType === "application/json") {
    // Siliconflow's API gateway fails or drops connection when response_format is sent
    const isSiliconFlow = config.baseUrl.includes("siliconflow");
    if (!isSiliconFlow) {
      request.response_format = { type: "json_object" };
    }
  }

  return request;
}

function isRetryableStatus(status: number) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
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

function isRetryableModelOutputError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("LLM returned empty response") ||
    message.includes("LLM response contained only thinking/reasoning content")
  );
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
  const effectiveOptions = {
    ...options,
    prompt: guarded.prompt,
    systemInstruction: guarded.systemInstruction,
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
      return correctedResult;
    }

    // If both failed, return the one with the higher clean score (better quality)
    return secondGuardResult.score >= guardResult.score ? correctedResult : rawResult;
  } catch {
    // If corrective retry fails (e.g. network/API issue), fall back gracefully to the original draft
    return rawResult;
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

  if (!config.apiKey) {
    throw new Error("API key not configured");
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
          for await (const chunk of responseStream) {
            if (controller.signal.aborted) {
              throw controller.signal.reason || new Error('AbortError');
            }
            const text = chunk.text || '';
            if (text) {
              fullText += text;
              onToken(text);
            }
          }
          if (controller.signal.aborted) {
            throw controller.signal.reason || new Error('AbortError');
          }
          return sanitizeModelText(fullText);
        }

        if (controller.signal.aborted) {
          throw controller.signal.reason || new Error('AbortError');
        }
        const response = await ai.models.generateContent(request);
        if (controller.signal.aborted) {
          throw controller.signal.reason || new Error('AbortError');
        }
        return sanitizeModelText(response.text || "");
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

        throw lastError instanceof Error ? lastError : new Error(String(lastError));
      } finally {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', onExternalAbort);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
          const response = await fetch(joinUrl(config.baseUrl, "/chat/completions"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(
              buildOpenAICompatibleChatRequest(
                { baseUrl: config.baseUrl, model: config.model },
                { prompt, systemInstruction, maxTokens, responseMimeType, disableThinking, onToken },
              ),
            ),
            signal: controller.signal
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LLM request failed (${response.status}): ${errorText}`);
          }

          if (onToken) {
            const body = response.body;
            if (!body) throw new Error("Response body is empty");
            const reader = body.getReader();
            const decoder = new TextDecoder("utf-8");
            let fullText = '';
            let buffer = '';
            let sawDone = false;

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
              const token = asRecord(asRecord(asArray(asRecord(parsed).choices)[0]).delta).content;
              if (typeof token === 'string' && token) {
                if (controller.signal.aborted) {
                  throw controller.signal.reason || new Error('AbortError');
                }
                fullText += token;
                onToken(token);
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
            if (!sawDone) {
              throw new Error('LLM SSE ended before [DONE]');
            }
            return sanitizeModelText(fullText);
          } else {
            const data = await response.json();
            const text = extractOpenAIText(data);
            if (!text) {
              throw new Error("LLM returned empty response");
            }
            const sanitized = sanitizeModelText(text);
            if (!sanitized) {
              throw new Error("LLM response contained only thinking/reasoning content — increase max_tokens or use a non-thinking model");
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

      // Do not retry if request was explicitly aborted or timed out to prevent compounding delays.
      const isRetryable = !controller.signal.aborted && !isAbort && (
        isRetryableStatus(
          error instanceof Error ? parseInt(error.message.match(/\((\d+)\)/)?.[1] || '0') : 0
        ) ||
        isRetryableNetworkError(error) ||
        isRetryableModelOutputError(error)
      );

      if (attempt < maxAttempts && isRetryable) {
        await sleep(400 * attempt);
        continue;
      }

      // Final failure for this request -> set liveness to unknown
      setLivenessStatus('unknown');
      throw lastError;
    } finally {
      clearTimeout(abortTimeoutId);
      options.signal?.removeEventListener('abort', onExternalAbort);
      if (raceTimeoutId !== null) clearTimeout(raceTimeoutId);
    }
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
      const modelName = config.model && config.model.includes("embedding") ? config.model : "text-embedding-004";
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

    const isChatModel = config.model && (
      config.model.includes("chat") ||
      config.model.includes("gpt-") ||
      config.model.includes("claude-") ||
      config.model.includes("deepseek-")
    );
    const model = isChatModel ? "text-embedding-3-small" : (config.model || "text-embedding-3-small");

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
