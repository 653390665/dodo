import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { PLANNER_SOUL, WRITER_SOUL, CRITIC_SOUL } from "./src/config/souls.js";

// Ensure Gemini API Key is available
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-pro",
  apiKey: process.env.GEMINI_API_KEY,
});

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
  const skillsList = skills.map(s => `
- ${s.name}: ${s.description}
  【笔调要求】${s.style}
  【节奏要求】${s.pacing}
  【绝对禁语】${(s.bannedWords || []).join(", ")}
  【经典句式示例】
  ${(s.fewShots || []).map((fs: string) => `  * "${fs}"`).join('\n')}
`).join('\n');
  return `\n【当前激活的书籍特征技能 (Skills)】\n你必须严格模仿以下提炼出的文风和技法：\n${skillsList}\n`;
}

async function writerNode(state: typeof GraphState.State, config: any) {
  const skillsInfo = buildSkillsPrompt(state.skills || []);
  const prompt = `
${WRITER_SOUL}

【当前小说背景设定】
${state.contextStr}
${skillsInfo}
【当前章节细纲】
${state.sceneBeats}

【总编的打回意见（如果为空代表初稿）】
${state.criticFeedback || "暂无意见，请直接撰写初稿。"}

请根据以上细纲与意见进行正文的撰写/修改。`;

  const res = await llm.invoke(prompt, config);
  return { 
    draftContent: res.content.toString(), 
    iterationCount: state.iterationCount + 1 
  };
}

async function criticNode(state: typeof GraphState.State, config: any) {
  const skillsInfo = buildSkillsPrompt(state.skills || []);
  const prompt = `
${CRITIC_SOUL}

【当前小说背景设定】
${state.contextStr}
${skillsInfo}
【当前章节细纲】
${state.sceneBeats}

【主笔刚刚给出的正文草稿】
${state.draftContent}

请按照审查维度进行毒舌点评。如果有激活特征技能，请重点关注是否做到了那些特征。如果你觉得质量已经达标（满分100分，目前能拿85分以上），或者虽然有瑕疵但已经修改得足够好了，请在你的回复的最后加上大写的 "PASS" 字样。如果不到 85 分，指出痛点并打回。
`;

  const res = await llm.invoke(prompt, config);
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
