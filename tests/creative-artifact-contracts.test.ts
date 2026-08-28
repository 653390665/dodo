import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ArtifactCandidate,
  CharacterCore,
  ChapterCompletionGate,
  CreativeArtifactKind,
  NarrativePromiseCore,
} from '../shared/types.js';
import type { Character, Foreshadowing } from '../shared/types.js';

test('legacy character remains valid without a structured core', () => {
  const legacyCharacter: Character = {
    id: 'c1', novelId: 'n1', name: '叶半夏', role: 'protagonist',
    summary: '药师', traits: [], bio: '',
  };
  assert.equal(legacyCharacter.core, undefined);
});

test('narrative promise keeps plan and evidence separate', () => {
  const promise: NarrativePromiseCore = {
    schemaVersion: 1,
    plan: {
      intent: '戒指身份悬念',
      plannedHintRanges: [{ from: 3, to: 5 }],
      sourceOutlineNodeIds: ['master-hook-1'],
    },
    evidence: [],
  };
  assert.equal(promise.evidence.length, 0);
  assert.equal(promise.plan.plannedHintRanges[0]?.from, 3);
});

test('foreshadowing status stays a compatibility projection', () => {
  const status: Foreshadowing['status'] = 'planted';
  assert.ok(['planted', 'hinted', 'payoff'].includes(status));
  const plannedOnly: Foreshadowing = {
    id: 'f1', novelId: 'n1', title: '戒指', description: '', status,
    relatedCharacterIds: [], createdAt: 0, updatedAt: 0,
    narrativeCore: {
      schemaVersion: 1,
      plan: { intent: '身份悬念', plannedHintRanges: [{ from: 3, to: 5 }], sourceOutlineNodeIds: [] },
      evidence: [],
    },
  };
  assert.equal(plannedOnly.status, 'planted');
  assert.equal(plannedOnly.narrativeCore?.evidence.length, 0);
});

test('chapter completion gate and candidate contracts are explicit', () => {
  const gate: ChapterCompletionGate = 'review-required';
  const kind: CreativeArtifactKind = 'character';
  const candidate: ArtifactCandidate<CharacterCore> = {
    id: 'candidate-1', novelId: 'n1', target: { kind, id: 'c1', version: 1 },
    operation: 'restructure', goal: '补齐人物矛盾', baseFingerprint: 'fp',
    sourceCapabilityVersions: [{ capabilityId: 'bible-character-arc', version: '1' }],
    proposedCore: {
      schemaVersion: 1, desire: '活下去', externalGoal: '查清真相', internalNeed: '信任他人',
      fear: '失去控制', woundOrFalseBelief: '只能独自承担', strengths: ['坚韧'], flaws: ['多疑'],
      contradictions: ['渴望亲近又拒绝帮助'], speechPattern: '短句', habitualActions: ['摸戒指'],
      decisionPattern: '先试探后行动', relationshipTensions: [], arc: { start: '封闭', turns: [], target: '开放' },
      immutableFacts: [],
    },
    diff: { changed: true, fields: [{ path: 'desire', before: '', after: '活下去', kind: 'changed' }] },
    impactReport: { downstream: [], reviewRequired: [], manuscriptConflict: false, reasons: [] },
    status: 'pending',
  };
  assert.equal(gate, 'review-required');
  assert.equal(candidate.target.kind, 'character');
});
