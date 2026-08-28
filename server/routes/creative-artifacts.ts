import type { Express, Response } from 'express';
import { z } from 'zod';
import {
  acceptArtifactCandidate,
  ArtifactCandidateError,
  previewArtifactCandidate,
  rejectArtifactCandidate,
} from '../helpers/creative-artifact-candidates.js';
import { getArtifactCandidate, listArtifactCandidates, listArtifactCores } from '../lib/db/creative-artifacts.js';
import { getDatabaseGeneration, runInSerializedWriteForGeneration } from '../lib/db-instance.js';

const id = z.string().min(1).max(200);
const capabilityVersion = z.object({ capabilityId: id, version: id }).strict();
const artifactRef = z.object({
  kind: z.enum(['world', 'character']),
  id,
  version: z.number().int().nonnegative(),
}).strict();
const reviewRef = z.object({
  kind: z.enum(['world', 'character', 'master-outline', 'volume-outline', 'chapter-outline', 'scene-beats', 'narrative-promise']),
  id,
  version: z.number().int().positive(),
}).strict();
const impactReport = z.object({
  downstream: z.array(reviewRef).max(100),
  reviewRequired: z.array(reviewRef).max(100),
  affectedEntities: z.array(z.object({
    kind: z.enum(['relationship', 'narrative-promise']),
    id,
    reviewRequired: z.boolean(),
  }).strict()).max(500).optional(),
  manuscriptConflict: z.boolean(),
  reasons: z.array(z.string().max(1_000)).max(100),
}).strict();
const previewSchema = z.object({
  target: artifactRef,
  operation: z.enum(['diagnose', 'generate', 'restructure', 'optimize', 'validate']),
  goal: z.string().max(10_000),
  baseFingerprint: z.string().min(1).max(200),
  sourceCapabilityVersions: z.array(capabilityVersion).max(100),
  proposedCore: z.record(z.string(), z.unknown()),
  proposedContent: z.string().max(1_000_000).optional(),
  impactReport,
  databaseGeneration: z.number().int().nonnegative(),
}).strict();
const actionSchema = z.object({ databaseGeneration: z.number().int().nonnegative() }).strict();

function invalid(res: Response) {
  return res.status(400).json({ code: 'ARTIFACT_CANDIDATE_INVALID_INPUT', error: '候选请求参数无效，请检查后重试。' });
}

function fail(res: Response, error: unknown) {
  if (error instanceof ArtifactCandidateError) {
    const status = error.code.endsWith('NOT_FOUND')
      ? 404
      : error.code.includes('STALE') || error.code.endsWith('REJECTED') || error.code.endsWith('TERMINAL')
        ? 409
        : error.code.includes('INVALID') || error.code.includes('UNSUPPORTED')
          ? 400
          : 409;
    return res.status(status).json({ code: error.code, error: error.message });
  }
  return res.status(500).json({ code: 'ARTIFACT_CANDIDATE_INTERNAL_ERROR', error: '候选请求处理失败，请稍后重试。' });
}

export function registerCreativeArtifactRoutes(app: Express): void {
  app.get('/api/novels/:novelId/artifacts', (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const kind = z.enum(['world', 'character']).safeParse(req.query.kind);
    const status = z.enum(['pending', 'accepted', 'rejected', 'stale']).optional().safeParse(req.query.status);
    if (!novelId.success || !kind.success || !status.success) return invalid(res);
    try {
      return res.json({
        cores: listArtifactCores(novelId.data, kind.data),
        candidates: listArtifactCandidates(novelId.data, { artifactKind: kind.data, status: status.data }),
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  app.post('/api/novels/:novelId/artifacts/candidates/preview', async (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const body = previewSchema.safeParse(req.body);
    if (!novelId.success || !body.success) return invalid(res);
    if (body.data.databaseGeneration !== getDatabaseGeneration()) {
      return res.status(409).json({ code: 'ARTIFACT_CANDIDATE_GENERATION_STALE', error: '数据库已变化，请刷新候选后重试。' });
    }
    try {
      const { databaseGeneration, ...input } = body.data;
      const guarded = await runInSerializedWriteForGeneration(databaseGeneration, () => previewArtifactCandidate({ ...input, novelId: novelId.data }));
      if (!guarded.executed) {
        return res.status(409).json({ code: 'ARTIFACT_CANDIDATE_GENERATION_STALE', error: '数据库已变化，请刷新候选后重试。' });
      }
      return res.status(201).json(guarded.result);
    } catch (error) {
      return fail(res, error);
    }
  });

  app.get('/api/novels/:novelId/artifacts/candidates/:candidateId', (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const candidateId = id.safeParse(req.params.candidateId);
    if (!novelId.success || !candidateId.success) return invalid(res);
    try {
      const candidate = getArtifactCandidate(novelId.data, candidateId.data);
      return candidate
        ? res.json(candidate)
        : res.status(404).json({ code: 'ARTIFACT_CANDIDATE_NOT_FOUND', error: '候选不存在或不属于当前作品。' });
    } catch (error) {
      return fail(res, error);
    }
  });

  app.post('/api/novels/:novelId/artifacts/candidates/:candidateId/accept', async (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const candidateId = id.safeParse(req.params.candidateId);
    const body = actionSchema.safeParse(req.body);
    if (!novelId.success || !candidateId.success || !body.success) return invalid(res);
    try {
      const result = await acceptArtifactCandidate({
        novelId: novelId.data, candidateId: candidateId.data, databaseGeneration: body.data.databaseGeneration,
      });
      return res.json(result);
    } catch (error) {
      return fail(res, error);
    }
  });

  app.post('/api/novels/:novelId/artifacts/candidates/:candidateId/reject', async (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const candidateId = id.safeParse(req.params.candidateId);
    const body = actionSchema.safeParse(req.body);
    if (!novelId.success || !candidateId.success || !body.success) return invalid(res);
    try {
      const guarded = await runInSerializedWriteForGeneration(
        body.data.databaseGeneration,
        () => rejectArtifactCandidate(novelId.data, candidateId.data),
      );
      if (!guarded.executed) {
        return res.status(409).json({ code: 'ARTIFACT_CANDIDATE_GENERATION_STALE', error: '数据库已变化，请刷新候选后重试。' });
      }
      return res.json(guarded.result);
    } catch (error) {
      return fail(res, error);
    }
  });
}
