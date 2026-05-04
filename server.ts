import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { orchestrationApp } from './workflow';
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' })); // Increase limit for text upload

  // API Route setup
  app.post('/api/orchestrate', async (req, res) => {
    const { contextStr, sceneBeats, maxIterations = 2, draftContent = "", skills = [] } = req.body;
    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const stream = await orchestrationApp.streamEvents(
        {
          contextStr,
          sceneBeats,
          draftContent,
          criticFeedback: "",
          isValid: false,
          iterationCount: 0,
          maxIterations,
          skills
        },
        { version: "v2" }
      );

      for await (const event of stream) {
        if (event.event === "on_chat_model_stream") {
          // Send AI token stream
          const token = event.data?.chunk?.content;
          if (token) {
            res.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
          }
        } else if (event.event === "on_chain_end" && event.name === "writer") {
           res.write(`data: ${JSON.stringify({ type: 'writer_done' })}\n\n`);
        } else if (event.event === "on_chain_end" && event.name === "critic") {
           const state = event.data?.output;
           if (state) {
             res.write(`data: ${JSON.stringify({ type: 'critic_done', feedback: state.criticFeedback, isValid: state.isValid })}\n\n`);
           }
        }
      }
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err) {
      console.error(err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
      res.end();
    }
  });

  app.post('/api/extract-skill', async (req, res) => {
    try {
      const { text } = req.body;
      const prompt = `
你是一个顶级的网文拆书专家。请阅读用户提供的万字范例文稿，深度剖析其剧情节奏、悬念设置、断章技巧、描写习惯（如独特的比喻或白描手法），萃取出可被 AI 直接服用的 "Skill" json 规则集。

务必返回纯粹的 JSON 字符串（无需 \`\`\`json 标记），键必须严格符合以下结构：
{
  "name": "这里起一个很酷的技能卡名字，比如：乌贼式狂乱低语渲染",
  "description": "简要介绍该写作风格的精髓",
  "style": "分析其用词倾向（例：冷峻、克制、包含大量心理学词汇）",
  "pacing": "分析节奏与断章（例：日常铺垫漫长，战斗极简）",
  "bannedWords": ["这里填上原作者绝对不会使用的俗套词汇，如 不禁、倒吸一口凉气"],
  "fewShots": ["原样摘录小说中极具代表性的精彩原句1", "原样摘录小说中极具代表性的精彩原句2"]
}

以下为范例文稿片段：
${text.substring(0, 30000)} // 截取前三万字避免超长
      `;
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      let responseText = response.text || "{}";
      responseText = responseText.replace(/\\`\\`\\`json/g, '').replace(/\\`\\`\\`/g, '').trim();
      res.json(JSON.parse(responseText));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();