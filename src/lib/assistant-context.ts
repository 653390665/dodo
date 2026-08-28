import type { AssistantLaunchContext } from '../../shared/types';

function compactLine(label: string, value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const bounded = trimmed.length > 2_000 ? `${trimmed.slice(0, 2_000)}...` : trimmed;
  return `${label}：${bounded}`;
}

export function buildAssistantSeedPrompt(context: AssistantLaunchContext): string {
  const lines = [
    '你正在为当前作品提供创作中辅助，请直接围绕下面的上下文给出可执行建议。',
    compactLine('当前作品', context.novelTitle),
    compactLine('作品概要', context.novelSummary),
    compactLine('当前章节', context.chapterTitle),
    compactLine('场景分镜', context.sceneBeats),
    compactLine('世界规则', context.worldRules),
    compactLine('全局大纲', context.globalOutline),
    compactLine('关键人物', context.charactersContext),
    compactLine('开放伏笔', context.foreshadowingsContext),
    compactLine('时间线', context.timelineContext),
    compactLine('能力快照', context.capabilitySnapshot),
    compactLine('当前片段', context.currentExcerpt),
    compactLine('选中文段', context.selectedText),
    compactLine('用户目标', context.intent),
  ].filter(Boolean);

  return lines.join('\n');
}
