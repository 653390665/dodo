export type PromptStage =
  | 'discovery'
  | 'foundation'
  | 'planning'
  | 'drafting'
  | 'polish'
  | 'review';

export type PromptSurface =
  | 'welcome'
  | 'world-onboarding'
  | 'workspace-beats'
  | 'workspace-draft'
  | 'chapter-polish'
  | 'chapter-review';

export function selectPromptStageForSurface(surface: PromptSurface): PromptStage {
  switch (surface) {
    case 'welcome':
      return 'discovery';
    case 'world-onboarding':
      return 'foundation';
    case 'workspace-beats':
      return 'planning';
    case 'workspace-draft':
      return 'drafting';
    case 'chapter-polish':
      return 'polish';
    case 'chapter-review':
      return 'review';
  }
}
