import type { Express } from 'express';
import { generateText } from '../../src/lib/server-llm';
import { getConfig } from '../../src/lib/config';

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
      res.status(500).json({ error: e.message });
    }
  });

  // 生成角色传记
  app.post('/api/generate-bio', async (req, res) => {
    try {
      const { name, traits, context } = req.body;
      const prompt = `请为以下角色生成传记:\n\n角色名: ${name}\n性格特征: ${traits || '未知'}\n背景: ${context || '未知'}`;
      const result = await generateText(getConfig(), { prompt });
      res.json({ text: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 从文本提取实体
  app.post('/api/extract-entities', async (req, res) => {
    try {
      const { text } = req.body;
      const prompt = `请从以下文本中提取所有实体（人物、地点、物品），以JSON数组返回:\n\n${text}`;
      const result = await generateText(getConfig(), { prompt });
      res.json({ text: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 检测伏笔
  app.post('/api/detect-foreshadowing', async (req, res) => {
    try {
      const { text, context } = req.body;
      const prompt = `请从以下文本中检测伏笔和暗示:\n\n${text}\n\n上下文: ${context || '无'}`;
      const result = await generateText(getConfig(), { prompt });
      res.json({ text: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 分析节奏
  app.post('/api/analyze-pacing', async (req, res) => {
    try {
      const { text } = req.body;
      const prompt = `请分析以下文本的叙事节奏:\n\n${text}`;
      const result = await generateText(getConfig(), { prompt });
      res.json({ text: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 生成实体详情
  app.post('/api/generate-entity-details', async (req, res) => {
    try {
      const { name, type, context } = req.body;
      const prompt = `请为以下${type || '实体'}生成详细设定:\n\n名称: ${name}\n上下文: ${context || '未知'}`;
      const result = await generateText(getConfig(), { prompt });
      res.json({ text: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
