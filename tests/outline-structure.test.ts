import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOutlineHierarchy } from '../shared/lib/outline-structure.js';
import { buildOutlineImpactReport } from '../server/helpers/outline-impact.js';
import type { OutlineArtifact, StructuredOutlineCore } from '../shared/types/outline-governance.js';

function core(nodes: StructuredOutlineCore['nodes'], promiseActions: StructuredOutlineCore['promiseActions'] = []): StructuredOutlineCore {
  return { schemaVersion: 1, nodes, promiseActions };
}

function artifact(input: {
  id: string;
  level: OutlineArtifact['level'];
  scope: OutlineArtifact['scope'];
  core?: StructuredOutlineCore;
}): OutlineArtifact {
  return {
    id: input.id,
    novelId: 'novel-1',
    level: input.level,
    scope: input.scope,
    content: input.id,
    source: 'user',
    status: 'active',
    version: 1,
    ...(input.core ? { core: input.core } : {}),
  };
}

test('hierarchy validation accepts an upstream parent and planned payoff in range', () => {
  const result = validateOutlineHierarchy({
    artifact: artifact({
      id: 'volume-1',
      level: 'volume',
      scope: { volumeName: '卷一' },
      core: core([{
        id: 'volume-turn', parentNodeId: 'master-conflict', type: 'turn', title: '转折', intent: '推进', order: 0,
        characterIds: ['hero'], foreshadowingIds: ['promise-1'],
      }], [{ foreshadowingId: 'promise-1', action: 'payoff', chapterRange: { from: 6, to: 7 } }]),
    }),
    upstreamNodeIds: ['master-conflict'],
    siblingScopes: [],
    characterIds: ['hero'],
    foreshadowings: [{ id: 'promise-1', plannedPayoffRange: { from: 6, to: 8 } }],
  });

  assert.deepEqual(result, { ok: true, issues: [] });
});

test('hierarchy validation returns stable issues for bad parent, scope, and references', () => {
  const result = validateOutlineHierarchy({
    artifact: artifact({
      id: 'chapter-2',
      level: 'chapter',
      scope: { chapterStart: 4, chapterEnd: 6 },
      core: core([{
        id: 'chapter-turn', parentNodeId: 'lost-volume-node', type: 'turn', title: '转折', intent: '推进', order: 0,
        characterIds: ['missing-character'], foreshadowingIds: ['missing-promise'],
      }], [
        { foreshadowingId: 'missing-promise', action: 'plant', chapterRange: { from: 7, to: 6 } },
        { foreshadowingId: 'promise-1', action: 'payoff', chapterRange: { from: 2, to: 3 } },
      ]),
    }),
    upstreamNodeIds: ['volume-turn'],
    siblingScopes: [artifact({ id: 'chapter-1', level: 'chapter', scope: { chapterStart: 2, chapterEnd: 4 } })],
    characterIds: [],
    foreshadowings: [{ id: 'promise-1', plannedPayoffRange: { from: 5, to: 7 } }],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    'OUTLINE_SCOPE_OVERLAP',
    'OUTLINE_UPSTREAM_NODE_MISSING',
    'OUTLINE_CHARACTER_MISSING',
    'OUTLINE_FORESHADOWING_MISSING',
    'OUTLINE_PROMISE_NOT_FOUND',
    'OUTLINE_PROMISE_RANGE_INVALID',
    'OUTLINE_PROMISE_PAYOFF_PREMATURE',
  ]);
  assert.equal(result.issues[0]?.detail, 'chapter range overlaps active sibling chapter-1');
});

test('hierarchy validation rejects parent nodes on a master', () => {
  const result = validateOutlineHierarchy({
    artifact: artifact({
      id: 'master-1', level: 'master', scope: {},
      core: core([{
        id: 'master-node', parentNodeId: 'forbidden', type: 'premise', title: '起点', intent: '建立', order: 0,
        characterIds: [], foreshadowingIds: [],
      }]),
    }),
    siblingScopes: [],
    characterIds: [],
    foreshadowings: [],
  });

  assert.deepEqual(result.issues, [{
    code: 'OUTLINE_MASTER_PARENT_FORBIDDEN', detail: 'master node master-node cannot reference an upstream parent',
  }]);
});

test('outline impacts mark only active downstream cores that lose an upstream parent', () => {
  const report = buildOutlineImpactReport({
    proposedUpstreamNodeIds: ['still-present'],
    activeDownstream: [
      artifact({
        id: 'volume-stale', level: 'volume', scope: { volumeName: '卷一' },
        core: core([{
          id: 'volume-node', parentNodeId: 'lost-master-node', type: 'turn', title: '旧转折', intent: '推进', order: 0,
          characterIds: [], foreshadowingIds: [],
        }]),
      }),
      artifact({
        id: 'volume-fresh', level: 'volume', scope: { volumeName: '卷二' },
        core: core([{
          id: 'volume-node-2', parentNodeId: 'still-present', type: 'turn', title: '新转折', intent: '推进', order: 0,
          characterIds: [], foreshadowingIds: [],
        }]),
      }),
      artifact({ id: 'legacy-volume', level: 'volume', scope: { volumeName: '旧卷' } }),
    ],
  });

  assert.deepEqual(report.reviewRequired, [{ kind: 'volume-outline', id: 'volume-stale', version: 1 }]);
  assert.deepEqual(report.downstream, report.reviewRequired);
  assert.equal(report.manuscriptConflict, false);
  assert.deepEqual(report.reasons, ['missing upstream node: lost-master-node']);
});
