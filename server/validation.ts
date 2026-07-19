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

const dbIdSchema = z.string().min(1).max(200);
const dbTextSchema = z.string().max(1_000_000);
const dbShortTextSchema = z.string().max(500);
const dbTimestampSchema = z.number().int().nonnegative().finite();
const dbEntitySchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  if (JSON.stringify(value).length > 1_000_000) {
    context.addIssue({ code: 'custom', message: 'Database payload is too large' });
  }
});
const noArgsSchema = z.tuple([]);
const idArgsSchema = z.tuple([dbIdSchema]);
const optionalIdArgsSchema = z.union([noArgsSchema, idArgsSchema]);
const createArgsSchema = z.tuple([dbEntitySchema]);
const updateArgsSchema = z.tuple([dbIdSchema, dbEntitySchema]);

// Core writing entities cross a generic IPC/HTTP proxy, so validate their
// domain fields at runtime instead of trusting TypeScript-only interfaces.
const novelEntitySchema = z.object({
  id: dbIdSchema,
  title: dbShortTextSchema,
  authorId: dbIdSchema,
  summary: dbTextSchema,
  coverImage: dbTextSchema.optional(),
  status: z.enum(['ongoing', 'completed', 'hiatus']),
  worldRules: dbTextSchema.optional(),
  globalOutline: dbTextSchema.optional(),
  mountedSkillIds: z.array(dbIdSchema).max(100).optional(),
  mountedSkillLoadout: z.array(z.unknown()).max(100).optional(),
  projectPreferenceProfile: z.record(z.string(), z.unknown()).optional(),
  createdAt: dbTimestampSchema,
  updatedAt: dbTimestampSchema,
}).strict();

const chapterEntitySchema = z.object({
  id: dbIdSchema,
  novelId: dbIdSchema,
  volumeName: dbShortTextSchema.optional(),
  title: dbShortTextSchema,
  content: dbTextSchema,
  order: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  sceneBeats: dbTextSchema.optional(),
  critique: dbTextSchema.optional(),
  createdAt: dbTimestampSchema,
  updatedAt: dbTimestampSchema,
}).strict();

const characterEntitySchema = z.object({
  id: dbIdSchema,
  novelId: dbIdSchema,
  name: dbShortTextSchema,
  role: z.enum(['protagonist', 'antagonist', 'supporting', 'extra']),
  summary: dbTextSchema,
  traits: z.array(dbShortTextSchema).max(200),
  bio: dbTextSchema,
  current_state: dbTextSchema.optional(),
  concealGender: z.boolean().optional(),
  createdAt: dbTimestampSchema.optional(),
  updatedAt: dbTimestampSchema.optional(),
}).strict();

const locationEntitySchema = z.object({
  id: dbIdSchema,
  novelId: dbIdSchema,
  name: dbShortTextSchema,
  description: dbTextSchema,
  region: dbShortTextSchema,
  createdAt: dbTimestampSchema,
  updatedAt: dbTimestampSchema,
}).strict();

const itemEntitySchema = z.object({
  id: dbIdSchema,
  novelId: dbIdSchema,
  name: dbShortTextSchema,
  description: dbTextSchema,
  type: dbShortTextSchema,
  createdAt: dbTimestampSchema,
  updatedAt: dbTimestampSchema,
}).strict();

const DB_LIST_WITH_ID = [
  'listChapters', 'listChaptersMetadata', 'listChapterVersions',
  'listCharacters', 'listLocations', 'listItems', 'listFactions',
  'listPowerLevels', 'listTimelineEvents', 'listSkillVersions',
  'listForeshadowings', 'listChapterProductionRuns',
  'listContinuationPacks', 'listEntityRelationships',
] as const;
const DB_OPTIONAL_LIST = ['listSkillUsageRecords', 'listIdeaFragments'] as const;
const DB_GET_OR_DELETE = [
  'getNovel', 'deleteNovel', 'getChapter', 'deleteChapter',
  'getSkill', 'deleteSkill', 'getCharacter', 'deleteCharacter',
  'deleteLocation', 'getItem', 'deleteItem', 'deleteFaction',
  'deletePowerLevel', 'deleteTimelineEvent', 'getForeshadowing',
  'deleteForeshadowing', 'getChapterProductionRun',
  'getContinuationPack', 'deleteContinuationPack', 'deleteEntityRelationship',
] as const;
const DB_CREATE = [
  'createNovel', 'createChapter', 'createChapterVersion', 'createSkill',
  'createSkillUsageRecord', 'createCharacter', 'createLocation', 'createItem',
  'createFaction', 'createPowerLevel', 'createTimelineEvent',
  'createIdeaFragment', 'createForeshadowing',
  'createEntityRelationship',
] as const;
const DB_UPDATE = [
  'updateNovel', 'updateChapter', 'updateSkill', 'updateCharacter',
  'updateLocation', 'updateItem', 'updateFaction', 'updatePowerLevel',
  'updateTimelineEvent', 'updateIdeaFragment', 'updateForeshadowing',
  'updateContinuationPack', 'updateEntityRelationship',
] as const;

export const dbMethodSchemas: Record<string, z.ZodType<unknown>> = {
  listNovels: noArgsSchema,
  listSkills: noArgsSchema,
  syncSkillFeedbackScores: noArgsSchema,
};
for (const method of DB_LIST_WITH_ID) dbMethodSchemas[method] = idArgsSchema;
for (const method of DB_OPTIONAL_LIST) dbMethodSchemas[method] = optionalIdArgsSchema;
for (const method of DB_GET_OR_DELETE) dbMethodSchemas[method] = idArgsSchema;
for (const method of DB_CREATE) dbMethodSchemas[method] = createArgsSchema;
for (const method of DB_UPDATE) dbMethodSchemas[method] = updateArgsSchema;

for (const [name, schema] of Object.entries({
  Novel: novelEntitySchema,
  Chapter: chapterEntitySchema,
  Character: characterEntitySchema,
  Location: locationEntitySchema,
  Item: itemEntitySchema,
})) {
  dbMethodSchemas[`create${name}`] = z.tuple([schema]);
}

// Identity and ownership fields are immutable.  In particular, accepting a
// renderer supplied `novelId` here would let a generic update silently move a
// chapter or world entity between projects and bypass the route-level domain
// checks.
dbMethodSchemas.updateNovel = z.tuple([
  dbIdSchema,
  novelEntitySchema.omit({ id: true, createdAt: true }).partial(),
]);
dbMethodSchemas.updateChapter = z.tuple([
  dbIdSchema,
  chapterEntitySchema.omit({ id: true, novelId: true, createdAt: true }).partial(),
]);
dbMethodSchemas.updateCharacter = z.tuple([
  dbIdSchema,
  characterEntitySchema.omit({ id: true, novelId: true, createdAt: true }).partial(),
]);
dbMethodSchemas.updateLocation = z.tuple([
  dbIdSchema,
  locationEntitySchema.omit({ id: true, novelId: true, createdAt: true }).partial(),
]);
dbMethodSchemas.updateItem = z.tuple([
  dbIdSchema,
  itemEntitySchema.omit({ id: true, novelId: true, createdAt: true }).partial(),
]);

const immutableProjectUpdateSchema = dbEntitySchema.superRefine((value, context) => {
  for (const key of ['id', 'novelId', 'createdAt']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      context.addIssue({ code: 'custom', path: [key], message: `${key} is immutable` });
    }
  }
});
for (const method of [
  'updateFaction',
  'updatePowerLevel',
  'updateTimelineEvent',
  'updateIdeaFragment',
  'updateForeshadowing',
  'updateEntityRelationship',
]) {
  dbMethodSchemas[method] = z.tuple([dbIdSchema, immutableProjectUpdateSchema]);
}

// Continuation packs are created only by the guarded import workflow. The
// renderer may edit review state, but it must never move a pack to another
// novel or rewrite its source/canon payload through the generic DB proxy.
dbMethodSchemas.updateContinuationPack = z.tuple([
  dbIdSchema,
  z.object({
    status: z.enum(['draft', 'approved']).optional(),
    continuationTask: dbTextSchema.optional(),
    updatedAt: dbTimestampSchema.optional(),
  }).strict(),
]);

export const dbSchema = z.object({
  method: z.string().min(1),
  args: z.array(z.unknown()).default([]),
  databaseGeneration: z.number().int().nonnegative().optional(),
}).superRefine(({ method, args }, context) => {
  const methodSchema = dbMethodSchemas[method];
  if (!methodSchema) {
    context.addIssue({ code: 'custom', path: ['method'], message: 'Unknown database method' });
    return;
  }
  const result = methodSchema.safeParse(args);
  if (!result.success) {
    for (const issue of result.error.issues) {
      context.addIssue({ ...issue, path: ['args', ...issue.path] });
    }
  }
});

export const configSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional().or(z.literal('')),
  model: z.string().optional(),
  promptGuardLevel: z.enum(['strict', 'balanced', 'disabled']).optional(),
  promptTemplates: z.record(z.string(), z.unknown()).optional(),
});

export const configConnectionSchema = z.object({
  apiKey: z.string().max(20_000).optional(),
  baseUrl: z.string().url().max(2_000).optional().or(z.literal('')),
  model: z.string().max(500).optional(),
});

export const extractSkillSchema = z.object({
  text: z.string().min(1).max(150000, '文本字数超出 15 万字上限'),
  title: z.string().max(100).optional(),
  style: z.string().max(100).optional(),
  novelId: dbIdSchema,
  skills: z.array(z.unknown()).max(3).optional().default([]),
});

export const storyCardsSchema = z.object({
  onboardingSessionId: dbIdSchema,
  ideaSeed: z.string().min(1).max(5000, '创意种子字数不能超过 5000 字'),
  chatContext: z.string().max(10000).optional(),
  planning: z.record(z.string(), z.unknown()).optional(),
  surface: z.string().max(100).optional(),
  previousHookTexts: z.array(z.string().max(2_000)).max(50).optional(),
  batchIndex: z.number().int().nonnegative().max(100).optional(),
});

export const setupTaskRefineSchema = z.object({
  novelId: dbIdSchema,
  taskTitle: z.string().min(1).max(500),
  currentDraft: z.string().max(100_000).optional(),
  userRequest: z.string().max(20_000).optional(),
  storyContext: z.string().max(100_000).optional(),
  surface: z.string().max(100).optional(),
});

export const worldSetupExtractSchema = z.object({
  novelId: dbIdSchema,
  documentText: z.string().min(1).max(150_000),
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
const allowedDocExtensions = /\.(txt|md|json|docx)$/i;

export const parseDocSchema = z.object({
  novelId: z.string().min(1).max(200),
  filename: z.string().min(1).max(255).refine(val => allowedDocExtensions.test(val), {
    message: '仅支持 .txt, .md, .json, .docx 格式文档'
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
