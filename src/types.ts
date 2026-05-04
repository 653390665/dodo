export interface Novel {
  id: string;
  title: string;
  authorId: string;
  summary: string;
  coverImage?: string;
  status: 'ongoing' | 'completed' | 'hiatus';
  createdAt: number;
  updatedAt: number;
}

export interface Chapter {
  id: string;
  novelId: string;
  title: string;
  content: string;
  order: number;
  wordCount: number;
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
}

export type ViewType = 'library' | 'editor' | 'world' | 'ai';
