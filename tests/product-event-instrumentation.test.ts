import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const files = [
  'src/lib/prompt-client.ts',
  'src/lib/continuation-client.ts',
  'src/lib/hooks/useChapterProductionFlow.ts',
  'src/lib/hooks/generation/useAuditPolishActions.ts',
  'src/lib/hooks/useEditorPersistence.ts',
  'src/components/EditorView.tsx',
];

test('the local funnel records every governed milestone', () => {
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const eventName of [
    'continuation_parse', 'continuation_confirm', 'continuation_conflict', 'world_sync',
    'scene_plan', 'draft_preview', 'critic_review', 'draft_accept', 'audit', 'polish', 'next_chapter',
  ]) {
    assert.match(source, new RegExp(`eventName: ['"]${eventName}['"]`));
  }
  for (const eventName of ['writing_style_required', 'writing_style_confirmed', 'writing_style_stale']) {
    assert.match(source, new RegExp(`eventName: ['"]${eventName}['"]`));
  }
});

test('writing style panel lifecycle events are part of the governed event catalog', () => {
  const catalog = fs.readFileSync('shared/types/product-events.ts', 'utf8');
  for (const eventName of ['writing_style_panel_opened', 'writing_style_panel_recovered', 'writing_style_panel_error']) {
    assert.match(catalog, new RegExp(`['"]${eventName}['"]`));
  }
});

test('writing style panel refresh records recovered on success and error on failure', () => {
  const source = fs.readFileSync('src/components/AgentWorkspace.tsx', 'utf8');
  assert.match(source, /setSkillsProfileOverride[\s\S]*?eventName: 'writing_style_panel_recovered',[\s\S]*?result: 'success'/);
  assert.match(source, /catch \{[\s\S]*?eventName: 'writing_style_panel_error',[\s\S]*?result: 'failure'[\s\S]*?WRITING_STYLE_PROFILE_REFRESH_FAILED/);
  assert.doesNotMatch(source, /finally \{\s*setSkillsPanelRevision/);
  assert.match(source, /skillsPanelContextRef\.current !== requestContext/);
});

test('capability lifecycle events are emitted from their real execution surfaces', () => {
  const skillsStudio = fs.readFileSync('src/components/SkillsStudioView.tsx', 'utf8');
  const editor = fs.readFileSync('src/components/EditorView.tsx', 'utf8');
  const skillDrawer = fs.readFileSync('src/components/skills/SkillDetailDrawer.tsx', 'utf8');

  assert.match(skillsStudio, /eventName: 'capability_returned_to_editor'/);
  assert.match(editor, /eventName: 'chapter_overlay_used'/);
  assert.match(editor, /eventName: 'diagnostic_run'/);
  assert.match(editor, /eventName: 'capability_preview'[\s\S]*action: result\.kind[\s\S]*sessionId: previewSessionId/);
  assert.match(editor, /eventName: 'capability_apply'[\s\S]*\.\.\.eventMetadata[\s\S]*eventId: `event:capability-apply:\$\{eventMetadata\.sessionId\}`/);
  assert.match(editor, /eventName: 'capability_cancel'[\s\S]*\.\.\.eventMetadata[\s\S]*eventId: `event:capability-cancel:\$\{eventMetadata\.sessionId\}`/);
  assert.match(skillDrawer, /eventName: 'fusion_previewed'/);
  assert.match(skillDrawer, /eventName: 'fusion_saved'/);
  assert.doesNotMatch(editor, /eventName: 'capability_return'/);
});

test('product event call sites do not include writing or model payload fields', () => {
  const forbiddenField = /\b(?:content|text|prompt|feedback|modelOutput|sourceDocuments)\s*:/;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const calls = source.match(/recordProductEvent\(\{[\s\S]*?\}\)/g) || [];
    assert.ok(calls.length > 0, `${file} must record at least one product event`);
    for (const call of calls) assert.doesNotMatch(call, forbiddenField, file);
  }
});

test('terminal error paths preserve explicit telemetry outcomes', () => {
  const prompt = fs.readFileSync('src/lib/prompt-client.ts', 'utf8');
  const continuation = fs.readFileSync('src/lib/continuation-client.ts', 'utf8');
  const production = fs.readFileSync('src/lib/hooks/useChapterProductionFlow.ts', 'utf8');
  const auditPolish = fs.readFileSync('src/lib/hooks/generation/useAuditPolishActions.ts', 'utf8');

  assert.match(prompt, /MALFORMED_JSON/);
  assert.match(prompt, /POLLING_MALFORMED_JSON/);
  assert.match(prompt, /POLLING_HTTP_/);
  assert.match(continuation, /MALFORMED_JSON/);
  assert.match(continuation, /'unknown'/);
  assert.match(continuation, /let recorded = false/);
  assert.match(continuation, /if \(recorded\) return/);
  assert.match(production, /eventName: 'draft_preview',[\s\S]*result: 'unknown'/);
  assert.match(auditPolish, /eventName: 'audit',[\s\S]*result: 'unknown'/);
  assert.match(auditPolish, /eventName: 'polish',[\s\S]*result: 'unknown'/);
  assert.match(auditPolish, /OPERATION_CANCELLED/);
});
