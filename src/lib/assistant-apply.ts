function trimValue(value: string): string {
  return value.trim();
}

export interface AssistantSelection {
  start: number;
  end: number;
  selectedText: string;
}

export function appendAssistantTextToChapterContent(currentContent: string, suggestion: string): string {
  const base = trimValue(currentContent);
  const incoming = trimValue(suggestion);
  if (!base) return incoming;
  if (!incoming) return base;
  return `${base}\n\n${incoming}`;
}

export function appendAssistantTextToSceneBeats(currentBeats: string, suggestion: string): string {
  const base = trimValue(currentBeats);
  const incoming = trimValue(suggestion);
  if (!incoming) return base;
  const normalized = incoming.startsWith('-') ? incoming : `- ${incoming}`;
  if (!base) return normalized;
  return `${base}\n${normalized}`;
}

export function replaceAssistantTextInSelection(
  currentContent: string,
  selection: AssistantSelection,
  suggestion: string,
): string {
  const incoming = trimValue(suggestion);
  const expected = currentContent.slice(selection.start, selection.end);
  if (expected !== selection.selectedText) {
    throw new Error('Selection no longer matches current chapter content');
  }
  return `${currentContent.slice(0, selection.start)}${incoming}${currentContent.slice(selection.end)}`;
}
