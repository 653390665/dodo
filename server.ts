import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { orchestrationApp } from './workflow';
import { GoogleGenAI } from "@google/genai";
import mammoth from 'mammoth';
import { initDb } from './src/lib/db';
import * as db from './src/lib/db';

// Initialize local database on startup
initDb();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' })); // Increase limit for text upload
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Generic DB proxy — frontend calls this instead of importing db.ts directly
  app.post('/api/db', (req, res) => {
    const { method, args = [] } = req.body;
    const fn = (db as Record<string, Function>)[method];
    if (typeof fn !== 'function') {
      return res.status(400).json({ error: `Unknown method: ${method}` });
    }
    try {
      const result = fn(...args);
      res.json({ result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // SSE endpoint for change notifications (replaces the subscribe() pattern)
  app.get('/api/db/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const { subscribe } = db;
    const unsub = subscribe(() => {
      res.write('data: {}\n\n');
    });

    req.on('close', () => unsub());
  });

  app.post('/api/parse-doc', async (req, res) => {
    try {
      const { filename, filedata } = req.body;
      let text = '';
      
      if (filename.endsWith('.txt')) {
        text = Buffer.from(filedata, 'base64').toString('utf8');
      } else if (filename.endsWith('.docx')) {
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

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      let rawText = response.text || "{}";
      rawText = rawText.replace(/```(json)?/g, '').trim();

      res.json(JSON.parse(rawText));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/audit', async (req, res) => {
    try {
      const { draftContent, sceneBeats, contextStr, skills = [] } = req.body;
      const skillsInfo = skills.length > 0 
        ? `\n【当前挂载的叙事 DNA 插件】\n${skills.map((s: any) => `
- 技能名：${s.name}
- 核心笔调：${s.style}
- 句式特征：${s.sentenceStructure}
- 禁用红线：${s.bannedWords.join('、')}
- 意象/符号：${s.imagery?.join('、')}
        `).join('\n')}\n` : "";
      
      const prompt = `
你是一个极为挑剔、网文阅历 20 年的“金牌总编（Critic Agent）”。
你的任务是扫除文字中的平庸、逻辑漏洞以及由于 AI 写作产生的机械感。

【世界观架构】
${contextStr}

【叙事 DNA 插件要求】
${skillsInfo}

【本节分镜蓝图 (Beats)】
${sceneBeats}

【待审计的正文草稿 (Draft)】
${draftContent}

---

请执行“分子级”深度审计，重点寻找以下败笔：
1. **机械性倾向**：是否连续使用“他/她 + 动作”？是否段落起首极其呆板？
2. **对话僵硬度**：对白是否缺乏潜台词？是否只是干瘪的输出信息而没有环境交互？
3. **DNA 损耗**：文字是否丢失了 Skill 插件定义的笔调和意象？

请严格按以下要求（Markdown格式）输出反馈，不要使用多余的开场白：
1. 评分 (Score)：给出 0-100 的评分，并附带简短的毒舌评语。
2. 具体问题点（病毒点扫描）：逐一扫描文中的问题（逻辑漏洞、人物OOC、节奏拖沓、违背所挂载的 Skill 设定的地方等）。
3. 修改建议（手术级修改方案）：给出具体的重写方向或段落级修改演示，呈现“白金大神”级的质感。
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      res.json({ feedback: response.text });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  // API Route setup
  app.post('/api/rewrite', async (req, res) => {
    try {
      const { text, instruction, contextStr } = req.body;
      const prompt = `
你是一个顶级的网文主编及文学润色大师。用户正在创作一部长篇小说，并希望你改写或润色下面提供的一段文字。

【整体世界观与上下文背景】
${contextStr}

【需要改写的原段落】
"""
${text}
"""

${instruction ? `【用户的改写要求 / 改写方向】\n${instruction}` : '【润色要求】：请在保持原意和主线剧情不变的前提下，优化词境、修整重复词汇，使文字更加流畅、富有画面感和情绪张力。'}

请结合以上【整体世界观与上下文背景】（尤其是其中挂载的技能插件、文风、红线等设定）以及用户的改写要求，直接输出改写后的文本。不要输出任何多余的客套话或前导词。字数应该与原段落大体相当（也可以稍作合理的增删以圆润文笔）。
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      res.json({ text: response.text });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

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
      const { text = '' } = req.body;
      const prompt = `
你是一个顶级的网文“架构级”拆书专家。你的任务是分析一段范例文本，并生成一张高精准度的 "Skill Card" (包含写作方式、剧情、伏笔、世界观、设定、角色特征等多维度的叙事 DNA 插件)。

请对文本进行语料库级别的分析，重点观察：
- **写作风格**（用词偏好、句法特征、意象系统等）
- **人物特征**（角色性格模板、交互模式、行为动机特征）
- **世界观与设定**（力量体系、背景规则、社会结构）
- **剧情与爽点**（情节推进套路、矛盾冲突模式、高潮节奏感）
- **伏笔与草蛇灰线**（铺垫手法、悬念机制）

请严格按以下 JSON 格式输出，不要包含 Markdown 代码块标记：
{
  "name": "该写作流派/设定的命名（如：诡秘式疯狂侧写、凡人流极致谨慎）",
  "description": "一句话总结该设定的核心维度",
  "style": "详细描述其笔调傾向及句法特征",
  "pacing": "分析其整体剧情推进与高低潮转换节奏",
  "characterTraits": "提炼出的人物特征、性格塑造模板、对白风格",
  "worldBuilding": "推导出的世界观架构规则、力量体系及独特设定",
  "plotPattern": "剧情推进节奏、矛盾设计及爽点套路结构",
  "foreshadowing": "伏笔埋设手法与悬念解谜结构",
  "corePatterns": ["萃取出的3-5个核心模式/剧情要素"],
  "bannedElements": ["在该体系下严禁出现的、会破坏基调的俗套设定或词汇"],
  "vocabulary": ["萃取出的核心特色词汇"],
  "fewShots": ["原样摘录最有代表性的片段"],
  "stabilityScore": 90, 
  "evaluationFeedback": "对该插件在 AI 生成时的稳定性预测：例如'角色特征鲜明，设定自恰，AI极易复刻'"
}

以下为分析素材：
${text.substring(0, 30000)}
      `;
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      let responseText = response.text || "{}";
      responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(responseText);
      parsed.version = 1;
      res.json(parsed);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/generate-bio', async (req, res) => {
    try {
      const { name, role, summary, traits = [], background, features, habits, personality, inventory, abilities, globalOutline, worldRules } = req.body;
      
      const prompt = `
你是一个专业的创作协助 AI，擅长深度刻画小说角色。
请根据以下碎片的角色信息以及世界观设定，撰写一段富有深度、细节丰富且具有文学色彩的角色背景故事（Biography / 详细背景设定）。

【全局故事大纲】：${globalOutline || '无'}
【世界观法则】：${worldRules || '无'}

【角色名称】：${name}
【身份定位】：${role}
【核心简介】：${summary}
【性格特质】：${traits.join('、')}
${background ? `【背景经历】：${background}` : ''}
${features ? `【外貌特征】：${features}` : ''}
${habits ? `【行为习惯】：${habits}` : ''}
${personality ? `【人格魅力】：${personality}` : ''}
${inventory ? `【随身道具】：${inventory}` : ''}
${abilities ? `【独特能力】：${abilities}` : ''}

要求：
1. 语言精炼且富有张力，适合放在小说设定集中。
2. 不要只是简单罗列信息，要结合“世界观法则”和“主线大纲”通过描述勾勒出一个有血有肉的人物形象，或者为其补充符合世界观的过去经历片段。
3. 重点突出该角色与其身份定位（${role}）相符的独特性。
4. 字数在 200-400 字之间。
5. 直接输出故事内容，不要包含任何前导词（如“好的，这是为您生成的...”）。
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      res.json({ bio: response.text });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/generate-outline', async (req, res) => {
    try {
      const { title, worldRules, seedOutline, expectedWordCount } = req.body;
      
      const prompt = `
你是一个顶级的网文主编及架构师。用户正在进行长篇小说的架构规划。
小说的预计总字数是：${expectedWordCount}字。
${title ? `小说名称：${title}` : ''}
${worldRules ? `世界观及设定：${worldRules}` : ''}
${seedOutline ? `用户的初始构思/种子创意：\n${seedOutline}` : ''}

请根据预计总字数，将整部小说合理地划分为几个大卷（或大情节弧线），明确规划出每卷的内容梗概、字数分配以及章回数量预测。
规划必须结构清晰、节奏合理，符合网文商业大纲的标准（如：起承转合、核心矛盾、高潮爆发等）。如果字数极大（如超越 100 万字），请重点细化前中期，后期做宏观走向即可。

请直接输出 markdown 格式的全局大纲，排版要清晰、美观。不要输出多余的客套话。
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      res.json({ outline: response.text });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/extract-entities', async (req, res) => {
    try {
      const { text = '', existingNames = [] } = req.body;
      
      const prompt = `
你是一个极为敏锐的设定集萃取 AI。请阅读下方的网文片段，从中提取所有的专有名词（包括：人物姓名、地点/据点/组织名称、特殊功法/道具/武器名称）。

网文片段：
"""
${text.substring(0, 15000)}
"""

当前数据库中已经存在的实体名称列表（Existing Entities）：
${existingNames && existingNames.length > 0 ? existingNames.join(', ') : '无'}

请仔细比对：
1. 本次片段中出现的名称，如果在“当前存在的实体名称”中，请归入 activeExisting。
2. 本次片段中出现的【新名称】（不在存量列表中），请归入 newEntities，并附带它在文中的简单上下文解释（50字以内）以及猜测的类型（如：character, location, item）。

请严格以 JSON 格式输出，不要包含 markdown 标记：
{
  "activeExisting": ["名字1", "名字2"],
  "newEntities": [
    { "name": "新名字A", "type": "character", "context": "在某酒馆出场的神秘老者大能" }
  ]
}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      // Attempt to clean markdown if present
      let rawText = response.text.trim();
      rawText = rawText.replace(/```(json)?/g, '').trim();

      res.json(JSON.parse(rawText));
    } catch (e) {
      console.error('Extract entities error:', e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/api/generate-entity-details', async (req, res) => {
    try {
      const { name, type, context } = req.body;
      
      const prompt = `你是一个网文世界观架构师。系统在一个新章节中扫描到了一个新设定实体，请根据上下文为其生成一份初始的万物词典（World Bible）条目。

实体名称：${name}
初步判断的类型：${type} (可能是人物 character、地点 location、物品 item、概念等，你可以根据上下文自行调整)
提取的上下文：${context}

请严格根据类型输出不同的 JSON 结构（直接输出 JSON，不要 Markdown 标记）：

如果它最可能是【人物 Character】：
{
  "entityType": "character",
  "name": "${name}",
  "role": "supporting", 
  "summary": "一句话简介",
  "traits": ["特性1", "特性2"],
  "bio": "根据上下文生成的背景设定补全（100字左右）"
}

如果它最可能是【地点 Location】：
{
  "entityType": "location",
  "name": "${name}",
  "region": "所属区域（根据上下文推理）",
  "description": "详细描述（100字左右）"
}

如果它最可能是【物品/概念 Item/Concept】：
{
  "entityType": "item",
  "name": "${name}",
  "type": "法宝、武器、丹药、功法等",
  "description": "详细描述及功能（100字左右）"
}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      let rawText = response.text || "{}";
      rawText = rawText.replace(/```(json)?/g, '').trim();

      res.json(JSON.parse(rawText));
    } catch (e) {
      console.error('Generate entity details error:', e);
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