export type LlmAvailabilityState = 'connected' | 'missing' | 'unknown';

export function deriveLlmAvailability(input: {
  hasApiKey?: boolean | null;
  livenessStatus?: 'connected' | 'unknown' | 'disconnected' | string;
}): LlmAvailabilityState {
  if (input.livenessStatus === 'unknown') return 'unknown';
  if (input.livenessStatus === 'disconnected') return 'missing';
  return input.hasApiKey ? 'connected' : 'missing';
}

export const LLM_AVAILABILITY_COPY = {
  connected: {
    label: '已连接',
    helper: 'AI 生成与审阅可用。',
  },
  missing: {
    label: '未配置',
    helper: '可继续本地写作、保存和整理设定；需要 AI 时请先配置 API Key。',
  },
  unknown: {
    label: '暂时无法确认',
    helper: '网络或配置检测暂时不可确认；可继续本地写作，稍后重试 AI。',
  },
} as const;
