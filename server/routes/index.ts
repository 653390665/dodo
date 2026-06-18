import type { Express } from 'express';
import { registerDbRoutes } from './db';
import { registerConfigRoutes } from './config';
import { registerSimpleLlmRoutes } from './simple-llm';
import { registerExportRoutes } from './export';

/**
 * 注册所有已提取的 API 路由。
 *
 * 以下路由仍在 server.ts 中（尚未提取）：
 * - POST /api/prompt-template-test — 依赖多个本地辅助函数
 * - POST /api/story-cards (+ GET /api/story-cards/jobs/:jobId) — 依赖异步 Job 模式 + 多个本地辅助函数
 * - POST /api/setup-task-refine
 * - POST /api/extract-world-setup
 * - POST /api/editor-agent
 * - POST /api/parse-doc
 * - POST /api/continuation-packs/parse
 * - POST /api/audit
 * - POST /api/rewrite
 * - POST /api/orchestrate / orchestrate-draft
 * - POST /api/chapter-production-runs/start / start-stream / :runId/apply
 * - POST /api/extract-skill (+ GET /api/extract-skill/jobs/:jobId)
 * - POST /api/generate-outline
 *
 * 这些路由依赖大量 startServer() 内的本地辅助函数（buildSkillsPrompt, renderPromptTemplate,
 * buildFallbackStoryCards, buildFallbackDraft 等），需要先将这些辅助函数提取到
 * server/helpers/ 目录后才能拆分。
 */
export function registerRoutes(app: Express) {
  registerDbRoutes(app);
  registerConfigRoutes(app);
  registerSimpleLlmRoutes(app);
  registerExportRoutes(app);
}
