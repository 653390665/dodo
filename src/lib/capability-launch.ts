import type { CapabilityLaunchState } from '../../shared/types';

const EDITOR_CAPABILITY_ACTIONS = new Set<CapabilityLaunchState['action']>([
  'use-technique',
  'use-project-technique',
  'add-to-stack',
  'run-diagnostic',
  'run-utility',
  'use-overlay',
]);

export function isEditorCapabilityLaunchAction(action: CapabilityLaunchState['action']): boolean {
  return EDITOR_CAPABILITY_ACTIONS.has(action);
}

type EditorCapabilityLaunchResult =
  | { ok: false; code: 'CAPABILITY_NOVEL_MISMATCH' | 'CAPABILITY_CHAPTER_MISMATCH' }
  | {
      ok: true;
      action: 'use-project-technique';
      assetId: string;
      projectTechniqueId: string;
    }
  | {
      ok: true;
      action: Exclude<CapabilityLaunchState['action'], 'use-project-technique'>;
      assetId: string;
      targetChapterId: string;
      sessionCardIds?: readonly string[];
    };

function normalizeSessionCardIds(ids: readonly string[] | undefined): string[] {
  if (!ids?.length) return [];
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, 6);
}

export function resolveEditorCapabilityLaunch(
  launch: CapabilityLaunchState,
  current: { novelId: string; chapterId?: string },
): EditorCapabilityLaunchResult {
  if (launch.novelId !== current.novelId) {
    return { ok: false, code: 'CAPABILITY_NOVEL_MISMATCH' };
  }
  if (launch.action === 'use-project-technique') {
    return { ok: true, action: launch.action, assetId: launch.assetId, projectTechniqueId: launch.assetId };
  }
  if (launch.targetChapterId && launch.targetChapterId !== current.chapterId) {
    return { ok: false, code: 'CAPABILITY_CHAPTER_MISMATCH' };
  }
  if (!current.chapterId) {
    return { ok: false, code: 'CAPABILITY_CHAPTER_MISMATCH' };
  }
  const sessionCardIds = normalizeSessionCardIds(launch.sessionCardIds);
  return {
    ok: true,
    action: launch.action,
    assetId: launch.assetId,
    targetChapterId: current.chapterId,
    ...(sessionCardIds.length ? { sessionCardIds } : {}),
  };
}
