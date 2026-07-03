import type { ViewType, WorkspaceFocus, WorkspaceNavKey } from '../../shared/types';

export interface SidebarNavItem {
  id: ViewType;
  label: string;
  navKey?: WorkspaceNavKey;
}

const SIDEBAR_MAIN_ITEMS: SidebarNavItem[] = [
  { id: 'welcome', label: '开始创作' },
  { id: 'library', label: '我的书库' },
  { id: 'workspace', label: '创作工作台', navKey: 'workspace-editor' },
  { id: 'ai', label: '灵感助手' },
];

const SIDEBAR_SECONDARY_ITEMS: SidebarNavItem[] = [
  { id: 'continuation-import', label: '资料续写' },
];

export function getSidebarMainItems(): SidebarNavItem[] {
  return SIDEBAR_MAIN_ITEMS;
}

export function getSidebarSecondaryItems(): SidebarNavItem[] {
  return SIDEBAR_SECONDARY_ITEMS;
}

export function isWorkspaceFamilyView(view: ViewType): boolean {
  return view === 'workspace' || view === 'editor' || view === 'world';
}

export function deriveWorkspaceFocus(
  view: ViewType,
  navKey?: WorkspaceNavKey,
  previousFocus: WorkspaceFocus = 'editor',
): WorkspaceFocus {
  if (navKey === 'workspace-editor' || view === 'editor') return 'editor';
  if (navKey === 'workspace-world' || view === 'world') return 'world';
  return previousFocus;
}
