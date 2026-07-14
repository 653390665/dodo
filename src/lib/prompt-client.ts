import type {
  Skill,
  StoryIdeaCard,
  StoryPlanningInput,
  ContinuationPack,
  AggregatedSkillDeck,
  BookEvidenceSegment,
} from '../../shared/types';
import type { PromptSurface } from './prompt-stage-routing';
import { readSseStream } from './sse-client';

/**
 * Result of parsing a world-setup document. All fields optional since the
 * extracted structure depends on the uploaded document's content.
 * Array payloads are typed loosely because they originate from untrusted LLM
 * JSON output; callers validate/normalize before persisting.
 */
export type DocExtractionResult = {
  databaseGeneration: number;
  globalOutline?: string;
  worldRules?: string;
  characters?: unknown[];
  locations?: unknown[];
  items?: unknown[];
  factions?: unknown[];
  powerLevels?: unknown[];
  timelineEvents?: unknown[];
  [key: string]: unknown;
};

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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function extractApiErrorMessage(data: unknown, fallback: string): string {
  const rec = asRecord(data);
  if (typeof rec.error === 'string' && rec.error.trim()) return rec.error;
  if (typeof rec.reason === 'string' && rec.reason.trim()) return rec.reason;
  if (typeof rec.message === 'string' && rec.message.trim()) return rec.message;
  return fallback;
}

export class QuotaError extends Error {
  quotaExceeded = true;
  limitType: string;
  count: number;
  max: number;
  constructor(message: string, limitType: string, count: number, max: number) {
    super(message);
    this.name = 'QuotaError';
    this.limitType = limitType;
    this.count = count;
    this.max = max;
  }
}

export async function extractSkill(text: string, novelId?: string): Promise<ExtractSkillResponse> {
  const res = await fetch('/api/extract-skill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, novelId }),
  });
  const data = await res.json();
  if (data && data.quotaExceeded) {
    throw new QuotaError(data.error || 'Quota exceeded', data.limitType, data.count, data.max);
  }
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

export async function cancelSkillExtractionJob(jobId: string): Promise<void> {
  await fetch(`/api/extract-skill/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
}

export async function generateStoryCards(payload: {
  ideaSeed: string;
  chatContext: string;
  planning: StoryPlanningInput;
  surface?: PromptSurface;
  previousHookTexts?: string[];
  batchIndex?: number;
}): Promise<{ cards: StoryIdeaCard[]; source?: 'model' | 'fallback'; jobId?: string; warnings?: string[] }> {
  const onboardingSessionId = await createOnboardingLlmSession('story-cards');
  const res = await fetch('/api/story-cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, onboardingSessionId }),
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

export async function cancelStoryCardJob(jobId: string): Promise<void> {
  await fetch(`/api/story-cards/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
}

export async function createContinuationImportSession(): Promise<string> {
  const res = await fetch('/api/continuation-packs/import-session', { method: 'POST' });
  const data = asRecord(await res.json().catch(() => ({})));
  if (!res.ok || typeof data.novelId !== 'string') {
    throw new Error(String(data.error || '无法创建续写导入会话，请重试。'));
  }
  return data.novelId;
}

export async function parseContinuationPack(
  payload: {
    novelId: string;
    title: string;
    documents: Array<{ filename: string; filedata: string }>;
  },
  onProgress?: (progress: number, stageText: string) => void
): Promise<ContinuationPack> {
  const res = await fetch('/api/continuation-packs/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => { throw new Error('无法连接到本地解析服务，请确认应用服务仍在运行。'); });
  const raw = await res.text();
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw || '解析服务返回异常，请重试。');
  }
  const rec = asRecord(data);
  if (!res.ok || rec.error) {
    if (rec.error === 'Validation failed' && Array.isArray(rec.details)) {
      const detailMsgs = rec.details.map((d: { path: string; message: string }) => `[${d.path}]: ${d.message}`).join('; ');
      throw new Error(`数据校验失败: ${detailMsgs}`);
    }
    throw new Error(String(rec.error || '解析失败，请重试。'));
  }

  // If backend returns a background jobId
  if (typeof rec.jobId === 'string') {
    const jobId = rec.jobId;
    onProgress?.(10, '正在读取资料并提取文本...');

    const startTime = Date.now();
    const timeoutMs = 300_000; // 5 minutes timeout

    let currentDisplayedProgress = 10;
    let targetProgress = 10;
    let currentStageText = '正在读取资料并提取文本...';
    let isTerminated = false;

    // Smooth micro-ticks progress interpolation timer
    const intervalId = setInterval(() => {
      if (isTerminated) return;
      if (currentDisplayedProgress < targetProgress) {
        currentDisplayedProgress += 1;
        onProgress?.(currentDisplayedProgress, currentStageText);
      } else if (currentDisplayedProgress < 90 && targetProgress < 100) {
        // Slow creep up when waiting (0.2% every 200ms = 1% per second)
        currentDisplayedProgress += 0.2;
        onProgress?.(Math.floor(currentDisplayedProgress), currentStageText);
      }
    }, 200);

    try {
      while (true) {
        if (Date.now() - startTime > timeoutMs) {
          throw new Error('解析任务超时，请重试。');
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));

        const jobRes = await fetch(`/api/continuation-packs/jobs/${encodeURIComponent(jobId)}`);
        if (!jobRes.ok) {
          const errText = await jobRes.text().catch(() => '');
          if (errText.includes('已过期') || jobRes.status === 404) {
            throw new Error('解析任务已过期或服务已重启，请重新解析。');
          }
          throw new Error('无法连接到本地解析服务，请确认应用服务仍在运行。');
        }

        const jobData = asRecord(await jobRes.json());
        const status = typeof jobData.status === 'string' ? jobData.status : '';

        if (status === 'completed') {
          isTerminated = true;
          clearInterval(intervalId);
          onProgress?.(100, '解析完成，正在加载工作区！');
          return jobData.pack as ContinuationPack;
        } else if (status === 'failed') {
          isTerminated = true;
          clearInterval(intervalId);
          throw new Error(typeof jobData.error === 'string' ? jobData.error : '解析任务失败，请重试。');
        } else {
          targetProgress = typeof jobData.progress === 'number' ? jobData.progress : 15;
          currentStageText = typeof jobData.stageText === 'string' ? jobData.stageText : '解析中...';
        }
      }
    } finally {
      isTerminated = true;
      clearInterval(intervalId);
    }
  }

  return rec.pack as ContinuationPack;
}

export async function parseDocAsync(
  payload: {
    novelId: string;
    filename: string;
    filedata: string;
  },
  onProgress?: (progress: number, stageText: string) => void,
  signal?: AbortSignal,
): Promise<DocExtractionResult> {
  const res = await fetch('/api/parse-doc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || '上传设定文档失败');
  }

  const { jobId, databaseGeneration } = await res.json() as {
    jobId?: string;
    databaseGeneration?: number;
  };
  if (!jobId || !Number.isInteger(databaseGeneration)) {
    throw new Error('解析服务未返回有效的数据库代际，请重试。');
  }
  let completed = false;
  let cancelled = false;
  const cancel = () => {
    if (completed || cancelled) return;
    cancelled = true;
    void fetch(`/api/parse-doc/jobs/${encodeURIComponent(jobId)}/cancel?databaseGeneration=${databaseGeneration}`, { method: 'POST' }).catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  onProgress?.(10, '正在读取并提取文档内容...');

  const startTime = Date.now();
  const timeoutMs = 300_000; // 5 minutes

  let currentDisplayedProgress = 10;
  let targetProgress = 10;
  let currentStageText = '正在读取并提取文档内容...';
  let isTerminated = false;

  // Smooth micro-ticks progress interpolation timer
  const intervalId = setInterval(() => {
    if (isTerminated) return;
    if (currentDisplayedProgress < targetProgress) {
      currentDisplayedProgress += 1;
      onProgress?.(currentDisplayedProgress, currentStageText);
    } else if (currentDisplayedProgress < 90 && targetProgress < 100) {
      // Slow creep up when waiting (0.2% every 200ms = 1% per second)
      currentDisplayedProgress += 0.2;
      onProgress?.(Math.floor(currentDisplayedProgress), currentStageText);
    }
  }, 200);

  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new Error('解析任务已取消');
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('解析设定文档任务超时，请重试。');
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, 1500);
        const onAbort = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(signal?.reason || new Error('解析任务已取消'));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });

      const jobRes = await fetch(
        `/api/parse-doc/jobs/${encodeURIComponent(jobId)}?databaseGeneration=${databaseGeneration}`,
        { signal },
      );
      if (!jobRes.ok) {
        const errorData = asRecord(await jobRes.json().catch(() => ({})));
        throw new Error(
          typeof errorData.error === 'string'
            ? errorData.error
            : '无法连接到解析后台服务，请检查网络。',
        );
      }

      const jobData = asRecord(await jobRes.json());
      const status = typeof jobData.status === 'string' ? jobData.status : '';

      if (status === 'completed') {
        completed = true;
        isTerminated = true;
        clearInterval(intervalId);
        onProgress?.(100, '解析完成，正在写入您的设定集...');
        return {
          ...asRecord(jobData.result),
          databaseGeneration,
        } as DocExtractionResult;
      } else if (status === 'failed') {
        isTerminated = true;
        clearInterval(intervalId);
        throw new Error(typeof jobData.error === 'string' ? jobData.error : '解析设定文档任务失败，请重试。');
      } else {
        targetProgress = typeof jobData.progress === 'number' ? jobData.progress : 15;
        currentStageText = typeof jobData.stageText === 'string' ? jobData.stageText : '解析中...';
      }
    }
  } finally {
    isTerminated = true;
    clearInterval(intervalId);
    signal?.removeEventListener('abort', cancel);
    if (!completed) cancel();
  }
}

export async function refineSetupTask(payload: {
  novelId: string;
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

export async function generateInspiration(prompt: string, surface: PromptSurface = 'workspace-draft', novelId?: string): Promise<string> {
  const onboardingSessionId = novelId ? undefined : await createOnboardingLlmSession('inspiration');
  const res = await fetch('/api/inspiration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, surface, ...(novelId ? { novelId } : { onboardingSessionId }) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(extractApiErrorMessage(data, 'Failed to generate inspiration'));
  }
  const result = await readSseStream(res, () => {});
  if (!result.done) throw new Error('灵感生成流不完整，请重试。');
  if (!result.text.trim()) throw new Error('灵感生成结果为空，请重试。');
  return result.text;
}

async function createOnboardingLlmSession(operation: 'story-cards' | 'inspiration'): Promise<string> {
  const res = await fetch('/api/onboarding/llm-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation }),
  });
  const data = asRecord(await res.json().catch(() => ({})));
  if (!res.ok || typeof data.sessionId !== 'string') {
    throw new Error(extractApiErrorMessage(data, '无法创建欢迎页模型会话，请稍后重试。'));
  }
  return data.sessionId;
}
