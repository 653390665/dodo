import { GoogleGenAI } from "@google/genai";
import { getConfig } from "./config";

function getAi() {
  const config = getConfig();
  return new GoogleGenAI({ apiKey: config.apiKey });
}

export async function generateInspiration(prompt: string) {
  const config = getConfig();
  try {
    const response = await getAi().models.generateContent({
      model: config.model || "gemini-2.5-pro",
      contents: prompt,
      config: {
        systemInstruction: "你是一个资深小说编辑和文学创作助手。你的回答应该具有文学性、逻辑性，并能激发作者的灵感。",
      },
    });
    return response.text;
  } catch (error) {
    console.error("AI Error:", error);
    return "抱歉，由于 AI 错误，暂时无法提供建议。";
  }
}
