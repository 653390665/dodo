export interface Novel {
  id: string;
  title: string;
  authorId: string;
  summary: string;
  coverImage?: string;
  status: 'ongoing' | 'completed' | 'hiatus';
  worldRules?: string; // 规划层：全局世界观设定
  globalOutline?: string; // 规划层：全局大纲
  createdAt: number;
  updatedAt: number;
}

export interface Character {
  id: string;
  novelId: string;
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting' | 'extra';
  summary: string;
  traits: string[];
  bio: string;
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

export interface ChapterVersion {
  id: string;
  chapterId: string;
  content: string;
  wordCount: number;
  author: 'user' | 'writer-agent' | 'editor-agent' | 'auto';
  createdAt: number;
}

export interface Chapter {
  id: string;
  novelId: string;
  title: string;
  content: string;
  order: number;
  wordCount: number;
  sceneBeats?: string;     // 规划层：场景大纲/细纲
  critique?: string;       // 质量层：AI 评审意见
  createdAt: number;
  updatedAt: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  style: string;
  pacing: string;
  bannedWords: string[];
  fewShots: string[];
  createdAt: number;
}
export type ViewType = 'library' | 'editor' | 'world' | 'ai' | 'skills';

