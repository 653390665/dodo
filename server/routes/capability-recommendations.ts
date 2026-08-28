import type { Express } from 'express';
import { z } from 'zod';
import { dismissCapabilityRecommendation, isCapabilityRecommendationDismissed } from '../lib/db/capability-recommendations.js';
import { getNovel } from '../lib/db/novels.js';
import { getDatabaseGeneration, runInSerializedWriteForGeneration } from '../lib/db-instance.js';
import { recommendationFingerprint } from '../../shared/lib/capability-recommendation.js';
import { listCatalogCapabilityManifests } from '../../shared/lib/capability-manifest-catalog.js';

const dismissalSchema = z.object({
  novelId: z.string().min(1), databaseGeneration: z.number().int().nonnegative(), fingerprint: z.string().min(1), issueFingerprint: z.string().min(1), artifactKind: z.enum(['world', 'character', 'master-outline', 'volume-outline', 'chapter-outline', 'scene-beats', 'narrative-promise']), operation: z.enum(['diagnose', 'generate', 'restructure', 'optimize', 'validate']), scope: z.enum(['project', 'volume', 'chapter', 'selection', 'single-run']), artifactVersion: z.union([z.string(), z.number()]), upstreamVersion: z.union([z.string(), z.number()]).optional(), capabilityId: z.string().min(1),
}).strict();

function canonicalFingerprint(input: z.infer<typeof dismissalSchema>): string {
  return recommendationFingerprint({
    issue: { fingerprint: input.issueFingerprint },
    artifactKind: input.artifactKind,
    operation: input.operation,
    scope: input.scope,
    artifactVersion: input.artifactVersion,
    upstreamVersion: input.upstreamVersion,
  });
}

export function registerCapabilityRecommendationRoutes(app: Express): void {
  app.post('/api/capability-recommendations/dismiss', async (req, res) => {
    const parsed = dismissalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: 'CAPABILITY_RECOMMENDATION_INVALID_INPUT', error: '推荐忽略参数无效' });
    const input = parsed.data;
    if (!getNovel(input.novelId)) return res.status(404).json({ code: 'NOVEL_NOT_FOUND', error: '作品不存在' });
    if (input.databaseGeneration !== getDatabaseGeneration()) return res.status(409).json({ code: 'CAPABILITY_RECOMMENDATION_GENERATION_STALE', error: '数据库已变化，请刷新后重试' });
    if (canonicalFingerprint(input) !== input.fingerprint) return res.status(400).json({ code: 'CAPABILITY_RECOMMENDATION_FINGERPRINT_MISMATCH', error: '推荐指纹不匹配' });
    if (!listCatalogCapabilityManifests().some((entry) => entry.id === input.capabilityId)) return res.status(400).json({ code: 'CAPABILITY_RECOMMENDATION_UNKNOWN_CAPABILITY', error: '推荐能力不存在' });
    const result = await runInSerializedWriteForGeneration(input.databaseGeneration, () => { dismissCapabilityRecommendation(input); });
    if (!result.executed) return res.status(409).json({ code: 'CAPABILITY_RECOMMENDATION_GENERATION_STALE', error: '数据库已变化，请刷新后重试' });
    return res.status(204).send();
  });
  app.post('/api/capability-recommendations/dismissed', (req, res) => {
    const parsed = dismissalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: 'CAPABILITY_RECOMMENDATION_INVALID_INPUT', error: '推荐忽略参数无效' });
    const input = parsed.data;
    if (!getNovel(input.novelId)) return res.status(404).json({ code: 'NOVEL_NOT_FOUND', error: '作品不存在' });
    if (input.databaseGeneration !== getDatabaseGeneration()) return res.status(409).json({ code: 'CAPABILITY_RECOMMENDATION_GENERATION_STALE', error: '数据库已变化，请刷新后重试' });
    if (canonicalFingerprint(input) !== input.fingerprint) return res.status(400).json({ code: 'CAPABILITY_RECOMMENDATION_FINGERPRINT_MISMATCH', error: '推荐指纹不匹配' });
    return res.json({ dismissed: isCapabilityRecommendationDismissed(input) });
  });
}
