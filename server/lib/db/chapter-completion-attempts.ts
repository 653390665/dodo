import { getDb } from '../db-instance.js';
import type { ChapterCompletionPhase, ChapterCompletionQuality } from '../../../shared/lib/chapter-completion.js';

export interface ChapterCompletionAttempt { id: string; novelId: string; chapterId: string; databaseGeneration: number; contentHash: string; planHash: string; phase: ChapterCompletionPhase; quality: ChapterCompletionQuality; issueIds: string[]; unknownChecks: string[]; riskAcceptedAt?: number; factCandidateId?: string; result?: unknown; createdAt: number; updatedAt: number; }

const PHASES: ChapterCompletionPhase[] = ['writes-flushed', 'version-created', 'deterministic-checked', 'ai-reviewed', 'facts-proposed'];
function map(row: Record<string, unknown>): ChapterCompletionAttempt {
  const phases = new Set<ChapterCompletionPhase>(['writes-flushed', 'version-created', 'deterministic-checked', 'ai-reviewed', 'facts-proposed']);
  const qualities = new Set<ChapterCompletionQuality>(['pass', 'needs-action', 'unknown']);
  if (!phases.has(row.phase as ChapterCompletionPhase) || !qualities.has(row.quality as ChapterCompletionQuality)) throw new Error('INVALID_CHAPTER_COMPLETION_ATTEMPT');
  const parseArray = (value: unknown): string[] => { try { const parsed = JSON.parse(String(value || '[]')); if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error(); return parsed; } catch { throw new Error('INVALID_CHAPTER_COMPLETION_ATTEMPT_JSON'); } };
  let result: unknown;
  if (row.result_json) { try { result = JSON.parse(String(row.result_json)); } catch { throw new Error('INVALID_CHAPTER_COMPLETION_ATTEMPT_RESULT'); } }
  const required = ['id', 'novel_id', 'chapter_id', 'content_hash', 'plan_hash'] as const;
  if (required.some((key) => typeof row[key] !== 'string' || !String(row[key]).trim()) || !Number.isInteger(Number(row.database_generation)) || !Number.isFinite(Number(row.created_at)) || !Number.isFinite(Number(row.updated_at))) {
    throw new Error('INVALID_CHAPTER_COMPLETION_ATTEMPT');
  }
  return { id: String(row.id), novelId: String(row.novel_id), chapterId: String(row.chapter_id), databaseGeneration: Number(row.database_generation), contentHash: String(row.content_hash), planHash: String(row.plan_hash), phase: row.phase as ChapterCompletionPhase, quality: row.quality as ChapterCompletionQuality, issueIds: parseArray(row.issue_ids), unknownChecks: parseArray(row.unknown_checks), riskAcceptedAt: row.risk_accepted_at == null ? undefined : Number(row.risk_accepted_at), factCandidateId: row.fact_candidate_id == null ? undefined : String(row.fact_candidate_id), result, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
export function getChapterCompletionAttempt(id: string): ChapterCompletionAttempt | undefined { const row = getDb().prepare('SELECT * FROM chapter_completion_attempts WHERE id = ?').get(id) as Record<string, unknown> | undefined; return row ? map(row) : undefined; }
export function findChapterCompletionAttempt(key: Pick<ChapterCompletionAttempt, 'novelId'|'chapterId'|'databaseGeneration'|'contentHash'|'planHash'>): ChapterCompletionAttempt | undefined { const row = getDb().prepare('SELECT * FROM chapter_completion_attempts WHERE novel_id=? AND chapter_id=? AND database_generation=? AND content_hash=? AND plan_hash=?').get(key.novelId,key.chapterId,key.databaseGeneration,key.contentHash,key.planHash) as Record<string, unknown> | undefined; return row ? map(row) : undefined; }
export function upsertChapterCompletionAttempt(attempt: ChapterCompletionAttempt): void {
  const existing = findChapterCompletionAttempt(attempt);
  if (existing && PHASES.indexOf(attempt.phase) < PHASES.indexOf(existing.phase)) throw new Error('CHAPTER_COMPLETION_PHASE_REGRESSION');
  getDb().prepare(`INSERT INTO chapter_completion_attempts (id,novel_id,chapter_id,database_generation,content_hash,plan_hash,phase,quality,issue_ids,unknown_checks,risk_accepted_at,fact_candidate_id,result_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(novel_id,chapter_id,database_generation,content_hash,plan_hash) DO UPDATE SET phase=excluded.phase,quality=excluded.quality,issue_ids=excluded.issue_ids,unknown_checks=excluded.unknown_checks,risk_accepted_at=excluded.risk_accepted_at,fact_candidate_id=excluded.fact_candidate_id,result_json=excluded.result_json,updated_at=excluded.updated_at`).run(attempt.id,attempt.novelId,attempt.chapterId,attempt.databaseGeneration,attempt.contentHash,attempt.planHash,attempt.phase,attempt.quality,JSON.stringify(attempt.issueIds),JSON.stringify(attempt.unknownChecks),attempt.riskAcceptedAt ?? null,attempt.factCandidateId ?? null,attempt.result == null ? null : JSON.stringify(attempt.result),attempt.createdAt,attempt.updatedAt);
}
export function listChapterCompletionAttempts(novelId: string, chapterId?: string): ChapterCompletionAttempt[] { const rows = getDb().prepare(`SELECT * FROM chapter_completion_attempts WHERE novel_id=? ${chapterId ? 'AND chapter_id=?' : ''} ORDER BY created_at DESC`).all(...(chapterId ? [novelId,chapterId] : [novelId])) as Record<string, unknown>[]; return rows.map(map); }
