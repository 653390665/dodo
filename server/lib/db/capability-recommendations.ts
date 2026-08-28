import { getDb } from '../db-instance.js';
import type { CapabilityRecommendationDismissal } from '../../../shared/types/capability-recommendation.js';

export function ensureCapabilityRecommendationSchema(): void {
  getDb().exec(`CREATE TABLE IF NOT EXISTS capability_recommendation_dismissals (
    novel_id TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL, issue_fingerprint TEXT NOT NULL, artifact_version TEXT NOT NULL,
    upstream_version TEXT NOT NULL DEFAULT '', capability_id TEXT NOT NULL, dismissed_at INTEGER NOT NULL,
    PRIMARY KEY (novel_id, fingerprint, capability_id)
  );`);
}

export function dismissCapabilityRecommendation(input: CapabilityRecommendationDismissal): void {
  if (!input.novelId || !Number.isInteger(input.databaseGeneration)) throw new Error('CAPABILITY_RECOMMENDATION_OWNERSHIP_REQUIRED');
  ensureCapabilityRecommendationSchema();
  getDb().prepare(`INSERT OR REPLACE INTO capability_recommendation_dismissals
    (novel_id, fingerprint, issue_fingerprint, artifact_version, upstream_version, capability_id, dismissed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(input.novelId, input.fingerprint, input.issueFingerprint, String(input.artifactVersion), String(input.upstreamVersion ?? ''), input.capabilityId, Date.now());
}

export function isCapabilityRecommendationDismissed(input: CapabilityRecommendationDismissal): boolean {
  if (!input.novelId || !Number.isInteger(input.databaseGeneration)) return false;
  ensureCapabilityRecommendationSchema();
  const row = getDb().prepare(`SELECT 1 AS found FROM capability_recommendation_dismissals
    WHERE novel_id = ? AND fingerprint = ? AND issue_fingerprint = ? AND artifact_version = ? AND upstream_version = ? AND capability_id = ?`)
    .get(input.novelId, input.fingerprint, input.issueFingerprint, String(input.artifactVersion), String(input.upstreamVersion ?? ''), input.capabilityId) as { found?: number } | undefined;
  return row?.found === 1;
}
