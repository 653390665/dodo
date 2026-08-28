import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalWritingStyleFingerprint,
  checkWritingStyleConfirmation,
  resolveWritingStyle,
} from '../server/helpers/writing-style-resolver';

test('defaults to writer-skill and gives slot1 precedence over pack and session cards', () => {
    const result = resolveWritingStyle({
      mode: undefined,
      writerSkill: { id: 'writer-1', style: '冷峻', version: 2 },
      pack: { novelId: 'novel-1', status: 'approved', styleProfile: { pacing: '慢' } },
      sessionCards: [{ id: 'card-1', style: '明快' }],
      novelId: 'novel-1',
    });
    assert.equal(result.mode, 'writer-skill'); assert.equal(result.slots[0]?.source, 'writer-skill'); assert.equal(result.slots[1]?.source, 'continuation-pack'); assert.equal(result.slots[2]?.source, 'writer-session'); assert.equal(result.sessionCards.length, 1);
});

test('rejects more than six writer session cards and ignores client skill payload', () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({ id: `card-${index}`, style: `s${index}` }));
    assert.throws(
      () => resolveWritingStyle({ novelId: 'n', sessionCards: cards, clientSkills: [{ id: 'client-only' }] }),
      /TOO_MANY_SESSION_CARDS/,
    );
    const result = resolveWritingStyle({ novelId: 'n', sessionCards: cards.slice(0, 1), clientSkills: [{ id: 'client-only' }] });
    assert.equal(result.sessionCards.length, 1); assert.equal(JSON.stringify(result).includes('client-only'), false);
});

test('has stable canonical fingerprints and changes when writer changes', () => {
    const a = resolveWritingStyle({ novelId: 'n', writerSkill: { id: 'w', style: 'a' } });
    const b = resolveWritingStyle({ novelId: 'n', writerSkill: { style: 'a', id: 'w' } });
    const c = resolveWritingStyle({ novelId: 'n', writerSkill: { id: 'w2', style: 'a' } });
    assert.equal(canonicalWritingStyleFingerprint(a), canonicalWritingStyleFingerprint(b)); assert.notEqual(canonicalWritingStyleFingerprint(a), canonicalWritingStyleFingerprint(c));
});

test('requires an explicit current confirmation and rejects stale sources', () => {
  const first = canonicalWritingStyleFingerprint(resolveWritingStyle({
    novelId: 'n',
    styleAnchors: ['克制', ' 短句\r\n '],
    writerSkill: { id: 'writer', version: 1, style: '冷峻' },
  }));
  const changed = canonicalWritingStyleFingerprint(resolveWritingStyle({
    novelId: 'n',
    styleAnchors: ['克制', '短句'],
    writerSkill: { id: 'writer', version: 2, style: '冷峻' },
  }));

  assert.equal(checkWritingStyleConfirmation({ currentFingerprint: first }).ok, false);
  assert.equal(checkWritingStyleConfirmation({
    currentFingerprint: first,
    providedFingerprint: first,
    storedFingerprint: first,
  }).ok, true);
  assert.equal(checkWritingStyleConfirmation({
    currentFingerprint: changed,
    providedFingerprint: first,
    storedFingerprint: first,
  }).ok, false);
});

test('normalizes anchors and changes the fingerprint only when style content changes', () => {
  const a = resolveWritingStyle({ novelId: 'n', styleAnchors: ['短句', '克制', '短句'] });
  const b = resolveWritingStyle({ novelId: 'n', styleAnchors: [' 克制 ', '短句\r\n'] });
  const c = resolveWritingStyle({ novelId: 'n', styleAnchors: ['明快', '短句'] });

  assert.equal(canonicalWritingStyleFingerprint(a), canonicalWritingStyleFingerprint(b));
  assert.notEqual(canonicalWritingStyleFingerprint(a), canonicalWritingStyleFingerprint(c));
});

test('normalizes style profile collections and ignores non-style pack metadata', () => {
  const a = resolveWritingStyle({
    novelId: 'n',
    pack: { novelId: 'n', status: 'approved', styleProfile: {
      pov: ' 第三人称\r\n', proseTraits: ['冷峻', '克制', '冷峻'], avoidTraits: ['空泛'], sampleEvidence: '样章',
    } },
  });
  const b = resolveWritingStyle({
    novelId: 'n',
    pack: { novelId: 'n', status: 'approved', styleProfile: {
      pov: '第三人称', proseTraits: ['克制', '冷峻'], avoidTraits: ['空泛'], sampleEvidence: '样章',
    } },
  });
  const c = resolveWritingStyle({
    novelId: 'n',
    pack: { novelId: 'n', status: 'approved', styleProfile: {
      pov: '第三人称', proseTraits: ['克制', '冷峻'], avoidTraits: ['空泛'], sampleEvidence: '样章', extraNonStyleMetadata: 'changed',
    } },
  });
  assert.equal(canonicalWritingStyleFingerprint(a), canonicalWritingStyleFingerprint(b));
  assert.equal(canonicalWritingStyleFingerprint(a), canonicalWritingStyleFingerprint(c));
});

test('pack identity and approval status participate in the writing style fingerprint', () => {
  const base = { novelId: 'n', status: 'approved' as const, styleProfile: { pov: '第三人称' } };
  const first = resolveWritingStyle({ novelId: 'n', pack: { ...base, id: 'pack-1' } });
  const second = resolveWritingStyle({ novelId: 'n', pack: { ...base, id: 'pack-2' } });
  const draft = resolveWritingStyle({ novelId: 'n', pack: { ...base, id: 'pack-1', status: 'draft' } });

  assert.notEqual(canonicalWritingStyleFingerprint(first), canonicalWritingStyleFingerprint(second));
  assert.notEqual(canonicalWritingStyleFingerprint(first), canonicalWritingStyleFingerprint(draft));
});

test('skill deck runtime metadata participates in the writing style fingerprint', () => {
  const base = { id: 'card', type: 'style-card', version: 1, source: 'fused', position: 'project-main', dimensionOwners: { style: 'card' }, resolvedRules: { style: '冷峻' }, lineage: { root: 'card' }, runtimeContent: '{"style":"冷峻"}' };
  const first = canonicalWritingStyleFingerprint(resolveWritingStyle({ novelId: 'n', mode: 'skill-deck', skillDeck: [base] }));
  const versionChanged = canonicalWritingStyleFingerprint(resolveWritingStyle({ novelId: 'n', mode: 'skill-deck', skillDeck: [{ ...base, version: 2 }] }));
  const rulesChanged = canonicalWritingStyleFingerprint(resolveWritingStyle({ novelId: 'n', mode: 'skill-deck', skillDeck: [{ ...base, resolvedRules: { style: '明快' } }] }));
  assert.notEqual(first, versionChanged);
  assert.notEqual(first, rulesChanged);
});

test('rejects cross-novel packs and allows draft packs with a warning', () => {
    assert.throws(() => resolveWritingStyle({ novelId: 'n1', pack: { novelId: 'n2', status: 'approved', styleProfile: {} } }), /novel/i);
    const result = resolveWritingStyle({ novelId: 'n1', pack: { novelId: 'n1', status: 'draft', styleProfile: {} } });
    assert.ok(result.warnings.includes('continuation-pack-draft'));
});
