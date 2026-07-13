import type { Chapter, ChapterMetadata } from '../../shared/types';

/**
 * Converts a ChapterMetadata (which lacks content/sceneBeats/critique) to a
 * full Chapter with empty string defaults. Use this when a component needs
 * a Chapter but only ChapterMetadata is available (e.g. chapter list selection).
 * The auto-fetch logic in useEditorData will replace the empty content with
 * the real value shortly after.
 */
export function metadataToChapter(meta: ChapterMetadata): Chapter {
  return {
    ...meta,
    content: '',
    sceneBeats: '',
    critique: '',
  };
}