import type { Express, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { validate } from '../validation.js';
import { getNovel, updateNovel } from '../lib/db/novels.js';
import { getDatabaseGeneration, runInSerializedWriteForGeneration } from '../lib/db-instance.js';
import { buildCapabilityMigrationPreview, mergeMigratedProfile, migrationProfileFingerprint, migrationProjectProfileFingerprint } from '../capabilities/migration.js';
import { validateCapabilityProfile } from '../helpers/writing-style-service.js';
import { listSkills } from '../lib/db/skills.js';
import type { ProjectCapabilityProfile, ProjectPreferenceProfile } from '../../shared/types.js';
import { z } from 'zod';

const requestSchema = z.object({ databaseGeneration: z.number().int().nonnegative() });
const applySchema = requestSchema.extend({ previewToken: z.string().min(1) });
const PREVIEW_TTL = 10 * 60 * 1000;
const previews = new Map<string, { novelId: string; generation: number; capabilityProfile: ProjectCapabilityProfile; projectProfileFingerprint: string; expiresAt: number }>();
const applied = new Map<string, { novelId: string; generation: number; profile: unknown }>();

function stale(res: Response, message = '迁移预览已过期，请重新预览') { return res.status(409).json({ code: 'CAPABILITY_MIGRATION_STALE', error: message }); }

export function registerCapabilityMigrationRoutes(app: Express): void {
  app.post('/api/novels/:novelId/capabilities/migration/preview', validate(requestSchema), (req, res) => {
    const novel = getNovel(req.params.novelId);
    if (!novel) return res.status(404).json({ code: 'NOVEL_NOT_FOUND', error: '作品不存在' });
    if (req.body.databaseGeneration !== getDatabaseGeneration()) return stale(res, '数据库已变化，请刷新后重试');
    const preview = buildCapabilityMigrationPreview(novel, listSkills());
    const previewToken = randomUUID();
    const expiresAt = Date.now() + PREVIEW_TTL;
    previews.set(previewToken, {
      novelId: novel.id,
      generation: req.body.databaseGeneration,
      capabilityProfile: preview.capabilityProfile,
      projectProfileFingerprint: migrationProjectProfileFingerprint(novel.projectPreferenceProfile),
      expiresAt,
    });
    return res.json({ ...preview, previewToken, databaseGeneration: req.body.databaseGeneration, expiresAt });
  });

  app.post(['/api/novels/:novelId/capabilities/migration/apply', '/api/novels/:novelId/capabilities/migration/confirm'], validate(applySchema), async (req, res) => {
    if (req.body.databaseGeneration !== getDatabaseGeneration()) return stale(res, '数据库已变化，请刷新后重试');
    const previous = applied.get(req.body.previewToken);
    if (previous && previous.novelId === req.params.novelId && previous.generation === req.body.databaseGeneration) return res.json({ applied: true, idempotent: true, databaseGeneration: previous.generation, profile: previous.profile });
    const preview = previews.get(req.body.previewToken);
    if (!preview || preview.novelId !== req.params.novelId || preview.generation !== req.body.databaseGeneration || preview.expiresAt < Date.now()) return stale(res);
    const currentBefore = getNovel(req.params.novelId);
    if (!currentBefore) return res.status(404).json({ code: 'NOVEL_NOT_FOUND', error: '作品不存在' });
    if (migrationProjectProfileFingerprint(currentBefore.projectPreferenceProfile) !== preview.projectProfileFingerprint) {
      return stale(res, '项目配置已变化，请重新预览迁移');
    }
    const currentReceipt = (currentBefore.projectPreferenceProfile as Record<string, unknown> | undefined)?.migrationReceipt as { token?: string; generation?: number } | undefined;
    if (currentReceipt?.token === req.body.previewToken && currentReceipt?.generation === req.body.databaseGeneration) return res.json({ applied: true, idempotent: true, databaseGeneration: req.body.databaseGeneration, profile: currentBefore.projectPreferenceProfile });
    const guarded = await runInSerializedWriteForGeneration(req.body.databaseGeneration, () => {
      const novel = getNovel(req.params.novelId);
      if (!novel) return undefined;
      if (migrationProjectProfileFingerprint(novel.projectPreferenceProfile) !== preview.projectProfileFingerprint) return 'STALE_CANDIDATE' as const;
      if (novel.projectPreferenceProfile?.capabilityModelVersion === 3) return novel.projectPreferenceProfile;
      const recomputed = buildCapabilityMigrationPreview(novel, listSkills());
      validateCapabilityProfile(novel.id, recomputed.capabilityProfile);
      if (migrationProfileFingerprint(recomputed.capabilityProfile) !== migrationProfileFingerprint(preview.capabilityProfile)) return 'STALE_CANDIDATE' as const;
      const migrated = mergeMigratedProfile(novel.projectPreferenceProfile, preview.capabilityProfile) as Record<string, unknown>;
      validateCapabilityProfile(novel.id, migrated.capabilityProfile);
      migrated.migrationReceipt = { token: req.body.previewToken, generation: req.body.databaseGeneration };
      updateNovel(req.params.novelId, { projectPreferenceProfile: migrated as unknown as ProjectPreferenceProfile });
      return getNovel(req.params.novelId)?.projectPreferenceProfile;
    });
    if (!guarded.executed) return stale(res, '数据库已变化，请刷新后重试');
    if (guarded.result === 'STALE_CANDIDATE') return stale(res, '迁移候选已变化，请重新预览');
    if (!guarded.result) return res.status(404).json({ code: 'NOVEL_NOT_FOUND', error: '作品不存在' });
    applied.set(req.body.previewToken, { novelId: req.params.novelId, generation: req.body.databaseGeneration, profile: guarded.result });
    previews.delete(req.body.previewToken);
    return res.json({ applied: true, databaseGeneration: req.body.databaseGeneration, profile: guarded.result });
  });
}
