import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getConfig, type AppConfig } from '../server/lib/config';
import { generateText, ProviderError } from '../server/lib/server-llm';
import { validateDraftQuality } from '../shared/lib/draft-quality';

export type ProviderSmokeErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'empty_response'
  | 'provider_error'
  | 'request_failed';

interface ProviderQualitySmokeDependencies {
  getConfig?: () => AppConfig;
  generateText?: typeof generateText;
  out?: (message: string) => void;
  now?: () => number;
}

export function classifyProviderSmokeError(error: unknown): ProviderSmokeErrorCode {
  if (error instanceof ProviderError) {
    if (error.code === 'timeout') return 'timeout';
    if (error.code === 'rate_limit') return 'rate_limited';
    if (error.code === 'empty_response') return 'empty_response';
    return 'provider_error';
  }
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/timeout|timed out|超时/.test(message)) return 'timeout';
  if (/rate.?limit|429|限流/.test(message)) return 'rate_limited';
  if (/empty|no content|空结果/.test(message)) return 'empty_response';
  return error instanceof Error ? 'request_failed' : 'provider_error';
}

export async function runProviderQualitySmoke(
  dependencies: ProviderQualitySmokeDependencies = {},
): Promise<number> {
  const config = (dependencies.getConfig || getConfig)();
  const emit = dependencies.out || ((message: string) => process.stdout.write(`${message}\n`));
  const now = dependencies.now || Date.now;

  if (!config.apiKey) {
    emit('SKIP: provider credentials not configured');
    return 0;
  }

  const startedAt = now();
  try {
    const text = await (dependencies.generateText || generateText)(config, {
      prompt: '请只输出一小段中文小说正文：雨夜里，主角发现门缝下多出一枚不属于自己的铜钥匙。不要解释，不要标题，不要问答，不要使用 Markdown。',
      systemInstruction: '你是中文小说作者，只输出纯正文。',
      timeoutMs: 30_000,
      maxAttempts: 1,
      maxTokens: 800,
    });
    if (!text.trim()) {
      emit('FAIL: provider smoke (empty_response)');
      return 1;
    }
    const quality = validateDraftQuality(text);
    if (!quality.ok) {
      const codes = quality.findings
        .filter((finding) => finding.severity === 'P0' || finding.severity === 'P1')
        .map((finding) => finding.code);
      emit(`FAIL: provider output rejected (${codes.join(',') || 'quality_rejected'})`);
      return 1;
    }
    emit(`PASS: provider prose quality (${text.replace(/\s/g, '').length} chars, ${now() - startedAt}ms, model=configured)`);
    return 0;
  } catch (error) {
    emit(`FAIL: provider smoke (${classifyProviderSmokeError(error)})`);
    return 1;
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isMain) {
  runProviderQualitySmoke()
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch(() => { process.exitCode = 1; });
}
