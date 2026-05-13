export interface Shortcut {
  key: string;
  mod: boolean;
  shift?: boolean;
  label: string;
  desc: string;
}

export const SHORTCUTS: Record<string, Shortcut> = {
  undo: { key: 'z', mod: true, label: 'Cmd+Z', desc: '撤销' },
  redo: { key: 'z', mod: true, shift: true, label: 'Cmd+Shift+Z', desc: '重做' },
  view1: { key: '1', mod: true, label: 'Cmd+1', desc: '开始创作' },
  view2: { key: '2', mod: true, label: 'Cmd+2', desc: '我的书库' },
  view3: { key: '3', mod: true, label: 'Cmd+3', desc: '创作舞台' },
  view4: { key: '4', mod: true, label: 'Cmd+4', desc: '设定记忆' },
  view5: { key: '5', mod: true, label: 'Cmd+5', desc: '灵感助手' },
};

export function matchesShortcut(e: KeyboardEvent, s: Shortcut): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  if (mod !== s.mod) return false;
  if (!!s.shift !== e.shiftKey) return false;
  return true;
}
