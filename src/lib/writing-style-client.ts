import type { WritingStyleCandidate, WritingStyleMode, WritingStyleResolution } from '../../shared/types';

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

async function requestWritingStyle(novelId: string, action: 'resolve' | 'confirm', payload: WritingStyleRequest): Promise<WritingStyleResponse> {
  const response = await fetch(`/api/novels/${encodeURIComponent(novelId)}/writing-style/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as WritingStyleResponse;
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
