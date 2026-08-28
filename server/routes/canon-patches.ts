import type { Express } from 'express';
import { z } from 'zod';
import * as db from '../lib/db.js';
import { runInSerializedWriteForGeneration } from '../lib/db-instance.js';

const id = z.string().min(1).max(200);
const capabilityVersion = z.object({ capabilityId: id, version: id }).strict();
const scope = z.object({ volumeName: z.string().max(200).optional(), chapterStart: z.number().int().nonnegative().optional(), chapterEnd: z.number().int().nonnegative().optional() }).strict();
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
const operation = z.union([
  z.object({ operation: z.literal('create-master-outline'), content: z.string().min(1).max(1_000_000), core: core.optional() }).strict(),
  z.object({ operation: z.literal('replace-outline'), targetArtifactId: id, content: z.string().min(1).max(1_000_000), core: core.optional() }).strict(),
  z.object({ operation: z.literal('create-scoped-outline'), level: z.enum(['volume', 'chapter']), scope, content: z.string().min(1).max(1_000_000), core: core.optional() }).strict(),
]);
const createSchema = z.object({
  baseFingerprint: z.string().min(1).max(200),
  sourceCapabilityVersions: z.array(capabilityVersion).min(1).max(100).optional(),
  operations: z.array(operation).min(1).max(100),
  databaseGeneration: z.number().int().nonnegative(),
}).strict();
function fail(res: import('express').Response, e: unknown) {
  if (e instanceof db.OutlineError) {
    const status = e.code === 'OUTLINE_MIRROR_DIVERGED'
      || e.code === 'OUTLINE_MASTER_REQUIRED'
      || e.code === 'OUTLINE_VOLUME_REQUIRED'
      || e.code === 'OUTLINE_SCOPE_OVERLAP'
      || e.code === 'OUTLINE_UPSTREAM_NODE_MISSING'
      ? 409
      : 400;
    return res.status(status).json({ code: e.code, error: e.message });
  }
  if (e instanceof db.CanonPatchError) {
    const status = e.code.endsWith('NOT_FOUND') ? 404 : e.code === 'CANON_PATCH_CONFLICT' || e.code === 'CANON_PATCH_GENERATION_STALE' || e.code === 'CANON_PATCH_INVALID_DATA' || e.code === 'CANON_PATCH_STALE' || e.code === 'CANON_PATCH_TERMINAL' ? 409 : 400;
    return res.status(status).json({ code: e.code, error: e.message });
  }
  return res.status(500).json({ code: 'CANON_PATCH_INTERNAL_ERROR', error: '大纲变更请求处理失败，请稍后重试。' });
}
export function registerCanonPatchRoutes(app: Express) {
  app.get('/api/novels/:novelId/canon-patches', (req, res) => {
    if (!id.safeParse(req.params.novelId).success) return res.status(400).json({ code: 'CANON_PATCH_INVALID_INPUT', error: '大纲变更请求参数无效，请重新检查后再试。' });
    try { if (!db.getNovel(req.params.novelId)) return res.status(404).json({ code: 'CANON_PATCH_NOVEL_NOT_FOUND', error: '作品不存在，请刷新项目后重试。' }); return res.json(db.listCanonPatches(req.params.novelId)); } catch (e) { return fail(res, e); }
  });
  app.get('/api/novels/:novelId/canon-patches/:patchId', (req, res) => {
    if (!id.safeParse(req.params.novelId).success || !id.safeParse(req.params.patchId).success) return res.status(400).json({ code: 'CANON_PATCH_INVALID_INPUT', error: '大纲变更请求参数无效，请重新检查后再试。' });
    try { const result = db.getCanonPatch(req.params.patchId, req.params.novelId); return result ? res.json(result) : res.status(404).json({ code: 'CANON_PATCH_NOT_FOUND', error: '大纲变更不存在，请刷新后重试。' }); } catch (e) { return fail(res, e); }
  });
  app.post('/api/novels/:novelId/canon-patches', async (req, res) => {
    const novel = id.safeParse(req.params.novelId); const parsed = createSchema.safeParse(req.body);
    if (!novel.success || !parsed.success) return res.status(400).json({ code: 'CANON_PATCH_INVALID_INPUT', error: '大纲变更请求参数无效，请重新检查后再试。' });
    try {
      const { databaseGeneration, ...input } = parsed.data;
      const guarded = await runInSerializedWriteForGeneration(databaseGeneration, () => db.createCanonPatch({ ...input, novelId: novel.data }));
      if (!guarded.executed) return res.status(409).json({ code: 'CANON_PATCH_GENERATION_STALE', error: '数据库已变化，请刷新大纲变更后重试。' });
      return res.status(201).json(guarded.result);
    } catch (e) { return fail(res, e); }
  });
  for (const action of ['accept', 'reject'] as const) app.post(`/api/novels/:novelId/canon-patches/:patchId/${action}`, async (req, res) => {
    const generation = z.object({ databaseGeneration: z.number().int().nonnegative() }).strict().safeParse(req.body);
    if (!id.safeParse(req.params.novelId).success || !id.safeParse(req.params.patchId).success || !generation.success) return res.status(400).json({ code: 'CANON_PATCH_INVALID_INPUT', error: '大纲变更请求参数无效，请重新检查后再试。' });
    try {
      // acceptCanonPatch applies its own generation guard; wrapping it again would deadlock the FIFO queue.
      const guarded = action === 'accept'
        ? { executed: true as const, result: await db.acceptCanonPatch(req.params.novelId, req.params.patchId, generation.data.databaseGeneration) }
        : await runInSerializedWriteForGeneration(generation.data.databaseGeneration, () => db.rejectCanonPatch(req.params.novelId, req.params.patchId));
      if (!guarded.executed) return res.status(409).json({ code: 'CANON_PATCH_GENERATION_STALE', error: '数据库已变化，请刷新大纲变更后重试。' });
      const result = guarded.result;
      return result.status === 'stale' ? res.status(409).json({ ...result, code: 'CANON_PATCH_STALE', error: '大纲基线已变化，请刷新后重新生成变更。' }) : res.json(result);
    } catch (e) { return fail(res, e); }
  });
}
