import type { ChapterFactApplyInput, ChapterFactApplyResult, ChapterFactCandidate } from '../../shared/types/chapter-facts';

export async function previewChapterFactCandidate(
  runId: string,
  context: { novelId: string; databaseGeneration: number },
): Promise<ChapterFactCandidate> {
  const response = await fetch(`/api/chapter-production-runs/${runId}/fact-candidate/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(context),
  });
  const data = await response.json() as ChapterFactCandidate & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error || '事实候选预览失败');
  return data;
}

export async function applyChapterFactCandidate(input: ChapterFactApplyInput): Promise<ChapterFactApplyResult> {
  const response = await fetch(`/api/chapter-production-runs/${input.runId}/fact-candidate/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const data = await response.json() as ChapterFactApplyResult & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error || '事实确认失败');
  return data;
}
