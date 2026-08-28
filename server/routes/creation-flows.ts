import type { Express, Response } from 'express';
import { z } from 'zod';
import type { CreationFlowDefinitionDraft } from '../../shared/types/creation-flow.js';
import {
  buildFlowMigrationCandidate,
  CreationFlowError,
  freezeCreationFlowDefinition,
  getActiveCreationFlowSession,
  getCreationFlowReadiness,
  getCreationFlowSession,
  recordAcceptedFlowOutput,
  startCreationFlow,
} from '../lib/db/creation-flows.js';
import { getDatabaseGeneration, runInSerializedWriteForGeneration } from '../lib/db-instance.js';

const id = z.string().min(1).max(200);
const artifactKind = z.enum(['world', 'character', 'master-outline', 'volume-outline', 'chapter-outline', 'scene-beats']);
const step = z.object({
  id,
  capabilityId: id,
  dependsOn: z.array(id).max(100),
  requiredArtifactKinds: z.array(artifactKind).max(20),
  producedArtifactKind: artifactKind,
  required: z.boolean(),
}).strict();
const definition = z.object({ id, version: id, steps: z.array(step).min(1).max(100) }).strict();
const startBody = z.object({ definition, databaseGeneration: z.number().int().nonnegative() }).strict();
const outputBody = z.object({
  artifact: z.object({ kind: artifactKind, id, version: z.number().int().positive() }).strict(),
  databaseGeneration: z.number().int().nonnegative(),
}).strict();
const migrationBody = z.object({ definition, databaseGeneration: z.number().int().nonnegative() }).strict();

function errorResponse(res: Response, error: unknown) {
  if (error instanceof CreationFlowError) {
    const status = error.code.endsWith('NOT_FOUND') || error.code === 'CREATION_FLOW_NOVEL_NOT_FOUND'
      ? 404
      : error.code.includes('STALE') || error.code.includes('ACTIVE_EXISTS') || error.code.includes('TERMINAL')
        || error.code.includes('PREREQUISITES') || error.code.includes('MISMATCH') || error.code.includes('NOT_ACCEPTED')
          ? 409
          : 400;
    return res.status(status).json({ code: error.code, error: error.message, ...(error.missingArtifactKinds ? { missingArtifactKinds: error.missingArtifactKinds } : {}) });
  }
  return res.status(500).json({ code: 'CREATION_FLOW_INTERNAL_ERROR', error: '创作流程请求处理失败，请稍后重试。' });
}

export function registerCreationFlowRoutes(app: Express): void {
  app.post('/api/novels/:novelId/creation-flows/start', async (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const parsed = startBody.safeParse(req.body);
    if (!novelId.success || !parsed.success) return res.status(400).json({ code: 'CREATION_FLOW_INVALID_INPUT', error: '创作流程参数无效。' });
    try {
      const { databaseGeneration, definition: draft } = parsed.data;
      const guarded = await runInSerializedWriteForGeneration(databaseGeneration, () => startCreationFlow({
        novelId: novelId.data,
        definition: draft as CreationFlowDefinitionDraft,
        databaseGeneration,
      }));
      if (!guarded.executed) return res.status(409).json({ code: 'CREATION_FLOW_GENERATION_STALE', error: '数据库已变化，请刷新后重试。' });
      return res.status(201).json(guarded.result);
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  app.get('/api/novels/:novelId/creation-flows/active', (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const generation = z.coerce.number().int().nonnegative().safeParse(req.query.generation);
    if (!novelId.success || !generation.success) return res.status(400).json({ code: 'CREATION_FLOW_INVALID_INPUT', error: '创作流程参数无效。' });
    if (generation.data !== getDatabaseGeneration()) return res.status(409).json({ code: 'CREATION_FLOW_GENERATION_STALE', error: '数据库已变化，请刷新后重试。' });
    try {
      const session = getActiveCreationFlowSession(novelId.data);
      return session ? res.json({ ...session, readiness: getCreationFlowReadiness(session) }) : res.status(404).json({ code: 'CREATION_FLOW_NOT_FOUND', error: '没有活动中的创作流程。' });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  app.get('/api/novels/:novelId/creation-flows/:sessionId', (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const sessionId = id.safeParse(req.params.sessionId);
    if (!novelId.success || !sessionId.success) return res.status(400).json({ code: 'CREATION_FLOW_INVALID_INPUT', error: '创作流程参数无效。' });
    try {
      const session = getCreationFlowSession(novelId.data, sessionId.data);
      return session ? res.json({ ...session, readiness: getCreationFlowReadiness(session) }) : res.status(404).json({ code: 'CREATION_FLOW_NOT_FOUND', error: '创作流程不存在。' });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  app.post('/api/novels/:novelId/creation-flows/:sessionId/outputs/accept', async (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const sessionId = id.safeParse(req.params.sessionId);
    const parsed = outputBody.safeParse(req.body);
    if (!novelId.success || !sessionId.success || !parsed.success) return res.status(400).json({ code: 'CREATION_FLOW_INVALID_INPUT', error: '创作流程参数无效。' });
    try {
      const guarded = await runInSerializedWriteForGeneration(parsed.data.databaseGeneration, () => recordAcceptedFlowOutput({
        novelId: novelId.data,
        sessionId: sessionId.data,
        artifact: parsed.data.artifact,
        databaseGeneration: parsed.data.databaseGeneration,
      }));
      if (!guarded.executed) return res.status(409).json({ code: 'CREATION_FLOW_GENERATION_STALE', error: '数据库已变化，请刷新后重试。' });
      return res.json(guarded.result);
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  app.post('/api/novels/:novelId/creation-flows/:sessionId/migration/preview', (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const sessionId = id.safeParse(req.params.sessionId);
    const parsed = migrationBody.safeParse(req.body);
    if (!novelId.success || !sessionId.success || !parsed.success) return res.status(400).json({ code: 'CREATION_FLOW_INVALID_INPUT', error: '创作流程参数无效。' });
    if (parsed.data.databaseGeneration !== getDatabaseGeneration()) return res.status(409).json({ code: 'CREATION_FLOW_GENERATION_STALE', error: '数据库已变化，请刷新后重试。' });
    try {
      const session = getCreationFlowSession(novelId.data, sessionId.data);
      if (!session) return res.status(404).json({ code: 'CREATION_FLOW_NOT_FOUND', error: '创作流程不存在。' });
      const proposed = freezeCreationFlowDefinition(parsed.data.definition as CreationFlowDefinitionDraft);
      return res.json(buildFlowMigrationCandidate(session, proposed));
    } catch (error) {
      return errorResponse(res, error);
    }
  });
}
