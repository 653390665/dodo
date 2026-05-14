import type { AppConfig } from "./config";

interface GenerateTextOptions {
  prompt: string;
  systemInstruction?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  maxTokens?: number;
}

const OPENAI_TIMEOUT_MS = 75_000;
const OPENAI_MAX_ATTEMPTS = 3;

function isGoogleProvider(baseUrl: string) {
  return !baseUrl || baseUrl.includes("generativelanguage.googleapis.com");
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function extractOpenAIText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

function sanitizeModelText(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
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
          const response = await ai.models.generateContent({
            model: config.model || "gemini-2.5-pro",
            contents: prompt,
            ...(systemInstruction ? { config: { systemInstruction } } : {}),
          });
          return sanitizeModelText(response.text || "");
        })();

        const result = await Promise.race([
          callPromise,
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error(`LLM request timed out after ${timeoutMs / 1000}s`)), timeoutMs),
          ),
        ]);
        return result;
      } catch (error) {
        lastError = error;

        const isTimeout = error instanceof Error && error.message.includes("timed out");
        if (attempt < maxAttempts && (isTimeout || isRetryableNetworkError(error))) {
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
            body: JSON.stringify({
              model: config.model,
              messages: [
                ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
                { role: "user", content: prompt }
              ],
              stream: false,
              ...(maxTokens ? { max_tokens: maxTokens } : {}),
            }),
            signal: controller.signal
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LLM request failed (${response.status}): ${errorText}`);
          }

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
      ) || isRetryableNetworkError(error);

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
