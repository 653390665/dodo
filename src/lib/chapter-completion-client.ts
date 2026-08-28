import type { ChapterCompletionResult } from '../../shared/lib/chapter-completion';

export async function completeChapter(chapterId: string, input: Record<string, unknown>): Promise<ChapterCompletionResult> {
  const response = await fetch(`/api/chapters/${encodeURIComponent(chapterId)}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '章节完成失败');
  return response.json() as Promise<ChapterCompletionResult>;
}

export async function acceptChapterRisk(chapterId: string, input: Record<string, unknown>): Promise<ChapterCompletionResult> {
  const response = await fetch(`/api/chapters/${encodeURIComponent(chapterId)}/complete/risk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '风险确认失败');
  return response.json() as Promise<ChapterCompletionResult>;
}
