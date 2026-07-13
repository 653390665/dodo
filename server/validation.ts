import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      console.error('[Validation Failed] Path:', req.path, 'Issues:', JSON.stringify(result.error.issues, null, 2));

      // Write detailed validation log only when INKFLOW_VALIDATION_DEBUG=true
      if (process.env.INKFLOW_VALIDATION_DEBUG === 'true') {
        try {
            const _errorLogPath = path.join(process.cwd(), 'validation-debug.log');
            const safeBody = JSON.parse(JSON.stringify(req.body, (key, value) => {
              if (key === 'filedata' && typeof value === 'string') return value.slice(0, 200) + '...[TRUNCATED]';
              return value;
            }));
            const logContent = `\n=========================================\n[${new Date().toISOString()}] Validation Failed\nPath: ${req.path}\nIssues: ${JSON.stringify(result.error.issues, null, 2)}\nBody: ${JSON.stringify(safeBody, null, 2)}\n=========================================\n`;
            // Validation debug logging disabled in production — enable via INKFLOW_DEBUG_VALIDATION=1
            if (process.env.INKFLOW_DEBUG_VALIDATION === '1') {
              fs.appendFileSync(_errorLogPath, logContent, 'utf8');
            }
        } catch (_err) { /* ignore */ }
      }

      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
      });
    }
    req.body = result.data;
    next();
  };
}

export const dbSchema = z.object({
  method: z.string().min(1),
  args: z.array(z.unknown()).default([]),
});

export const configSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional().or(z.literal('')),
  model: z.string().optional(),
  promptGuardLevel: z.enum(['strict', 'balanced', 'disabled']).optional(),
  promptTemplates: z.record(z.string(), z.unknown()).optional(),
});

export const extractSkillSchema = z.object({
  text: z.string().min(1).max(150000, '文本字数超出 15 万字上限'),
  title: z.string().max(100).optional(),
  style: z.string().max(100).optional(),
  novelId: z.string().optional(), // 关联的小说ID
  skills: z.array(z.unknown()).max(3).optional().default([]),
});

export const storyCardsSchema = z.object({
  ideaSeed: z.string().min(1).max(5000, '创意种子字数不能超过 5000 字'),
  chatContext: z.string().max(10000).optional(),
  planning: z.record(z.string(), z.unknown()).optional(),
  surface: z.string().max(100).optional(),
});

export const chapterProductionSchema = z.object({
  novelId: z.string().min(1),
  targetChapterId: z.string().optional(),
  userIntent: z.string().max(2000, '写作意图字数不能超过 2000 字').optional(),
  continuationPackId: z.string().optional(),
  surface: z.string().max(100).optional(),
  activeEntityNames: z.array(z.string().max(100)).max(100).optional(),
});

export const orchestrateSchema = z.object({
  draftingSurface: z.string().min(1).max(100).optional().default('workspace-draft'),
  reviewSurface: z.string().min(1).max(100).optional().default('chapter-review'),
  contextStr: z.string().max(10000).optional(),
  sceneBeats: z.string().min(1).max(5000, '分镜字数不能超过 5000 字'),
  skills: z.array(z.unknown()).max(3, '最多只能挂载 3 个技能卡').optional().default([]),
  maxIterations: z.coerce.number().int().min(1).max(5).optional().default(2),
  draftContent: z.string().max(50000).optional().default(''),
  includeCritic: z.boolean().optional().default(true),
  novelId: z.string().optional(), // 关联的小说ID
});

const base64Regex = /^[a-zA-Z0-9+/_\-\s]*={0,2}$/;
const allowedExtensions = /\.(txt|md|json|docx)$/i;
const allowedDocExtensions = /\.(txt|md|json|docx|zip)$/i;

export const parseDocSchema = z.object({
  filename: z.string().min(1).max(255).refine(val => allowedDocExtensions.test(val), {
    message: '仅支持 .txt, .md, .json, .docx, .zip 格式文档'
  }),
  filedata: z.string().min(1).max(8000000, '单文件不能超过 6MB').regex(base64Regex, '非法 Base64 数据'),
});

export const continuationParseSchema = z.object({
  novelId: z.string().min(1),
  title: z.string().max(500).optional(),
  documents: z.array(
    z.object({
      filename: z.string().min(1).max(255).refine(val => allowedExtensions.test(val), {
        message: '仅支持 .txt, .md, .json, .docx 格式文档'
      }),
      filedata: z.string().min(1).max(15000000, '单文件不能超过 10MB').regex(base64Regex, '非法 Base64 数据'),
    })
  ).min(1).max(100, '一次最多只能上传 100 个文档')
.refine(docs => {
      const totalSize = docs.reduce((acc, doc) => acc + doc.filedata.length, 0);
      return totalSize <= 50000000;
    }, { message: '总文件大小不能超过 35MB' }),
});

export const exportSchema = z.object({
  novelId: z.string().min(1),
  format: z.enum(['txt', 'epub']).optional().default('txt'),
});
