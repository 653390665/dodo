import type { Express, Response } from 'express';
import { z } from 'zod';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import {
  buildLegacyStructuringPrompt,
  confirmLegacyStructuringPreview,
  createLegacyArtifactPreview,
  listLegacyArtifactSources,
  parseLegacyStructuringOutput,
} from '../helpers/legacy-artifact-structuring';
import { createLlmExecution, LlmExecutionRejectedError } from '../helpers/llm-execution-gate';
import { getConfig } from '../lib/config';
import * as db from '../lib/db';
import { getDatabaseGeneration } from '../lib/db-instance';
import type { LegacyArtifactPreview } from '../../shared/types/legacy-artifact-structuring';

const id = z.string().trim().min(1).max(200);
const databaseGeneration = z.number().int().nonnegative();
const artifactKind = z.enum([
  'world', 'character', 'master-outline', 'volume-outline',
  'chapter-outline', 'scene-beats', 'narrative-promise',
]);
const previewInput = z.object({ artifactKind, artifactId: id, databaseGeneration }).strict();
const confirmInput = z.object({ previewId: id, databaseGeneration }).strict();
const PREVIEW_TTL_MS = 15 * 60_000;
const MAX_PREVIEWS = 100;
const previews = new Map<string, LegacyArtifactPreview>();

function prunePreviews(now = Date.now()): void {
  for (const [previewId, preview] of previews) {
    if (preview.expiresAt <= now) previews.delete(previewId);
  }
}

function storePreview(preview: LegacyArtifactPreview): void {
  prunePreviews();
  while (previews.size >= MAX_PREVIEWS) {
    const oldest = previews.keys().next().value as string | undefined;
    if (!oldest) break;
    previews.delete(oldest);
  }
  previews.set(preview.previewId, preview);
}

function invalid(res: Response) {
  return res.status(400).json({ code: 'LEGACY_ARTIFACT_INVALID_INPUT', error: '旧产物整理请求参数无效。' });
}

function conflict(res: Response, code: string, error: string) {
  return res.status(409).json({ code, error });
}

export function registerLegacyArtifactStructuringRoutes(app: Express) {
  app.get('/api/novels/:novelId/legacy-artifacts', (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    if (!novelId.success) return invalid(res);
    if (!db.getNovel(novelId.data)) {
      return res.status(404).json({ code: 'LEGACY_ARTIFACT_NOVEL_NOT_FOUND', error: '作品不存在。' });
    }
    return res.json({
      sources: listLegacyArtifactSources(novelId.data),
      databaseGeneration: getDatabaseGeneration(),
    });
  });

  app.post('/api/novels/:novelId/legacy-artifacts/preview', async (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const input = previewInput.safeParse(req.body);
    if (!novelId.success || !input.success) return invalid(res);
    if (!db.getNovel(novelId.data)) {
      return res.status(404).json({ code: 'LEGACY_ARTIFACT_NOVEL_NOT_FOUND', error: '作品不存在。' });
    }
    if (input.data.databaseGeneration !== getDatabaseGeneration()) {
      return conflict(res, 'LEGACY_ARTIFACT_GENERATION_STALE', '数据库已切换，请重新检查旧产物。');
    }
    const source = listLegacyArtifactSources(novelId.data).find((candidate) => (
      candidate.artifactKind === input.data.artifactKind
      && candidate.artifactId === input.data.artifactId
    ));
    if (!source) {
      return res.status(404).json({ code: 'LEGACY_ARTIFACT_SOURCE_NOT_FOUND', error: '旧产物不存在或已经结构化。' });
    }

    try {
      const execution = await createLlmExecution({
        operation: 'legacy-artifact-structuring',
        novelId: novelId.data,
        timeoutMs: 90_000,
        concurrency: 1,
        databaseGeneration: input.data.databaseGeneration,
      });
      const raw = await execution.run(({ signal }) => generateText(getConfig(), {
        prompt: buildLegacyStructuringPrompt(source),
        novelId: novelId.data,
        signal,
        responseMimeType: 'application/json',
        maxTokens: 4_000,
        maxAttempts: 1,
        // Structured legacy artifacts must parse as JSON; pin thinking off so
        // reasoning-heavy providers don't truncate the payload.
        disableThinking: true,
      }));
      let parsed: ReturnType<typeof parseLegacyStructuringOutput>;
      try {
        parsed = parseLegacyStructuringOutput(source, raw);
      } catch {
        return res.status(422).json({ code: 'LEGACY_ARTIFACT_PREVIEW_INVALID', error: '模型未返回有效的结构化结果。' });
      }
      const preview = createLegacyArtifactPreview(source, parsed, Date.now() + PREVIEW_TTL_MS);
      storePreview(preview);
      return res.json({ preview, databaseGeneration: input.data.databaseGeneration });
    } catch (error) {
      if (error instanceof LlmExecutionRejectedError) {
        return res.status(error.status).json({ code: error.quota.code, error: error.message });
      }
      if (error instanceof Error && error.message.includes('数据库')) {
        return conflict(res, 'LEGACY_ARTIFACT_GENERATION_STALE', '数据库已切换，请重新检查旧产物。');
      }
      return res.status(500).json({ code: 'LEGACY_ARTIFACT_PREVIEW_FAILED', error: '结构化预览生成失败，请稍后重试。' });
    }
  });

  app.post('/api/novels/:novelId/legacy-artifacts/confirm', async (req, res) => {
    const novelId = id.safeParse(req.params.novelId);
    const input = confirmInput.safeParse(req.body);
    if (!novelId.success || !input.success) return invalid(res);
    prunePreviews();
    const preview = previews.get(input.data.previewId);
    if (!preview || preview.source.novelId !== novelId.data) {
      return conflict(res, 'LEGACY_ARTIFACT_PREVIEW_UNAVAILABLE', '预览已过期或不属于当前作品，请重新生成。');
    }
    try {
      const result = await confirmLegacyStructuringPreview({
        preview,
        databaseGeneration: input.data.databaseGeneration,
      });
      previews.delete(input.data.previewId);
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('GENERATION') || message.includes('EXPIRED') || message.includes('STALE')) {
        return conflict(res, 'LEGACY_ARTIFACT_CONFIRM_STALE', '原产物或数据库已变化，请重新生成预览。');
      }
      return conflict(res, 'LEGACY_ARTIFACT_CONFIRM_FAILED', '结构化版本未能确认，原产物保持不变。');
    }
  });
}
