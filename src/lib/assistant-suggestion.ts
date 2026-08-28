import type {
  AssistantLaunchContext,
  AssistantPrimaryAction,
  AssistantSuggestionKind,
} from '../../shared/types';

export function classifyAssistantSuggestion(
  content: string,
  _context: AssistantLaunchContext,
): AssistantSuggestionKind {
  const trimmed = content.trim();
  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);

  if (lines.length >= 2 && lines.filter((line) => line.startsWith('-') || /^\d+\./.test(line)).length >= 2) {
    return 'scene-beat';
  }

  if (/(角色|地点|物品|设定|身份|特点|规则)[:：]/.test(trimmed)) {
    return 'setting';
  }

  if (trimmed.length >= 40 && !trimmed.includes('\n')) {
    return 'prose';
  }

  return 'fragment';
}

export function getPrimaryAssistantAction(
  kind: AssistantSuggestionKind,
  context: AssistantLaunchContext,
): AssistantPrimaryAction {
  if (kind === 'setting') return 'extract-setting';
  if (kind === 'scene-beat') return 'append-scene-beat';
  if (kind === 'fragment') return 'save-fragment';
  if (context.selectedText && context.selectionStart !== undefined && context.selectionEnd !== undefined) {
    return 'replace-selection';
  }
  return 'append-content';
}
