import { getConfig } from '../src/lib/config';
import { mergePromptTemplates } from '../src/config/prompt-templates';
import { generateText } from '../src/lib/server-llm';
import { extractJsonPayload } from '../src/lib/extract-skill-json';

const cases = [
  '一个乞丐捡到玉玺的故事',
  '一个现代医生穿越到修仙门派当杂役',
  '一个失忆公主在边境小城开酒馆',
  '一个失败的网文作者被困进自己烂尾小说',
  '一个记忆可以交易的都市悬疑故事',
];

function render(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? ''));
}

const config = getConfig();
const template = mergePromptTemplates(config.promptTemplates).storyCards;

for (const ideaSeed of cases) {
  for (const timeoutMs of [8000, 15000, 30000, 60000]) {
    const prompt = render(template, {
      ideaSeed, chatContext: '',
      expectedWordCount: 180000, storyFocus: '剧情推进', pacingPreference: '紧推进',
    });

    const started = performance.now();
    try {
      const raw = await generateText(config, { prompt, timeoutMs, maxAttempts: 1, maxTokens: 4096 });
      const elapsedMs = Math.round(performance.now() - started);
      let cards = 0; let parse = 'ok';
      try {
        const parsed = extractJsonPayload(raw);
        cards = Array.isArray(parsed?.cards) ? parsed.cards.length : 0;
        if (cards !== 3) parse = `cards=${cards}`;
      } catch (e) { parse = e.message; }
      console.log(JSON.stringify({ ideaSeed, timeoutMs, elapsedMs, rawChars: raw.length, parse, cards }));
    } catch (e) {
      console.log(JSON.stringify({ ideaSeed, timeoutMs, elapsedMs: Math.round(performance.now() - started), error: e.message }));
    }
  }
}
