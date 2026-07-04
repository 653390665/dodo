import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDb,
  createNovel,
  initDb,
  createCharacter,
  getCharacter,
  updateCharacter,
  listCharacters,
} from '../server/lib/db';
import type { Novel, Character } from '../shared/types';

function makeBaseNovel(): Novel {
  const now = Date.now();
  return {
    id: 'novel-char-state-1',
    title: '状态落盘测试小说',
    authorId: 'local-user',
    summary: '测试角色状态持久化',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    projectPreferenceProfile: {
      tags: [],
      weights: {
        styleWeight: 0.5,
        characterWeight: 0.5,
        worldWeight: 0.5,
        plotWeight: 0.5,
        pacingWeight: 0.5,
      },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function makeBaseCharacter(novelId: string): Character {
  const now = Date.now();
  return {
    id: 'char-state-test-1',
    novelId,
    name: '测试角色',
    role: 'protagonist',
    summary: '这是一个状态落盘测试角色',
    traits: ['坚韧', '智睿'],
    bio: '背景经历...',
    current_state: '身处林中, 遭遇野兽袭击',
    createdAt: now,
    updatedAt: now,
  };
}

describe("db-character-state", () => {
  test('current_state persists through create, update and cold reboot', () => {
    closeDb();
    const dbPath = path.join(os.tmpdir(), `inkflow-char-state-${Date.now()}.db`);

    try {
      // 1. 初始化数据库
      initDb(dbPath);

      // 2. 创建作品与角色
      const novel = makeBaseNovel();
      createNovel(novel);

      const character = makeBaseCharacter(novel.id);
      createCharacter(character);

      // 3. 验证创建时的 current_state 能被 getCharacter 完整读回
      const retrieved = getCharacter(character.id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.current_state, '身处林中, 遭遇野兽袭击');

      // 4. 验证创建时的 current_state 能被 listCharacters 完整读回
      const list = listCharacters(novel.id);
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].current_state, '身处林中, 遭遇野兽袭击');

      // 5. 修改角色状态
      updateCharacter(character.id, {
        current_state: '成功击败野兽, 正在打扫战场',
      });

      // 6. 验证修改后的状态能正常被读取
      const updated = getCharacter(character.id);
      assert.ok(updated);
      assert.strictEqual(updated.current_state, '成功击败野兽, 正在打扫战场');

      // 7. 物理冷重启：关闭数据库、重新加载
      closeDb();
      initDb(dbPath);

      // 8. 重新加载后验证持久化到磁盘的字段依然存在且正确
      const rebooted = getCharacter(character.id);
      assert.ok(rebooted);
      assert.strictEqual(rebooted.current_state, '成功击败野兽, 正在打扫战场');

    } finally {
      // 清理临时数据库
      closeDb();
      if (fs.existsSync(dbPath)) {
        try {
          fs.unlinkSync(dbPath);
        } catch {
          // 忽略清理时的失败
        }
      }
    }
  });
});
