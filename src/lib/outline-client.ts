import type { CanonPatch, OutlineArtifact, OutlineArtifactLevel, OutlineArtifactScope, OutlineArtifactSource, OutlineArtifactStatus, CanonPatchOperation } from '../../shared/types/outline-governance';
import type { CreativeArtifactRef } from '../../shared/types/creative-artifacts';
export { getDatabaseGenerationSnapshot } from './db-transport';

export class OutlineClientError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = 'OutlineClientError';
  }
}

type Listener = (event: { type: 'outline-governance-change'; novelId: string }) => void;
const listeners = new Set<Listener>();
export function subscribeToOutlineGovernanceChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit(novelId: string) {
  listeners.forEach((listener) => listener({ type: 'outline-governance-change', novelId }));
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as T & { code?: string; error?: string };
  if (!response.ok) throw new OutlineClientError(payload.code || 'OUTLINE_REQUEST_FAILED', response.status, payload.error || `Request failed with status ${response.status}`);
  return payload as T;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function listOutlines(novelId: string, filters: { level?: OutlineArtifactLevel; status?: OutlineArtifactStatus } = {}, databaseGeneration?: number) {
  const params = new URLSearchParams();
  if (filters.level) params.set('level', filters.level);
  if (filters.status) params.set('status', filters.status);
  if (databaseGeneration !== undefined) params.set('generation', String(databaseGeneration));
  const suffix = params.toString() ? `?${params}` : '';
  return request<OutlineArtifact[]>(`/api/novels/${encodeURIComponent(novelId)}/outlines${suffix}`);
}
export async function createOutline(novelId: string, input: { level: OutlineArtifactLevel; scope: OutlineArtifactScope; content: string; source?: 'user' | 'continuation-pack' | 'ai-proposal'; databaseGeneration: number }) {
  const result = await request<OutlineArtifact>(`/api/novels/${encodeURIComponent(novelId)}/outlines`, json(input));
  emit(novelId); return result;
}
export async function activateOutline(novelId: string, outlineId: string, databaseGeneration: number) {
  const result = await request<{ archivedIds: string[]; demotedIds: string[] }>(`/api/novels/${encodeURIComponent(novelId)}/outlines/${encodeURIComponent(outlineId)}/activate`, json({ databaseGeneration }));
  emit(novelId); return result;
}
export async function archiveOutline(novelId: string, outlineId: string, databaseGeneration: number) {
  const result = await request<{ archived: boolean }>(`/api/novels/${encodeURIComponent(novelId)}/outlines/${encodeURIComponent(outlineId)}/archive`, json({ databaseGeneration }));
  emit(novelId); return result;
}
export function listCanonPatches(novelId: string) {
  return request<CanonPatch[]>(`/api/novels/${encodeURIComponent(novelId)}/canon-patches`);
}
export interface CanonPatchActionResult { status: CanonPatch['status']; fingerprint?: string; artifacts?: string[]; acceptedOutlineRefs?: CreativeArtifactRef[]; code?: string; }
export async function acceptCanonPatch(novelId: string, patchId: string, databaseGeneration: number) {
  const result = await request<CanonPatchActionResult>(`/api/novels/${encodeURIComponent(novelId)}/canon-patches/${encodeURIComponent(patchId)}/accept`, json({ databaseGeneration }));
  emit(novelId); return result;
}
export async function rejectCanonPatch(novelId: string, patchId: string, databaseGeneration: number) {
  const result = await request<CanonPatchActionResult>(`/api/novels/${encodeURIComponent(novelId)}/canon-patches/${encodeURIComponent(patchId)}/reject`, json({ databaseGeneration }));
  emit(novelId); return result;
}
// Compatibility names used by governance views.
export const listOutlineArtifacts = listOutlines;
export const subscribeOutlineGovernanceChanges = subscribeToOutlineGovernanceChanges;
export async function createOutlineArtifact(novelId: string, input: { level: OutlineArtifactLevel; scope: OutlineArtifactScope; content: string }, options: { source?: OutlineArtifactSource; databaseGeneration: number }) {
  return createOutline(novelId, { ...input, ...(options.source ? { source: options.source } : {}), databaseGeneration: options.databaseGeneration });
}
export async function activateOutlineArtifact(novelId: string, outlineId: string, databaseGeneration: number) {
  await activateOutline(novelId, outlineId, databaseGeneration);
  const artifacts = await listOutlines(novelId, {}, databaseGeneration);
  return artifacts.find((artifact) => artifact.id === outlineId);
}
export const archiveOutlineArtifact = archiveOutline;
export type { CanonPatch, CanonPatchOperation, OutlineArtifact, OutlineArtifactLevel, OutlineArtifactScope, OutlineArtifactStatus };
