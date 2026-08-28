import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { closeDb, getDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import { validateDatabaseImportFile } from '../server/routes/db.js';
import { clearProductEvents, createProductEvent, getProductEventMetrics, listProductEvents } from '../server/lib/db/product-events.js';
import { productEventSchema } from '../server/routes/product-events.js';

test('product event HTTP schema accepts all assistant values and rejects unknown fields', () => {
  assert.equal(productEventSchema.safeParse({ eventName: 'assistant_request', stage: 'assistant', result: 'success' }).success, true);
  assert.equal(productEventSchema.safeParse({ eventName: 'assistant_request', stage: 'bogus', result: 'success' }).success, false);
  assert.equal(productEventSchema.safeParse({ eventName: 'unknown', stage: 'assistant', result: 'success' }).success, false);
  assert.equal(productEventSchema.safeParse({ eventName: 'assistant_request', stage: 'assistant', result: 'success', prompt: 'secret' }).success, false);
});

test('Plan 158 lifecycle events accept metadata only and reject source content', () => {
  for (const eventName of ['capability_viewed','technique_favorited','skill_card_added','skill_deck_applied','capability_config_cancelled','fusion_previewed','fusion_saved','chapter_overlay_used','diagnostic_run','capability_returned_to_editor'] as const) {
    assert.equal(productEventSchema.safeParse({ eventName, stage: 'advanced', result: 'success', sourceType: 'plaza', action: 'open', count: 1, fingerprint: 'fp-1', objectId: 'cap-1' }).success, true, eventName);
  }
  assert.equal(productEventSchema.safeParse({ eventName: 'capability_viewed', stage: 'advanced', result: 'success', prompt: 'secret' }).success, false);
  assert.equal(productEventSchema.safeParse({
    schemaVersion: 1,
    eventId: 'event-1',
    sessionId: 'session-1',
    occurredAt: 123,
    eventName: 'capability_viewed',
    stage: 'advanced',
    result: 'success',
  }).success, true);
});

test('deconstruction card events accept only privacy-safe identifiers', () => {
  assert.equal(productEventSchema.safeParse({ eventName: 'deconstruction_card_stack', stage: 'drafting', result: 'success', novelId: 'n1', chapterId: 'c1', objectId: 'card-1' }).success, true);
  assert.equal(productEventSchema.safeParse({ eventName: 'deconstruction_card_trial', stage: 'drafting', result: 'success', novelId: 'n1', chapterId: 'c1', objectId: 'card-1' }).success, true);
  assert.equal(productEventSchema.safeParse({ eventName: 'deconstruction_card_restore', stage: 'drafting', result: 'success', novelId: 'n1', chapterId: 'c1', objectId: 'card-1' }).success, true);
  assert.equal(productEventSchema.safeParse({ eventName: 'deconstruction_card_stack', stage: 'drafting', result: 'success', objectId: 'card-1', prompt: 'secret' }).success, false);
  assert.equal(productEventSchema.safeParse({ eventName: 'deconstruction_card_trial', stage: 'drafting', result: 'success', objectId: 'card-1', text: 'secret' }).success, false);
});

test('product events are additive and metrics are privacy-safe', () => {
  closeDb();
  initDb(':memory:');
  const columns = (getDb().pragma('table_info(product_events)') as Array<{ name: string }>).map((row) => row.name);
  assert.deepEqual(columns, ['id','event_name','stage','duration_ms','result','error_code','novel_id','chapter_id','object_id','quality_status','created_at']);
  clearProductEvents();
  createProductEvent({ eventName: 'draft_preview', stage: 'drafting', result: 'success', durationMs: 10, chapterId: 'c1', objectId: 'p1' });
  createProductEvent({ eventName: 'draft_preview', stage: 'drafting', result: 'success', durationMs: 30, chapterId: 'c2', objectId: 'p2' });
  createProductEvent({ eventName: 'draft_accept', stage: 'drafting', result: 'success', chapterId: 'c1', objectId: 'p1' });
  createProductEvent({ eventName: 'draft_accept', stage: 'drafting', result: 'success', chapterId: 'c1', objectId: 'p1' });
  createProductEvent({ eventName: 'critic_review', stage: 'review', result: 'success', qualityStatus: 'unknown', objectId: 'cr1' });
  createProductEvent({ eventName: 'continuation_parse', stage: 'import', result: 'success', objectId: 'pack1' });
  createProductEvent({ eventName: 'continuation_parse', stage: 'import', result: 'success', objectId: 'pack2' });
  createProductEvent({ eventName: 'continuation_parse', stage: 'import', result: 'failure', objectId: 'pack3' });
  createProductEvent({ eventName: 'continuation_conflict', stage: 'review', result: 'success', objectId: 'conflict1' });
  createProductEvent({ eventName: 'scene_plan', stage: 'planning', result: 'success' });
  const metrics = getProductEventMetrics(7);
  assert.equal(metrics.sampleSize, 7);
  assert.equal(metrics.northStar.acceptedChapters, 1);
  assert.deepEqual(metrics.rates.previewAcceptance, { value: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(metrics.rates.criticUnknown, { value: 1, numerator: 1, denominator: 1 });
  assert.deepEqual(metrics.rates.conflict, { value: 0.5, numerator: 1, denominator: 2 });
  assert.equal(metrics.stageCompletions.find((item) => item.stage === 'drafting')?.count, 2);
  assert.equal(metrics.stageCompletions.find((item) => item.stage === 'review')?.count, 2);
  assert.equal(metrics.generationLatencyMs.p50, 20);
  assert.equal(metrics.generationLatencyMs.p95, 29);
  assert.deepEqual(listProductEvents().map((event) => event.eventName), ['draft_preview','draft_preview','draft_accept','draft_accept','critic_review','continuation_parse','continuation_parse','continuation_parse','continuation_conflict','scene_plan']);
  assert.equal(JSON.stringify(listProductEvents()).includes('prompt'), false);
  closeDb();
});

test('product metrics use the Plan 158 thirty-day window by default', () => {
  closeDb();
  initDb(':memory:');
  clearProductEvents();
  assert.equal(getProductEventMetrics().rangeDays, 30);
  closeDb();
});

test('lifecycle metadata round-trips without storing source material', () => {
  closeDb();
  initDb(':memory:');
  clearProductEvents();
  createProductEvent({ eventName: 'fusion_saved', stage: 'advanced', result: 'success', objectId: 'fusion-1', sourceType: 'book-extracted', action: 'save', count: 1, fingerprint: 'rules-v1' });
  const [event] = listProductEvents();
  assert.deepEqual({ sourceType: event.sourceType, action: event.action, count: event.count, fingerprint: event.fingerprint }, { sourceType: 'book-extracted', action: 'save', count: 1, fingerprint: 'rules-v1' });
  assert.equal(JSON.stringify(event).includes('prompt'), false);
  closeDb();
});

test('stable event ids are idempotent and preserve the session envelope', () => {
  closeDb();
  initDb(':memory:');
  clearProductEvents();
  const input = {
    schemaVersion: 1 as const,
    eventId: 'event-idempotent-1',
    sessionId: 'configuration-session-1',
    occurredAt: 123,
    eventName: 'skill_card_added' as const,
    stage: 'advanced' as const,
    result: 'success' as const,
    objectId: 'card-1',
  };
  createProductEvent(input);
  createProductEvent(input);
  const events = listProductEvents();
  assert.equal(events.length, 1);
  assert.deepEqual({
    id: events[0].id,
    eventId: events[0].eventId,
    sessionId: events[0].sessionId,
    schemaVersion: events[0].schemaVersion,
    occurredAt: events[0].occurredAt,
  }, {
    id: input.eventId,
    eventId: input.eventId,
    sessionId: input.sessionId,
    schemaVersion: 1,
    occurredAt: input.occurredAt,
  });
  closeDb();
});

test('Plan 158 capability metrics use session-scoped denominators and honest unavailable rates', () => {
  closeDb();
  initDb(':memory:');
  clearProductEvents();
  const add = (sessionId: string, event: Parameters<typeof createProductEvent>[0]) => createProductEvent({
    schemaVersion: 1,
    eventId: `${sessionId}-${event.eventName}-${listProductEvents().length}`,
    sessionId,
    occurredAt: Date.now(),
    ...event,
  });

  add('config-1', { eventName: 'capability_viewed', stage: 'advanced', result: 'success', novelId: 'novel-1', objectId: 'card-1' });
  add('config-1', { eventName: 'capability_viewed', stage: 'advanced', result: 'success', novelId: 'novel-1', action: 'view-change', count: 1, objectId: 'card-2' });
  add('config-1', { eventName: 'skill_card_added', stage: 'advanced', result: 'success', novelId: 'novel-1', objectId: 'card-1' });
  add('config-1', { eventName: 'skill_deck_applied', stage: 'advanced', result: 'success', novelId: 'novel-1' });
  add('config-1', { eventName: 'capability_returned_to_editor', stage: 'drafting', result: 'success', novelId: 'novel-1', chapterId: 'chapter-1' });
  add('config-2', { eventName: 'capability_viewed', stage: 'advanced', result: 'success', novelId: 'novel-2', objectId: 'card-3' });
  add('config-2', { eventName: 'technique_favorited', stage: 'advanced', result: 'success', novelId: 'novel-2', objectId: 'technique-1' });
  add('conflict-1', { eventName: 'skill_card_added', stage: 'advanced', result: 'failure', novelId: 'novel-1', action: 'conflict', errorCode: 'SKILL_DECK_CONFLICT_UNRESOLVED', objectId: 'card-4' });
  add('conflict-1', { eventName: 'capability_config_cancelled', stage: 'advanced', result: 'success', novelId: 'novel-1', action: 'conflict' });
  add('draft-1', { eventName: 'draft_preview', stage: 'drafting', result: 'success', novelId: 'novel-1', action: 'skill-stack', fingerprint: 'stack-1', objectId: 'draft-1', chapterId: 'chapter-1' });
  add('draft-1', { eventName: 'draft_accept', stage: 'drafting', result: 'success', novelId: 'novel-1', action: 'skill-stack', fingerprint: 'stack-1', objectId: 'draft-1', chapterId: 'chapter-1' });
  add('preview-1', { eventName: 'capability_preview', stage: 'polish', result: 'success', novelId: 'novel-1', chapterId: 'chapter-1', action: 'transform-preview', objectId: 'polish-card-1' });
  add('preview-1', { eventName: 'capability_apply', stage: 'polish', result: 'success', novelId: 'novel-1', chapterId: 'chapter-1', action: 'transform-preview', objectId: 'polish-card-1' });
  add('preview-2', { eventName: 'capability_preview', stage: 'polish', result: 'success', novelId: 'novel-1', chapterId: 'chapter-2', action: 'transform-preview', objectId: 'polish-card-1' });
  add('preview-2', { eventName: 'capability_apply', stage: 'polish', result: 'success', novelId: 'novel-1', chapterId: 'chapter-3', action: 'transform-preview', objectId: 'polish-card-1' });
  add('diagnostic-1', { eventName: 'diagnostic_run', stage: 'audit', result: 'success', novelId: 'novel-1', objectId: 'diagnostic-1' });

  const metrics = getProductEventMetrics(30).capabilities;
  assert.deepEqual(metrics.configurationCompletion, { value: 0.5, numerator: 1, denominator: 2 });
  assert.equal(metrics.configurationViewChanges, 1);
  assert.deepEqual(metrics.conflictCancellation, { value: 1, numerator: 1, denominator: 1 });
  assert.deepEqual(metrics.storeToEditorReturn, { value: 1, numerator: 1, denominator: 1 });
  assert.deepEqual(metrics.cardDraftAcceptance, { value: 1, numerator: 1, denominator: 1 });
  assert.deepEqual(metrics.oneShotPreviewApplication, { value: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(metrics.diagnosticPreviewApplication, metrics.oneShotPreviewApplication);

  add('shared-session', { eventName: 'capability_viewed', stage: 'advanced', result: 'success', novelId: 'novel-a', objectId: 'card-a' });
  add('shared-session', { eventName: 'skill_card_added', stage: 'advanced', result: 'success', novelId: 'novel-a', objectId: 'card-a' });
  add('shared-session', { eventName: 'skill_deck_applied', stage: 'advanced', result: 'success', novelId: 'novel-b', objectId: 'card-b' });
  assert.deepEqual(getProductEventMetrics(30).capabilities.configurationCompletion, { value: 1 / 3, numerator: 1, denominator: 3 });

  clearProductEvents();
  const unavailable = getProductEventMetrics(30).capabilities;
  assert.equal(unavailable.configurationCompletion.value, null);
  assert.equal(unavailable.conflictCancellation.value, null);
  assert.equal(unavailable.storeToEditorReturn.value, null);
  assert.equal(unavailable.cardDraftAcceptance.value, null);
  assert.equal(unavailable.oneShotPreviewApplication.value, null);
  assert.equal(unavailable.diagnosticPreviewApplication.value, null);
  closeDb();
});

test('lifecycle metadata is persisted in a versioned error envelope across reopen/export', () => {
  closeDb();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-event-envelope-'));
  const dbPath = path.join(directory, 'events.db');
  try {
    initDb(dbPath);
    createProductEvent({ eventName: 'capability_viewed', stage: 'advanced', result: 'success', errorCode: 'LEGACY', sourceType: 'plaza', action: 'view', count: 2, fingerprint: 'fp:v1', objectId: 'cap-1' });
    const raw = getDb().prepare('SELECT error_code FROM product_events').get() as { error_code: string };
    const envelope = JSON.parse(raw.error_code) as Record<string, unknown>;
    assert.deepEqual({
      version: envelope.version,
      schemaVersion: envelope.schemaVersion,
      errorCode: envelope.errorCode,
      sourceType: envelope.sourceType,
      action: envelope.action,
      count: envelope.count,
      fingerprint: envelope.fingerprint,
    }, { version: 1, schemaVersion: 1, errorCode: 'LEGACY', sourceType: 'plaza', action: 'view', count: 2, fingerprint: 'fp:v1' });
    assert.equal(typeof envelope.eventId, 'string');
    assert.equal(typeof envelope.occurredAt, 'number');
    closeDb();
    initDb(dbPath);
    const [event] = listProductEvents();
    assert.deepEqual({ errorCode: event.errorCode, sourceType: event.sourceType, action: event.action, count: event.count, fingerprint: event.fingerprint }, { errorCode: 'LEGACY', sourceType: 'plaza', action: 'view', count: 2, fingerprint: 'fp:v1' });
  } finally {
    closeDb();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('writing activation metrics count distinct novels and expose honest conversion rates', () => {
  closeDb();
  initDb(':memory:');
  clearProductEvents();
  createProductEvent({ eventName: 'editor_enter', stage: 'drafting', result: 'success', novelId: 'novel-1' });
  createProductEvent({ eventName: 'editor_enter', stage: 'drafting', result: 'success', novelId: 'novel-1' });
  createProductEvent({ eventName: 'editor_enter', stage: 'drafting', result: 'success', novelId: 'novel-2' });
  createProductEvent({ eventName: 'first_content_input', stage: 'drafting', result: 'success', novelId: 'novel-1', chapterId: 'chapter-1', objectId: 'chapter-1' });
  createProductEvent({ eventName: 'content_save', stage: 'drafting', result: 'success', novelId: 'novel-1', chapterId: 'chapter-1', objectId: 'chapter-1' });
  createProductEvent({ eventName: 'continuation_skip', stage: 'sync', result: 'success', novelId: 'novel-2', chapterId: 'chapter-2' });
  const writing = getProductEventMetrics(7).writingActivation;
  assert.deepEqual(writing, {
    editorEntries: 2,
    firstInputs: 1,
    contentSaves: 1,
    continuationSkips: 1,
    entryToFirstInput: { value: 0.5, numerator: 1, denominator: 2 },
    skipToFirstInput: { value: 0, numerator: 0, denominator: 1 },
    firstAiAssistCompletion: { value: null, numerator: 0, denominator: 0 },
  });
  closeDb();
});

test('product metrics count active novels and first AI assist completion by earliest request', () => {
  closeDb();
  initDb(':memory:');
  clearProductEvents();
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    createProductEvent({ eventName: 'editor_enter', stage: 'drafting', result: 'success', novelId: 'novel-1' });
    now = 2_000;
    createProductEvent({ eventName: 'assistant_request', stage: 'assistant', result: 'success', novelId: 'novel-1', objectId: 'request-1' });
    now = 3_000;
    createProductEvent({ eventName: 'assistant_request', stage: 'assistant', result: 'success', novelId: 'novel-1', objectId: 'request-2' });
    now = 4_000;
    createProductEvent({ eventName: 'assistant_success', stage: 'assistant', result: 'success', novelId: 'novel-1', objectId: 'request-1' });
    now = 5_000;
    createProductEvent({ eventName: 'assistant_request', stage: 'assistant', result: 'success', novelId: 'novel-2', objectId: 'request-3' });
    now = 6_000;
    createProductEvent({ eventName: 'assistant_success', stage: 'assistant', result: 'success', novelId: 'novel-2', objectId: 'other-request' });
    now = 7_000;
    createProductEvent({ eventName: 'content_save', stage: 'drafting', result: 'failure', novelId: 'novel-3' });
    createProductEvent({ eventName: 'assistant_request', stage: 'assistant', result: 'success', novelId: 'novel-3' });
    now = 8_000;
    createProductEvent({ eventName: 'assistant_request', stage: 'assistant', result: 'success', novelId: 'novel-4', objectId: 'request-4' });
    createProductEvent({ eventName: 'assistant_success', stage: 'assistant', result: 'success', novelId: 'novel-4', objectId: 'request-4' });

    const metrics = getProductEventMetrics(7);
    assert.equal(metrics.northStar.activeNovels, 4);
    assert.deepEqual(metrics.writingActivation.firstAiAssistCompletion, { value: 0.5, numerator: 2, denominator: 4 });
  } finally {
    Date.now = originalNow;
    closeDb();
  }
});

test('assistant recovery metrics link retries to the failed request', () => {
  closeDb();
  initDb(':memory:');
  clearProductEvents();
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  try {
    createProductEvent({ eventName: 'assistant_request', stage: 'assistant', result: 'success', objectId: 'req-1' });
    now = 100;
    createProductEvent({ eventName: 'assistant_failure', stage: 'assistant', result: 'failure', errorCode: 'network', objectId: 'req-1' });
    now = 200;
    createProductEvent({ eventName: 'assistant_request', stage: 'assistant', result: 'success', objectId: 'req-2' });
    now = 300;
    createProductEvent({ eventName: 'assistant_retry', stage: 'assistant', result: 'success', objectId: 'req-1' });
    now = 500;
    createProductEvent({ eventName: 'assistant_recovered', stage: 'assistant', result: 'success', objectId: 'req-1', chapterId: 'chapter-1', durationMs: 400 });
    now = 600;
    createProductEvent({ eventName: 'draft_accept', stage: 'drafting', result: 'success', objectId: 'draft-1', chapterId: 'chapter-1' });
    now = 700;
    createProductEvent({ eventName: 'assistant_request', stage: 'assistant', result: 'success', objectId: 'req-3' });
    now = 800;
    createProductEvent({ eventName: 'assistant_failure', stage: 'assistant', result: 'failure', errorCode: 'timeout', objectId: 'req-3' });
    now = 900;
    createProductEvent({ eventName: 'assistant_request', stage: 'assistant', result: 'success', objectId: 'req-4' });
    now = 1000;
    createProductEvent({ eventName: 'assistant_empty_response', stage: 'assistant', result: 'failure', errorCode: 'empty_response', objectId: 'req-4' });

    const assistant = getProductEventMetrics(7).assistant;
    assert.deepEqual(assistant.emptyResponseRate, { value: 0.25, numerator: 1, denominator: 4 });
    assert.deepEqual(assistant.failureRate, { value: 0.75, numerator: 3, denominator: 4 });
    assert.deepEqual(assistant.retryWithin5mRate, { value: 1 / 3, numerator: 1, denominator: 3 });
    assert.deepEqual(assistant.recoveryLatencyMs, { p50: 400, p95: 400 });
    assert.deepEqual(assistant.recoveredChapterAcceptance, { value: 1, numerator: 1, denominator: 1 });
  } finally {
    Date.now = originalNow;
    closeDb();
  }
});

test('writing style metrics measure confirmation, launch latency, and accepted output', () => {
  closeDb();
  initDb(':memory:');
  clearProductEvents();
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  try {
    createProductEvent({ eventName: 'writing_style_required', stage: 'drafting', result: 'success', novelId: 'novel-1', chapterId: 'chapter-1', objectId: 'style-1' });
    createProductEvent({ eventName: 'writing_style_required', stage: 'drafting', result: 'success', novelId: 'novel-2', chapterId: 'chapter-2', objectId: 'style-2' });
    now = 100;
    createProductEvent({ eventName: 'writing_style_confirmed', stage: 'drafting', result: 'success', novelId: 'novel-1', chapterId: 'chapter-1', objectId: 'style-1' });
    now = 350;
    createProductEvent({ eventName: 'draft_preview', stage: 'drafting', result: 'success', novelId: 'novel-1', chapterId: 'chapter-1', objectId: 'draft-1' });
    now = 500;
    createProductEvent({ eventName: 'draft_accept', stage: 'drafting', result: 'success', novelId: 'novel-1', chapterId: 'chapter-1', objectId: 'draft-1' });

    const writingStyle = getProductEventMetrics(7).writingStyle;
    assert.deepEqual(writingStyle.confirmationCompletion, { value: 0.5, numerator: 1, denominator: 2 });
    assert.deepEqual(writingStyle.confirmationToDraftLatencyMs, { p50: 250, p95: 250 });
    assert.deepEqual(writingStyle.confirmedChapterAcceptance, { value: 1, numerator: 1, denominator: 1 });
  } finally {
    Date.now = originalNow;
    closeDb();
  }
});

test('product_events import schema is optional but strict when present', async () => {
  closeDb();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-product-events-'));
  const dbPath = path.join(directory, 'candidate.db');
  try {
    initDb(dbPath);
    closeDb();
    assert.doesNotThrow(() => validateDatabaseImportFile(dbPath));
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    const candidate = new Database(dbPath);
    candidate.exec('DROP TABLE product_events; CREATE TABLE product_events (id TEXT PRIMARY KEY, event_name TEXT NOT NULL, stage TEXT NOT NULL, duration_ms TEXT, result TEXT NOT NULL, error_code TEXT, novel_id TEXT, chapter_id TEXT, object_id TEXT, created_at INTEGER NOT NULL);');
    candidate.close();
    assert.throws(() => validateDatabaseImportFile(dbPath), /product_events\.duration_ms/);
    const noEvents = new Database(dbPath);
    noEvents.exec('DROP TABLE product_events;');
    noEvents.close();
    assert.doesNotThrow(() => validateDatabaseImportFile(dbPath));
  } finally {
    closeDb();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
