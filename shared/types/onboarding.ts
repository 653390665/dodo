export interface StoryContract {
  genreRules?: string[];
  characterConstraints?: string[];
  plotTaboos?: string[];
  styleAnchors?: string[];
  pacingRules?: string;
  worldBuildingNotes?: string[];
  powerCeiling?: string;
  noResurrection?: boolean;
  characterConsistency?: 'strict' | 'loose';
  customConstraints?: string[];
  foreshadowingDebt?: { open: number; resolved: number; planted: number; overdue: number };
}

export interface GenreProfile {
  id: string;
  label: string;
  icon: string;
  description: string;
  constraints: Record<string, unknown>;
  promptAugmentation: string;
}

