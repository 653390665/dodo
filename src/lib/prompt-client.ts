import type {
  Skill,
  StoryIdeaCard,
  StoryPlanningInput,
  ContinuationPack,
  AggregatedSkillDeck,
  BookEvidenceSegment,
} from '../types';
import type { PromptSurface } from './prompt-stage-routing';

export type ExtractSkillResponse = {
  skills: Skill[];
  deck: AggregatedSkillDeck;
  segments: BookEvidenceSegment[];
  source: 'fallback' | 'model';
  jobId?: string;
  warnings?: string[];
  quality?: {
    passed: boolean;
    anchoringScore: number;
    genericSkillCount: number;
    totalSkillCount: number;
    genericDetails: string[];
    fieldCompleteness: number;
    issue: string | null;
  };
  statusNote?: string;
};

export type SkillExtractionJobStatus = {
  status: 'pending' | 'completed' | 'failed';
  source?: 'model';
  skills?: Skill[];
  deck?: AggregatedSkillDeck;
  segments?: BookEvidenceSegment[];
  warnings?: string[];
  quality?: ExtractSkillResponse['quality'];
  error?: string;
};

function extractApiErrorMessage(data: any, fallback: string): string {
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  if (typeof data?.reason === 'string' && data.reason.trim()) return data.reason;
  if (typeof data?.message === 'string' && data.message.trim()) return data.message;
  return fallback;
}

export async function extractSkill(text: string): Promise<ExtractSkillResponse> {
  const res = await fetch('/api/extract-skill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!res.ok || data.error || data.rejected) {
    throw new Error(extractApiErrorMessage(data, 'Failed to extract skill'));
  }
  return {
    skills: data.skills,
    deck: data.deck,
    segments: data.segments,
    source: data.source,
    jobId: data.jobId,
    warnings: data.warnings,
    quality: data.quality,
    statusNote: data.statusNote,
  };
}

export async function checkSkillExtractionJob(jobId: string): Promise<SkillExtractionJobStatus> {
  const res = await fetch(`/api/extract-skill/jobs/${encodeURIComponent(jobId)}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to check skill extraction job');
  return data;
}

export async function generateStoryCards(payload: {
  ideaSeed: string;
  chatContext: string;
  planning: StoryPlanningInput;
  surface?: PromptSurface;
  previousHookTexts?: string[];
  batchIndex?: number;
}): Promise<{ cards: StoryIdeaCard[]; source?: 'model' | 'fallback'; jobId?: string; warnings?: string[] }> {
  const res = await fetch('/api/story-cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to generate story cards');
  return { cards: data.cards, source: data.source, jobId: data.jobId, warnings: data.warnings };
}

export async function checkStoryCardJob(jobId: string): Promise<{
  status: 'pending' | 'completed' | 'failed';
  cards?: StoryIdeaCard[];
  error?: string;
}> {
  const res = await fetch(`/api/story-cards/jobs/${encodeURIComponent(jobId)}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to check story card job');
  return data;
}

export async function parseContinuationPack(payload: {
  novelId: string;
  title: string;
  documents: Array<{ filename: string; filedata: string }>;
}): Promise<ContinuationPack> {
  const res = await fetch('/api/continuation-packs/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to parse continuation pack');
  return data.pack;
}

export async function refineSetupTask(payload: {
  taskTitle: string;
  currentDraft: string;
  userRequest: string;
  storyContext: string;
  surface?: PromptSurface;
}): Promise<string> {
  const res = await fetch('/api/setup-task-refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to refine setup task');
  return data.text;
}

export async function generateInspiration(prompt: string, surface: PromptSurface = 'workspace-draft'): Promise<string> {
  const res = await fetch('/api/inspiration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, surface }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to generate inspiration');
  return data.text;
}
