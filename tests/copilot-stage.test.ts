import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCopilotStage,
  buildCopilotSuggestion,
  type CopilotInput,
} from '../src/lib/copilot-stage';

function baseInput(overrides: Partial<CopilotInput> = {}): CopilotInput {
  return {
    hasCurrentChapter: true,
    hasSummary: true,
    hasGlobalOutline: true,
    hasWorldRules: true,
    hasContinuationPackContext: false,
    hasSceneBeats: true,
    hasChapterContent: false,
    hasCritique: false,
    hasSniffedNewEntities: false,
    mountedSkillCount: 2,
    fitScore: 82,
    lastFocusArea: 'editor',
    ...overrides,
  };
}

test('deriveCopilotStage returns missing-setup when core story frame is absent', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasSummary: false,
      hasGlobalOutline: false,
      hasWorldRules: false,
    }),
  );
  assert.equal(stage, 'missing-setup');
});

test('deriveCopilotStage treats approved continuation pack as story frame', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasSummary: false,
      hasGlobalOutline: false,
      hasWorldRules: false,
      hasContinuationPackContext: true,
      hasSceneBeats: true,
      hasChapterContent: false,
    }),
  );
  assert.equal(stage, 'ready-to-draft');
});

test('deriveCopilotStage returns missing-beats when chapter exists but has no scene beats', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasSceneBeats: false,
      hasChapterContent: false,
    }),
  );
  assert.equal(stage, 'missing-beats');
});

test('deriveCopilotStage returns ready-to-draft when beats exist but正文为空', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasSceneBeats: true,
      hasChapterContent: false,
    }),
  );
  assert.equal(stage, 'ready-to-draft');
});

test('deriveCopilotStage returns pending-audit when正文已生成但尚未审计', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasChapterContent: true,
      hasCritique: false,
    }),
  );
  assert.equal(stage, 'pending-audit');
});

test('deriveCopilotStage returns pending-polish when已有审计结果', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasChapterContent: true,
      hasCritique: true,
    }),
  );
  assert.equal(stage, 'pending-polish');
});

test('deriveCopilotStage prioritizes syncing memory before quality improvements', () => {
  const stage = deriveCopilotStage(
    baseInput({
      hasChapterContent: true,
      hasCritique: false,
      hasSniffedNewEntities: true,
    }),
  );
  assert.equal(stage, 'needs-memory-sync');
});

test('buildCopilotSuggestion returns one primary action and reason summary', () => {
  const suggestion = buildCopilotSuggestion(
    baseInput({
      hasSceneBeats: false,
      hasChapterContent: false,
      lastFocusArea: 'planning',
    }),
  );

  assert.equal(suggestion.stage, 'missing-beats');
  assert.equal(suggestion.primaryAction.key, 'generate-beats');
  assert.equal(suggestion.secondaryActions.length <= 2, true);
  assert.equal(suggestion.reasons.missing.includes('scene beats'), true);
});
