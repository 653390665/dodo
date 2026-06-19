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
  text: z.string().min(1),
  title: z.string().optional(),
  style: z.string().optional(),
});

export const storyCardsSchema = z.object({
  ideaSeed: z.string().min(1),
  chatContext: z.string().optional(),
  planning: z.record(z.string(), z.unknown()).optional(),
  surface: z.string().optional(),
});

export const chapterProductionSchema = z.object({
  novelId: z.string().min(1),
  chapterId: z.string().optional(),
  intent: z.string().optional(),
});