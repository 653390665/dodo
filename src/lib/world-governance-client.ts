import { request, HttpApiError } from './http';

/**
 * Governance read for artifact candidates (character / world cores).
 * Keeps the labelled error copy the WorldBible UI relies on, including the
 * "invalid JSON body" case that a plain 2xx response can still produce.
 */
export async function fetchArtifactGovernance<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label}读取失败（${response.status}），请刷新后重试。`);
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`${label}响应无效，请刷新后重试。`);
  }
}

/** Accept/reject a stored artifact candidate (character or world core). */
export async function decideArtifactCandidate<TCore>(
  novelId: string,
  candidateId: string,
  action: 'accept' | 'reject',
  databaseGeneration: number
): Promise<{ error?: string; core?: { core: TCore; version: number } }> {
  return request(
    `/api/novels/${encodeURIComponent(novelId)}/artifacts/candidates/${encodeURIComponent(candidateId)}/${action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ databaseGeneration }),
    }
  );
}

/**
 * Ask the server whether a capability recommendation is already dismissed.
 * Non-2xx (e.g. stale generation) means "not dismissed", matching the UI's
 * tolerant check; network-level failures still propagate to the caller.
 */
export async function fetchCapabilityRecommendationDismissed(dismissal: unknown): Promise<boolean> {
  try {
    const body = await request<{ dismissed?: boolean }>(
      '/api/capability-recommendations/dismissed',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dismissal),
      }
    );
    return Boolean(body?.dismissed);
  } catch (error) {
    if (error instanceof HttpApiError) return false;
    throw error;
  }
}

/** Persist a capability recommendation dismissal (fixed UI-facing error copy). */
export async function dismissCapabilityRecommendation(dismissal: unknown): Promise<void> {
  try {
    await request<null>('/api/capability-recommendations/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dismissal),
    });
  } catch (error) {
    if (error instanceof HttpApiError) throw new Error('暂时无法忽略该推荐', { cause: error });
    throw error;
  }
}
