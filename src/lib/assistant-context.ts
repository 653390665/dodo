import type { AssistantLaunchContext } from '../../shared/types';

function compactLine(label: string, value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return `${label}：${trimmed}`;
}

export function buildAssistantSeedPrompt(context: AssistantLaunchContext): string {
  const lines = [
    '你正在为当前作品提供创作中辅助，请直接围绕下面的上下文给出可执行建议。',
    compactLine('当前作品', context.novelTitle),
    compactLine('作品概要', context.novelSummary),
    compactLine('当前章节', context.chapterTitle),
    compactLine('场景分镜', context.sceneBeats),
    compactLine('当前片段', context.currentExcerpt),
    compactLine('选中文段', context.selectedText),
    compactLine('用户目标', context.intent),
  ].filter(Boolean);

  return lines.join('\n');
}
