import type { AppConfig } from "./config";

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

export function buildGoogleGenerateContentRequest(options: Pick<GenerateTextOptions, "prompt" | "systemInstruction" | "maxTokens" | "responseMimeType" | "disableThinking">) {
  const { prompt, systemInstruction, maxTokens, responseMimeType, disableThinking } = options;
  const config = {
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
    ...(responseMimeType ? { responseMimeType } : {}),
    ...(disableThinking ? { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } } : {}),
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
    request.response_format = { type: "json_object" };
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

export async function generateText(config: AppConfig, options: GenerateTextOptions): Promise<string> {
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
      try {
        const callPromise = (async () => {
          const { GoogleGenAI } = await import("@google/genai");
          const ai = new GoogleGenAI({ apiKey: config.apiKey });
          const request = buildGoogleGenerateContentRequest({
            prompt,
            systemInstruction,
            maxTokens,
            responseMimeType,
            disableThinking,
          });
          request.model = config.model || request.model;
          if (onToken) {
            const responseStream = await ai.models.generateContentStream(request);
            let fullText = '';
            for await (const chunk of responseStream) {
              const text = chunk.text || '';
              fullText += text;
              onToken(text);
            }
            return sanitizeModelText(fullText);
          } else {
            const response = await ai.models.generateContent(request);
            return sanitizeModelText(response.text || "");
          }
        })();

        let onAbort: (() => void) | undefined;
        const abortPromise = new Promise<never>((_, reject) => {
          const signal = options.signal;
          if (signal) {
            if (signal.aborted) {
              return reject(signal.reason || new Error("AbortError"));
            }
            onAbort = () => reject(signal.reason || new Error("AbortError"));
            signal.addEventListener("abort", onAbort);
          }
        });

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          callPromise,
          abortPromise,
          new Promise<string>((_, reject) =>
            timeoutId = setTimeout(() => reject(new Error(`LLM request timed out after ${timeoutMs / 1000}s`)), timeoutMs),
          ),
        ]);
        if (onAbort && options.signal) options.signal.removeEventListener("abort", onAbort);
        if (timeoutId) clearTimeout(timeoutId);
        return result;
      } catch (error) {
        lastError = error;

        const isTimeout = error instanceof Error && error.message.includes("timed out");
        if (attempt < maxAttempts && (isTimeout || isRetryableNetworkError(error) || isRetryableModelOutputError(error))) {
          await sleep(400 * attempt);
          continue;
        }

        throw lastError instanceof Error ? lastError : new Error(String(lastError));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const abortTimeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
      if (options.signal.aborted) {
        throw options.signal.reason || new Error("AbortError");
      }
      options.signal.addEventListener("abort", () => {
        controller.abort();
      });
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

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const cleaned = line.trim();
                if (!cleaned) continue;
                if (cleaned === 'data: [DONE]') continue;
                if (cleaned.startsWith('data: ')) {
                  try {
                    const parsed = JSON.parse(cleaned.substring(6));
                    const token = parsed?.choices?.[0]?.delta?.content || '';
                    if (token) {
                      fullText += token;
                      onToken(token);
                    }
                  } catch {}
                }
              }
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
      return result;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (isAbort) {
        lastError = new Error(`LLM request timed out after ${timeoutMs / 1000}s`);
      } else {
        lastError = error;
      }

      const isRetryable = isAbort || isRetryableStatus(
        error instanceof Error ? parseInt(error.message.match(/\((\d+)\)/)?.[1] || '0') : 0
      ) || isRetryableNetworkError(error) || isRetryableModelOutputError(error);

      if (attempt < maxAttempts && isRetryable) {
        await sleep(400 * attempt);
        continue;
      }

      throw lastError;
    } finally {
      clearTimeout(abortTimeoutId);
      if (raceTimeoutId !== null) clearTimeout(raceTimeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function generateEmbedding(config: AppConfig, text: string): Promise<number[]> {
  if (!config.apiKey) {
    throw new Error("API key not configured");
  }

  if (isGoogleProvider(config.baseUrl)) {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const modelName = config.model && config.model.includes("embedding") ? config.model : "text-embedding-004";
    const response = await ai.models.embedContent({
      model: modelName,
      contents: text,
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
}
