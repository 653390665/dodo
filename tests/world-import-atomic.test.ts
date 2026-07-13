import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-world-import-'));
const dbPath = path.join(testDir, 'world-import.db');
process.env.INKFLOW_DB_PATH = dbPath;

test('world extraction import is atomic', async (t) => {
  const db = await import('../server/lib/db');
  const { commitWorldExtraction } = await import('../server/routes/world');

  db.initDb(dbPath);
  const now = Date.now();
  db.createNovel({
    id: 'novel-1',
    title: '原作品',
    authorId: 'local-user',
    summary: '',
    status: 'ongoing',
    worldRules: '原规则',
    globalOutline: '原大纲',
    mountedSkillIds: [],
    createdAt: now,
    updatedAt: now,
  });

  const emptyCollections = {
    locations: [],
    items: [],
    factions: [],
    powerLevels: [],
    timelineEvents: [],
  };

  try {
    await t.test('commits outline and entities together on success', () => {
      commitWorldExtraction({
        novelId: 'novel-1',
        globalOutline: '新大纲',
        worldRules: '新规则',
        characters: [{
          name: '角色甲', role: 'supporting', summary: '', bio: '', traits: [],
        }],
        ...emptyCollections,
      }, () => 'character-success');

      assert.equal(db.getNovel('novel-1')?.globalOutline, '新大纲');
      assert.equal(db.listCharacters('novel-1').length, 1);
    });

    await t.test('rolls back outline when any entity insert fails', () => {
      assert.throws(() => commitWorldExtraction({
        novelId: 'novel-1',
        globalOutline: '不得残留的大纲',
        worldRules: '不得残留的规则',
        characters: [
          { name: '角色乙', role: 'supporting', summary: '', bio: '', traits: [] },
          { name: '角色丙', role: 'supporting', summary: '', bio: '', traits: [] },
        ],
        ...emptyCollections,
      }, () => 'duplicate-character-id'));

      assert.equal(db.getNovel('novel-1')?.globalOutline, '新大纲');
      assert.deepEqual(db.listCharacters('novel-1').map((character) => character.name), ['角色甲']);
    });
  } finally {
    db.closeDb();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
