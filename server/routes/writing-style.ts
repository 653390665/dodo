import type { Express, Request, Response } from 'express';
import { validate, writingStyleConfirmSchema, writingStyleResolveSchema, capabilityConfigurationPreviewSchema, capabilityConfigurationApplySchema } from '../validation.js';
import * as db from '../lib/db.js';
import { resolveWritingStyleRequest, WritingStyleRequestError, validateCapabilityProfile } from '../helpers/writing-style-service.js';
import { getDatabaseGeneration, runInSerializedWriteForGeneration, runInTransaction } from '../lib/db-instance.js';
import { randomUUID } from 'node:crypto';
import { normalizeProjectPreferenceProfile } from '../../shared/lib/project-preference-profile.js';
import type { ProjectCapabilityProfile } from '../../shared/types/preferences.js';
import type { CapabilityApplicationItemResult, CapabilityPackageStep } from '../../shared/types/capability-execution.js';
import { capabilityManifestFor } from '../capabilities/manifest.js';

const configurationPreviews = new Map<string, { novelId: string; generation: number; profile: ProjectCapabilityProfile; expiresAt: number; claimed?: boolean }>();
const PREVIEW_TTL = 10 * 60 * 1000;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function normalizeCapabilityProfile(value: unknown): ProjectCapabilityProfile {
  const normalized = normalizeProjectPreferenceProfile({
    capabilityModelVersion: 3,
    capabilityProfile: value,
  }).capabilityProfile;
  if (!normalized) throw new Error('Capability profile normalization failed');
  return copy(normalized);
}

async function handle(req: Request, res: Response, confirm: boolean) {
  try {
    const resolveAndConfirm = () => {
      const result = resolveWritingStyleRequest(req.params.novelId, req.body);
      if (confirm) {
        const profile = normalizeProjectPreferenceProfile(result.novel.projectPreferenceProfile);
        db.updateNovel(req.params.novelId, { projectPreferenceProfile: {
          ...profile,
          writingStyleConfirmation: {
            mode: result.resolution.mode,
            fingerprint: result.resolution.fingerprint,
            confirmedAt: Date.now(),
          },
        } });
      }
      return result;
    };
    const guarded = confirm
      ? await runInSerializedWriteForGeneration(req.body.databaseGeneration, resolveAndConfirm)
      : { executed: true as const, result: resolveAndConfirm() };
    if (!guarded.executed) {
      return res.status(409).json({ code: 'DATABASE_GENERATION_MISMATCH', error: '数据库已变化，请刷新后重试' });
    }
    const result = guarded.result;
    const resolution = { ...result.resolution };
    if (confirm) {
      resolution.confirmed = true;
    }
    return res.json({ resolution, candidates: result.candidates });
  } catch (error) {
    if (error instanceof WritingStyleRequestError) {
      return res.status(error.status).json({ error: error.message, code: error.code, ...(error.sessionCardId ? { sessionCardId: error.sessionCardId } : {}) });
    }
    return res.status(500).json({ error: '写法解析失败', code: 'WRITING_STYLE_RESOLUTION_FAILED' });
  }
}

export function registerWritingStyleRoutes(app: Express): void {
  app.post('/api/novels/:novelId/capabilities/configuration/preview', validate(capabilityConfigurationPreviewSchema), (req, res) => {
    const novel = db.getNovel(req.params.novelId);
    if (!novel) return res.status(404).json({ code: 'NOVEL_NOT_FOUND', error: '作品不存在' });
    if (req.body.databaseGeneration !== getDatabaseGeneration()) return res.status(409).json({ code: 'DATABASE_GENERATION_MISMATCH', error: '数据库已变化，请刷新后重试' });
    try {
      const profile = normalizeCapabilityProfile(req.body.capabilityProfile);
      validateCapabilityProfile(req.params.novelId, profile);
      const previewToken = randomUUID();
      configurationPreviews.set(previewToken, { novelId: req.params.novelId, generation: req.body.databaseGeneration, profile, expiresAt: Date.now() + PREVIEW_TTL });
      return res.json({ previewToken, databaseGeneration: req.body.databaseGeneration, profile, warnings: [], conflicts: [] });
    } catch (error) {
      if (error instanceof WritingStyleRequestError) return res.status(400).json({ code: error.code, error: error.message });
      return res.status(400).json({ code: 'CAPABILITY_PROFILE_INVALID', error: '能力配置无效' });
    }
  });
  app.post('/api/novels/:novelId/capabilities/configuration/apply', validate(capabilityConfigurationApplySchema), async (req, res) => {
    const novel = db.getNovel(req.params.novelId);
    if (!novel) return res.status(404).json({ code: 'NOVEL_NOT_FOUND', error: '作品不存在' });
    const preview = configurationPreviews.get(req.body.previewToken);
    if (!preview || preview.expiresAt < Date.now() || preview.novelId !== req.params.novelId || preview.generation !== req.body.databaseGeneration || req.body.databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ code: 'CAPABILITY_CONFIGURATION_STALE', error: '能力配置预览已过期，请重新预览' });
    }
    if (preview.claimed) {
      return res.status(409).json({ code: 'CAPABILITY_CONFIGURATION_APPLY_IN_PROGRESS', error: '能力配置正在应用，请勿重复提交' });
    }
    preview.claimed = true;
    let consumed = false;
    try {
      const requestedProfile = normalizeCapabilityProfile(req.body.capabilityProfile);
      const packageSteps = req.body.packageSteps || [];
      const stepIds = new Set<string>();
      for (const step of packageSteps) {
        if (stepIds.has(step.stepId)) return res.status(400).json({ code: 'CAPABILITY_PACKAGE_STEP_DUPLICATE', error: '能力包步骤重复' });
        stepIds.add(step.stepId);
      }
      for (const step of packageSteps) {
        if ((step.dependsOn || []).some((dependencyId: string) => !stepIds.has(dependencyId))) {
          return res.status(400).json({ code: 'CAPABILITY_PACKAGE_DEPENDENCY_MISSING', error: '能力包前置组件未选择' });
        }
      }
      if (JSON.stringify(preview.profile) !== JSON.stringify(requestedProfile)) return res.status(409).json({ code: 'CAPABILITY_CONFIGURATION_CHANGED', error: '能力配置已变化，请重新预览' });
      validateCapabilityProfile(req.params.novelId, requestedProfile);
      const guarded = await runInSerializedWriteForGeneration(req.body.databaseGeneration, () => {
        return runInTransaction(() => {
          const current = db.getNovel(req.params.novelId);
          if (!current) throw new WritingStyleRequestError(404, 'NOVEL_NOT_FOUND', '作品不存在');
          const scheduledTechniques = packageSteps.filter((step: CapabilityPackageStep) => step.mode === 'schedule' && step.scope === 'chapter');
          const validScheduledTechniques = scheduledTechniques.map((step: CapabilityPackageStep) => {
            const manifest = capabilityManifestFor(step.assetId);
            if (!manifest || manifest.kind !== 'technique' || manifest.runtimeStatus !== 'active' || !manifest.allowedScopes.includes('chapter')) {
              throw new WritingStyleRequestError(400, 'CAPABILITY_MANIFEST_INVALID', '能力包步骤不是可安排的章节技法');
            }
            return { step, manifest };
          });
          const targetChapter = req.body.targetChapterId ? db.getChapter(req.body.targetChapterId) : undefined;
          if (req.body.targetChapterId && (!targetChapter || targetChapter.novelId !== req.params.novelId)) {
            throw new WritingStyleRequestError(400, 'CAPABILITY_TARGET_CHAPTER_INVALID', '目标章节不属于当前作品');
          }
          if (targetChapter && validScheduledTechniques.length > 0) {
            const existing = targetChapter.workflowMeta?.capabilityState;
            const techniqueIds = [...new Set([...(existing?.techniqueIds || []), ...validScheduledTechniques.map(({ step }: { step: CapabilityPackageStep }) => step.assetId)])];
            const techniqueVersions = { ...(existing?.techniqueVersions || {}) };
            for (const { step, manifest } of validScheduledTechniques) techniqueVersions[step.assetId] = manifest.version;
            db.updateChapter(targetChapter.id, {
              workflowMeta: {
                ...(targetChapter.workflowMeta || { version: 1 as const }),
                capabilityState: {
                  ...(existing || { techniqueIds: [], overlayCardIds: [] }),
                  novelId: req.params.novelId,
                  databaseGeneration: req.body.databaseGeneration,
                  techniqueIds,
                  techniqueVersions,
                  overlayCardIds: existing?.overlayCardIds || [],
                  ...(existing?.overlayVersions ? { overlayVersions: existing.overlayVersions } : {}),
                  updatedAt: Date.now(),
                },
              },
            });
          }
          const currentProfile = normalizeProjectPreferenceProfile(current.projectPreferenceProfile);
          db.updateNovel(req.params.novelId, { projectPreferenceProfile: { ...currentProfile, capabilityModelVersion: 3, capabilityProfile: requestedProfile } });
          return targetChapter ? new Set(validScheduledTechniques.map(({ step }: { step: CapabilityPackageStep }) => step.stepId)) : new Set<string>();
        });
      });
      if (!guarded.executed) return res.status(409).json({ code: 'DATABASE_GENERATION_MISMATCH', error: '数据库已变化，请刷新后重试' });
      configurationPreviews.delete(req.body.previewToken);
      consumed = true;
      const scheduledStepIds = guarded.result;
      const items: CapabilityApplicationItemResult[] = (req.body.packageSteps || []).map((step: CapabilityPackageStep) => ({
        capabilityId: step.assetId,
        stepId: step.stepId,
        status: step.mode === 'configure' ? 'configured' : scheduledStepIds.has(step.stepId) ? 'scheduled' : step.mode === 'schedule' && step.scope === 'chapter' ? 'skipped' : 'recommended',
        ...(step.mode === 'configure' || (step.mode === 'schedule' && step.scope === 'chapter') ? {} : { reason: '当前版本不会自动安排或运行该能力，请在写作流程中手动触发。' }),
      }));
      return res.json({ applied: true, idempotent: false, databaseGeneration: req.body.databaseGeneration, profile: copy(requestedProfile), items });
    } catch (error) {
      if (error instanceof WritingStyleRequestError) return res.status(error.status === 404 ? 404 : 400).json({ code: error.code, error: error.message });
      return res.status(400).json({ code: 'CAPABILITY_PROFILE_INVALID', error: '能力配置无效' });
    } finally {
      if (!consumed && configurationPreviews.get(req.body.previewToken) === preview) preview.claimed = false;
    }
  });
  app.post('/api/novels/:novelId/writing-style/resolve', validate(writingStyleResolveSchema), (req, res) => handle(req, res, false));
  app.post('/api/novels/:novelId/writing-style/confirm', validate(writingStyleConfirmSchema), (req, res) => handle(req, res, true));
}
