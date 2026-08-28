import { createHash } from 'node:crypto';
import type { CreativeArtifactKind } from '../types/creative-artifacts.js';

export interface CreativeArtifactFingerprintInput {
  kind: CreativeArtifactKind;
  version: number;
  core?: unknown;
  content?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function fingerprintCreativeArtifact(input: CreativeArtifactFingerprintInput): string {
  const payload = canonicalize({
    kind: input.kind,
    version: input.version,
    core: input.core,
    content: input.content,
  });
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
