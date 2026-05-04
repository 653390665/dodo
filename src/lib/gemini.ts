import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateInspiration(prompt: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: "你是一个资深小说编辑和文学创作助手。你的回答应该具有文学性、逻辑性，并能激发作者的灵感。",
      },
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "抱歉，由于灵感枯竭（AI 错误），暂时无法提供建议。";
  }
}
