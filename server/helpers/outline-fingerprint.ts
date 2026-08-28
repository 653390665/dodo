import { createHash } from 'node:crypto';
import type {
  OutlineArtifact,
  OutlineArtifactScope,
} from '../../shared/types/outline-governance.js';

function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
}

function stable(value: unknown): unknown {
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])])
    );
  return value;
}

export function stableOutlineScope(scope: OutlineArtifactScope): string {
  return JSON.stringify(stable(scope));
}

export function outlineMasterBaseFingerprint(
  novelId: string,
  worldRules: string,
  master: Pick<OutlineArtifact, 'id' | 'level' | 'scope' | 'content' | 'core'>,
): string {
  const payload = JSON.stringify(
    stable({
      version: 'outline-master-base-v1',
      novelId,
      worldRules,
      master: {
        id: master.id,
        level: master.level,
        scope: master.scope,
        content: master.content,
        ...(master.core ? { core: master.core } : {}),
      },
    })
  );
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export interface CanonFingerprintArtifact {
  id: string;
  level: string;
  scope: OutlineArtifactScope;
  content: string;
  core?: OutlineArtifact['core'];
}

/** Stable fingerprint of the complete active outline canon. */
export function outlineCanonFingerprint(
  novelId: string,
  worldRules: string,
  artifacts: readonly CanonFingerprintArtifact[],
): string {
  const payload = JSON.stringify(stable({
    version: 'outline-canon-v1',
    novelId,
    worldRules,
    artifacts: [...artifacts]
      .map((artifact) => ({
        id: artifact.id,
        level: artifact.level,
        scope: artifact.scope,
        content: artifact.content,
        ...(artifact.core ? { core: artifact.core } : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }));
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
