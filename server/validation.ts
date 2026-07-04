import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
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
  promptTemplates: z.record(z.string(), z.unknown()).optional(),
});

export const extractSkillSchema = z.object({
  text: z.string().min(1).max(150000, '文本字数超出 15 万字上限'),
  title: z.string().max(100).optional(),
  style: z.string().max(100).optional(),
  novelId: z.string().optional(), // 关联的小说ID
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

const base64Regex = /^[a-zA-Z0-9+/]*={0,2}$/;
const allowedExtensions = /\.(txt|md|json|docx)$/i;

export const parseDocSchema = z.object({
  filename: z.string().min(1).max(255).refine(val => allowedExtensions.test(val), {
    message: '仅支持 .txt, .md, .json, .docx 格式文档'
  }),
  filedata: z.string().min(1).max(8000000, '单文件不能超过 6MB').regex(base64Regex, '非法 Base64 数据'),
});

export const continuationParseSchema = z.object({
  novelId: z.string().min(1),
  title: z.string().max(100).optional(),
  documents: z.array(
    z.object({
      filename: z.string().min(1).max(255).refine(val => allowedExtensions.test(val), {
        message: '仅支持 .txt, .md, .json, .docx 格式文档'
      }),
      filedata: z.string().min(1).max(8000000, '单文件不能超过 6MB').regex(base64Regex, '非法 Base64 数据'),
    })
  ).min(1).max(10, '一次最多只能上传 10 个文档')
   .refine(docs => {
     const totalSize = docs.reduce((acc, doc) => acc + doc.filedata.length, 0);
     return totalSize <= 20000000;
   }, { message: '总文件大小不能超过 15MB' }),
});
