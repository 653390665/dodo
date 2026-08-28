import type {
  LegacyArtifactPreview,
  LegacyArtifactSource,
  LegacyStructurableKind,
} from '../../shared/types/legacy-artifact-structuring';

export class LegacyArtifactStructuringError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LegacyArtifactStructuringError';
  }
}

async function readPayload<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { code?: string; error?: string };
  if (!response.ok) {
    throw new LegacyArtifactStructuringError(
      payload.code || `HTTP_${response.status}`,
      response.status,
      payload.error || '旧产物整理失败',
    );
  }
  return payload;
}

export async function discoverLegacyArtifacts(novelId: string): Promise<{
  sources: LegacyArtifactSource[];
  databaseGeneration: number;
}> {
  return readPayload(await fetch(`/api/novels/${encodeURIComponent(novelId)}/legacy-artifacts`));
}

export async function previewLegacyArtifact(input: {
  novelId: string;
  artifactKind: LegacyStructurableKind;
  artifactId: string;
  databaseGeneration: number;
}): Promise<{ preview: LegacyArtifactPreview; databaseGeneration: number }> {
  const response = await fetch(`/api/novels/${encodeURIComponent(input.novelId)}/legacy-artifacts/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      artifactKind: input.artifactKind,
      artifactId: input.artifactId,
      databaseGeneration: input.databaseGeneration,
    }),
  });
  return readPayload(response);
}

export async function confirmLegacyArtifact(input: {
  novelId: string;
  previewId: string;
  databaseGeneration: number;
}): Promise<{ status: 'accepted'; version?: number; patchId?: string }> {
  const response = await fetch(`/api/novels/${encodeURIComponent(input.novelId)}/legacy-artifacts/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewId: input.previewId, databaseGeneration: input.databaseGeneration }),
  });
  return readPayload(response);
}
