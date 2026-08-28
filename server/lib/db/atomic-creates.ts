import type { Chapter, Foreshadowing, Novel, Skill } from '../../../shared/types';
import { runInTransaction } from '../db-instance.js';
import { createChapter } from './chapters.js';
import { createForeshadowing } from './ideas.js';
import { createNovel } from './novels.js';
import { createSkill } from './skills.js';

/** Persist related entities as one logical operation. SQLite rolls back the whole batch on any error. */
export function createNovelWithChapter(novel: Novel, chapter: Chapter): void {
  if (chapter.novelId !== novel.id) throw new Error('NOVEL_CHAPTER_SCOPE_MISMATCH');
  runInTransaction(() => {
    createNovel(novel);
    createChapter(chapter);
  });
}

export function createForeshadowingsBatch(items: Foreshadowing[]): void {
  runInTransaction(() => {
    for (const item of items) createForeshadowing(item);
  });
}

export function createSkillsBatch(items: Skill[]): void {
  runInTransaction(() => {
    for (const item of items) createSkill(item);
  });
}
