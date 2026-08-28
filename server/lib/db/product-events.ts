import { randomUUID } from 'node:crypto';
import { getDb } from '../db-instance.js';
import type { ProductEvent, ProductEventInput, ProductEventMetrics, ProductEventName } from '../../../shared/types/product-events.js';

type ProductEventRow = ProductEventInput & { id: string; created_at: number; event_name: ProductEventName; duration_ms: number | null; error_code: string | null; novel_id: string | null; chapter_id: string | null; object_id: string | null; quality_status: 'pass'|'fail'|'unknown'|null };
type EventEnvelope = {
  version: 1;
  schemaVersion?: 1;
  eventId?: string;
  sessionId?: string;
  occurredAt?: number;
  errorCode?: string;
  sourceType?: ProductEventInput['sourceType'];
  action?: string;
  count?: number;
  fingerprint?: string;
};
function decodeErrorMetadata(raw: string | null): Pick<ProductEventInput, 'schemaVersion' | 'eventId' | 'sessionId' | 'occurredAt' | 'errorCode' | 'sourceType' | 'action' | 'count' | 'fingerprint'> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<EventEnvelope>;
    const sourceTypes = ['built-in', 'plaza', 'licensed', 'book-extracted', 'unknown'];
    const keys = Object.keys(parsed);
    if (parsed.version !== 1 || keys.some((key) => !['version', 'schemaVersion', 'eventId', 'sessionId', 'occurredAt', 'errorCode', 'sourceType', 'action', 'count', 'fingerprint'].includes(key))
      || (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1)
      || (parsed.eventId !== undefined && (typeof parsed.eventId !== 'string' || !/^[a-zA-Z0-9._:-]+$/.test(parsed.eventId)))
      || (parsed.sessionId !== undefined && (typeof parsed.sessionId !== 'string' || !/^[a-zA-Z0-9._:-]+$/.test(parsed.sessionId)))
      || (parsed.occurredAt !== undefined && (!Number.isInteger(parsed.occurredAt) || parsed.occurredAt < 0))
      || (parsed.errorCode !== undefined && typeof parsed.errorCode !== 'string')
      || (parsed.sourceType !== undefined && !sourceTypes.includes(parsed.sourceType))
      || (parsed.action !== undefined && (typeof parsed.action !== 'string' || parsed.action.length < 1 || parsed.action.length > 100))
      || (parsed.count !== undefined && (!Number.isInteger(parsed.count) || parsed.count < 0))
      || (parsed.fingerprint !== undefined && (typeof parsed.fingerprint !== 'string' || !/^[a-zA-Z0-9._:-]+$/.test(parsed.fingerprint)))) return { errorCode: raw };
    return {
      schemaVersion: parsed.schemaVersion,
      eventId: parsed.eventId,
      sessionId: parsed.sessionId,
      occurredAt: parsed.occurredAt,
      errorCode: parsed.errorCode,
      sourceType: parsed.sourceType,
      action: parsed.action,
      count: parsed.count,
      fingerprint: parsed.fingerprint,
    };
  } catch {
    return { errorCode: raw };
  }
}
const toEvent = (row: ProductEventRow): ProductEvent => {
  const metadata = decodeErrorMetadata(row.error_code);
  return {
    id: row.id,
    eventName: row.event_name,
    stage: row.stage,
    durationMs: row.duration_ms ?? undefined,
    result: row.result,
    qualityStatus: row.quality_status ?? undefined,
    ...metadata,
    schemaVersion: metadata.schemaVersion ?? 1,
    eventId: metadata.eventId ?? row.id,
    occurredAt: metadata.occurredAt ?? row.created_at,
    novelId: row.novel_id ?? undefined,
    chapterId: row.chapter_id ?? undefined,
    objectId: row.object_id ?? undefined,
    createdAt: row.created_at,
  };
};

export function createProductEvent(input: ProductEventInput): ProductEvent {
  const id = input.eventId || randomUUID();
  const existing = getDb().prepare('SELECT * FROM product_events WHERE id = ?').get(id) as ProductEventRow | undefined;
  if (existing) return toEvent(existing);
  const createdAt = input.occurredAt ?? Date.now();
  const event: ProductEvent = {
    ...input,
    schemaVersion: 1,
    eventId: id,
    occurredAt: createdAt,
    id,
    createdAt,
  };
  const { errorCode, sourceType, action, count, fingerprint, sessionId } = event;
  const errorCodeValue = JSON.stringify({
    version: 1,
    schemaVersion: 1,
    eventId: id,
    ...(sessionId !== undefined ? { sessionId } : {}),
    occurredAt: createdAt,
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(sourceType !== undefined ? { sourceType } : {}),
    ...(action !== undefined ? { action } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(fingerprint !== undefined ? { fingerprint } : {}),
  });
  getDb().prepare(`INSERT INTO product_events (id,event_name,stage,duration_ms,result,quality_status,error_code,novel_id,chapter_id,object_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(event.id, event.eventName, event.stage, event.durationMs ?? null, event.result, event.qualityStatus ?? null, errorCodeValue ?? null, event.novelId ?? null, event.chapterId ?? null, event.objectId ?? null, event.createdAt);
  return event;
}

export function listProductEvents(): ProductEvent[] {
  return (getDb().prepare('SELECT * FROM product_events ORDER BY created_at ASC').all() as ProductEventRow[]).map(toEvent);
}
export function clearProductEvents(): void { getDb().prepare('DELETE FROM product_events').run(); }

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index), upper = Math.ceil(index);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function getProductEventMetrics(days = 30): ProductEventMetrics {
  const rangeDays = Math.max(1, Math.min(365, Math.floor(days)));
  const cutoff = Date.now() - rangeDays * 86400000;
  const events = (getDb().prepare('SELECT * FROM product_events WHERE created_at >= ? ORDER BY created_at ASC').all(cutoff) as ProductEventRow[]).map(toEvent);
  const unique = (name: ProductEventName, result?: string) => new Set(events.filter(e => e.eventName === name && (!result || e.result === result) && e.objectId).map(e => e.objectId)).size;
  const sampleSize = new Set(events.filter(e => e.objectId).map(e => e.objectId)).size;
  const metric = (n:number,d:number) => ({ value: d ? Math.min(1,n/d) : null, numerator:n, denominator:d });
  const previewIds = new Set(events.filter(e => e.eventName === 'draft_preview' && e.result === 'success' && e.objectId).map(e => e.objectId));
  const acceptedIds = new Set(events.filter(e => e.eventName === 'draft_accept' && e.result === 'success' && e.objectId).map(e => e.objectId));
  const preview = previewIds.size, accepted = [...acceptedIds].filter(id => previewIds.has(id)).length;
  const syncTotal = unique('world_sync'), syncSuccess = unique('world_sync','success');
  const criticEvents = events.filter(e => e.eventName === 'critic_review' && e.objectId);
  const criticTotal = new Set(criticEvents.map(e => e.objectId)).size, criticUnknown = new Set(criticEvents.filter(e => e.qualityStatus === 'unknown').map(e => e.objectId)).size;
  const parse = unique('continuation_parse','success'), conflict = unique('continuation_conflict','success');
  const chapterIds = new Set(events.filter((e) => e.eventName === 'draft_accept' && e.result === 'success' && e.chapterId).map((e) => e.chapterId));
  const latency = [...new Map(events.filter(e => e.eventName === 'draft_preview' && e.result === 'success' && e.objectId && e.durationMs !== undefined).map(e => [e.objectId, e.durationMs as number])).values()];
  const stageCompletions = (['import','review','sync','planning','drafting','audit','polish','next_chapter','advanced','assistant'] as const).map(stage => ({ stage, count: new Set(events.filter(e => e.stage === stage && e.result === 'success' && e.objectId).map(e => e.objectId)).size }));
  const advancedNames = ['advanced_tools_open','factory_start','factory_complete','skill_equip'] as const;
  const advancedAdoption = advancedNames.map(eventName => ({ eventName, count: new Set(events.filter(e => e.eventName === eventName && e.result === 'success' && (e.objectId || e.chapterId)).map(e => e.objectId || e.chapterId)).size }));
  const assistantIds = (name: ProductEventName) => new Set(events.filter(event => event.eventName === name && event.objectId).map(event => event.objectId as string));
  const assistantCount = (name: ProductEventName) => assistantIds(name).size;
  const assistantRequests = events.filter(event => event.eventName === 'assistant_request' && event.objectId);
  const assistantFailures = events.filter(event => (event.eventName === 'assistant_failure' || event.eventName === 'assistant_empty_response') && event.objectId);
  const failedById = new Map<string, ProductEvent>();
  for (const event of assistantFailures) {
    if (event.objectId && !failedById.has(event.objectId)) failedById.set(event.objectId, event);
  }
  const retries = events.filter(event => event.eventName === 'assistant_retry' && event.objectId);
  const retryWithinFiveMinutes = retries.filter(event => {
    const failed = event.objectId ? failedById.get(event.objectId) : undefined;
    return Boolean(failed && event.createdAt >= failed.createdAt && event.createdAt - failed.createdAt <= 5 * 60 * 1000);
  });
  const recovered = events.filter(event => event.eventName === 'assistant_recovered' && event.objectId);
  const recoveryLatency = recovered.map(event => {
    if (typeof event.durationMs === 'number') return event.durationMs;
    const failed = event.objectId ? failedById.get(event.objectId) : undefined;
    return failed ? Math.max(0, event.createdAt - failed.createdAt) : undefined;
  }).filter((value): value is number => value !== undefined);
  const recoveredByChapter = new Map<string, ProductEvent>();
  for (const event of recovered) {
    if (event.chapterId && !recoveredByChapter.has(event.chapterId)) recoveredByChapter.set(event.chapterId, event);
  }
  const recoveredAccepted = [...recoveredByChapter.values()].filter(recoveredEvent => events.some(event => event.eventName === 'draft_accept' && event.result === 'success' && event.chapterId === recoveredEvent.chapterId && event.createdAt >= recoveredEvent.createdAt));
  const requestCount = new Set(assistantRequests.map(event => event.objectId as string)).size;
  const failureCount = failedById.size;
  const assistant = {
    requests: assistantCount('assistant_request'), successes: assistantCount('assistant_success'),
    emptyResponses: assistantCount('assistant_empty_response'), failures: assistantCount('assistant_failure'),
    retries: assistantCount('assistant_retry'), recovered: assistantCount('assistant_recovered'),
    emptyResponseRate: metric(assistantCount('assistant_empty_response'), requestCount),
    failureRate: metric(failureCount, requestCount),
    retryWithin5mRate: metric(new Set(retryWithinFiveMinutes.map(event => event.objectId)).size, failedById.size),
    recoveryLatencyMs: { p50: percentile(recoveryLatency, .5), p95: percentile(recoveryLatency, .95) },
    recoveredChapterAcceptance: metric(recoveredAccepted.length, recoveredByChapter.size),
    successRate: metric(assistantIds('assistant_success').size, new Set(assistantRequests.map(event => event.objectId as string)).size),
    retrySuccessRate: metric(
      new Set(recovered.filter(event => event.objectId && retries.some(retry => retry.objectId === event.objectId)).map(event => event.objectId as string)).size,
      new Set(retries.map(event => event.objectId as string)).size,
    ),
  };
  const uniqueNovelEvent = (eventName: ProductEventName) => new Set(events.filter(event => event.eventName === eventName && event.result === 'success' && event.novelId).map(event => event.novelId as string));
  const activeNovels = new Set(events.filter(event => event.result === 'success' && event.novelId).map(event => event.novelId as string));
  const editorEntries = uniqueNovelEvent('editor_enter');
  const firstInputs = uniqueNovelEvent('first_content_input');
  const contentSaves = uniqueNovelEvent('content_save');
  const continuationSkips = uniqueNovelEvent('continuation_skip');
  const firstRequestByNovel = new Map<string, ProductEvent>();
  for (const event of events) {
    if (event.eventName !== 'assistant_request' || !event.novelId || firstRequestByNovel.has(event.novelId)) continue;
    firstRequestByNovel.set(event.novelId, event);
  }
  const firstAiAssistCompletions = [...firstRequestByNovel.values()].filter(request => events.some(event => event.eventName === 'assistant_success'
    && request.objectId
    && event.novelId === request.novelId
    && event.objectId === request.objectId
    && event.createdAt >= request.createdAt));
  const writingActivation = {
    editorEntries: editorEntries.size,
    firstInputs: firstInputs.size,
    contentSaves: contentSaves.size,
    continuationSkips: continuationSkips.size,
    entryToFirstInput: metric([...editorEntries].filter(id => firstInputs.has(id)).length, editorEntries.size),
    skipToFirstInput: metric([...continuationSkips].filter(id => firstInputs.has(id)).length, continuationSkips.size),
    firstAiAssistCompletion: metric(firstAiAssistCompletions.length, firstRequestByNovel.size),
  };
  const requiredStyleIds = new Set(events.filter(event => event.eventName === 'writing_style_required' && event.objectId).map(event => event.objectId as string));
  const confirmedStyleEvents = events.filter(event => event.eventName === 'writing_style_confirmed' && event.result === 'success' && event.objectId);
  const confirmedStyleIds = new Set(confirmedStyleEvents.map(event => event.objectId as string).filter(id => requiredStyleIds.has(id)));
  const confirmationToDraftLatency = confirmedStyleEvents.map(confirmation => {
    const draft = events.find(event => event.eventName === 'draft_preview'
      && event.result === 'success'
      && event.createdAt >= confirmation.createdAt
      && event.novelId === confirmation.novelId
      && (!confirmation.chapterId || event.chapterId === confirmation.chapterId));
    return draft ? draft.createdAt - confirmation.createdAt : undefined;
  }).filter((value): value is number => value !== undefined);
  const acceptedConfirmedChapters = confirmedStyleEvents.filter(confirmation => events.some(event => event.eventName === 'draft_accept'
    && event.result === 'success'
    && event.createdAt >= confirmation.createdAt
    && event.novelId === confirmation.novelId
    && (!confirmation.chapterId || event.chapterId === confirmation.chapterId)));
  const writingStyle = {
    confirmationCompletion: metric(confirmedStyleIds.size, requiredStyleIds.size),
    confirmationToDraftLatencyMs: { p50: percentile(confirmationToDraftLatency, .5), p95: percentile(confirmationToDraftLatency, .95) },
    confirmedChapterAcceptance: metric(acceptedConfirmedChapters.length, confirmedStyleEvents.length),
  };
  const lifecycleKey = (event: ProductEvent): string | null => event.sessionId && event.novelId
    ? `${event.novelId}\u0000${event.sessionId}`
    : null;
  const lifecycleKeys = (selected: ProductEvent[]) => new Set(selected.map(lifecycleKey).filter((key): key is string => Boolean(key)));
  const viewedSessions = lifecycleKeys(events.filter(event => event.eventName === 'capability_viewed'));
  const draftSessions = lifecycleKeys(events.filter(event => (event.eventName === 'skill_card_added' || event.eventName === 'technique_favorited') && event.result === 'success'));
  const configuredSessions = new Set([...draftSessions].filter(id => viewedSessions.has(id)));
  const appliedSessions = lifecycleKeys(events.filter(event => event.eventName === 'skill_deck_applied' && event.result === 'success'));
  const conflictSessions = lifecycleKeys(events.filter(event => event.action === 'conflict' || event.errorCode === 'SKILL_DECK_CONFLICT_UNRESOLVED'));
  const conflictCancelledSessions = lifecycleKeys(events.filter(event => event.eventName === 'capability_config_cancelled' && event.action === 'conflict'));
  const returnedSessions = lifecycleKeys(events.filter(event => event.eventName === 'capability_returned_to_editor' && event.result === 'success'));
  const skillStackPreviews = events.filter(event => event.eventName === 'draft_preview' && event.result === 'success' && event.action === 'skill-stack' && event.fingerprint);
  const acceptedSkillStackPreviews = skillStackPreviews.filter(previewEvent => events.some(event => event.eventName === 'draft_accept'
    && event.result === 'success'
    && event.createdAt >= previewEvent.createdAt
    && event.novelId === previewEvent.novelId
    && event.fingerprint === previewEvent.fingerprint
    && event.objectId === previewEvent.objectId));
  const transformPreviews = events.filter(event => event.eventName === 'capability_preview'
    && event.result === 'success'
    && event.action === 'transform-preview');
  const appliedTransformPreviews = transformPreviews.filter(preview => events.some(event => event.eventName === 'capability_apply'
    && event.result === 'success'
    && event.action === 'transform-preview'
    && event.createdAt >= preview.createdAt
    && event.sessionId === preview.sessionId
    && event.novelId === preview.novelId
    && event.objectId === preview.objectId
    && (!preview.chapterId || event.chapterId === preview.chapterId)));
  const oneShotPreviewApplication = metric(appliedTransformPreviews.length, transformPreviews.length);
  const capabilities = {
    configurationCompletion: metric([...appliedSessions].filter(id => configuredSessions.has(id)).length, configuredSessions.size),
    configurationViewChanges: events.filter(event => event.eventName === 'capability_viewed' && event.action === 'view-change').reduce((sum, event) => sum + (event.count ?? 1), 0),
    conflictCancellation: metric([...conflictCancelledSessions].filter(id => conflictSessions.has(id)).length, conflictSessions.size),
    storeToEditorReturn: metric([...returnedSessions].filter(id => appliedSessions.has(id)).length, appliedSessions.size),
    cardDraftAcceptance: metric(acceptedSkillStackPreviews.length, skillStackPreviews.length),
    oneShotPreviewApplication,
    diagnosticPreviewApplication: oneShotPreviewApplication,
  };
  return { rangeDays, sampleSize, northStar: { acceptedChapters: chapterIds.size, activeNovels: activeNovels.size }, rates: { previewAcceptance: metric(accepted, preview), syncCompletion: metric(syncSuccess, syncTotal), criticUnknown: metric(criticUnknown, criticTotal), conflict: metric(conflict, parse) }, generationLatencyMs: { p50: percentile(latency, .5), p95: percentile(latency, .95) }, stageCompletions, advancedAdoption, assistant, writingActivation, writingStyle, capabilities };
}
