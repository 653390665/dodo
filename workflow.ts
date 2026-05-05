import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { PLANNER_SOUL, WRITER_SOUL, CRITIC_SOUL } from "./src/config/souls.js";

let _llm: ChatGoogleGenerativeAI | null = null;

function getLlm(): ChatGoogleGenerativeAI {
  if (!_llm) {
    const apiKey = process.env.API_KEY || '';
    _llm = new ChatGoogleGenerativeAI({
      model: process.env.API_MODEL || "gemini-2.5-pro",
      apiKey,
    });
  }
  return _llm;
}

export const GraphState = Annotation.Root({
  contextStr: Annotation<string>(),
  sceneBeats: Annotation<string>(),
  draftContent: Annotation<string>(),
  criticFeedback: Annotation<string>(),
  isValid: Annotation<boolean>(),
  iterationCount: Annotation<number>(),
  maxIterations: Annotation<number>(),
  skills: Annotation<any[]>(),
});

function buildSkillsPrompt(skills: any[]) {
  if (!skills || skills.length === 0) return "";

  // 1. 提取全局规约（去重合并）
  const allBannedElements = Array.from(new Set(skills.flatMap(s => [...(s.bannedWords || []), ...(s.bannedElements || [])])));
  const allImagery = Array.from(new Set(skills.flatMap(s => s.imagery || [])));
  const allVocabulary = Array.from(new Set(skills.flatMap(s => s.vocabulary || [])));
  const allCorePatterns = Array.from(new Set(skills.flatMap(s => s.corePatterns || [])));

  // 2. 分层描述：第一个技能为主，后续为辅
  const primarySkill = skills[0];
  const secondarySkills = skills.slice(1);

  let prompt = `\n【当前挂载的复合叙事 DNA (Composite Narrative Signature)】\n`;
  prompt += `你现在的文字灵魂由以下 ${skills.length} 个维度交织而成，请进行深度化学反应式的融合：\n\n`;

  prompt += `核心描述基调 (Primary Voice)：\n`;
  prompt += `- 基于《${primarySkill.name}》：${primarySkill.style}\n`;
  if (primarySkill.sentenceStructure) {
     prompt += `  句法要求：“${primarySkill.sentenceStructure}”\n`;
  }
  prompt += `  节奏推进遵循：“${primarySkill.pacing}”\n`;
  if (primarySkill.characterTraits) {
     prompt += `  核心人物特征模版：“${primarySkill.characterTraits}”\n`;
  }
  if (primarySkill.worldBuilding) {
     prompt += `  世界观/力量体系感：“${primarySkill.worldBuilding}”\n`;
  }
  if (primarySkill.plotPattern) {
     prompt += `  剧情/爽点套路结构：“${primarySkill.plotPattern}”\n`;
  }
  if (primarySkill.foreshadowing) {
     prompt += `  悬念及伏笔手法：“${primarySkill.foreshadowing}”\n`;
  }
  prompt += `\n`;

  if (secondarySkills.length > 0) {
    prompt += `质感滤镜与大纲补强 (Flavor Overlays)：\n`;
    secondarySkills.forEach(s => {
      prompt += `- 融合《${s.name}》：在描写层引入其“${s.style}”的色彩。`;
      if (s.characterTraits) prompt += `引入人物特征：${s.characterTraits}。`;
      if (s.plotPattern) prompt += `借鉴剧情节奏：${s.plotPattern}。`;
      prompt += `\n`;
    });
    prompt += `\n`;
  }

  prompt += `全局语法规约 (Global Constraints)：\n`;
  if (allImagery.length > 0) prompt += `- 【核心意象群】：${allImagery.join("、")} (在描写中高频出现这些符号)\n`;
  if (allVocabulary.length > 0) prompt += `- 【标志性词汇】：${allVocabulary.join("、")} (优先使用这些具有辨识度的词汇)\n`;
  if (allCorePatterns.length > 0) prompt += `- 【核心行文套路】：${allCorePatterns.join("、")} (在构建桥段时，请采纳这些模式)\n`;
  if (allBannedElements.length > 0) prompt += `- 【绝对禁忌红线】：${allBannedElements.join("、")} (如果你在文中写出 these 设定或词汇，总编会立刻撕碎草稿)\n\n`;

  prompt += `风格对标样例 (Composite Few-Shots)：\n`;
  skills.forEach(s => {
    (s.fewShots || []).slice(0, 2).forEach((fs: string) => {
      prompt += `  * "${fs}" (来自 ${s.name})\n`;
    });
  });

  prompt += `\n指令：不要生硬堆砌，要把上面提到的《人物特征》、《世界观》、《剧情》、《设定》和写作方式有机相融，打造独属于你的复合风格。`;
  
  return prompt;
}

async function writerNode(state: typeof GraphState.State, config: any) {
  const skillsInfo = buildSkillsPrompt(state.skills || []);
  const prompt = `
${WRITER_SOUL}

【世界观与人物志】
${state.contextStr}

【叙事 DNA 规约】
${skillsInfo}

【分镜蓝图 (Beats)】
${state.sceneBeats}

【总编的审读建议】
${state.criticFeedback || "初稿阶段，请全力输出。"}

---

请执行“主笔”职责进行内容扩写：
1. **画面感表现**：使用 Skill 中的“风格意象”和“高频词汇”增强现场感。
2. **句法模拟**：严格遵守“句式特征”，模仿 Few-shots 的质感。
3. **情绪穿透**：通过分镜细纲，将冲突推向高潮。

请直接输出正文内容。`;

  const res = await getLlm().invoke(prompt, config);
  return {
    draftContent: res.content.toString(),
    iterationCount: state.iterationCount + 1
  };
}

async function criticNode(state: typeof GraphState.State, config: any) {
  const skillsInfo = buildSkillsPrompt(state.skills || []);
  const prompt = `
${CRITIC_SOUL}

【背景架构】
${state.contextStr}

【预期风格 (Skills DNA)】
${skillsInfo}

【本节分镜要点 (Beats)】
${state.sceneBeats}

【待审计的正文草稿 (Current Draft)】
${state.draftContent}

---

你现在的身份是“金牌内容总编”，请执行“暴力审计”：
1. **执行病毒点扫描**：寻找机械重复、对话平庸、过渡注水等 AI 写作通病。
2. **评估 DNA 契合度**：检查文字是否完全吸收了 Skill 插件的质感。
3. **给出手术建议**：不要废话，直接给出如何改能变强的具体方案。

必须严格遵守 ${CRITIC_SOUL} 中要求的输出格式。`;

  const res = await getLlm().invoke(prompt, config);
  const feedback = res.content.toString();
  const isValid = feedback.includes("PASS");
  
  return { 
    criticFeedback: feedback,
    isValid
  };
}

function shouldContinue(state: typeof GraphState.State) {
  if (state.isValid) {
    return END;
  }
  if (state.iterationCount >= state.maxIterations) {
    return END;
  }
  return "writer";
}

const workflow = new StateGraph(GraphState)
  .addNode("writer", writerNode)
  .addNode("critic", criticNode)
  .addEdge(START, "writer")
  .addEdge("writer", "critic")
  .addConditionalEdges("critic", shouldContinue)

export const orchestrationApp = workflow.compile();
