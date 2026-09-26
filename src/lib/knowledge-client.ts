/**
 * 批次 C · 图谱维护入口（2026-09-26）：知识谱系能力卡的浏览器侧客户端。
 *
 * 与 `world-job-client` 不同，知识谱系抽取是同步的确定性动作（解析资料包 + 幂等入库），
 * 因此直接携带数据库代际调用作品级路由，不做轮询；代际冲突由服务端回 409。
 *
 * 批次 D（2026-09-27）追加只读 `fetchMemoryHealth`：记忆健康度看板四项指标的唯一取数口。
 */
import type {
  KnowledgeCapabilityRunResult,
  KnowledgeExtractResult,
} from '../../shared/lib/knowledge-capabilities';
import type { MemoryHealthMetric } from '../../shared/lib/memory-health';
import { getDatabaseGenerationSnapshot } from './db-transport';

export class KnowledgeCapabilityRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'KnowledgeCapabilityRequestError';
  }
}

async function postKnowledgeCapability<T>(
  novelId: string,
  assetId: string,
  signal?: AbortSignal
): Promise<T> {
  const databaseGeneration = await getDatabaseGenerationSnapshot(signal);
  const response = await fetch(
    `/api/novels/${encodeURIComponent(novelId)}/knowledge-capabilities/${encodeURIComponent(assetId)}/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ databaseGeneration }),
      signal,
    }
  );
  const payload = (await response.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new KnowledgeCapabilityRequestError(
      response.status,
      payload.code ?? 'KNOWLEDGE_REQUEST_FAILED',
      payload.error ?? `服务器返回 ${response.status}`
    );
  }
  return payload as T;
}

/** 通用入口（批次 C 第 4 条，Plan 262 C5）：链路步骤声明的能力卡按 id 触发一次。 */
export async function runKnowledgeCapability(
  novelId: string,
  assetId: string,
  signal?: AbortSignal
): Promise<KnowledgeCapabilityRunResult> {
  return postKnowledgeCapability<KnowledgeCapabilityRunResult>(novelId, assetId, signal);
}

export async function runKnowledgeExtract(
  novelId: string,
  signal?: AbortSignal
): Promise<KnowledgeExtractResult> {
  return postKnowledgeCapability<KnowledgeExtractResult>(novelId, 'knowledge-extract', signal);
}

/**
 * 记忆健康度证据（镜像 `server/helpers/memory-health.ts` 的响应形状；架构边界禁止 src import server，
 * 故此处只声明读取面用到的字段）。
 */
export interface MemoryHealthEvidence {
  packDocuments: number;
  foreshadowingRows: number;
  relationshipRows: number;
  entityRows: number;
  orphanRows: number;
  indexedChunks: number;
  embeddingStatus: string;
  ragQueryChapterId: string | null;
}

export interface MemoryHealthSnapshot {
  novelId: string;
  computedAt: string;
  metrics: MemoryHealthMetric[];
  evidence: MemoryHealthEvidence;
}

/** 只读 GET：不携带代际（服务端每次现算，无需乐观并发比对）。 */
export async function fetchMemoryHealth(
  novelId: string,
  signal?: AbortSignal
): Promise<MemoryHealthSnapshot> {
  const response = await fetch(`/api/novels/${encodeURIComponent(novelId)}/memory-health`, {
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<MemoryHealthSnapshot> & {
    code?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new KnowledgeCapabilityRequestError(
      response.status,
      payload.code ?? 'MEMORY_HEALTH_REQUEST_FAILED',
      payload.error ?? `服务器返回 ${response.status}`
    );
  }
  return payload as MemoryHealthSnapshot;
}
