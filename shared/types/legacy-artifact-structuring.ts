import type { CreativeArtifactKind } from './creative-artifacts.js';

export type LegacyStructurableKind = CreativeArtifactKind;

export interface LegacyArtifactSource {
  novelId: string;
  artifactKind: LegacyStructurableKind;
  artifactId: string;
  label: string;
  originalContent: string;
  artifactVersion: number;
  sourceFingerprint: string;
}

export interface LegacyArtifactPreview {
  previewId: string;
  source: LegacyArtifactSource;
  proposedCore: Record<string, unknown>;
  proposedContent?: string;
  expiresAt: number;
}
