import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDb,
  createNovel,
  getNovel,
  initDb,
  listNovels,
  updateNovel,
} from '../server/lib/db';
import type { Novel, ProjectPreferenceProfile } from '../shared/types';

function baseProfile(): ProjectPreferenceProfile {
  return {
    tags: ['冷峻', '强冲突'],
    weights: {
      styleWeight: 0.7,
      characterWeight: 0.6,
      worldWeight: 0.3,
      plotWeight: 0.8,
      pacingWeight: 0.7,
    },
    acceptedDimensions: ['style', 'plot'],
    rejectedDimensions: ['world'],
    notes: ['更接受短句压迫感'],
    evidenceCount: 2,
  };
}

function baseNovel(profile: ProjectPreferenceProfile): Novel {
  const now = Date.now();
  return {
    id: 'novel-pref-1',
    title: '偏好测试作品',
    authorId: 'local-user',
    summary: '测试项目偏好画像持久化',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    projectPreferenceProfile: profile,
    createdAt: now,
    updatedAt: now,
  };
}

describe("db-compat", () => {
test('projectPreferenceProfile persists through createNovel getNovel updateNovel listNovels', () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-pref-${Date.now()}.db`);

  try {
    initDb(dbPath);

    createNovel(baseNovel(baseProfile()));

    const created = getNovel('novel-pref-1');
    assert.ok(created);
    assert.deepEqual(created.projectPreferenceProfile?.tags, ['冷峻', '强冲突']);
    assert.equal(created.projectPreferenceProfile?.weights.styleWeight, 0.7);
    assert.deepEqual(created.projectPreferenceProfile?.acceptedDimensions, ['style', 'plot']);
    assert.deepEqual(created.projectPreferenceProfile?.rejectedDimensions, ['world']);

    updateNovel('novel-pref-1', {
      projectPreferenceProfile: {
        tags: ['紧推进', '重人物张力'],
        weights: {
          styleWeight: 0.4,
          characterWeight: 0.9,
          worldWeight: 0.2,
          plotWeight: 0.8,
          pacingWeight: 0.85,
        },
        acceptedDimensions: ['character', 'pacing'],
        rejectedDimensions: ['world'],
        notes: ['世界设定不要压过人物冲突', '本项目偏快节奏'],
        evidenceCount: 4,
      },
    });

    const updated = getNovel('novel-pref-1');
    assert.ok(updated);
    assert.deepEqual(updated.projectPreferenceProfile?.tags, ['紧推进', '重人物张力']);
    assert.equal(updated.projectPreferenceProfile?.weights.characterWeight, 0.9);
    assert.deepEqual(updated.projectPreferenceProfile?.acceptedDimensions, ['character', 'pacing']);
    assert.deepEqual(updated.projectPreferenceProfile?.notes, ['世界设定不要压过人物冲突', '本项目偏快节奏']);
    assert.equal(updated.projectPreferenceProfile?.evidenceCount, 4);

    const novels = listNovels();
    const listed = novels.find((novel) => novel.id === 'novel-pref-1');
    assert.ok(listed);
    assert.deepEqual(listed.projectPreferenceProfile?.tags, ['紧推进', '重人物张力']);
    assert.equal(listed.projectPreferenceProfile?.weights.pacingWeight, 0.85);
  } finally {
    closeDb();
    fs.rmSync(dbPath, { force: true });
  }
});
});
