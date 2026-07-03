export interface Character {
  id: string;
  novelId: string;
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting' | 'extra';
  summary: string;
  traits: string[];
  bio: string;
  current_state?: string;
  concealGender?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface Location {
  id: string;
  novelId: string;
  name: string;
  description: string;
  region: string;
  createdAt: number;
  updatedAt: number;
}

export interface Item {
  id: string;
  novelId: string;
  name: string;
  description: string;
  type: string;
  createdAt: number;
  updatedAt: number;
}

export interface Faction {
  id: string;
  novelId: string;
  name: string;
  description: string;
  leader: string;
  territory: string;
  createdAt: number;
  updatedAt: number;
}

export interface PowerLevel {
  id: string;
  novelId: string;
  name: string;
  description: string;
  tier: number;
  characteristics: string;
  createdAt: number;
  updatedAt: number;
}

export interface TimelineEvent {
  id: string;
  novelId: string;
  title: string;
  description: string;
  timestamp: string;
  statusTag?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Foreshadowing {
  id: string;
  novelId: string;
  title: string;
  description: string;
  status: 'planted' | 'hinted' | 'payoff';
  plantedChapterId?: string;
  payoffChapterId?: string;
  relatedCharacterIds: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoryEntitySnapshot {
  id: string;
  name: string;
  kind: 'character' | 'location' | 'item' | 'faction' | 'powerLevel';
  summary: string;
  statusNote: string;
  updatedAt?: number;
}

export interface StoryStateLedger {
  novelId: string;
  title: string;
  summary: string;
  worldRules: string;
  globalOutline: string;
  recentChapters: Array<{
    id: string;
    title: string;
    order: number;
    sceneBeats: string;
    summary: string;
  }>;
  entityStates: {
    characters: StoryEntitySnapshot[];
    locations: StoryEntitySnapshot[];
    items: StoryEntitySnapshot[];
    factions: StoryEntitySnapshot[];
    powerLevels: StoryEntitySnapshot[];
  };
  timeline: Array<{
    id: string;
    title: string;
    timestamp: string;
    description: string;
    statusTag?: string;
    order: number;
  }>;
  openForeshadowings: Array<{
    id: string;
    title: string;
    description: string;
    status: Foreshadowing['status'];
    plantedChapterId?: string;
    payoffChapterId?: string;
    notes?: string;
  }>;
}

export interface EntityRelationship {
  id: string;
  novelId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationshipType: string;
  description?: string;
  createdAt: number;
}

