import type { AssistantLaunchContext, IdeaFragment } from '../../shared/types';

export function buildAssistantIdeaFragment(content: string, context: AssistantLaunchContext): IdeaFragment {
  const hasChapterContext = Boolean(context.chapterId || context.chapterTitle || context.sceneBeats || context.currentExcerpt);
  return {
    id: Date.now().toString(),
    novelId: context.novelId,
    content: content.trim(),
    type: hasChapterContext ? 'scene' : 'world',
    status: 'raw',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
