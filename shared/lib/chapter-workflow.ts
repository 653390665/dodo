import type { ChapterWorkflowMeta } from '../types/novel.js';
import { sha256Hex } from './sha256.js';

export function computeChapterWorkflowHash(content: string, sceneBeats?: string): string {
  const normalize = (value: string | undefined) => (value ?? '').replace(/\r\n?/g, '\n');
  return sha256Hex(JSON.stringify({ content: normalize(content), sceneBeats: normalize(sceneBeats) }));
}

export const EMPTY_CHAPTER_WORKFLOW_META: ChapterWorkflowMeta = { version: 1 };
