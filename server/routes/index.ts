import type { Express } from 'express';
import { registerDbRoutes } from './db';
import { registerConfigRoutes } from './config';
import { registerSimpleLlmRoutes } from './simple-llm';
import { registerExportRoutes } from './export';
import { registerOnboardingRoutes } from './onboarding';
import { registerAgentsRoutes } from './agents';
import { registerProductionRoutes } from './production';
import { registerAuditRoutes } from './audit';
import { registerSkillsRoutes } from './skills';
import { registerContinuationRoutes } from './continuation';
import { registerWorldRoutes } from './world';
import { registerPromptTestRoutes } from './prompt-test';
import { registerProductEventRoutes } from './product-events';
import { registerWritingStyleRoutes } from './writing-style';
import { registerOutlineRoutes } from './outlines';
import { registerCanonPatchRoutes } from './canon-patches';
import { registerUtilityRoutes } from './utilities';
import { registerCapabilityMigrationRoutes } from './capability-migration';
import { registerCreativeArtifactRoutes } from './creative-artifacts';
import { registerCreationFlowRoutes } from './creation-flows';
import { registerCapabilityRecommendationRoutes } from './capability-recommendations';
import { registerLegacyArtifactStructuringRoutes } from './legacy-artifact-structuring';

/**
 * 注册所有已提取的 API 路由。
 *
 * 所有路由均已从 server.ts 提取到 server/routes/ 目录。
 * server.ts 仅保留 initApp() 入口 + 中间件注册 + 路由挂载。
 */
export function registerRoutes(app: Express) {
  registerDbRoutes(app);
  registerConfigRoutes(app);
  registerSimpleLlmRoutes(app);
  registerExportRoutes(app);
  registerOnboardingRoutes(app);
  registerAgentsRoutes(app);
  registerProductionRoutes(app);
  registerAuditRoutes(app);
  registerSkillsRoutes(app);
  registerContinuationRoutes(app);
  registerWorldRoutes(app);
  registerPromptTestRoutes(app);
  registerProductEventRoutes(app);
  registerWritingStyleRoutes(app);
  registerOutlineRoutes(app);
  registerCanonPatchRoutes(app);
  registerUtilityRoutes(app);
  registerCapabilityMigrationRoutes(app);
  registerCreativeArtifactRoutes(app);
  registerCreationFlowRoutes(app);
  registerCapabilityRecommendationRoutes(app);
  registerLegacyArtifactStructuringRoutes(app);
}
