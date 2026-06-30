import type { Express } from 'express';
import { generateText } from '../lib/server-llm';
import { getConfig } from '../lib/config';
import { rateLimit } from '../middleware/rate-limit';
import { logger } from '../logger';

/**
 * Simple LLM proxy routes — no shared local helpers needed.
 */
export function registerSimpleLlmRoutes(app: Express) {
  // 扩展创意片段
  app.post('/api/expand-fragment', async (req, res) => {
    try {
      const { text, context } = req.body;
      const prompt = `请将以下创意片段扩展为更详细的描述:\n\n${text}\n\n上下文: ${context || '无'}`;
      const result = await generateText(getConfig(), { prompt });
      res.json({ text: result });
    } catch (e: any) {
      logger.error("Simple LLM route error:", e);
      res.status(500).json({ error: "Internal server error" });
    }
  });


  // Remaining routes (generate-bio, extract-entities, detect-foreshadowing,
  // analyze-pacing, generate-entity-details) are handled by world.ts with
  // enhanced prompt engineering and continuation-pack context support.
}
