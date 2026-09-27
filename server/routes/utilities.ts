import type { Express, Response } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  validateCapabilityInvocation,
  CapabilityInvocationError,
  listCapabilityManifests,
} from '../capabilities/manifest.js';
import * as db from '../lib/db.js';
import { getDatabaseGeneration } from '../lib/db-instance.js';
import { KnowledgeCapabilityError, runKnowledgeCapability } from '../helpers/knowledge-capabilities.js';
import { MemoryHealthError, collectMemoryHealth } from '../helpers/memory-health.js';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow.js';
import { scoreSlop } from '../../shared/lib/slop-scorer.js';
import { buildCapabilityPolishPreview } from '../../shared/lib/slop-rewriter.js';
import { validateDraftQuality } from '../../shared/lib/draft-quality.js';

const bodySchema = z
  .object({
    chapterId: z.string().min(1).max(200),
    databaseGeneration: z.number().int().nonnegative(),
    stage: z.enum(['planner', 'writer', 'critic']).default('critic'),
    selection: z
      .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => !value.selection || value.selection.start <= value.selection.end, {
    message: 'invalid selection',
  });

function respondError(res: Response, error: unknown) {
  if (error instanceof CapabilityInvocationError)
    return res
      .status(error.code === 'CAPABILITY_NOT_FOUND' ? 404 : 409)
      .json({ code: error.code, error: error.message });
  return res
    .status(500)
    .json({ code: 'UTILITY_INTERNAL_ERROR', error: '能力工具执行失败，请稍后重试。' });
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function registerUtilityRoutes(app: Express): void {
  app.get('/api/capabilities/manifest', (_req, res) => {
    res.json({ entries: listCapabilityManifests() });
  });
  // 批次 C：图谱能力卡（作品级、无章节上下文）——knowledge-extract 跑幂等谱系抽取并回 coverage，
  // foreshadow-settle 回未回收伏笔核对清单。写入只发生在既有台账（幂等），不触碰章节正文。
  app.post('/api/novels/:novelId/knowledge-capabilities/:assetId/run', (req, res) => {
    const parsed = z
      .object({ databaseGeneration: z.number().int().nonnegative() })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ code: 'KNOWLEDGE_INVALID_INPUT', error: '知识能力卡请求参数无效，请刷新后重试。' });
    if (parsed.data.databaseGeneration !== getDatabaseGeneration())
      return res.status(409).json({
        code: 'DATABASE_GENERATION_STALE',
        error: '数据库已变化，请刷新后重新运行知识能力卡。',
      });
    try {
      const result = runKnowledgeCapability(req.params.novelId, req.params.assetId);
      const responseGeneration = getDatabaseGeneration();
      if (responseGeneration !== parsed.data.databaseGeneration)
        return res.status(409).json({
          code: 'DATABASE_GENERATION_STALE',
          error: '数据库已变化，知识能力卡结果已失效。',
        });
      return res.json({
        ...result,
        resolvedAtGeneration: responseGeneration,
        evidence: { databaseGeneration: responseGeneration },
      });
    } catch (error) {
      if (error instanceof KnowledgeCapabilityError)
        return res.status(error.status).json({ code: error.code, error: error.message });
      return res.status(500).json({
        code: 'KNOWLEDGE_INTERNAL_ERROR',
        error: '知识能力卡执行失败，请稍后重试。',
      });
    }
  });
  // 批次 D：记忆健康度看板——五项指标只取数，语义与未知口径由 shared/lib/memory-health.ts 单源定义。
  app.get('/api/novels/:novelId/memory-health', async (req, res) => {
    try {
      const snapshot = await collectMemoryHealth(req.params.novelId);
      return res.json(snapshot);
    } catch (error) {
      if (error instanceof MemoryHealthError)
        return res.status(error.status).json({ code: error.code, error: error.message });
      return res.status(500).json({
        code: 'MEMORY_HEALTH_INTERNAL_ERROR',
        error: '记忆健康度读取失败，请稍后重试。',
      });
    }
  });
  app.post('/api/novels/:novelId/capabilities/:assetId/execute', (req, res) => {
    if (
      typeof req.body?.chapterId !== 'string' ||
      typeof req.body?.databaseGeneration !== 'number'
    ) {
      return res
        .status(400)
        .json({ code: 'SCOPED_CONTEXT_REQUIRED', error: '请先选择章节并刷新写作上下文。' });
    }
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ code: 'UTILITY_INVALID_INPUT', error: '能力工具请求参数无效，请重新选择后再试。' });
    if (parsed.data.databaseGeneration !== getDatabaseGeneration())
      return res.status(409).json({
        code: 'DATABASE_GENERATION_STALE',
        error: '数据库已变化，请刷新后重新运行能力工具。',
      });
    const novel = db.getNovel(req.params.novelId);
    const chapter = db.getChapter(parsed.data.chapterId);
    if (!novel)
      return res
        .status(404)
        .json({ code: 'UTILITY_NOVEL_NOT_FOUND', error: '作品不存在，请刷新项目后重试。' });
    if (!chapter)
      return res
        .status(404)
        .json({ code: 'CHAPTER_NOT_FOUND', error: '章节不存在，请刷新目录后重试。' });
    if (chapter.novelId !== novel.id)
      return res
        .status(403)
        .json({ code: 'CHAPTER_SCOPE_MISMATCH', error: '章节不属于当前作品，请返回项目后重试。' });
    try {
      const content = chapter.content || '';
      if (
        parsed.data.selection &&
        (parsed.data.selection.start >= content.length ||
          parsed.data.selection.end > content.length ||
          parsed.data.selection.start >= parsed.data.selection.end)
      ) {
        return res.status(400).json({
          code: 'UTILITY_INVALID_SELECTION',
          error: '选中文本已变化，请重新选择后再运行能力工具。',
        });
      }
      const selected = parsed.data.selection
        ? content.slice(parsed.data.selection.start, parsed.data.selection.end)
        : content;
      const baselineHash = computeChapterWorkflowHash(selected, chapter.sceneBeats);
      const manifest = validateCapabilityInvocation(req.params.assetId, parsed.data.stage);
      const preview = buildCapabilityPolishPreview(manifest.id, selected);
      const capabilitySourceText = [
        `capability:${manifest.id}`,
        `version:${manifest.version}`,
        `stage:${parsed.data.stage}`,
        `output:${manifest.output}`,
      ].join('\n');
      const runtimeText = [selected, capabilitySourceText].filter(Boolean).join('\n\n');
      const capabilityLabel =
        manifest.output === 'diagnostic' ? `审稿卡：${manifest.id}` : `精修卡：${manifest.id}`;
      const contextReceipt = {
        actual: true,
        sourceIds: [chapter.id, manifest.id],
        runtimeSha256: digest(runtimeText),
        injectedChars: runtimeText.length,
        itemCount: 2,
        truncated: false,
        sources: [
          {
            id: chapter.id,
            label: parsed.data.selection ? '选中正文片段' : '当前章节正文',
            sha256: digest(selected),
            chars: selected.length,
            itemCount: 1,
            truncated: false,
          },
          {
            id: manifest.id,
            label: capabilityLabel,
            sha256: digest(capabilitySourceText),
            chars: capabilitySourceText.length,
            itemCount: 1,
            truncated: false,
            version: manifest.version,
          },
        ],
      } as const;
      if (manifest.output === 'diagnostic') {
        if (manifest.id !== 'text-diagnostics' && manifest.id !== 'audit-cliche-detector') {
          return res.status(503).json({
            code: 'UTILITY_UNAVAILABLE',
            error: '该工具尚未接入可验证的只读执行器',
            retriable: false,
          });
        }
        const report = scoreSlop(selected);
        const structureSignals = report.hits.filter((hit) => hit.category === 'structural');
        const responseGeneration = getDatabaseGeneration();
        if (responseGeneration !== parsed.data.databaseGeneration) {
          return res
            .status(409)
            .json({ code: 'DATABASE_GENERATION_STALE', error: '数据库已变化，诊断预览已失效' });
        }
        return res.json({
          kind: 'diagnostic',
          capabilityId: manifest.id,
          report: {
            issueCount: report.hits.length,
            score: report.score,
            issues: report.hits.map((hit) => ({
              category: hit.category,
              line: hit.line,
              snippet: hit.snippet,
              suggestion: hit.suggestion,
              ...(hit.priority ? { priority: hit.priority } : {}),
              ...(hit.signal ? { signal: hit.signal } : {}),
              ...(hit.range ? { range: hit.range } : {}),
              ...(hit.scope ? { scope: hit.scope } : {}),
            })),
            structureSignals,
            qualityMode: 'deterministic',
            needsContextRewrite: structureSignals.some((hit) => hit.priority === 'P1'),
          },
          baselineHash,
          contextReceipt,
          resolvedAtGeneration: responseGeneration,
          readOnly: true,
        });
      }
      const responseGeneration = getDatabaseGeneration();
      if (responseGeneration !== parsed.data.databaseGeneration) {
        return res
          .status(409)
          .json({ code: 'DATABASE_GENERATION_STALE', error: '数据库已变化，预览已失效' });
      }
      const quality = validateDraftQuality(preview);
      const report = scoreSlop(selected);
      const structureSignals = report.hits.filter((hit) => hit.category === 'structural');
      const response = {
        kind: 'transform-preview' as const,
        capabilityId: manifest.id,
        preview,
        quality,
        baselineHash,
        contextReceipt,
        resolvedAtGeneration: responseGeneration,
        readOnly: true as const,
        qualityMode: 'deterministic-preview' as const,
        structureSignals,
        contextRewrite: {
          status: structureSignals.some((hit) => hit.priority === 'P1')
            ? ('required' as const)
            : ('not-required' as const),
          retriable: true,
          originalTextRetained: true,
        },
      };
      return res.json(response);
    } catch (error) {
      return respondError(res, error);
    }
  });
}
