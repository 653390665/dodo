import type {
  WritingStyleCandidate,
  WritingStyleMode,
  WritingStyleResolution,
} from '../../shared/types';
import { recordProductEvent } from './product-events-client';
import { claimProductEventOnce } from './telemetry-once';

export interface WritingStyleResponse {
  resolution?: WritingStyleResolution;
  fingerprint?: string;
  candidates?: WritingStyleCandidate[];
  code?: string;
  error?: string;
  sessionCardId?: string;
}

export type { WritingStyleCandidate, WritingStyleMode, WritingStyleResolution };

export interface WritingStyleRequest {
  chapterId: string;
  databaseGeneration: number;
  continuationPackId?: string;
  sessionCardIds?: string[];
  mode?: WritingStyleMode;
}

export class StyleConfirmationRequiredError extends Error {
  readonly code = 'STYLE_CONFIRMATION_REQUIRED';
  readonly resolution?: WritingStyleResolution;
  readonly candidates?: WritingStyleCandidate[];

  constructor(data: WritingStyleResponse) {
    super('Writing style confirmation is required');
    this.name = 'StyleConfirmationRequiredError';
    this.resolution = data.resolution;
    this.candidates = data.candidates;
  }
}

export class WritingStyleRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly sessionCardId?: string;
  constructor(data: WritingStyleResponse, status: number) {
    super(typeof data.error === 'string' ? data.error : '写法解析失败');
    this.name = 'WritingStyleRequestError';
    this.code = data.code || 'WRITING_STYLE_RESOLUTION_FAILED';
    this.status = status;
    this.sessionCardId = data.sessionCardId;
  }
}

async function requestWritingStyle(
  novelId: string,
  action: 'resolve' | 'confirm',
  payload: WritingStyleRequest
): Promise<WritingStyleResponse> {
  const response = await fetch(
    `/api/novels/${encodeURIComponent(novelId)}/writing-style/${action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const data = (await response.json().catch(() => ({}))) as WritingStyleResponse;
  if (response.status === 409 && data.code === 'STYLE_CONFIRMATION_REQUIRED') {
    throw new StyleConfirmationRequiredError(data);
  }
  if (!response.ok) throw new WritingStyleRequestError(data, response.status);
  return data;
}

export function resolveWritingStyle(novelId: string, payload: WritingStyleRequest) {
  return requestWritingStyle(novelId, 'resolve', payload);
}

export function confirmWritingStyle(novelId: string, payload: WritingStyleRequest) {
  return requestWritingStyle(novelId, 'confirm', payload);
}

export interface EnsuredWritingStyle {
  fingerprint: string;
  /** true = 本次请求自动确认了推荐写法（用户没有手动确认过）。 */
  defaulted: boolean;
}

/**
 * Plan 271 W3 · 写法确认默认化：
 * 生成前若没有指纹，先 resolve 拿到推荐写法；若尚未确认（`resolution.confirmed === false`），
 * 就地用同一上下文 confirm（等价于作者点「确认推荐写法」），
 * 拆掉 `writing_style_required → 0 出稿` 的第一道墙。

 * 自动确认按 novel+chapter 去重，每个章节只上报一次 `writing_style_defaulted`。
 */
export async function ensureWritingStyleConfirmed(
  novelId: string,
  payload: WritingStyleRequest
): Promise<EnsuredWritingStyle> {
  const resolved = await resolveWritingStyle(novelId, payload);
  const fingerprint = resolved.fingerprint ?? resolved.resolution?.fingerprint;
  if (!fingerprint) {
    throw new WritingStyleRequestError(
      { ...resolved, error: resolved.error ?? '写法解析未返回指纹' },
      200
    );
  }
  if (resolved.resolution?.confirmed !== false) {
    return { fingerprint, defaulted: false };
  }

  const confirmed = await confirmWritingStyle(novelId, payload);
  const confirmedFingerprint =
    confirmed.fingerprint ?? confirmed.resolution?.fingerprint ?? fingerprint;
  if (claimProductEventOnce(`writing_style_defaulted:${novelId}:${payload.chapterId}`)) {
    void recordProductEvent({
      eventName: 'writing_style_defaulted',
      stage: 'drafting',
      result: 'success',
      novelId,
      chapterId: payload.chapterId,
      action: 'auto-confirm',
    }).catch(() => undefined);
  }
  return { fingerprint: confirmedFingerprint, defaulted: true };
}
