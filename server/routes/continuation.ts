import type { Express } from 'express';
import { generateText } from '../lib/server-llm';
import { getConfig } from '../lib/config';
import { logger } from '../logger';
import { generateId } from '../id';
import {
  buildContinuationPackParseAttempts,
  buildContinuationPackPrompt,
} from '../../shared/lib/continuation-pack-parse';
import { parseModelJsonPayload } from '../../shared/lib/model-json';
import * as db from '../lib/db';
import { classifyContinuationSource } from '../../shared/lib/continuation-pack';
import { validate, parseDocSchema, continuationParseSchema } from '../validation';

async function extractUploadedText(filename: string, filedata: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.json')) {
    return Buffer.from(filedata, 'base64').toString('utf8');
  }
  if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const buffer = Buffer.from(filedata, 'base64');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  throw new Error('Unsupported file type.');
}

export function registerContinuationRoutes(app: Express) {
  app.post('/api/parse-doc', validate(parseDocSchema), async (req, res) => {
    try {
      const { filename, filedata } = req.body;
      let text = '';

      if (filename.endsWith('.txt') || filename.endsWith('.md') || filename.endsWith('.json')) {
        text = Buffer.from(filedata, 'base64').toString('utf8');
      } else if (filename.endsWith('.docx')) {
        const mammoth = await import('mammoth');
        const buffer = Buffer.from(filedata, 'base64');
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } else {
        return res.status(400).json({ error: 'Unsupported file type.' });
      }

      // Now use AI to parse this text into World Bible Entities
      const prompt = `
你是一个小说世界观设定解析专家。用户上传了一份设定文档（内容在下方）。
请提取其中的世界观设定、角色信息、大纲、以及时间线等。

【提取要求】:
1. "globalOutline" (全局大纲): 一段概括性的长文。
2. "worldRules" (世界观设定): 一段概括性的长文。
3. "characters" (角色): name, role(protagonist|antagonist|supporting|extra), summary, bio(长文字), traits(数组)
4. "locations" (地点/地域): name, region, description
5. "items" (物品/法宝): name, type, description
6. "factions" (势力): name, leader, territory, description
7. "powerLevels" (境界等级): name, tier(数字), characteristics(特征描述), description
8. "timelineEvents" (时间线): title, timestamp, description, order(数字)

文档内容：
"""
${text.substring(0, 30000)}
"""

请严格以JSON格式输出，结构如下：
{
  "globalOutline": "...",
  "worldRules": "...",
  "characters": [...],
  "locations": [...],
  "items": [...],
  "factions": [...],
  "powerLevels": [...],
  "timelineEvents": [...]
}
`;

      let rawText = await generateText(getConfig(), { prompt });
      rawText = rawText.replace(/```(json)?/g, '').trim();

      res.json(JSON.parse(rawText));
    } catch (e) {
      logger.error(String(e));
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post('/api/continuation-packs/parse', validate(continuationParseSchema), async (req, res) => {
    try {
      const { novelId = '', title = '', documents = [] } = req.body;
      if (!novelId.trim()) return res.status(400).json({ error: 'novelId is required' });
      if (!documents.length) return res.status(400).json({ error: 'At least one document is required' });

      const parsedDocs = await Promise.all(documents.map(async (doc: any) => {
        const text = await extractUploadedText(doc.filename, doc.filedata);
        const trimmed = text.slice(0, 60000);
        const chineseChars = trimmed.replace(/[^一-鿿]/g, '');
        if (chineseChars.length < 20) {
          throw new Error(`"${doc.filename}" 内容过短或无可识别中文文本，请检查文件。`);
        }
        return { filename: doc.filename, text: trimmed };
      }));

      const llmConfig = getConfig();
      const buildDocumentsForPrompt = (maxCharsPerDocument: number) =>
        parsedDocs.map((d: any) =>
          `【${d.filename}】\n${d.text.slice(0, maxCharsPerDocument)}\n`
        ).join('\n---\n');

      const shouldRetryWithShorterPrompt = (message: string) =>
        /only thinking\/reasoning content|empty response|可解析的 JSON|不完整的 JSON|LLM returned empty response/i.test(message);
      const promptAttempts = buildContinuationPackParseAttempts(llmConfig.baseUrl);

      let parsed: any = null;
      let lastParseError: unknown = null;
      for (const attempt of promptAttempts) {
        try {
          const raw = await generateText(llmConfig, {
            prompt: buildContinuationPackPrompt(
              buildDocumentsForPrompt(attempt.maxCharsPerDocument),
              attempt.compactMode,
            ),
            timeoutMs: 90_000,
            maxAttempts: 3,
            maxTokens: attempt.maxTokens,
            responseMimeType: 'application/json',
            disableThinking: true,
          });
          parsed = parseModelJsonPayload<any>(raw);
          break;
        } catch (error) {
          lastParseError = error;
          const message = error instanceof Error ? error.message : String(error);
          if (!shouldRetryWithShorterPrompt(message) || attempt === promptAttempts[promptAttempts.length - 1]) {
            throw error;
          }
        }
      }
      if (!parsed) {
        throw lastParseError instanceof Error ? lastParseError : new Error(String(lastParseError || '模型未返回可用 JSON，请重试。'));
      }

      const now = Date.now();
      const packId = `cont-pack-${generateId()}`;
      const pack = {
        id: packId,
        novelId,
        title: title || '续写资料包',
        status: 'draft' as const,
        sourceDocuments: parsedDocs.map((d: any, i: number) => ({
          id: `${packId}-doc-${i}`,
          packId,
          filename: d.filename,
          kind: classifyContinuationSource(d.filename, d.text),
          text: d.text,
          excerpt: d.text.slice(0, 500),
          createdAt: now,
        })),
        canonFacts: (parsed.canonFacts || []).map((f: any, i: number) => ({ id: `${packId}-fact-${i}`, ...f })),
        characterStates: parsed.characterStates || [],
        plotState: parsed.plotState || { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
        styleProfile: parsed.styleProfile || { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
        contradictions: (parsed.contradictions || []).map((c: any, i: number) => ({ id: `${packId}-contra-${i}`, ...c })),
        sourceMap: parsed.sourceMap || { sections: [], keyConflicts: [] },
        readingQuestions: (parsed.readingQuestions || []).map((q: any, i: number) => ({ id: `${packId}-question-${i}`, ...q })),
        continuationGaps: (parsed.continuationGaps || []).map((g: any, i: number) => ({ id: `${packId}-gap-${i}`, ...g })),
        continuationTask: parsed.continuationTask || '',
        sourceBadge: 'user-uploaded' as const,
        createdAt: now,
        updatedAt: now,
      };

      db.createContinuationPack(pack);
      res.json({ pack });
    } catch (e) {
      logger.error(String(e));
      const message = e instanceof Error ? e.message : String(e);
      if (/only thinking\/reasoning content|empty response|可解析的 JSON|不完整的 JSON|LLM returned empty response/i.test(message)) {
        return res.status(502).json({
          error: '模型未返回可用 JSON，请重试。',
        });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
