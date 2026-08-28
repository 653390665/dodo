import type { Express } from 'express';
import { z } from 'zod';
import * as db from '../lib/db.js';
import { getDatabaseGeneration, runInSerializedWriteForGeneration } from '../lib/db-instance.js';

const id = z.string().min(1).max(200);
const capabilityVersion = z.object({ capabilityId: id, version: id }).strict();
const scope = z
  .object({
    volumeName: z.string().max(200).optional(),
    chapterStart: z.number().int().nonnegative().optional(),
    chapterEnd: z.number().int().nonnegative().optional(),
  })
  .strict();
const core = z.object({
  schemaVersion: z.literal(1),
  nodes: z.array(z.object({
    id,
    parentNodeId: id.optional(),
    type: z.enum(['premise', 'conflict', 'turn', 'climax', 'resolution', 'character-arc', 'foreshadowing']),
    title: z.string().max(10_000),
    intent: z.string().max(10_000),
    order: z.number().int().nonnegative(),
    characterIds: z.array(id).max(1_000),
    foreshadowingIds: z.array(id).max(1_000),
  }).strict()).max(10_000),
  promiseActions: z.array(z.object({
    foreshadowingId: id,
    action: z.enum(['plant', 'hint', 'payoff']),
    chapterRange: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }).strict().optional(),
  }).strict()).max(10_000).optional(),
}).strict();
const bodySchema = z
  .object({
    level: z.enum(['master', 'volume', 'chapter']),
    scope,
    content: z.string().min(1).max(1_000_000),
    core: core.optional(),
    sourceCapabilityVersions: z.array(capabilityVersion).min(1).max(100).optional(),
  })
  .extend({ databaseGeneration: z.number().int().nonnegative(), source: z.enum(['user', 'continuation-pack', 'ai-proposal']).optional() })
  .strict();
const actionBodySchema = z.object({ databaseGeneration: z.number().int().nonnegative() }).strict();
const querySchema = z
  .object({
    level: z.enum(['master', 'volume', 'chapter']).optional(),
    status: z.enum(['candidate', 'active', 'archived']).optional(),
    generation: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

function error(res: import('express').Response, e: unknown) {
  if (e instanceof db.OutlineError) {
    const status =
      e.code === 'OUTLINE_NOT_FOUND' || e.code === 'OUTLINE_NOVEL_NOT_FOUND'
        ? 404
        : e.code === 'OUTLINE_MASTER_REQUIRED'
          || e.code === 'OUTLINE_VOLUME_REQUIRED'
          || e.code === 'OUTLINE_INVALID_DATA'
          || e.code === 'OUTLINE_MIRROR_DIVERGED'
          || e.code === 'OUTLINE_SCOPE_OVERLAP'
          || e.code === 'OUTLINE_UPSTREAM_NODE_MISSING'
          ? 409
          : 400;
    return res.status(status).json({ code: e.code, error: e.message });
  }
  return res.status(500).json({ code: 'OUTLINE_INTERNAL_ERROR', error: '大纲请求处理失败，请稍后重试。' });
}
export function registerOutlineRoutes(app: Express) {
  app.get('/api/novels/:novelId/outlines', (req, res) => {
    const parsed = id.safeParse(req.params.novelId);
    const query = querySchema.safeParse(req.query);
    if (!parsed.success || !query.success)
      return res
        .status(400)
        .json({ code: 'OUTLINE_INVALID_INPUT', error: '大纲请求参数无效，请重新检查后再试。' });
    try {
      if (query.data.generation !== undefined && query.data.generation !== getDatabaseGeneration())
        return res.status(409).json({ code: 'OUTLINE_GENERATION_STALE', error: '数据库已变化，请刷新大纲后重试。' });
      if (!db.getNovel(parsed.data))
        return res.status(404).json({ code: 'OUTLINE_NOT_FOUND', error: '作品不存在，请刷新项目后重试。' });
      return res.json(db.listOutlineArtifacts(parsed.data, query.data));
    } catch (e) {
      return error(res, e);
    }
  });
  app.post('/api/novels/:novelId/outlines', async (req, res) => {
    const novel = id.safeParse(req.params.novelId);
    const parsed = bodySchema.safeParse(req.body);
    if (!novel.success || !parsed.success)
      return res
        .status(400)
        .json({ code: 'OUTLINE_INVALID_INPUT', error: '大纲请求参数无效，请重新检查后再试。' });
    try {
      if (!db.getNovel(novel.data))
        return res.status(404).json({ code: 'OUTLINE_NOVEL_NOT_FOUND', error: '作品不存在，请刷新项目后重试。' });
      const { databaseGeneration, ...input } = parsed.data;
      if (input.sourceCapabilityVersions !== undefined) {
        return res.status(400).json({
          code: 'OUTLINE_CAPABILITY_CANDIDATE_REQUIRED',
          error: '能力生成的大纲必须通过 Canon 候选确认。',
        });
      }
      const guarded = await runInSerializedWriteForGeneration(databaseGeneration, () => db.createOutlineArtifact({ ...input, novelId: novel.data, source: input.source || 'user' }));
      if (!guarded.executed) return res.status(409).json({ code: 'OUTLINE_GENERATION_STALE', error: '数据库已变化，请刷新大纲后重试。' });
      const result = guarded.result;
      return res.status(201).json(result);
    } catch (e) {
      return error(res, e);
    }
  });
  app.get('/api/novels/:novelId/outlines/:outlineId', (req, res) => {
    try {
      if (!id.safeParse(req.params.novelId).success || !id.safeParse(req.params.outlineId).success)
        return res
          .status(400)
          .json({ code: 'OUTLINE_INVALID_INPUT', error: '大纲请求参数无效，请重新检查后再试。' });
      const result = db.getOutlineArtifact(req.params.outlineId, req.params.novelId);
      return result
        ? res.json(result)
        : res.status(404).json({ code: 'OUTLINE_NOT_FOUND', error: '大纲不存在，请刷新后重试。' });
    } catch (e) {
      return error(res, e);
    }
  });
  for (const action of ['activate', 'archive'] as const)
    app.post(`/api/novels/:novelId/outlines/:outlineId/${action}`, async (req, res) => {
      const parsedBody = actionBodySchema.safeParse(req.body || {});
      if (
        !id.safeParse(req.params.novelId).success ||
        !id.safeParse(req.params.outlineId).success ||
        !parsedBody.success
      )
        return res
          .status(400)
          .json({ code: 'OUTLINE_INVALID_INPUT', error: '大纲请求参数无效，请重新检查后再试。' });
      try {
        const generation = parsedBody.data.databaseGeneration;
        const operation = () => action === 'activate'
          ? db.activateOutlineArtifact(req.params.novelId, req.params.outlineId)
          : db.archiveOutlineArtifact(req.params.novelId, req.params.outlineId);
        const guarded = await runInSerializedWriteForGeneration(generation, operation);
        if (!guarded.executed) return res.status(409).json({ code: 'OUTLINE_GENERATION_STALE', error: '数据库已变化，请刷新大纲后重试。' });
        const result = guarded.result;
        return res.json(result);
      } catch (e) {
        return error(res, e);
      }
    });
}
